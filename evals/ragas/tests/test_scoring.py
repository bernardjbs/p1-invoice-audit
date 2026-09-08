"""Gate logic, proved against fabricated scores. No model, no credentials, no cost.

The first three tests are the reason this file exists. They pin the behaviour
that the obvious implementation gets wrong: a gate that compares an average
against a threshold reports SUCCESS when every row failed to grade, because
comparing NaN to anything is False.
"""

from __future__ import annotations

import math

from ragas_gate.scoring import evaluate_all, evaluate_metric, mean_of_graded

NAN = float("nan")
THRESHOLD = 0.8
MIN_GRADED = 18


def test_every_row_ungraded_fails_rather_than_passing_vacuously() -> None:
    outcome = evaluate_metric("faithfulness", [NAN] * 20, THRESHOLD, MIN_GRADED)
    assert not outcome.passed
    assert outcome.graded == 0
    assert "no rows graded" in outcome.failure


def test_one_lucky_row_does_not_stand_in_for_the_dataset() -> None:
    """19 rows fail to grade, one scores well above threshold.

    The average of the survivors is 0.95, comfortably over the line. Reporting
    that as a pass would certify twenty rows on the evidence of one.
    """
    values = [NAN] * 19 + [0.95]
    outcome = evaluate_metric("faithfulness", values, THRESHOLD, MIN_GRADED)
    assert not outcome.passed
    assert outcome.graded == 1
    assert "below the minimum" in outcome.failure


def test_a_threshold_naming_a_metric_nobody_ran_fails() -> None:
    outcomes = evaluate_all({"faithfulness": [0.9] * 20}, {"context_relevance": 0.7}, MIN_GRADED)
    assert len(outcomes) == 1
    assert not outcomes[0].passed
    assert "nobody ran" in outcomes[0].failure


def test_genuinely_poor_answers_fail() -> None:
    outcome = evaluate_metric("faithfulness", [0.2] * 20, THRESHOLD, MIN_GRADED)
    assert not outcome.passed
    assert "below the threshold" in outcome.failure


def test_good_answers_pass() -> None:
    outcome = evaluate_metric("faithfulness", [0.9] * 20, THRESHOLD, MIN_GRADED)
    assert outcome.passed
    assert outcome.graded == 20
    assert outcome.mean == 0.9


def test_a_couple_of_ungraded_rows_are_tolerated_and_reported() -> None:
    """Two rows fail to grade; 18 still graded, which meets the minimum."""
    values: list[float | None] = [0.9] * 18 + [NAN, None]
    outcome = evaluate_metric("faithfulness", values, THRESHOLD, MIN_GRADED)
    assert outcome.passed
    assert outcome.graded == 18
    assert outcome.total == 20


def test_exactly_on_the_threshold_passes() -> None:
    outcome = evaluate_metric("faithfulness", [0.8] * 20, THRESHOLD, MIN_GRADED)
    assert outcome.passed


def test_none_and_nan_both_count_as_ungraded() -> None:
    assert mean_of_graded([NAN, None]) is None
    assert mean_of_graded([None, 0.5, NAN]) == 0.5


def test_mean_never_returns_nan() -> None:
    """The type is `float | None`, never NaN — NaN is what silently compares False."""
    result = mean_of_graded([NAN] * 5)
    assert result is None
    assert not (isinstance(result, float) and math.isnan(result))
