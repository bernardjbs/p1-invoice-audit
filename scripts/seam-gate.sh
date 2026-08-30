#!/usr/bin/env bash
# Seam gate (plan T5, criterion 6): audit check logic stays behind the seam.
# `CheckResult` / `check_type` may appear ONLY under apps/api/src/audit/ (the
# seam itself) or apps/api/src/db/ (generated DB types name the check_type
# column). A hit anywhere else means check logic has leaked out, which would
# break Phase B's drop-in replacement — fail the build.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
hits=$(grep -rlE 'CheckResult|check_type' apps/api/src --include='*.ts' 2>/dev/null \
  | grep -vE '^apps/api/src/(audit|db)/' || true)
if [ -n "$hits" ]; then
  echo "SEAM VIOLATION: audit check types referenced outside the seam:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "seam-gate: clean — no check logic outside apps/api/src/audit/"
