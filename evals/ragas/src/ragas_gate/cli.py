"""The eval gate's entry point.

Two paths, and the split is the point:

* `--fake-scores` proves the gate's LOGIC. It reads made-up numbers, applies the
  thresholds and sets the exit code. It calls no model, needs no credentials and
  needs no rubric, because it spends nothing.
* the live path GRADES, which costs money, and is therefore refused until a
  rubric exists.

The rubric guard runs before any model client is constructed. A plan step saying
"write the rubric first" relies on remembering it at the exact moment someone is
keen to see a real score, which is the moment it fails. This makes skipping it
impossible rather than discouraged — the same reason the repo's seam gate and
plan-citation ratchet exist.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path

from .checks import DatasetRow, cases, score_rows
from .scoring import (
    NOT_APPLICABLE,
    Score,
    evaluate_all,
    format_case_breakdown,
    format_report,
)

HERE = Path(__file__).resolve().parent.parent.parent
RUBRIC = HERE / "rubric.md"
CONFIG = HERE / "gate.toml"

EXIT_OK = 0
EXIT_THRESHOLD = 1
"""A metric came in under its threshold, or too few rows graded."""
EXIT_MISCONFIGURED = 2
"""The gate could not run: no rubric, no config, unreadable scores."""


def load_config(path: Path) -> tuple[dict[str, float], float, frozenset[str], frozenset[str]]:
    if not path.is_file():
        raise FileNotFoundError(f"no gate config at {path}")
    data = tomllib.loads(path.read_text())
    thresholds = {str(k): float(v) for k, v in data.get("thresholds", {}).items()}
    if not thresholds:
        raise ValueError(f"{path} declares no thresholds — the gate would guard nothing")
    min_graded = float(data.get("gate", {}).get("min_graded_fraction", 0.9))
    per_case = frozenset(str(m) for m in data.get("gate", {}).get("per_case", []))
    report_only = frozenset(str(c) for c in data.get("gate", {}).get("report_only_cases", []))
    return thresholds, min_graded, per_case, report_only


def load_scores(path: Path) -> tuple[dict[str, list[Score]], list[str]]:
    """Read a saved scores file, and the case label of each row.

    Grading a saved file rather than a live run is deliberate: re-running the
    engine to re-grade would re-pay for reading every invoice PDF.

    `case` is metadata, not a metric — it says which situation the row exercises
    so the report can be grouped. Rows without one are labelled `unlabelled`
    rather than dropped, so an older scores file still grades.
    """
    raw = json.loads(path.read_text())
    rows = raw["rows"] if isinstance(raw, dict) else raw
    by_metric: dict[str, list[Score]] = {}
    case_labels: list[str] = []
    for row in rows:
        case_labels.append(str(row.get("case", "unlabelled")))
        for metric, value in row.items():
            if metric in ("case", "invoice_number"):
                continue
            # Three distinct states, and they must survive the read: a number,
            # None for attempted-but-ungraded, and the not-applicable marker for
            # a metric this row does not exercise.
            if value is None or value == NOT_APPLICABLE:
                by_metric.setdefault(metric, []).append(value)
            else:
                by_metric.setdefault(metric, []).append(float(value))
    return by_metric, case_labels


def load_dataset(path: Path) -> tuple[list[DatasetRow], dict[str, list[Score]], list[str]]:
    """Read the dataset and compute every metric that needs no model.

    The free metrics are recomputed here rather than stored, so they can never
    drift from the answer key: change what a row expects and the score changes
    with it, instead of a stale number surviving in a file.
    """
    rows: list[DatasetRow] = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        raw = json.loads(line)
        rows.append(
            DatasetRow(
                invoice_number=raw["invoice_number"],
                case=raw["case"],
                retrieved_refs=raw["retrieved_refs"],
                cited_ref=raw["cited_ref"],
                verdict=raw["verdict"],
                expected_ref=raw["expected_ref"],
                expected_verdict=raw["expected_verdict"],
            )
        )
    return rows, score_rows(rows), cases(rows)


def rubric_is_usable(path: Path) -> bool:
    """A rubric that exists but says nothing is not a rubric."""
    return path.is_file() and path.read_text().strip() != ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ragas-gate")
    parser.add_argument(
        "--fake-scores",
        type=Path,
        help="Score a fabricated file instead of grading. Calls no model, needs no rubric.",
    )
    parser.add_argument(
        "--scores",
        type=Path,
        help="A saved scores file produced by a previous grading run.",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        help=(
            "Score the dataset's FREE metrics — exact lookups against the answer key. "
            "No model, no credentials, no cost, so no rubric is required."
        ),
    )
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--rubric", type=Path, default=RUBRIC)
    args = parser.parse_args(argv)

    try:
        thresholds, min_graded, per_case_metrics, report_only = load_config(args.config)
    except (FileNotFoundError, ValueError) as err:
        print(f"ragas-gate: {err}", file=sys.stderr)
        return EXIT_MISCONFIGURED

    if args.dataset is not None:
        # Free path: every metric here is a lookup against the planted answer
        # key, so nothing is paid for and the rubric guard does not apply.
        try:
            _, by_metric, case_labels = load_dataset(args.dataset)
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as err:
            print(f"ragas-gate: cannot read dataset at {args.dataset}: {err}", file=sys.stderr)
            return EXIT_MISCONFIGURED
        print(f"ragas-gate: free metrics over {len(case_labels)} dataset rows, no model called.")
        return report(
            by_metric, case_labels, thresholds, min_graded, per_case_metrics, report_only
        )

    scores_path: Path
    if args.fake_scores is not None:
        # The free path. No rubric check, because nothing is being paid for.
        scores_path = args.fake_scores
        print("ragas-gate: fabricated scores — proving gate logic, no model called.")
    else:
        # The paid path. Refuse before constructing any client.
        if not rubric_is_usable(args.rubric):
            print(
                f"ragas-gate: no rubric at {args.rubric} — write what a good answer "
                "looks like before paying for scores. Refusing to call a model.",
                file=sys.stderr,
            )
            return EXIT_MISCONFIGURED
        if args.scores is None:
            print(
                "ragas-gate: live grading is not wired yet; pass --scores with a "
                "saved grading run, or --fake-scores to prove the gate logic.",
                file=sys.stderr,
            )
            return EXIT_MISCONFIGURED
        scores_path = args.scores

    try:
        by_metric, case_labels = load_scores(scores_path)
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as err:
        print(f"ragas-gate: cannot read scores at {scores_path}: {err}", file=sys.stderr)
        return EXIT_MISCONFIGURED

    return report(by_metric, case_labels, thresholds, min_graded, per_case_metrics, report_only)


def report(
    by_metric: dict[str, list[Score]],
    case_labels: list[str],
    thresholds: dict[str, float],
    min_graded: float,
    per_case_metrics: frozenset[str],
    report_only: frozenset[str],
) -> int:
    outcomes = evaluate_all(
        by_metric, thresholds, min_graded, case_labels, per_case_metrics, report_only
    )
    print(format_report(outcomes))

    # Per-case breakdown for anything that failed. The dataset is deliberately
    # unbalanced towards clean invoices, so an overall average is dominated by
    # the easy case; when a metric fails, WHICH situation failed is the whole
    # diagnosis, and it is invisible in the aggregate.
    failed = [o for o in outcomes if not o.passed]
    if len(set(case_labels)) > 1:
        # ALWAYS, not only on failure. A metric that passes on the average while
        # one case sits at zero is precisely what the breakdown exists to show,
        # and printing it only when the gate is already red would hide it in the
        # one situation that matters.
        print()
        for outcome in outcomes:
            values = by_metric.get(outcome.metric)
            if values and len(values) == len(case_labels):
                print(format_case_breakdown(outcome.metric, values, case_labels, report_only))
    if failed:
        print(f"\nragas-gate: FAILED on {len(failed)} of {len(outcomes)} metric(s).")
        return EXIT_THRESHOLD
    print(f"\nragas-gate: all {len(outcomes)} metric(s) within threshold.")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
