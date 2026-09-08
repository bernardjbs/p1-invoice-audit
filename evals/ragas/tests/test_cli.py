"""The rubric guard and the exit codes CI reads.

The guard's whole value is that it can REFUSE, so both directions are pinned
here: no rubric must stop the paid path dead, and must not obstruct the free one.
"""

from __future__ import annotations

import json
from pathlib import Path

from ragas_gate.cli import EXIT_MISCONFIGURED, EXIT_OK, EXIT_THRESHOLD, main

CONFIG = """
[thresholds]
faithfulness = 0.8
[gate]
min_graded_rows = 3
"""


def _setup(tmp_path: Path, rows: list[dict[str, float | None]]) -> tuple[Path, Path]:
    config = tmp_path / "gate.toml"
    config.write_text(CONFIG)
    scores = tmp_path / "scores.json"
    scores.write_text(json.dumps({"rows": rows}))
    return config, scores


def test_fake_path_runs_without_a_rubric(tmp_path: Path) -> None:
    """The free path spends nothing, so nothing gates it."""
    config, scores = _setup(tmp_path, [{"faithfulness": 0.9} for _ in range(4)])
    code = main(
        ["--fake-scores", str(scores), "--config", str(config), "--rubric", str(tmp_path / "nope.md")]
    )
    assert code == EXIT_OK


def test_live_path_refuses_without_a_rubric(tmp_path: Path) -> None:
    config, scores = _setup(tmp_path, [{"faithfulness": 0.9} for _ in range(4)])
    code = main(
        ["--scores", str(scores), "--config", str(config), "--rubric", str(tmp_path / "nope.md")]
    )
    assert code == EXIT_MISCONFIGURED


def test_live_path_refuses_an_empty_rubric(tmp_path: Path) -> None:
    """A file that exists but says nothing is not a rubric."""
    config, scores = _setup(tmp_path, [{"faithfulness": 0.9} for _ in range(4)])
    rubric = tmp_path / "rubric.md"
    rubric.write_text("   \n\n  ")
    code = main(["--scores", str(scores), "--config", str(config), "--rubric", str(rubric)])
    assert code == EXIT_MISCONFIGURED


def test_live_path_proceeds_once_a_rubric_exists(tmp_path: Path) -> None:
    config, scores = _setup(tmp_path, [{"faithfulness": 0.9} for _ in range(4)])
    rubric = tmp_path / "rubric.md"
    rubric.write_text("A good answer cites the clause it relies on.")
    code = main(["--scores", str(scores), "--config", str(config), "--rubric", str(rubric)])
    assert code == EXIT_OK


def test_below_threshold_exits_nonzero(tmp_path: Path) -> None:
    config, scores = _setup(tmp_path, [{"faithfulness": 0.1} for _ in range(4)])
    code = main(["--fake-scores", str(scores), "--config", str(config)])
    assert code == EXIT_THRESHOLD


def test_all_rows_ungraded_exits_nonzero(tmp_path: Path) -> None:
    """The case the naive gate passes."""
    config, scores = _setup(tmp_path, [{"faithfulness": None} for _ in range(4)])
    code = main(["--fake-scores", str(scores), "--config", str(config)])
    assert code == EXIT_THRESHOLD


def test_a_config_with_no_thresholds_is_refused(tmp_path: Path) -> None:
    """An empty threshold table would make the gate pass by guarding nothing."""
    config = tmp_path / "gate.toml"
    config.write_text("[gate]\nmin_graded_rows = 3\n")
    scores = tmp_path / "scores.json"
    scores.write_text(json.dumps({"rows": [{"faithfulness": 0.9}]}))
    code = main(["--fake-scores", str(scores), "--config", str(config)])
    assert code == EXIT_MISCONFIGURED


# --- Combining the free metrics with a saved grading run ---------------------
#
# The two halves are produced at different times and at different prices: the
# free metrics recompute from the answer key on every run, the judged one is a
# saved artefact of a paid run. One report has to hold both, and alignment is by
# invoice number rather than by position, so a scores file that lost a row is
# recorded as ungraded rather than silently shifting every score onto the wrong
# invoice.

MERGE_CONFIG = """
[thresholds]
faithfulness = 0.8
verdict_correct = 0.9
[gate]
min_graded_fraction = 0.9
"""


