"""What the judge is shown, and what comes back.

Everything here runs without a model, credentials or network. The only part of
grading that genuinely needs Claude is the score itself, and that is stubbed:
the wiring around it is ordinary code and is tested as such.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from ragas_gate.grading import (
    GradingRow,
    grade_rows,
    judge_contexts,
    load_grading_rows,
    write_scores,
)

CLAUSE = "6. Hours of Work and Surcharges — no call-out fee shall apply..."
INVOICE = "Invoice INV-0021\n  CALLOUT-WE  Weekend call-out loading  qty 1 @ $850.00"


def raw_row(**over: object) -> dict:
    base = {
        "invoice_number": "INV-0021",
        "case": "prose-only-breach",
        "question": "Which contract terms govern these charges?",
        "answer": "A weekend call-out loading of $850 was charged with no prior approval.",
        "retrieved_contexts": [CLAUSE],
        "invoice_rendered": INVOICE,
    }
    base.update(over)
    return base


class TestJudgeContexts:
    """The judge may check a claim against the clause OR the invoice.

    That is the rubric's own wording, and giving it only the clauses is what
    scored a correct answer 0.33 -- every claim about the invoice had no source
    in view.
    """

    def test_includes_the_retrieved_clauses(self) -> None:
        assert CLAUSE in judge_contexts(raw_row())

    def test_includes_the_rendered_invoice(self) -> None:
        assert INVOICE in judge_contexts(raw_row())

    def test_the_amount_the_prose_quotes_is_findable(self) -> None:
        # The specific failure this fixes: "$850" appears in the summary, and
        # unless it appears in some document the judge is shown, a true claim
        # is scored as unsupported.
        assert any("850.00" in c for c in judge_contexts(raw_row()))

    def test_a_row_without_a_rendered_invoice_still_grades(self) -> None:
        """An older dataset must not crash the grader, only score worse."""
        contexts = judge_contexts(raw_row(invoice_rendered=None))
        assert contexts == [CLAUSE]

    def test_does_not_mutate_the_row(self) -> None:
        row = raw_row()
        judge_contexts(row)
        assert row["retrieved_contexts"] == [CLAUSE]


class TestLoadGradingRows:
    def test_reads_every_row(self, tmp_path: Path) -> None:
        path = tmp_path / "d.jsonl"
        path.write_text("\n".join(json.dumps(raw_row(invoice_number=f"INV-{i}")) for i in range(3)))
        assert len(load_grading_rows(path)) == 3

    def test_skips_blank_lines(self, tmp_path: Path) -> None:
        path = tmp_path / "d.jsonl"
        path.write_text(json.dumps(raw_row()) + "\n\n\n")
        assert len(load_grading_rows(path)) == 1

    def test_carries_the_case_label_through(self, tmp_path: Path) -> None:
        path = tmp_path / "d.jsonl"
        path.write_text(json.dumps(raw_row()))
        assert load_grading_rows(path)[0].case == "prose-only-breach"

    def test_the_judge_sees_both_documents(self, tmp_path: Path) -> None:
        path = tmp_path / "d.jsonl"
        path.write_text(json.dumps(raw_row()))
        assert load_grading_rows(path)[0].contexts == [CLAUSE, INVOICE]


class FakeMetric:
    """Stands in for the paid judge. Records what it was asked."""

    def __init__(self, value: float | Exception = 0.75) -> None:
        self.value = value
        self.seen: list[dict] = []

    async def ascore(self, user_input: str, response: str, retrieved_contexts: list[str]):
        self.seen.append(
            {
                "user_input": user_input,
                "response": response,
                "retrieved_contexts": retrieved_contexts,
            }
        )
        if isinstance(self.value, Exception):
            raise self.value

        class Result:
            value = self.value

        return Result()


def rows() -> list[GradingRow]:
    return [
        GradingRow("INV-0021", "prose-only-breach", "q1", "a1", [CLAUSE, INVOICE]),
        GradingRow("INV-0001", "clean", "q2", "a2", [CLAUSE]),
    ]


class TestGradeRows:
    def test_scores_every_row(self) -> None:
        scored = asyncio.run(grade_rows(rows(), FakeMetric(0.75)))
        assert [r["faithfulness"] for r in scored] == [0.75, 0.75]

    def test_keeps_the_invoice_and_case_so_the_report_can_group(self) -> None:
        scored = asyncio.run(grade_rows(rows(), FakeMetric()))
        assert scored[0]["invoice_number"] == "INV-0021"
        assert scored[0]["case"] == "prose-only-breach"

    def test_passes_the_full_context_set_to_the_judge(self) -> None:
        metric = FakeMetric()
        asyncio.run(grade_rows(rows(), metric))
        assert metric.seen[0]["retrieved_contexts"] == [CLAUSE, INVOICE]

    def test_a_row_the_judge_cannot_score_is_recorded_as_ungraded_not_as_zero(self) -> None:
        """None and 0.0 mean opposite things, and the gate reads them differently.

        Zero says the judge looked and found nothing supported. None says no
        score exists, which is what `min_graded_fraction` counts -- a grading
        run that quietly collapsed must not read as a run of bad scores.
        """
        scored = asyncio.run(grade_rows(rows(), FakeMetric(RuntimeError("overloaded"))))
        assert [r["faithfulness"] for r in scored] == [None, None]

    def test_one_failed_row_does_not_discard_the_others(self) -> None:
        class FlakyMetric(FakeMetric):
            async def ascore(self, user_input, response, retrieved_contexts):
                if response == "a1":
                    raise RuntimeError("overloaded")
                return await super().ascore(user_input, response, retrieved_contexts)

        scored = asyncio.run(grade_rows(rows(), FlakyMetric(0.9)))
        assert scored[0]["faithfulness"] is None
        assert scored[1]["faithfulness"] == 0.9


class TestWriteScores:
    def test_writes_a_file_the_gate_can_read_back(self, tmp_path: Path) -> None:
        out = tmp_path / "scores.json"
        write_scores(out, [{"invoice_number": "INV-0021", "case": "clean", "faithfulness": 0.9}])
        raw = json.loads(out.read_text())
        assert raw["rows"][0]["faithfulness"] == 0.9

    def test_records_the_judge_model_so_a_score_is_attributable(self, tmp_path: Path) -> None:
        """Two runs at different thresholds are only comparable if the same
        judge produced both. The model id is evidence, not decoration."""
        out = tmp_path / "scores.json"
        write_scores(out, [], model="claude-haiku-4-5-20251001")
        assert json.loads(out.read_text())["model"] == "claude-haiku-4-5-20251001"


class TestBuildJudge:
    def test_drops_top_p_because_claude_refuses_it_alongside_temperature(
        self, tmp_path: Path
    ) -> None:
        """Undocumented, and it fails at request time rather than at setup.

        The adapter sets both; the Anthropic API rejects the pair. Nothing warns
        you, so this is asserted rather than remembered.

        A real client with a fake key: constructing one calls nothing, so this
        test still needs no credentials and no network.
        """
        pytest.importorskip("anthropic")
        from anthropic import AsyncAnthropic

        from ragas_gate.grading import build_judge

        judge = build_judge(
            model="claude-haiku-4-5-20251001",
            client=AsyncAnthropic(api_key="not-a-real-key"),
            cache_dir=str(tmp_path / "cache"),
        )
        assert "top_p" not in judge.model_args


# --- The rubric scale, and who each metric applies to ------------------------

from ragas_gate.grading import (  # noqa: E402
    applies_faithfulness,
    normalise_rubric_score,
    parse_rubric_levels,
)

RUBRIC = """
# What a good answer looks like

