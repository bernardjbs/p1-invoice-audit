#!/usr/bin/env bash
#
# Run the CI integration slice locally, in the environment CI actually gives it.
#
# The `dev` Doppler config has every key; `ci` has a deliberately smaller set,
# and running the tier against `dev` proves nothing about whether CI can run it.
# Two of this job's first three failures were exactly that gap, and neither was
# reproducible with the command anyone reaches for first.
#
# Two of the values CI uses are in NO Doppler config: SUPABASE_URL and
# SUPABASE_SERVICE_ROLE_KEY belong to an ephemeral local container, so CI reads
# them off the stack it just started (.github/scripts/start-supabase.sh) and
# this script does the same.
#
# Usage, from anywhere in the repo, with Docker and the local stack up:
#   bash scripts/integration-ci-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! bunx supabase status >/dev/null 2>&1; then
  echo "The local Supabase stack is not running. Start it first:" >&2
  echo "    bunx supabase start" >&2
  exit 1
fi

# Command substitution keeps the status block (which contains several keys) out
# of the terminal and out of any transcript; only this shell sees the values.
eval "$(bunx supabase status -o env)"

echo "Running the integration slice under the 'ci' config (model-calling files excluded)…"
cd apps/api
exec doppler run -p p1-invoice-audit -c ci -- env \
  SUPABASE_URL="${API_URL}" \
  SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
  bunx vitest run --config vitest.integration-ci.config.ts "$@"
