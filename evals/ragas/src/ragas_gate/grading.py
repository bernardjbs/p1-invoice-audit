"""Grade the prose. The only part of the gate that costs money.

Three of the four metrics are exact lookups against the answer key and live in
`checks`. This module handles the one question no lookup can answer: does the
written explanation actually follow from what the engine was shown?

Everything here except the score itself is ordinary code, and is tested without
a model, credentials or network.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"
"""Cheapest tier first, deliberately.

The plan requires an agreement check against a stronger judge on a handful of
rows before this is trusted, and the agreement rate recorded. Until that has
run, treat a score from here as provisional.
"""

DEFAULT_CACHE_DIR = ".cache/judge"
"""Judge replies are cached by content.

Re-grading after a threshold tweak must not re-pay for the same judgement, and
`runs` is the factor with the multiplier in it: rows x metrics x runs.
"""

MAX_JUDGE_TOKENS = 4096

CONCURRENCY = 4


RUBRIC_SCALE_HEADING = "## Scoring scale"
RUBRIC_LEVELS = 5


@dataclass(frozen=True)
class GradingRow:
    invoice_number: str
    case: str
    question: str
    answer: str
    contexts: list[str]
    reference: str = ""
    expects_breach: bool = True


def applies_faithfulness(raw: dict) -> bool:
    """Whether the support-for-claims question means anything on this row.

    Calibrated 2026-09-08: a CORRECT pass explanation scores 0.00, because a pass
    asserts that no clause applies, and an absence cannot be supported by a
    document. The metric is therefore undefined on a pass row, not failing on
    one -- the same treatment retrieval recall already gets on a clean invoice.

    Keyed on the ANSWER KEY, never the engine's own verdict. Otherwise a wrongly
    passing row would exempt itself from the metric, and the set of graded rows
    would move between runs, which is the one thing a fixed dataset exists to
    prevent.
    """
    return str(raw.get("expected_verdict")) == "breach"


def parse_rubric_levels(rubric: str) -> dict[str, str]:
    """Read the five scoring levels out of the rubric file.

    The rubric stays the single source: the prose a human argues over and the
    scale the judge marks against are the same document, so they cannot drift.

    Refuses rather than falling back to the library's generic scale. A default
    scale would grade against criteria nobody wrote while still looking like it
    worked, which is the failure this whole gate is built to avoid.
    """
    body = rubric.split(RUBRIC_SCALE_HEADING, 1)
    if len(body) < 2:
        raise ValueError(
            f"the rubric has no scoring scale (expected a '{RUBRIC_SCALE_HEADING}' section) "
            "— the judge would fall back to a generic scale nobody wrote"
        )
    # Stop at the next top-level section, so the last level does not run on into
    # whatever follows the scale.
    scale = re.split(r"^## ", body[1], flags=re.MULTILINE)[0]

    levels: dict[str, str] = {}
    for match in re.finditer(
        r"^### Score (\d)\s*\n(.*?)(?=^### Score \d|\Z)", scale, re.MULTILINE | re.DOTALL
    ):
        levels[f"score{match.group(1)}_description"] = " ".join(match.group(2).split())

    if len(levels) != RUBRIC_LEVELS:
        raise ValueError(
            f"the rubric's scoring scale has {len(levels)} of {RUBRIC_LEVELS} levels "
            "— every level must be written before the judge marks against it"
        )
    return levels


def normalise_rubric_score(value: float | None) -> float | None:
    """The scale is 1-5; every threshold in the gate is 0-1."""
    if value is None:
        return None
    return (float(value) - 1.0) / 4.0


class Metric(Protocol):
    async def ascore(self, user_input: str, response: str, retrieved_contexts: list[str]) -> Any: ...


def judge_contexts(raw: dict) -> list[str]:
    """The documents a claim in the summary may rest on.

    The clauses the retriever returned, PLUS the invoice as the engine read it.
    The rubric's first criterion says a claim may be supported by the cited
    clause *or the invoice as rendered*, and the second criterion REQUIRES the
    summary to say what the invoice did -- so withholding the invoice marked a
    correct answer down for obeying the rubric. Measured on the prose-only
    breach, one variable held: the same answer and the same clauses scored 0.00
    with the invoice withheld and 1.00 with it supplied.

    Assembled here rather than stored in the dataset on purpose. The dataset's
    `retrieved_contexts` stays the honest record of what the retriever returned,
    so retrieval recall remains a statement about retrieval alone.
    """
    contexts = list(raw["retrieved_contexts"])
    rendered = raw.get("invoice_rendered")
    if rendered:
        contexts.append(rendered)
    return contexts


def load_grading_rows(path: Path) -> list[GradingRow]:
    rows: list[GradingRow] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        rows.append(
            GradingRow(
                invoice_number=raw["invoice_number"],
                case=raw["case"],
                question=raw["question"],
                answer=raw["answer"],
                contexts=judge_contexts(raw),
                reference=str(raw.get("reference") or ""),
                expects_breach=applies_faithfulness(raw),
            )
        )
    return rows


def build_judge(
    model: str = DEFAULT_JUDGE_MODEL,
    client: Any | None = None,
    cache_dir: str = DEFAULT_CACHE_DIR,
) -> Any:
    """Construct the judge.

    Two traps, both undocumented and both found the hard way:

    1. The adapter sets `temperature` AND `top_p`; the Anthropic API rejects the
       pair. It fails at request time, not at setup, so it is popped here and
       asserted in a test rather than remembered.
    2. The Anthropic SDK removed `temperature` in 1.x while the adapter still
       sends it, which is why the dependency is pinned below 1.0.
    """
    from ragas.cache import DiskCacheBackend
    from ragas.llms import llm_factory

    if client is None:
        from anthropic import AsyncAnthropic

        # The async client specifically: the metric's scoring path is async, and
        # a sync client there fails inside the adapter rather than at setup.
        client = AsyncAnthropic()

    judge = llm_factory(
        model,
        provider="anthropic",
        client=client,
        cache=DiskCacheBackend(cache_dir=cache_dir),
    )
    judge.model_args.pop("top_p", None)

    # The adapter's default cap is 1024, and faithfulness blew through it on two
    # invoices (2026-09-08): it decomposes an answer into claims and checks each
    # against every clause, so its output grows with the contract, not with the
    # summary. A truncated reply is recorded as UNGRADED, which is honest but
    # means a row can quietly stop being measured.
    #
    # This is a cap, not a charge -- generation is billed by what is produced --
    # so raising it costs nothing unless the judge genuinely needs the room. The
    # cost lever it appears to contradict is about stopping runaway generation,
    # and a limit that truncates correct work is the more expensive failure.
    judge.model_args["max_tokens"] = MAX_JUDGE_TOKENS
    return judge


def build_metric(judge: Any) -> Metric:
    from ragas.metrics.collections import Faithfulness

    return Faithfulness(llm=judge)


def build_rubric_metric(judge: Any, rubric: str) -> Metric:
    """The metric that marks against what we actually wrote.

    Faithfulness answers one question well and two badly (see
    `applies_faithfulness`, and the calibration recorded in the rubric). This one
    covers what it cannot see: vagueness, a pass that fails to explain itself,
    and an obeyed instruction.

    Scored WITH the reference, because the dataset carries the answer key's own
    explanation of why the invoice is or is not in breach. Marking prose against
    the truth beats marking it against the documents alone.
    """
    from ragas.metrics.collections import DomainSpecificRubrics

    return DomainSpecificRubrics(
        llm=judge,
        rubrics=parse_rubric_levels(rubric),
        with_reference=True,
        name="rubric_score",
    )


async def grade_rows(
    rows: list[GradingRow],
    metric: Metric,
    rubric_metric: Metric | None = None,
) -> list[dict]:
    """Score every row, and never let one failure discard the rest.

    A row the judge could not score is recorded as None, not 0.0. They mean
    opposite things and the gate reads them differently: zero says the judge
    looked and found nothing supported; None says no score exists, which is what
    the minimum-graded check counts. A collapsed grading run must not read as a
    run of bad scores.

    A third state, NOT_APPLICABLE, says the question is undefined on this row --
    faithfulness on a pass, where there is nothing positive to support.
    """
    from .scoring import NOT_APPLICABLE

    limit = asyncio.Semaphore(CONCURRENCY)

    async def attempt(what: str, row: GradingRow, call: Any) -> float | None:
        try:
            result = await call
            return float(result.value)
        except Exception as err:  # noqa: BLE001 - any judge failure is one ungraded value
            print(f"  {row.invoice_number}: {what} ungraded ({type(err).__name__}: {err})")
            return None

    async def score_one(row: GradingRow) -> dict:
        async with limit:
            if row.expects_breach:
                faithfulness: Any = await attempt(
                    "faithfulness",
                    row,
                    metric.ascore(
                        user_input=row.question,
                        response=row.answer,
                        retrieved_contexts=row.contexts,
                    ),
                )
            else:
                faithfulness = NOT_APPLICABLE

            scored: dict[str, Any] = {
                "invoice_number": row.invoice_number,
                "case": row.case,
                "faithfulness": faithfulness,
            }

            if rubric_metric is not None:
                raw = await attempt(
                    "rubric_score",
                    row,
                    rubric_metric.ascore(
                        user_input=row.question,
                        response=row.answer,
                        retrieved_contexts=row.contexts,
                        reference=row.reference,
                    ),
                )
                scored["rubric_score"] = normalise_rubric_score(raw)

        return scored

    return list(await asyncio.gather(*(score_one(row) for row in rows)))


def write_scores(path: Path, scored: list[dict], model: str = DEFAULT_JUDGE_MODEL) -> None:
    """Write a scores file the gate can read back.

    The judge model is recorded with the scores because two runs are only
    comparable if the same judge produced both. It is evidence, not decoration.
    """
    path.write_text(json.dumps({"model": model, "rows": scored}, indent=2) + "\n")