def _dataset(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "dataset.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in rows))
    return path


def _row(number: str, case: str = "clean") -> dict:
    return {
        "invoice_number": number,
        "case": case,
        "question": "q",
        "answer": "a",
        "retrieved_refs": [],
        "retrieved_contexts": [],
        "invoice_rendered": "inv",
        "cited_ref": None,
        "verdict": "pass",
        "expected_ref": None,
        "expected_verdict": "pass",
    }


def test_dataset_and_scores_together_report_both_halves(tmp_path: Path) -> None:
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    dataset = _dataset(tmp_path, [_row("INV-1"), _row("INV-2")])
    scores = tmp_path / "scores.json"
    scores.write_text(
        json.dumps(
            {
                "model": "test-judge",
                "rows": [
                    {"invoice_number": "INV-1", "case": "clean", "faithfulness": 0.95},
                    {"invoice_number": "INV-2", "case": "clean", "faithfulness": 0.91},
                ],
            }
        )
    )
    rubric = tmp_path / "rubric.md"
    rubric.write_text("what good looks like")
    code = main(
        [
            "--dataset",
            str(dataset),
            "--scores",
            str(scores),
            "--config",
            str(config),
            "--rubric",
            str(rubric),
        ]
    )
    assert code == EXIT_OK


def test_a_judged_score_below_threshold_fails_the_build(tmp_path: Path) -> None:
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    dataset = _dataset(tmp_path, [_row("INV-1"), _row("INV-2")])
    scores = tmp_path / "scores.json"
    scores.write_text(
        json.dumps(
            {
                "rows": [
                    {"invoice_number": "INV-1", "faithfulness": 0.2},
                    {"invoice_number": "INV-2", "faithfulness": 0.2},
                ]
            }
        )
    )
    rubric = tmp_path / "rubric.md"
    rubric.write_text("what good looks like")
    code = main(
        [
            "--dataset",
            str(dataset),
            "--scores",
            str(scores),
            "--config",
            str(config),
            "--rubric",
            str(rubric),
        ]
    )
    assert code == EXIT_THRESHOLD


def test_a_score_for_an_invoice_not_in_the_dataset_is_ignored_not_misaligned(
    tmp_path: Path,
) -> None:
    """Aligning by position would put INV-9's score onto INV-1."""
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    dataset = _dataset(tmp_path, [_row("INV-1"), _row("INV-2")])
    scores = tmp_path / "scores.json"
    scores.write_text(
        json.dumps(
            {
                "rows": [
                    {"invoice_number": "INV-9", "faithfulness": 0.1},
                    {"invoice_number": "INV-1", "faithfulness": 0.95},
                    {"invoice_number": "INV-2", "faithfulness": 0.95},
                ]
            }
        )
    )
    rubric = tmp_path / "rubric.md"
    rubric.write_text("ok")
    assert (
        main(
            [
                "--dataset",
                str(dataset),
                "--scores",
                str(scores),
                "--config",
                str(config),
                "--rubric",
                str(rubric),
            ]
        )
        == EXIT_OK
    )


def test_grading_refuses_without_a_rubric_before_any_model_is_built(tmp_path: Path) -> None:
    """The guard's whole point: it fires on the paid path, ahead of the client."""
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    dataset = _dataset(tmp_path, [_row("INV-1")])
    code = main(
        [
            "--dataset",
            str(dataset),
            "--grade",
            str(tmp_path / "out.json"),
            "--config",
            str(config),
            "--rubric",
            str(tmp_path / "absent.md"),
        ]
    )
    assert code == EXIT_MISCONFIGURED


def test_grading_needs_a_dataset_to_grade(tmp_path: Path) -> None:
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    rubric = tmp_path / "rubric.md"
    rubric.write_text("ok")
    code = main(
        ["--grade", str(tmp_path / "out.json"), "--config", str(config), "--rubric", str(rubric)]
    )
    assert code == EXIT_MISCONFIGURED


def test_a_not_applicable_judged_score_survives_the_merge(tmp_path: Path) -> None:
    """Not-applicable and ungraded must not collapse into each other.

    Faithfulness is undefined on a pass row, and there are thirteen of those in
    the real dataset. Reading them as "attempted but ungraded" trips the
    minimum-graded guard and fails the build for a healthy run -- the exact
    confusion the scoring module's own comment warns about.
    """
    config = tmp_path / "gate.toml"
    config.write_text(MERGE_CONFIG)
    dataset = _dataset(tmp_path, [_row("INV-1"), _row("INV-2")])
    scores = tmp_path / "scores.json"
    scores.write_text(
        json.dumps(
            {
                "rows": [
                    {"invoice_number": "INV-1", "faithfulness": 0.95},
                    {"invoice_number": "INV-2", "faithfulness": "n/a"},
                ]
            }
        )
    )
    rubric = tmp_path / "rubric.md"
    rubric.write_text("ok")
    assert (
        main(
            [
                "--dataset",
                str(dataset),
                "--scores",
                str(scores),
                "--config",
                str(config),
                "--rubric",
                str(rubric),
            ]
        )
        == EXIT_OK
    )
