#!/usr/bin/env bash
# Plan-citation ratchet.
#
# A bare task reference in source ("plan T6", "wired in T7") is ambiguous: every
# plan numbers its tasks from T1, this project already has two plans, and the
# plans live OUTSIDE the repo so a reader cannot check which one is meant. Phase A
# and Phase B both have a T2, T5, T6 and T7 — already colliding in the tree today.
#
# The rule (CONVENTIONS.md § Citing a plan from code): cite the dated plan slug,
# or say nothing. A line carrying a YYYY-MM-DD is treated as compliant.
#
# This is a RATCHET, not a cleanup. ~70 pre-existing Phase A references are
# recorded in the baseline beside this script and tolerated; anything NEW fails.
# The count may only go down — remove a line from the baseline when you fix it.
#
# Usage: bash scripts/check-plan-citations.sh
set -uo pipefail

cd "$(dirname "$0")/.."
BASELINE="scripts/plan-citations-baseline.txt"

# Matched text only (never line numbers) so the baseline survives edits above it.
current="$(
  grep -rnE '\bT[0-9]+\b' apps supabase scripts \
      --include='*.ts' --include='*.tsx' --include='*.sql' 2>/dev/null \
    | grep -v node_modules \
    | grep -vE '20[0-9]{2}-[0-9]{2}-[0-9]{2}' \
    | sed -E 's/^([^:]+):[0-9]+:[[:space:]]*/\1\t/' \
    | sort -u
)"

if [[ ! -f "$BASELINE" ]]; then
  echo "FAIL: no baseline at $BASELINE" >&2
  exit 1
fi

new="$(comm -23 <(printf '%s\n' "$current") <(sort -u "$BASELINE"))"

if [[ -n "$new" ]]; then
  echo "FAIL: new bare task reference(s) — cite the dated plan slug, e.g." >&2
  echo "      'Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T2', or drop the reference." >&2
  echo "" >&2
  printf '%s\n' "$new" >&2
  exit 1
fi

# Report shrinkage so a fixed line gets removed from the baseline rather than
# silently leaving a stale allowance behind.
stale="$(comm -13 <(printf '%s\n' "$current") <(sort -u "$BASELINE"))"
if [[ -n "$stale" ]]; then
  echo "FAIL: baseline entries no longer present — delete them from $BASELINE:" >&2
  printf '%s\n' "$stale" >&2
  exit 1
fi

echo "OK: no new bare task references ($(printf '%s\n' "$current" | grep -c . ) grandfathered)."
