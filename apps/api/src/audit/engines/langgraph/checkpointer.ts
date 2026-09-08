import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

/**
 * The graph's durable memory (plan: 2026-09-04-p1-phase-b-langgraph-engine, task T9).
 *
 * Without this, an audit exists only in the worker's memory: kill the process
 * mid-run and the work is gone, and the queue redelivers the job so every model
 * call is paid for twice. With it, the engine writes its state after each step,
 * so a fresh process can pick the run up, whether the previous one crashed or
 * deliberately suspended for a human.
 *
 * OWN SCHEMA, NOT `public`. The saver's tables are the engine's business, not the
 * application's, and keeping them out of `public` means `supabase gen types` and
 * anything else reading our schema never sees them. `setup()` issues
 * `CREATE SCHEMA IF NOT EXISTS` itself, which is why T9 needed no migration.
 *
 * WHY LAZY. `setup()` is idempotent DDL, but it is still a round trip, and the
 * unit tier compiles this graph with no database at all. Creating the saver on
 * first use keeps importing this module free, so a test that never checkpoints
 * never connects.
 */

/** The schema the saver owns outright. Nothing else may write here. */
export const CHECKPOINT_SCHEMA = 'langgraph'

let cached: Promise<PostgresSaver> | null = null

/**
 * The process-wide checkpointer, created and migrated once.
 *
 * The promise itself is cached rather than the resolved saver, so two concurrent
 * first-callers share one `setup()` instead of racing two lots of DDL.
 */
export function getCheckpointer(): Promise<PostgresSaver> {
  cached ??= (async () => {
    const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    const saver = PostgresSaver.fromConnString(url, { schema: CHECKPOINT_SCHEMA })
    await saver.setup()
    return saver
  })()
  return cached
}

/**
 * Drop the cached saver. Tests only: a suite that resets the database between
 * cases would otherwise hold a saver whose tables no longer exist.
 */
export function resetCheckpointerForTests(): void {
  cached = null
}
