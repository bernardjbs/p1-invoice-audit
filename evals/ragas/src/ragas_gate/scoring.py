"""Threshold arithmetic for the eval gate.

Deliberately pure and model-free: every function here works on plain numbers, so
the gate's logic is provable against fabricated scores at no cost. Only the step
that PRODUCES scores needs a model, and it lives elsewhere.

The subtlety this module exists for: a row that fails to grade scores NaN, and
`NaN < threshold` is False in Python. A gate written the obvious way therefore
reports success when every single row failed to grade. Measured 2026-09-08
against ragas 0.4.3, whose own reported average also silently skips NaN rows —
so 19 ungraded rows and one lucky 0.95 average out to "0.95, passed".
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class MetricOutcome:
    """One metric's verdict, carrying the evidence rather than just a boolean."""

    metric: str
    threshold: float
    mean: float | None
    """Mean over graded rows only. None when nothing graded."""
    graded: int
    total: int
    failure: str | None
    """Human-readable cause, or None when the metric passed."""

    @property
    def passed(self) -> bool:
        return self.failure is None


def is_graded(value: float | None) -> bool:
    """A row counts as graded when it produced a real number.

    `None` and NaN both mean the judge did not return a usable score. NaN is
    checked with `!=` self rather than `math.isnan` so a None never reaches it.
    """
    return value is not None and not math.isnan(value)


def mean_of_graded(values: list[float | None]) -> float | None:
    """Average the rows that graded. None when none did.

    Returning None rather than NaN is the whole point: None cannot be silently
    compared against a threshold, so the caller is forced to handle it.
    """
    graded = [v for v in values if is_graded(v)]
    if not graded:
        return None
    return sum(graded) / len(graded)  # type: ignore[arg-type]


def evaluate_metric(
    metric: str,
    values: list[float | None],
    threshold: float,
    min_graded: int,
) -> MetricOutcome:
    """Judge one metric over the dataset.

    Three distinct ways to fail, and they are kept distinct on purpose — "the
    answers were poor" and "the grader never ran" demand completely different
    responses, and a single boolean conflates them.
    """
    total = len(values)
    graded = sum(1 for v in values if is_graded(v))
    mean = mean_of_graded(values)

    failure: str | None = None
    if mean is None:
        failure = f"no rows graded ({total} attempted) — the judge produced no usable score"
    elif graded < min_graded:
        failure = (
            f"only {graded} of {total} rows graded, below the minimum of {min_graded} — "
            f"the {mean:.3f} average is over too few rows to mean anything"
        )
    elif mean < threshold:
        failure = f"{mean:.3f} is below the threshold of {threshold:.3f}"

    return MetricOutcome(
        metric=metric,
        threshold=threshold,
        mean=mean,
        graded=graded,
        total=total,
        failure=failure,
    )


def evaluate_all(
    scores_by_metric: dict[str, list[float | None]],
    thresholds: dict[str, float],
    min_graded: int,
) -> list[MetricOutcome]:
    """Judge every metric that carries a threshold.

    A threshold naming a metric absent from the scores is itself a failure: it
    means the harness did not run what the gate believes it is guarding, and
    skipping it silently would leave the gate green while measuring nothing.
    """
    outcomes: list[MetricOutcome] = []
    for metric, threshold in sorted(thresholds.items()):
        if metric not in scores_by_metric:
            outcomes.append(
                MetricOutcome(
                    metric=metric,
                    threshold=threshold,
                    mean=None,
                    graded=0,
                    total=0,
                    failure="not present in the scores file — the gate guards a metric nobody ran",
                )
            )
            continue
        outcomes.append(
            evaluate_metric(metric, scores_by_metric[metric], threshold, min_graded)
        )
    return outcomes


def format_report(outcomes: list[MetricOutcome]) -> str:
    """Render the outcomes so a CI log shows the denominator, not just the score.

    The graded count is printed on every line, passing or failing, because a
    shrinking denominator is the early warning that the grading step is
    degrading — and it is invisible if only the average is reported.
    """
    lines = [f"{'metric':<24} {'mean':>8} {'thresh':>8} {'graded':>10}  result"]
    for o in outcomes:
        mean = "  —" if o.mean is None else f"{o.mean:.3f}"
        verdict = "PASS" if o.passed else f"FAIL — {o.failure}"
        lines.append(
            f"{o.metric:<24} {mean:>8} {o.threshold:>8.3f} "
            f"{f'{o.graded}/{o.total}':>10}  {verdict}"
        )
    return "\n".join(lines)
