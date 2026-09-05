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

/** Enough clauses for the agent to reason over without burying the relevant one. */
const DEFAULT_K = 4

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
  const k = opts?.k ?? DEFAULT_K
  const embedder = opts?.embedder ?? (await defaultEmbedder())

  // pgvector's text form is a JSON-style array, so this is its literal syntax.
  const embedding = JSON.stringify(await embedder.embedQuery(query))

  // `<=>` is cosine DISTANCE (0 = identical), so similarity is 1 - distance.
  const rows = await sql<ChunkRow[]>`
    select id, contract_id, vendor_id, source_ref, content,
           1 - (embedding <=> ${embedding}::vector) as score
    from contract_chunks
    where vendor_id = ${vendorId}
    order by embedding <=> ${embedding}::vector
    limit ${k}
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
