"""Gate logic, proved against fabricated scores. No model, no credentials, no cost.

The first three tests are the reason this file exists. They pin the behaviour
that the obvious implementation gets wrong: a gate that compares an average
against a threshold reports SUCCESS when every row failed to grade, because
comparing NaN to anything is False.
"""

from __future__ import annotations

import math

from ragas_gate.scoring import (
    NOT_APPLICABLE,
    evaluate_all,
    evaluate_metric,
    evaluate_per_case,
    mean_of_graded,
)

NAN = float("nan")
THRESHOLD = 0.8
# A share of the rows the metric APPLIES to, not a count of all rows.
MIN_COVERAGE = 0.9


def test_every_row_ungraded_fails_rather_than_passing_vacuously() -> None:
    outcome = evaluate_metric("faithfulness", [NAN] * 20, THRESHOLD, MIN_COVERAGE)
    assert not outcome.passed
    assert outcome.graded == 0
    assert "no rows graded" in outcome.failure


def test_one_lucky_row_does_not_stand_in_for_the_dataset() -> None:
    """19 rows fail to grade, one scores well above threshold.

    The average of the survivors is 0.95, comfortably over the line. Reporting
    that as a pass would certify twenty rows on the evidence of one.
    """
    values = [NAN] * 19 + [0.95]
    outcome = evaluate_metric("faithfulness", values, THRESHOLD, MIN_COVERAGE)
    assert not outcome.passed
    assert outcome.graded == 1
    assert "applicable rows graded" in outcome.failure


def test_a_threshold_naming_a_metric_nobody_ran_fails() -> None:
    outcomes = evaluate_all({"faithfulness": [0.9] * 20}, {"context_relevance": 0.7}, MIN_COVERAGE)
    assert len(outcomes) == 1
    assert not outcomes[0].passed
    assert "nobody ran" in outcomes[0].failure


def test_genuinely_poor_answers_fail() -> None:
    outcome = evaluate_metric("faithfulness", [0.2] * 20, THRESHOLD, MIN_COVERAGE)
    assert not outcome.passed
    assert "below the threshold" in outcome.failure


def test_good_answers_pass() -> None:
    outcome = evaluate_metric("faithfulness", [0.9] * 20, THRESHOLD, MIN_COVERAGE)
    assert outcome.passed
    assert outcome.graded == 20
    assert outcome.mean == 0.9


def test_a_couple_of_ungraded_rows_are_tolerated_and_reported() -> None:
    """Two rows fail to grade; 18 still graded, which meets the minimum."""
    values: list[float | None] = [0.9] * 18 + [NAN, None]
    outcome = evaluate_metric("faithfulness", values, THRESHOLD, MIN_COVERAGE)
    assert outcome.passed
    assert outcome.graded == 18
    assert outcome.total == 20


def test_exactly_on_the_threshold_passes() -> None:
    outcome = evaluate_metric("faithfulness", [0.8] * 20, THRESHOLD, MIN_COVERAGE)
    assert outcome.passed


def test_none_and_nan_both_count_as_ungraded() -> None:
    assert mean_of_graded([NAN, None]) is None
    assert mean_of_graded([None, 0.5, NAN]) == 0.5


def test_mean_never_returns_nan() -> None:
    """The type is `float | None`, never NaN — NaN is what silently compares False."""
    result = mean_of_graded([NAN] * 5)
    assert result is None
    assert not (isinstance(result, float) and math.isnan(result))

def test_not_applicable_rows_do_not_look_like_a_grading_collapse() -> None:
    """The bug this distinction exists for, found by the guard itself.

    Retrieval recall is undefined on a clean invoice, and 13 of the 20 rows are
    clean. Treating "does not apply" as "failed to grade" made a perfectly
    healthy dataset report 7/20 graded and trip the coverage guard — the guard
    that exists to catch a real collapse of the grading step.
    """
    values = [1.0] * 7 + [NOT_APPLICABLE] * 13
    outcome = evaluate_metric("retrieval_recall", values, THRESHOLD, MIN_COVERAGE)
    assert outcome.passed
    assert outcome.applicable == 7
    assert outcome.graded == 7
    assert outcome.total == 20


def test_a_metric_that_applies_to_nothing_fails() -> None:
    """Guarding a metric no row exercises is guarding nothing."""
    outcome = evaluate_metric("retrieval_recall", [NOT_APPLICABLE] * 20, THRESHOLD, MIN_COVERAGE)
    assert not outcome.passed
    assert "guards nothing" in outcome.failure


