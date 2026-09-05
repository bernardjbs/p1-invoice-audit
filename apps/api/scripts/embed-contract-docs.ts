import '../src/config/load-env'
import { upsertContractChunks, type ChunkInput } from '../src/audit/retrieval'
import { chunksFor, CONTRACT_VENDORS } from '../src/db/contract-docs'
import { sql } from '../src/db/client'

/**
 * Embed the synthetic MSA corpus into `contract_chunks`.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * Runs after the seed, because it needs the contract and vendor rows the seed
 * creates. Makes a live embedding call per clause, so it runs under Doppler:
 *   doppler run -c dev -- bun run seed
 *
 * Chunks are derived from the same pure generator that writes the markdown, not
 * by re-parsing the files — one source of truth, so the documents on disk and the
 * rows in the database cannot drift apart.
 *
 * Safe to re-run on its own: it upserts on (contract, citation), which is the
 * cheap path while iterating, since re-embedding everything costs money.
 */

type ContractRow = { id: string; vendor_id: string; msa_ref: string }

async function main(): Promise<void> {
  const rows = await sql<ContractRow[]>`
    select id, vendor_id, msa_ref from contracts where msa_ref is not null`
  const byRef = new Map(rows.map((row) => [row.msa_ref, row]))

  const inputs: ChunkInput[] = []
  for (const vendor of CONTRACT_VENDORS) {
    const contract = byRef.get(vendor.msaRef)
    if (contract === undefined) {
      // A generator/seed mismatch would otherwise show up much later as an agent
      // that mysteriously finds no clauses for one vendor.
      throw new Error(
        `no contract row for ${vendor.msaRef} (${vendor.name}) — run the seed first, ` +
          'and check the generator still matches the seed vendors.',
      )
    }
    for (const chunk of chunksFor(vendor)) {
      inputs.push({
        contractId: contract.id,
        vendorId: contract.vendor_id,
        sourceRef: chunk.sourceRef,
        content: chunk.content,
      })
    }
  }

  const written = await upsertContractChunks(inputs)
  const [count] = await sql<{ count: string }[]>`select count(*)::text from contract_chunks`
  console.log(
    `contracts: embedded ${written} clauses across ${CONTRACT_VENDORS.length} MSAs ` +
      `(table now holds ${count!.count})`,
  )
}

try {
  await main()
} finally {
  await sql.end()
}
