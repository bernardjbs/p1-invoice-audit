import { defineConfig, configDefaults } from 'vitest/config'
import base from './vitest.integration.config'

/**
 * The CI slice of the integration tier: everything that does NOT call a paid
 * model (ruled 2026-09-23). Runs on `main` only, never on a pull request.
 *
 * WHY A SLICE. The full tier is 19 files / 73 tests. Six of them send real
 * prompts to Anthropic or OpenAI, which makes them non-deterministic — the same
 * risk already ruled on for the real-engine e2e job: a model changing its mind
 * must never redden a branch that changed no code. They stay a local/manual gate
 * until the job's true cost and runtime have been measured.
 *
 * WHAT THE SLICE STILL PROVES — the two criteria nothing else covers:
 *   - a paused audit survives its worker being SIGKILLed and completes in a
 *     different process (durability), and
 *   - a real audit records a real trace URL (tracing).
 * Both pass with deliberately invalid model keys, which is how this list was
 * derived rather than guessed: every excluded file below failed with a 401 and
 * every included one passed. Measured 2026-09-23: this slice is 13 files / 57
 * tests in 7.91s; the full tier is 19 files / 73 tests in 14.44s.
 *
 * The exclusion is per FILE, so it also drops 9 tests that need no model but sit
 * in a file alongside one that does. Recovering them means splitting those files
 * or tagging at test level — deliberately not done now, because the 9 are shape
 * assertions and the two load-bearing criteria are both inside the slice.
 *
 * NOT FREE, despite the name. The job still seeds, and the seed embeds 32
 * contract clauses through OpenAI, so it needs the Doppler `ci` config exactly
 * like the e2e jobs. `config/env` also validates both model keys at import, so
 * they must be present even though these tests never spend them.
 *
 * ADDING A TEST THAT CALLS A MODEL? Add it here too, or this job goes red with a
 * 401 on `main` — which is the intended failure, not a mystery.
 */
const CALLS_A_PAID_MODEL = [
  '**/audit/extraction.integration.test.ts',
  '**/audit/engines/langgraph/hello.integration.test.ts',
  '**/audit/engines/langgraph/engine.integration.test.ts',
  '**/audit/engines/langgraph/injection.integration.test.ts',
  '**/audit/engines/langgraph/contract-terms-agent.integration.test.ts',
  '**/db/contract-docs.integration.test.ts',
]

export default defineConfig({
  test: {
    ...base.test,
    exclude: [...configDefaults.exclude, ...CALLS_A_PAID_MODEL],
    // Refuse an incomplete environment with a named cause, rather than letting
    // it surface as three specs returning 500. See the setup file.
    setupFiles: ['./vitest.integration-ci.setup.ts'],
  },
})
