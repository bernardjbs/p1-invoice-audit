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


NOT_APPLICABLE = "n/a"
"""The metric does not apply to this row, which is different from failing to grade.

Retrieval recall on a clean invoice is the case that forced this distinction:
there is no clause to retrieve, so recall is undefined, not zero and not a
grading failure. Conflating the two made a healthy dataset look like a collapsed
grading run — thirteen of twenty rows "ungraded" — and tripped the very guard
that exists to catch a real collapse.
"""

Score = float | None | str
"""A per-row value: a number, None for attempted-but-not-graded, or NOT_APPLICABLE."""


@dataclass(frozen=True)
class MetricOutcome:
    """One metric's verdict, carrying the evidence rather than just a boolean."""

    metric: str
    threshold: float
    mean: float | None
    """Mean over graded rows only. None when nothing graded."""
    graded: int
    applicable: int
    """Rows the metric applies to. The honest denominator."""
    total: int
    failure: str | None
    """Human-readable cause, or None when the metric passed."""

    @property
    def passed(self) -> bool:
        return self.failure is None


def is_applicable(value: Score) -> bool:
    return value != NOT_APPLICABLE


def is_graded(value: Score) -> bool:
    """A row counts as graded when it produced a real number.

    `None` and NaN both mean the judge did not return a usable score. A
    not-applicable row is not graded either, but it is not a failure — callers
    must measure it against `applicable`, never against the row total.
    """
    if not is_applicable(value) or value is None:
        return False
    return not math.isnan(value)  # type: ignore[arg-type]


def mean_of_graded(values: list[Score]) -> float | None:
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
    values: list[Score],
    threshold: float,
    min_graded_fraction: float,
) -> MetricOutcome:
    """Judge one metric over the dataset.

    Three distinct ways to fail, kept distinct on purpose — "the answers were
    poor" and "the grader never ran" demand completely different responses, and
    a single boolean conflates them.

    Coverage is a FRACTION of applicable rows, not a count of all rows. A count
    cannot express "most rows graded" for a metric that only applies to seven of
    twenty, and an absolute floor would fail such a metric permanently while it
    was working perfectly.
    """
    total = len(values)
    applicable = sum(1 for v in values if is_applicable(v))
    graded = sum(1 for v in values if is_graded(v))
    mean = mean_of_graded(values)
    coverage = graded / applicable if applicable else 0.0

    failure: str | None = None
    if applicable == 0:
        failure = f"applies to none of the {total} rows — the gate guards nothing here"
    elif mean is None:
        failure = (
            f"no rows graded ({applicable} applicable) — the judge produced no usable score"
        )
    elif coverage < min_graded_fraction:
        failure = (
            f"only {graded} of {applicable} applicable rows graded "
            f"({coverage:.0%}, below {min_graded_fraction:.0%}) — "
            f"the {mean:.3f} average is over too few rows to mean anything"
        )
    elif mean < threshold:
        failure = f"{mean:.3f} is below the threshold of {threshold:.3f}"

    return MetricOutcome(
        metric=metric,
        threshold=threshold,
        mean=mean,
        graded=graded,
        applicable=applicable,
        total=total,
        failure=failure,
    )


