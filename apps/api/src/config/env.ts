import { z } from 'zod'

/**
 * The typed, validated SERVER environment (CONVENTIONS §14). Every value here is
 * a secret or a server-only switch — nothing in this file may ever reach the
 * browser bundle, which is why it lives in `apps/api` and carries no `VITE_`
 * keys at all.
 *
 * Secrets come from Doppler (`doppler run -c dev -- …`), injected straight into
 * the process; there is no `.env.local` to read. Importing this module parses
 * and validates immediately, so a missing key fails at start-up with a list of
 * what is missing rather than at the first API call, halfway through an audit.
 *
 * Import it only from code that genuinely needs a key — it is deliberately a
 * leaf module, so the unit tier (which runs in CI without Doppler) never pulls
 * it in and never needs secrets to stay green.
 */

const EnvSchema = z.object({
  /** Claude — PDF field extraction (T4) and the contract-terms agent (T6). */
  ANTHROPIC_API_KEY: z.string().min(1),
  /** OpenAI — embeddings only (`text-embedding-3-small`), for pgvector retrieval (T2/T3). */
  OPENAI_API_KEY: z.string().min(1),

  /**
   * LangSmith tracing (T11). Optional until then, and off unless explicitly
   * enabled — an unset `LANGSMITH_TRACING` must not start billing traces.
   * The endpoint MUST be the APAC host; the US/EU hosts 403 an otherwise valid
   * APAC key, which reads as a bad key rather than a wrong region.
   */
  LANGSMITH_API_KEY: z.string().min(1).optional(),
  LANGSMITH_ENDPOINT: z.url().optional(),
  LANGSMITH_TRACING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /** Slack incoming webhook — the pause-for-review notification (T12). */
  SLACK_WEBHOOK_URL: z.url().optional(),
})

/** The parsed server environment. Read fields off this, never `process.env`. */
export type ServerEnv = z.infer<typeof EnvSchema>

function parseEnv(): ServerEnv {
  const parsed = EnvSchema.safeParse(process.env)
  if (parsed.success) return parsed.data

  // Name the missing/invalid keys only — never echo a value, since a bad secret
  // would otherwise land in logs and in the agent's transcript.
  const problems = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  throw new Error(
    `Invalid server environment — check Doppler (\`doppler run -c dev -- …\`):\n${problems}`,
  )
}

export const serverEnv: ServerEnv = parseEnv()
