import { readFileSync } from 'node:fs'

/**
 * Guard: the criterion-3 spec must actually have RUN, not merely not-failed.
 *
 * WHY THIS EXISTS. `contract-citation.spec.ts` skips itself unless
 * `AUDIT_ENGINE=langgraph`. That self-gating is what keeps it out of the cheap
 * mock tier, and it is also a single point of silent failure: delete the env var
 * from the workflow, typo it, or move engine selection to another key, and the
 * langgraph job reports "1 skipped, 2 passed", exits 0, and looks exactly like
 * the mock job, where skipping is the correct outcome. Golden criterion 3 would
 * then be claimed, indefinitely, on runs that never touched pgvector or the
 * contract-terms agent.
 *
 * A skipped test is not a failure to any test runner, so no exit code can carry
 * this. The run's own report is the only place the distinction exists, which is
 * why this reads the JSON report rather than trusting the process's status.
 *
 * Usage (see the `langgraph-e2e` job in .github/workflows/ci.yml):
 *   PLAYWRIGHT_JSON_OUTPUT_NAME=report.json playwright test --reporter=list,json
 *   bun run scripts/assert-criterion3-ran.ts report.json
 */

/** The spec that proves criterion 3. Matched on filename, which outlives its title. */
const SPEC_FILE = 'contract-citation.spec.ts'

/**
 * Playwright's JSON reporter, narrowed to the two fields this needs. Everything
 * is optional because the shape is the reporter's, not ours: a version that
 * renames a field must make this guard fail loudly rather than silently pass.
 */
type JsonTest = { status?: string }
type JsonSpec = { title?: string; file?: string; tests?: JsonTest[] }
type JsonSuite = { file?: string; specs?: JsonSpec[]; suites?: JsonSuite[] }
type JsonReport = { suites?: JsonSuite[] }

type FoundSpec = { spec: JsonSpec; file: string }

/** Specs nest arbitrarily deep once a file uses `test.describe`, so this recurses. */
function collectSpecs(suites: JsonSuite[] | undefined, inheritedFile: string): FoundSpec[] {
  const found: FoundSpec[] = []
  for (const suite of suites ?? []) {
    const file = suite.file ?? inheritedFile
    for (const spec of suite.specs ?? []) found.push({ spec, file: spec.file ?? file })
    found.push(...collectSpecs(suite.suites, file))
  }
  return found
}

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  console.error('')
  console.error(
    `  ${SPEC_FILE} proves golden criterion 3 (the contract-terms check cites the clause it`,
  )
  console.error('  retrieved). It self-gates on AUDIT_ENGINE=langgraph, so the usual cause is that')
  console.error('  the engine was not selected for this run and every assertion was skipped.')
  process.exit(1)
}

const reportPath = process.argv[2]
if (reportPath === undefined) {
  console.error('usage: bun run scripts/assert-criterion3-ran.ts <playwright-report.json>')
  process.exit(2)
}

let report: JsonReport
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8')) as JsonReport
} catch (cause) {
  fail(`could not read a JSON report at ${reportPath}: ${String(cause)}`)
}

const specs = collectSpecs(report.suites, '').filter((found) => found.file.endsWith(SPEC_FILE))
if (specs.length === 0) {
  fail(`the report contains no spec from ${SPEC_FILE}`)
}

// 'expected' is the JSON reporter's word for a test that ran and passed.
// 'skipped' is what the self-gate produces, and it is the case this exists to catch.
const statuses = specs.flatMap((found) =>
  (found.spec.tests ?? []).map((t) => t.status ?? 'unknown'),
)
if (!statuses.includes('expected')) {
  fail(`${SPEC_FILE} did not run and pass. Statuses: ${statuses.join(', ') || '(none)'}`)
}

console.log(`OK: ${SPEC_FILE} ran and passed (statuses: ${statuses.join(', ')}).`)
