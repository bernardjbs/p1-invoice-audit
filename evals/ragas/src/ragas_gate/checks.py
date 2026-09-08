"""The metrics that need no model.

Everything here is a lookup against the answer key, because the corpus is
synthetic and we planted the breaches: the correct clause and the correct verdict
are KNOWN for every row. Asking a judge to score them would buy a slower, less
accurate copy of an exact comparison.

These produce scores in exactly the same shape as a judged metric, so the gate's
threshold machinery treats them identically and does not need to know which
metrics cost money.
"""

from __future__ import annotations

from dataclasses import dataclass

from .scoring import NOT_APPLICABLE, Score


@dataclass(frozen=True)
class DatasetRow:
    """One graded audit, as exported from a real run.

    `expected_ref` is None for a row where no clause should be cited — a clean
    invoice, or a vendor with no contract on file.
    """

    invoice_number: str
    case: str
    """Which situation this row exercises, e.g. 'clean' or 'prose-only-breach'.

    Carried so the report can be grouped: a single average lets thirteen clean
    rows scoring well hide the one prose-only breach scoring badly, which is the
    row the contract-terms agent exists for.
    """
    retrieved_refs: list[str]
    cited_ref: str | None
    verdict: str
    expected_ref: str | None
    expected_verdict: str


def retrieval_recall(row: DatasetRow) -> Score:
    """Was the clause that matters among those retrieved?

    This is the honest measure of the search half, and it is exact rather than
    judged. None when the row expects no clause: recall over an empty target is
    not zero, it is undefined, and scoring it zero would drag the average down
    for rows that are behaving correctly.
    """
    if row.expected_ref is None:
        return NOT_APPLICABLE
    return 1.0 if row.expected_ref in row.retrieved_refs else 0.0


def cited_clause_correct(row: DatasetRow) -> Score:
    """Did it rest its verdict on the right clause?

    Distinct from recall on purpose. Retrieval can surface the right clause and
    the model still cite a different one; the fixes differ, so the measurements
    must stay apart.
    """
    if row.expected_ref is None:
        return 1.0 if row.cited_ref is None else 0.0
    return 1.0 if row.cited_ref == row.expected_ref else 0.0


def verdict_correct(row: DatasetRow) -> float:
    return 1.0 if row.verdict == row.expected_verdict else 0.0


FREE_METRICS = {
    "retrieval_recall": retrieval_recall,
    "cited_clause_correct": cited_clause_correct,
    "verdict_correct": verdict_correct,
}


def score_rows(rows: list[DatasetRow]) -> dict[str, list[Score]]:
    """Run every free metric over the dataset. No model, no network, no key."""
    return {name: [fn(r) for r in rows] for name, fn in FREE_METRICS.items()}


def cases(rows: list[DatasetRow]) -> list[str]:
    """The case label per row, positionally aligned with the score lists."""
    return [r.case for r in rows]
