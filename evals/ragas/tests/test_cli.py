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
