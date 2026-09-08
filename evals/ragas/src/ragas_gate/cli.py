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

from .scoring import evaluate_all, format_report

HERE = Path(__file__).resolve().parent.parent.parent
RUBRIC = HERE / "rubric.md"
CONFIG = HERE / "gate.toml"

EXIT_OK = 0
EXIT_THRESHOLD = 1
"""A metric came in under its threshold, or too few rows graded."""
EXIT_MISCONFIGURED = 2
"""The gate could not run: no rubric, no config, unreadable scores."""


def load_config(path: Path) -> tuple[dict[str, float], int]:
    if not path.is_file():
        raise FileNotFoundError(f"no gate config at {path}")
    data = tomllib.loads(path.read_text())
    thresholds = {str(k): float(v) for k, v in data.get("thresholds", {}).items()}
    if not thresholds:
        raise ValueError(f"{path} declares no thresholds — the gate would guard nothing")
    min_graded = int(data.get("gate", {}).get("min_graded_rows", 0))
    return thresholds, min_graded


def load_scores(path: Path) -> dict[str, list[float | None]]:
    """Read a saved scores file.

    Grading a saved file rather than a live run is deliberate: re-running the
    engine to re-grade would re-pay for reading every invoice PDF.
    """
    raw = json.loads(path.read_text())
    rows = raw["rows"] if isinstance(raw, dict) else raw
    by_metric: dict[str, list[float | None]] = {}
    for row in rows:
        for metric, value in row.items():
            by_metric.setdefault(metric, []).append(
                None if value is None else float(value)
            )
    return by_metric


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
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--rubric", type=Path, default=RUBRIC)
    args = parser.parse_args(argv)

    try:
        thresholds, min_graded = load_config(args.config)
    except (FileNotFoundError, ValueError) as err:
        print(f"ragas-gate: {err}", file=sys.stderr)
        return EXIT_MISCONFIGURED

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
        by_metric = load_scores(scores_path)
    except (OSError, json.JSONDecodeError, KeyError) as err:
        print(f"ragas-gate: cannot read scores at {scores_path}: {err}", file=sys.stderr)
        return EXIT_MISCONFIGURED

    outcomes = evaluate_all(by_metric, thresholds, min_graded)
    print(format_report(outcomes))
    failed = [o for o in outcomes if not o.passed]
    if failed:
        print(f"\nragas-gate: FAILED on {len(failed)} of {len(outcomes)} metric(s).")
        return EXIT_THRESHOLD
    print(f"\nragas-gate: all {len(outcomes)} metric(s) within threshold.")
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
