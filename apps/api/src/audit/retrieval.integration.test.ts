import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '../db/client'
import { retrieveRelevantContext, type QueryEmbedder } from './retrieval'

/**
 * The retrieval seam. Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T2.
 *
 * Integration tier: the behaviour under test IS a SQL query, so a pure unit test
 * could not exercise it — the plan named this file `retrieval.test.ts`, but a
 * DB-backed spec belongs in the integration tier or it breaks CI, which runs the
 * unit tier with no database.
 *
 * The EMBEDDER is faked, which is the part that matters for determinism: real
 * embeddings cost an OpenAI call per run and drift. Fixtures use basis vectors
 * (all zeros but a single 1), so cosine distance is exactly 0 between identical
 * directions and exactly 1 between different ones — orderings are provable, not
 * approximate.
 */

const DIMS = 1536

/** A unit vector pointing along one axis. Two different axes are orthogonal. */
function basis(index: number): number[] {
  const v = new Array<number>(DIMS).fill(0)
  v[index] = 1
  return v
}

function fakeEmbedder(vector: number[]): QueryEmbedder {
  return { embedQuery: () => Promise.resolve(vector) }
}

const WEEKEND = basis(0)
const RATES = basis(1)

let vendorA: string
let vendorB: string
let contractA: string
let contractB: string
let vendorEmpty: string

async function insertVendor(name: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into vendors (name, is_approved) values (${name}, true) returning id`
  return row!.id
}

async function insertContract(vendorId: string, title: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into contracts (vendor_id, title) values (${vendorId}, ${title}) returning id`
  return row!.id
}

async function insertChunk(
  contractId: string,
  vendorId: string,
  sourceRef: string,
  content: string,
  embedding: number[],
): Promise<void> {
  await sql`
    insert into contract_chunks (contract_id, vendor_id, source_ref, content, embedding)
    values (${contractId}, ${vendorId}, ${sourceRef}, ${content}, ${JSON.stringify(embedding)}::vector)`
}

beforeAll(async () => {
  vendorA = await insertVendor('Retrieval Fixture Vendor A')
  vendorB = await insertVendor('Retrieval Fixture Vendor B')
  vendorEmpty = await insertVendor('Retrieval Fixture Vendor Empty')
  contractA = await insertContract(vendorA, 'Retrieval Fixture MSA A')
  contractB = await insertContract(vendorB, 'Retrieval Fixture MSA B')

  // Vendor A: the clause we plant, plus an unrelated one pointing elsewhere.
  await insertChunk(contractA, vendorA, 'MSA-A §4.2', 'No surcharge for weekend work.', WEEKEND)
  await insertChunk(contractA, vendorA, 'MSA-A §7.1', 'Rates are fixed for 12 months.', RATES)
  // Vendor B holds a clause on the SAME topic — the one that must never leak.
  await insertChunk(contractB, vendorB, 'MSA-B §2.9', 'Weekend surcharge of 15% applies.', WEEKEND)
})

// Fixtures only — never touch seeded rows. Order matters: chunks reference
// vendors without a cascade, so they go before the vendors do.
afterAll(async () => {
  const vendors = [vendorA, vendorB, vendorEmpty]
  await sql`delete from contract_chunks where vendor_id = any(${vendors})`
  await sql`delete from contracts where vendor_id = any(${vendors})`
  await sql`delete from vendors where id = any(${vendors})`
  await sql.end()
})

describe('retrieveRelevantContext', () => {
  it('returns the planted clause first for a matching query', async () => {
    const results = await retrieveRelevantContext('weekend surcharge?', vendorA, {
      embedder: fakeEmbedder(WEEKEND),
    })

    expect(results[0]?.sourceRef).toBe('MSA-A §4.2')
    expect(results[0]?.content).toContain('weekend')
    // Identical direction → cosine distance 0 → similarity 1.
    expect(results[0]?.score).toBeCloseTo(1, 5)
  })

  it('never returns another vendor’s chunks', async () => {
    // Vendor B's clause is the closest match on this query in the whole table.
    // Asking for more rows than vendor A owns means only the filter can exclude it.
    const results = await retrieveRelevantContext('weekend surcharge?', vendorA, {
      embedder: fakeEmbedder(WEEKEND),
      k: 10,
    })

    expect(results.every((chunk) => chunk.vendorId === vendorA)).toBe(true)
    expect(results.map((chunk) => chunk.sourceRef)).not.toContain('MSA-B §2.9')
  })

  it('returns an empty array when the vendor has no chunks', async () => {
    const results = await retrieveRelevantContext('anything at all', vendorEmpty, {
      embedder: fakeEmbedder(WEEKEND),
    })

    expect(results).toEqual([])
  })

  it('refuses a duplicate clause for the same contract', async () => {
    // The seed re-runs constantly while the corpus generator is built; without this the corpus silently
    // doubles and a top-k retrieval returns k copies of one clause.
    await expect(
      insertChunk(contractA, vendorA, 'MSA-A §4.2', 'No surcharge for weekend work.', WEEKEND),
    ).rejects.toThrow()
  })
})
