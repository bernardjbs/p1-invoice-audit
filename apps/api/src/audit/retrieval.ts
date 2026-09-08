import { sql } from '../db/client'

/**
 * The ONE retrieval seam. Everything that needs contract prose — today the
 * contract-terms agent, tomorrow whatever replaces it — calls this and nothing
 * else, so swapping the store means changing this file alone.
 *
 * Hand-written SQL rather than a vector-store library (Bernard's ruling,
 * 2026-09-05). `@langchain/pgvector` is at 0.1.0 and would put the vendor filter
 * inside library code; `@langchain/community` is mature but a large dependency
 * on an API that deploys as a serverless function. The query below is ~10 lines
 * and the safety rule is legible in it.
 *
 * What this does NOT do: decide anything. Embedding similarity measures "is this
 * about the same subject", not "does this agree with me" — a clause permitting
 * weekend surcharges sits right next to one forbidding them, because they share
 * every word but "no". Retrieval narrows the corpus to the clauses worth reading;
 * the agent reads them and judges. Never threshold a verdict off `score`.
 */

/** The minimum an embedder must do. `OpenAIEmbeddings` satisfies it structurally. */
export type QueryEmbedder = {
  embedQuery(text: string): Promise<number[]>
}

export type Chunk = {
  id: string
  contractId: string
  vendorId: string
  /** What gets cited to the user. The agent takes the citation from here, never from model output. */
  sourceRef: string
  content: string
  /** Cosine similarity, 0–1. For ranking and debugging only — never for a verdict. */
  score: number
}

/**
 * The floor: never hand the agent fewer clauses than this, however long they are.
 *
 * Was the whole rule, as a flat `k = 4`, justified as "enough to reason over
 * without burying the relevant one". That reasoning holds for a long contract
 * and was wrong for ours. Measured 2026-09-08 across the eval dataset: every
 * vendor's contract is 8 clauses and ~2,100 characters, and in 3 of the 5 faulty
 * invoices the clause that decides the case ranked FIFTH — one place below the
 * cut. The agent was asked to rule on a breach without being shown the clause
 * breached, and on one invoice it answered "pass" for exactly that reason.
 *
 * Nothing failed loudly. The audit still returned a confident verdict.
 */
const MIN_CLAUSES = 4

/**
 * How much contract text the agent may be handed when clauses are plentiful.
 *
 * ~3,000 tokens at four characters per token. A whole contract of ours is ~500,
 * so today every clause fits and the cut never engages — which is the point.
 * Filtering only earns its place when there is something to filter.
 */
const CONTEXT_BUDGET_CHARS = 12_000

/**
 * Built lazily, and imported dynamically, so the module stays usable with an
 * injected fake and no credentials — the unit tier runs in CI with no secrets,
 * and a top-level `serverEnv` import would parse (and fail) at module load.
 */
async function defaultEmbedder(): Promise<QueryEmbedder> {
  const [{ OpenAIEmbeddings }, { serverEnv }] = await Promise.all([
    import('@langchain/openai'),
    import('../config/env'),
  ])
  return new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: serverEnv.OPENAI_API_KEY,
  })
}

type ChunkRow = {
  id: string
  contract_id: string
  vendor_id: string
  source_ref: string
  content: string
  score: number
}

/**
 * The clauses most relevant to `query`, belonging to `vendorId` and no one else.
 *
 * The vendor filter is a CORRECTNESS invariant, not an optimisation. Without it a
 * query about vendor A can return a clause from vendor B's contract, and the agent
 * then reports A as breaching an obligation that does not exist between us and
 * them — plausible verdict, citation that resolves to a real clause in a real
 * document, entirely false. `retrieval.integration.test.ts` asserts it.
 */
export async function retrieveRelevantContext(
  query: string,
  vendorId: string,
  opts?: { k?: number; embedder?: QueryEmbedder },
): Promise<Chunk[]> {
  const embedder = opts?.embedder ?? (await defaultEmbedder())

  // pgvector's text form is a JSON-style array, so this is its literal syntax.
  const embedding = JSON.stringify(await embedder.embedQuery(query))

  // `<=>` is cosine DISTANCE (0 = identical), so similarity is 1 - distance.
  //
  // An explicit `k` still means exactly k — tests and probes need a fixed depth.
  // Left to itself, the rule is: send the whole contract when it fits, and only
  // rank-and-cut when it does not. The ordering is computed either way, so the
  // agent always reads the most relevant clause first, and the cut engages by
  // itself the day a contract outgrows the budget.
  const rows =
    opts?.k !== undefined
      ? await sql<ChunkRow[]>`
          select id, contract_id, vendor_id, source_ref, content,
                 1 - (embedding <=> ${embedding}::vector) as score
          from contract_chunks
          where vendor_id = ${vendorId}
          order by embedding <=> ${embedding}::vector
          limit ${opts.k}
        `
      : await sql<ChunkRow[]>`
          select id, contract_id, vendor_id, source_ref, content, score
          from (
            select id, contract_id, vendor_id, source_ref, content,
                   1 - (embedding <=> ${embedding}::vector) as score,
                   row_number() over (order by embedding <=> ${embedding}::vector) as rn,
                   sum(length(content)) over (
                     order by embedding <=> ${embedding}::vector
                     rows between unbounded preceding and current row
                   ) as running_chars
            from contract_chunks
            where vendor_id = ${vendorId}
          ) ranked
          where running_chars <= ${CONTEXT_BUDGET_CHARS} or rn <= ${MIN_CLAUSES}
          order by rn
        `

  return rows.map((row) => ({
    id: row.id,
    contractId: row.contract_id,
    vendorId: row.vendor_id,
    sourceRef: row.source_ref,
    content: row.content,
    score: Number(row.score),
  }))
}

/** One clause on its way into the store. */
export type ChunkInput = {
  contractId: string
  vendorId: string
  sourceRef: string
  content: string
}

/**
 * Embed and store clauses. Lives beside the read path on purpose: both sides
 * know the table's shape and the embedding width, so a change to either is one
 * file, not two that can drift.
 *
 * Upserts on (contract, citation) — the table refuses duplicates, and re-running
 * the loader on its own (to avoid paying to re-embed everything) must be safe
 * rather than an error.
 */
export async function upsertContractChunks(
  chunks: ChunkInput[],
  opts?: { embedder?: QueryEmbedder },
): Promise<number> {
  if (chunks.length === 0) return 0
  const embedder = opts?.embedder ?? (await defaultEmbedder())

  // Sequential rather than Promise.all: this runs in a seed script, and a burst
  // of parallel embedding calls is the easiest way to hit a rate limit.
  let written = 0
  for (const chunk of chunks) {
    const embedding = JSON.stringify(await embedder.embedQuery(chunk.content))
    await sql`
      insert into contract_chunks (contract_id, vendor_id, source_ref, content, embedding)
      values (${chunk.contractId}, ${chunk.vendorId}, ${chunk.sourceRef}, ${chunk.content},
              ${embedding}::vector)
      on conflict (contract_id, source_ref) do update
        set content = excluded.content, embedding = excluded.embedding`
    written += 1
  }
  return written
}
