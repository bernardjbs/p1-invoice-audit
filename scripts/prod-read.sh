#!/usr/bin/env bash
# Read production inside a transaction the SERVER enforces as read-only.
#   doppler run -c prd -- scripts/prod-read.sh "select ..." ["select ..."]
# PGOPTIONS='-c default_transaction_read_only=on' is dropped by the pooler (measured 2026-10-13:
# it read "off"), so the guard is BEGIN READ ONLY. Transaction-control words are refused, because a
# COMMIT inside the SQL would end the read-only transaction and run the rest without it.
set -euo pipefail
: "${DATABASE_URL:?run under: doppler run -c prd --}"
[ $# -gt 0 ] || { echo "prod-read: give at least one SQL statement" >&2; exit 2; }
if printf '%s\n' "$@" | grep -qiE '\b(commit|end|rollback|abort|begin|savepoint|start[[:space:]]+transaction|set[[:space:]]+(session|transaction|local))\b'; then
  echo "prod-read: REFUSED, transaction control or SET in the SQL" >&2; exit 2
fi
{ echo 'begin transaction read only;'; echo 'show transaction_read_only;'
  for s in "$@"; do printf '%s;\n' "${s%;}"; done
  echo 'rollback;'; } | psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -A -F' | '
