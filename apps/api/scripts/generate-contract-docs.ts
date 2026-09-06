import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGroundTruth, CONTRACT_VENDORS, renderMsa, vendorSlug } from '../src/db/contract-docs'

/**
 * Write the synthetic MSA corpus and its answer key to `assets/contracts/`.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * The output is COMMITTED — these are fixtures, so a change to a clause shows up
 * as a reviewable diff rather than appearing silently at the next seed. Run
 * `bun run contracts:generate` after editing the generator.
 *
 * Deterministic: no clock, no randomness, no database. Running it twice with an
 * unchanged generator rewrites byte-identical files.
 */

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../assets/contracts')

mkdirSync(outDir, { recursive: true })

for (const vendor of CONTRACT_VENDORS) {
  const path = resolve(outDir, `${vendorSlug(vendor.name)}.md`)
  writeFileSync(path, renderMsa(vendor), 'utf8')
}

writeFileSync(
  resolve(outDir, 'ground-truth.json'),
  `${JSON.stringify(buildGroundTruth(), null, 2)}\n`,
  'utf8',
)

console.log(`contracts: wrote ${CONTRACT_VENDORS.length} MSAs + ground-truth.json to ${outDir}`)