def evaluate_per_case(
    metric: str,
    values: list[Score],
    case_labels: list[str],
    threshold: float,
    min_graded_fraction: float,
) -> MetricOutcome:
    """Hold EVERY case to the threshold, not the dataset average.

    An average is the wrong instrument for a deliberately unbalanced dataset.
    Measured on fabricated scores, 2026-09-08: thirteen clean rows and six other
    correct cases carried a completely wrong prose-only-breach row — wrong
    verdict, wrong clause, 0.10 on faithfulness — to an overall 0.95 against a
    0.90 threshold. The gate passed, and the row it ignored is the only one the
    contract-terms agent exists to get right.

    So the pass condition is every case clearing the bar, and the reported mean
    is the WORST case's, not the average's. Use this for the exact lookups, where
    a miss is a real defect rather than grader noise.
    """
    grouped = group_by_case(values, case_labels)
    # Skip cases the metric does not apply to. At whole-dataset level "applies to
    # nothing" is a real failure — the gate would be guarding a metric nobody
    # ran. At case level it is routine and correct: retrieval recall is undefined
    # for every clean invoice, and failing that group would make the metric
    # permanently red while it worked perfectly.
    per_case = {
        case: evaluate_metric(metric, vs, threshold, min_graded_fraction)
        for case, vs in grouped.items()
        if any(is_applicable(v) for v in vs)
    }
    if not per_case:
        return MetricOutcome(
            metric=metric,
            threshold=threshold,
            mean=None,
            graded=0,
            applicable=0,
            total=len(values),
            failure=f"applies to none of the {len(values)} rows — the gate guards nothing here",
        )
    failures = {c: o for c, o in per_case.items() if not o.passed}
    graded = sum(o.graded for o in per_case.values())
    applicable = sum(o.applicable for o in per_case.values())

    if not failures:
        worst = min(
            (o for o in per_case.values() if o.mean is not None),
            key=lambda o: o.mean,
            default=None,
        )
        return MetricOutcome(
            metric=metric,
            threshold=threshold,
            mean=worst.mean if worst else None,
            graded=graded,
            applicable=applicable,
            total=len(values),
            failure=None,
        )

    worst_case, worst_outcome = min(
        failures.items(),
        key=lambda kv: kv[1].mean if kv[1].mean is not None else -1.0,
    )
    named = ", ".join(sorted(failures))
    return MetricOutcome(
        metric=metric,
        threshold=threshold,
        mean=worst_outcome.mean,
        graded=graded,
        applicable=applicable,
        total=len(values),
        failure=(
            f"{len(failures)} case(s) below the bar: {named}. "
            f"Worst is '{worst_case}' — {worst_outcome.failure}"
        ),
    )


def evaluate_all(
    scores_by_metric: dict[str, list[Score]],
    thresholds: dict[str, float],
    min_graded_fraction: float,
    case_labels: list[str] | None = None,
    per_case_metrics: frozenset[str] = frozenset(),
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
                    applicable=0,
                    total=0,
                    failure="not present in the scores file — the gate guards a metric nobody ran",
                )
            )
            continue
        values = scores_by_metric[metric]
        if metric in per_case_metrics and case_labels is not None:
            outcomes.append(
                evaluate_per_case(
                    metric, values, case_labels, threshold, min_graded_fraction
                )
            )
        else:
            outcomes.append(
                evaluate_metric(metric, values, threshold, min_graded_fraction)
            )
    return outcomes


def group_by_case(values: list[Score], case_labels: list[str]) -> dict[str, list[Score]]:
    """Split one metric's per-row scores by which situation each row exercises.

    The dataset is deliberately unbalanced — most rows are clean invoices,
    because that is where a false breach would be invented — so a single average
    is dominated by the easy case. Thirteen clean rows scoring well can hide the
    one prose-only breach scoring badly, and that breach is the entire reason the
    contract-terms agent exists. Grouping is what stops the average lying.
    """
    if len(values) != len(case_labels):
        raise ValueError(
            f"{len(values)} scores against {len(case_labels)} case labels — "
            "they must be positionally aligned"
        )
    grouped: dict[str, list[Score]] = {}
    for value, case in zip(values, case_labels):
        grouped.setdefault(case, []).append(value)
    return grouped


def format_case_breakdown(metric: str, values: list[Score], case_labels: list[str]) -> str:
    """Per-case means for one metric, worst first so the problem reads first."""
    grouped = group_by_case(values, case_labels)
    rows: list[tuple[str, float | None, int, int]] = []
    for case, vs in grouped.items():
        rows.append((case, mean_of_graded(vs), sum(1 for v in vs if is_graded(v)), len(vs)))
    # None sorts first: a case where nothing graded is the most urgent, not the best.
    rows.sort(key=lambda r: (r[1] is not None, r[1] if r[1] is not None else 0.0))
    lines = [f"  {metric} by case:"]
    for case, mean, graded, total in rows:
        shown = "  —" if mean is None else f"{mean:.3f}"
        lines.append(f"    {case:<26} {shown:>8}  {f'{graded}/{total}':>8}")
    return "\n".join(lines)


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
            f"{f'{o.graded}/{o.applicable}':>10}  {verdict}"
        )
    return "\n".join(lines)