def test_coverage_is_measured_against_applicable_rows_not_all_rows() -> None:
    """7 applicable, 3 of them ungraded: 57% coverage, so it fails."""
    values = [1.0] * 4 + [NAN] * 3 + [NOT_APPLICABLE] * 13
    outcome = evaluate_metric("retrieval_recall", values, THRESHOLD, MIN_COVERAGE)
    assert not outcome.passed
    assert outcome.applicable == 7
    assert "4 of 7 applicable" in outcome.failure


def test_per_case_skips_cases_the_metric_does_not_apply_to() -> None:
    """Clean invoices have no clause to retrieve, and that must not fail the case.

    At dataset level "applies to nothing" is a real failure; at case level it is
    routine. Getting this wrong made retrieval recall permanently red while it
    was working perfectly.
    """
    values = [1.0] * 6 + [NOT_APPLICABLE] * 13
    labels = ["prose-only-breach"] + ["other"] * 5 + ["clean"] * 13
    outcome = evaluate_per_case("retrieval_recall", values, labels, THRESHOLD, MIN_COVERAGE)
    assert outcome.passed
    assert outcome.applicable == 6


def test_per_case_fails_when_one_case_is_wrong_even_if_the_average_passes() -> None:
    """The hole this function exists to close.

    19 rows correct, one wrong. The average is 0.95 against a 0.90 bar, so the
    aggregate gate passes — and the wrong row is the prose-only breach, the only
    row the contract-terms agent exists to get right.
    """
    values = [0.0] + [1.0] * 19
    labels = ["prose-only-breach"] + ["clean"] * 19
    assert evaluate_metric("verdict_correct", values, 0.9, MIN_COVERAGE).passed
    per_case = evaluate_per_case("verdict_correct", values, labels, 0.9, MIN_COVERAGE)
    assert not per_case.passed
    assert "prose-only-breach" in per_case.failure
    # The reported mean is the worst case's, not the flattering average.
    assert per_case.mean == 0.0


REPORT_ONLY = frozenset({"rate-cap-20pct"})


def test_a_report_only_case_does_not_fail_the_build() -> None:
    """Ruled 2026-09-08: grade the reader on what only it can do.

    A rate-cap breach is caught by the free price check whatever the reader
    concludes, so the invoice is flagged either way and gating on it would put
    the bar where a red build need not mean anything is broken.
    """
    values = [0.0, 1.0, 1.0]
    labels = ["rate-cap-20pct", "prose-only-breach", "clean"]
    outcome = evaluate_per_case("verdict_correct", values, labels, 0.9, MIN_COVERAGE, REPORT_ONLY)
    assert outcome.passed


def test_a_gating_case_still_fails_the_build() -> None:
    """The exclusion must not leak: the clause-only breach still decides."""
    values = [1.0, 0.0, 1.0]
    labels = ["rate-cap-20pct", "prose-only-breach", "clean"]
    outcome = evaluate_per_case("verdict_correct", values, labels, 0.9, MIN_COVERAGE, REPORT_ONLY)
    assert not outcome.passed
    assert "prose-only-breach" in outcome.failure


def test_the_headline_figure_ignores_report_only_cases() -> None:
    """A passing gate must not print 0.000 beside it.

    The score came from a case that was deliberately excluded; showing it as the
    metric's figure reads as a broken gate and teaches people to ignore reports.
    """
    values = [0.0, 1.0, 1.0]
    labels = ["rate-cap-20pct", "prose-only-breach", "clean"]
    outcome = evaluate_per_case("verdict_correct", values, labels, 0.9, MIN_COVERAGE, REPORT_ONLY)
    assert outcome.passed
    assert outcome.mean == 1.0


def test_an_unlisted_case_gates_by_default() -> None:
    """Exclusions are a list, so a case added later is guarded unless someone
    deliberately excludes it. The opposite default would let a new case escape
    the gate by oversight."""
    values = [0.0, 1.0]
    labels = ["some-new-case", "clean"]
    outcome = evaluate_per_case("verdict_correct", values, labels, 0.9, MIN_COVERAGE, REPORT_ONLY)
    assert not outcome.passed
    assert "some-new-case" in outcome.failure
