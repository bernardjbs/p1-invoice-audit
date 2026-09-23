/**
 * Preflight for the CI integration slice: refuse to run with an incomplete
 * environment, and say which variable is missing.
 *
 * WHY THIS EXISTS. Everything this tier needs is present in the `dev` Doppler
 * config and some of it is absent from `ci`, so the two environments disagree
 * and the disagreement is silent. Worse, it surfaces dishonestly: the storage
 * layer throws a perfectly clear "SUPABASE_SERVICE_ROLE_KEY is required" —
 * inside a request, where the API's error handler turns every unexpected throw
 * into a generic 500 on purpose (CONVENTIONS §8, never leak internals to a
 * client). The clear message goes to the server log; the spec sees only
 * `expected 500 to be 201` and reads as a broken application.
 *
 * Three specs failed exactly that way while the real cause was one unset
 * variable. This turns that into one line, before any test runs.
 */

type Requirement = { name: string; why: string }

const REQUIRED: Requirement[] = [
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    why: 'storage reads and writes; without it every route that touches a PDF returns a generic 500',
  },
  {
    name: 'LANGSMITH_API_KEY',
    why: 'the trace spec asserts a real trace URL was recorded',
  },
  {
    name: 'LANGSMITH_ENDPOINT',
    why: 'the trace spec pins the APAC host; a default would send traces to the wrong region',
  },
]

const missing = REQUIRED.filter((r) => !process.env[r.name])

if (missing.length > 0) {
  const lines = missing.map((r) => `  ${r.name}\n      needed for: ${r.why}`).join('\n')
  throw new Error(
    `The integration slice cannot run: ${missing.length} required variable(s) are unset.\n\n` +
      `${lines}\n\n` +
      `This is almost always the dev/ci config gap. Run it the way CI does:\n` +
      `  bash scripts/integration-ci-local.sh\n\n` +
      `That script supplies the \`ci\` Doppler config plus the two SUPABASE_ values\n` +
      `read off the running local stack, which live in no Doppler config because\n` +
      `they belong to an ephemeral container.`,
  )
}
