#!/usr/bin/env bash
set -euo pipefail

# Start the local Supabase stack for the e2e jobs and export what the app needs
# to reach it.
#
# The acceptance suite's global-setup runs `supabase db reset` and a seed that
# uploads invoice PDFs to Storage, which the real engine then downloads. A bare
# Postgres service container has neither Storage nor the CLI's migration
# handling, so CI runs the same stack the developer runs (RULED 2026-09-07).
#
# `DATABASE_URL` and `SUPABASE_URL` already default to this stack in the app, but
# `SUPABASE_SERVICE_ROLE_KEY` has no default and storage access throws without
# it. It is read off the started stack rather than added as a third secret: the
# key belongs to an ephemeral local container, not to any hosted project.

# STDOUT IS DISCARDED ON PURPOSE. On a non-TTY `supabase start` finishes by
# printing the whole status block, which contains SERVICE_ROLE_KEY, ANON_KEY,
# SECRET_KEY, JWT_SECRET and the S3 protocol secret. `::add-mask::` below cannot
# retract what is already in the log, so the only working defence is never
# emitting them. Errors and progress go to stderr and are kept.
start=$(date +%s)
bunx supabase start >/dev/null
echo "supabase start took $(($(date +%s) - start))s"

# `-o env` prints KEY="value" lines. Command substitution keeps them out of the
# log, and they land in this script's own shell, so only the two names written to
# GITHUB_ENV below reach any later step.
eval "$(bunx supabase status -o env)"

# Mask it for the rest of the job even though it is an ephemeral local key: a
# service-role key printed by a workflow reads as a leak whatever its scope.
echo "::add-mask::${SERVICE_ROLE_KEY}"
{
  echo "SUPABASE_URL=${API_URL}"
  echo "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
} >>"${GITHUB_ENV}"