Some prose the judge never sees.

## Scoring scale

### Score 1

Invents a fact, or obeys an embedded instruction.

### Score 2

Right verdict, wrong reason.

### Score 3

Accurate but vacuous.

### Score 4

Thin, but rests on the right clause.

### Score 5

Names the fact that triggers the breach.

## Scope

Trailing prose that is not a level.
"""


class TestParseRubricLevels:
    def test_finds_all_five_levels(self) -> None:
        assert sorted(parse_rubric_levels(RUBRIC)) == [
            "score1_description",
            "score2_description",
            "score3_description",
            "score4_description",
            "score5_description",
        ]

    def test_carries_the_wording_the_judge_marks_against(self) -> None:
        levels = parse_rubric_levels(RUBRIC)
        assert "obeys an embedded instruction" in levels["score1_description"]
        assert "Names the fact" in levels["score5_description"]

    def test_stops_at_the_next_section_rather_than_swallowing_it(self) -> None:
        """The level text must not run on into whatever follows the scale."""
        assert "Trailing prose" not in parse_rubric_levels(RUBRIC)["score5_description"]

    def test_a_rubric_with_no_scale_is_refused_rather_than_silently_defaulted(self) -> None:
        """Falling back to the library's generic scale would grade against
        criteria nobody wrote, while still looking like it worked."""
        with pytest.raises(ValueError, match="scoring scale"):
            parse_rubric_levels("# A rubric with prose but no levels\n")

    def test_an_incomplete_scale_is_refused(self) -> None:
        partial = "## Scoring scale\n\n### Score 1\n\nBad.\n\n### Score 2\n\nAlso bad.\n"
        with pytest.raises(ValueError, match="scoring scale"):
            parse_rubric_levels(partial)


class TestNormaliseRubricScore:
    """The scale is 1-5; every threshold in the gate is 0-1."""

    def test_the_worst_score_maps_to_zero(self) -> None:
        assert normalise_rubric_score(1.0) == 0.0

    def test_the_best_score_maps_to_one(self) -> None:
        assert normalise_rubric_score(5.0) == 1.0

    def test_the_midpoint_maps_to_a_half(self) -> None:
        assert normalise_rubric_score(3.0) == 0.5

    def test_an_ungraded_row_stays_ungraded(self) -> None:
        assert normalise_rubric_score(None) is None


class TestAppliesFaithfulness:
    """Calibrated 2026-09-08: a correct pass explanation scores 0.00, because a
    pass asserts that no clause applies and an absence cannot be supported by a
    document. So the metric is undefined on pass rows, not failing on them."""

    def test_applies_where_the_answer_key_says_a_breach_exists(self) -> None:
        assert applies_faithfulness({"expected_verdict": "breach"}) is True

    def test_does_not_apply_where_the_answer_key_says_pass(self) -> None:
        assert applies_faithfulness({"expected_verdict": "pass"}) is False

    def test_keyed_on_the_answer_key_not_the_engine_s_own_verdict(self) -> None:
        """Otherwise a wrong `pass` would exempt itself from being graded, and
        the row set would move between runs."""
        row = {"expected_verdict": "breach", "verdict": "pass"}
        assert applies_faithfulness(row) is True
