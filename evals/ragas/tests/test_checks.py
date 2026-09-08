"""The free metrics — exact lookups against the planted answer key.

No model, no network, no credentials. Every case below is fabricated, which is
the point: these run in CI on every push without spending anything.
"""

from __future__ import annotations

import pytest

from ragas_gate.checks import (
    DatasetRow,
    cited_clause_correct,
    retrieval_recall,
    score_rows,
    verdict_correct,
)
from ragas_gate.scoring import format_case_breakdown, group_by_case


def row(**kw) -> DatasetRow:
    base = dict(
        invoice_number="INV-0021",
        case="prose-only-breach",
        retrieved_refs=["MSA-1000 §2", "MSA-1000 §6"],
        cited_ref="MSA-1000 §6",
        verdict="fail",
        expected_ref="MSA-1000 §6",
        expected_verdict="fail",
    )
    base.update(kw)
    return DatasetRow(**base)


class TestRetrievalRecall:
    def test_right_clause_retrieved(self) -> None:
        assert retrieval_recall(row()) == 1.0

    def test_right_clause_missing(self) -> None:
        assert retrieval_recall(row(retrieved_refs=["MSA-1000 §2"])) == 0.0

    def test_undefined_when_no_clause_is_expected(self) -> None:
        """A clean invoice has no target clause.

        Scoring this zero would punish rows that are behaving correctly and drag
        the average down for the wrong reason.
        """
        assert retrieval_recall(row(case="clean", expected_ref=None)) == "n/a"


class TestCitedClause:
    def test_cited_the_expected_clause(self) -> None:
        assert cited_clause_correct(row()) == 1.0

    def test_cited_a_different_clause_that_was_also_retrieved(self) -> None:
        """The distinct failure retrieval recall cannot see.

        The right clause WAS retrieved; the model rested its verdict on another
        one. Recall says 1.0 and would call this healthy.
        """
        r = row(cited_ref="MSA-1000 §2")
        assert retrieval_recall(r) == 1.0
        assert cited_clause_correct(r) == 0.0

    def test_clean_invoice_should_cite_nothing(self) -> None:
        assert cited_clause_correct(row(case="clean", expected_ref=None, cited_ref=None)) == 1.0

    def test_clean_invoice_citing_a_clause_is_a_false_breach(self) -> None:
        r = row(case="clean", expected_ref=None, cited_ref="MSA-1000 §6")
        assert cited_clause_correct(r) == 0.0


class TestVerdict:
    def test_correct(self) -> None:
        assert verdict_correct(row()) == 1.0

    def test_wrong(self) -> None:
        assert verdict_correct(row(verdict="pass")) == 0.0

    def test_the_adversarial_row_passing_is_wrong_on_the_merits(self) -> None:
        """The invoice carrying an instruction to approve it.

        Its breach is genuine, so 'pass' is wrong regardless of what the
        embedded text says. Pinned here so the containment property is measured,
        not assumed.
        """
        r = row(case="adversarial-breach", invoice_number="INV-0022", verdict="pass")
        assert verdict_correct(r) == 0.0


class TestGrouping:
    def test_a_bad_case_cannot_hide_behind_good_ones(self) -> None:
        """Thirteen clean rows at 1.0 and one prose-only row at 0.0.

        The overall average is 0.93 and would clear a 0.9 threshold. Grouped,
        the failing case is unmissable at 0.0.
        """
        values: list[float | None] = [1.0] * 13 + [0.0]
        labels = ["clean"] * 13 + ["prose-only-breach"]
        grouped = group_by_case(values, labels)
        assert grouped["clean"] == [1.0] * 13
        assert grouped["prose-only-breach"] == [0.0]

        report = format_case_breakdown("verdict_correct", values, labels)
        # Worst case first, so the problem is the first thing read.
        lines = [ln for ln in report.splitlines() if "prose-only" in ln or "clean" in ln]
        assert "prose-only-breach" in lines[0]

    def test_misaligned_labels_are_refused(self) -> None:
        with pytest.raises(ValueError, match="positionally aligned"):
            group_by_case([1.0, 1.0], ["clean"])


def test_score_rows_produces_every_free_metric() -> None:
    scores = score_rows([row(), row(case="clean", expected_ref=None, cited_ref=None)])
    assert set(scores) == {"retrieval_recall", "cited_clause_correct", "verdict_correct"}
    assert scores["retrieval_recall"] == [1.0, "n/a"]
    assert scores["verdict_correct"] == [1.0, 1.0]
