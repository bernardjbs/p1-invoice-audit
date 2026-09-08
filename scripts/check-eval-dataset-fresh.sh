#!/usr/bin/env bash
#
# Refuse a build whose eval dataset predates the engine that produced it.
#
# The eval gate does NOT run the engine. It grades `evals/ragas/dataset.jsonl`,
# a RECORDING of what the engine said, committed to the repo. So a prompt change
# that degrades the auditor leaves the gate green, because the gate is still
# marking the old engine's work.
#
# That is a gate which passes without proving anything, and it is not
# hypothetical: on 2026-09-08 the contract-terms prompt was edited and the
# dataset had to be rebuilt by hand to see the effect. Nothing would have said so.
#
# Same shape as the rubric guard: a check that REFUSES beats a note asking
# someone to remember, because the moment it matters is the moment they are
# thinking about something else.
#
# Compares COMMIT timestamps, not file mtimes -- a fresh checkout rewrites every
# mtime, so mtime comparison is meaningless in CI. This needs full history:
# `actions/checkout` defaults to a single commit, so the job must set
# `fetch-depth: 0` or `git log` sees nothing to compare.
#
# Usage: bash scripts/check-eval-dataset-fresh.sh

set -euo pipefail

DATASET="evals/ragas/dataset.jsonl"

# What counts as "the engine" for this purpose: anything that changes what the
# engine SAYS about an invoice. Tests are excluded -- they change constantly and
# cannot alter the output.
ENGINE_PATHS=(
  "apps/api/src/audit"
  ":!*.test.ts"
  ":!*.integration.test.ts"
)

if [[ ! -f "$DATASET" ]]; then
  echo "check-eval-dataset-fresh: no dataset at $DATASET" >&2
  exit 1
fi

dataset_ts=$(git log -1 --format=%ct -- "$DATASET" || true)
engine_ts=$(git log -1 --format=%ct -- "${ENGINE_PATHS[@]}" || true)

if [[ -z "$dataset_ts" || -z "$engine_ts" ]]; then
  # No history to compare. Refuse rather than pass: a shallow clone would
  # otherwise turn this guard into a no-op that reports success forever, which
  # is worse than not having it.
  echo "check-eval-dataset-fresh: no commit history for the dataset or the engine." >&2
  echo "  A shallow clone cannot answer this. Set fetch-depth: 0 on the checkout." >&2
  exit 1
fi

if (( engine_ts > dataset_ts )); then
  changed=$(git log -1 --format='%h %s' -- "${ENGINE_PATHS[@]}")
  echo "check-eval-dataset-fresh: the eval dataset is older than the engine." >&2
  echo "" >&2
  echo "  engine last changed : $changed" >&2
  echo "  dataset last built  : $(git log -1 --format='%h %s' -- "$DATASET")" >&2
  echo "" >&2
  echo "  The gate grades a recording of what the engine said. Marking it now would" >&2
  echo "  score the OLD engine and pass, proving nothing about the change you made." >&2
  echo "" >&2
  echo "  Rebuild it, then re-grade:" >&2
  echo "    doppler run -c dev -- bun evals/ragas/build-dataset.ts" >&2
  echo "    cd evals/ragas && doppler run -c dev -- uv run ragas-gate \\" >&2
  echo "      --dataset dataset.jsonl --grade scores.json" >&2
  exit 1
fi

echo "OK: eval dataset is at or ahead of the engine it grades."
