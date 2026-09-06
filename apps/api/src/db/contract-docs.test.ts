import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildGroundTruth,
  chunkClause,
  chunksFor,
  clausesFor,
  CONTRACT_VENDORS,
  MAX_CHUNK_CHARS,
  PLANTED_VIOLATIONS,
  renderMsa,
  sourceRefFor,
  vendorSlug,
  type Clause,
} from './contract-docs'

/**
 * The synthetic MSA corpus.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T3.
 *
 * Pure tier — no database, no network. The generator is deliberately free of
 * randomness and clocks so the committed fixtures are reviewable as diffs.
 */

const here = dirname(fileURLToPath(import.meta.url))
const assets = resolve(here, '../../assets/contracts')

describe('the corpus', () => {
  it('gives every contracted vendor an MSA with at least five clauses', () => {
    expect(CONTRACT_VENDORS.length).toBeGreaterThan(0)
    for (const vendor of CONTRACT_VENDORS) {
      expect(clausesFor(vendor).length).toBeGreaterThanOrEqual(5)
    }
  })

  it('produces at least thirty chunks in total, clearing the corpus gate', () => {
    const total = CONTRACT_VENDORS.reduce((sum, v) => sum + chunksFor(v).length, 0)
    expect(total).toBeGreaterThanOrEqual(30)
  })

  it('gives every chunk a citation unique within its contract', () => {
    for (const vendor of CONTRACT_VENDORS) {
      const refs = chunksFor(vendor).map((c) => c.sourceRef)
      expect(new Set(refs).size).toBe(refs.length)
      // The table's uniqueness rule is on (contract, citation) — a generator that
      // repeated a citation would upsert over itself and silently lose a clause.
      expect(refs.every((r) => r.startsWith(vendor.msaRef))).toBe(true)
    }
  })
})

describe('determinism', () => {
  it('renders byte-identical markdown on repeated calls', () => {
    for (const vendor of CONTRACT_VENDORS) {
      expect(renderMsa(vendor)).toBe(renderMsa(vendor))
    }
  })

  it('matches the committed fixture on disk', () => {
    // Fails when the generator changes without `bun run contracts:generate` —
    // otherwise the documents the agent reads drift from the ones in review.
    for (const vendor of CONTRACT_VENDORS) {
      const onDisk = readFileSync(resolve(assets, `${vendorSlug(vendor.name)}.md`), 'utf8')
      expect(onDisk).toBe(renderMsa(vendor))
    }
  })

  it('matches the committed ground truth on disk', () => {
    const onDisk = readFileSync(resolve(assets, 'ground-truth.json'), 'utf8')
    expect(onDisk).toBe(`${JSON.stringify(buildGroundTruth(), null, 2)}\n`)
  })
})

describe('planted violations', () => {
  it('cites a clause that actually exists in that vendor’s MSA', () => {
    const allRefs = new Set(
      CONTRACT_VENDORS.flatMap((v) => clausesFor(v).map((c) => sourceRefFor(v, c))),
    )
    for (const violation of PLANTED_VIOLATIONS) {
      expect(allRefs.has(violation.sourceRef)).toBe(true)
    }
  })

  it('gives the contract-terms check real work — every contracted vendor has one', () => {
    // A corpus where nothing is breached would let a check that always passes
    // score perfectly.
    const refs = PLANTED_VIOLATIONS.map((v) => v.msaRef)
    for (const vendor of CONTRACT_VENDORS) {
      expect(refs).toContain(vendor.msaRef)
    }
  })
})

describe('chunking', () => {
  it('keeps a normal clause whole', () => {
    const vendor = CONTRACT_VENDORS[0]!
    const clause = clausesFor(vendor)[4]!
    expect(chunkClause(vendor, clause)).toHaveLength(1)
  })

  it('splits an over-long clause without dropping any text', () => {
    const vendor = CONTRACT_VENDORS[0]!
    const sentence = 'The Supplier shall comply with all site rules and procedures. '
    const long: Clause = {
      section: 99,
      heading: 'Overlong',
      text: sentence.repeat(Math.ceil((MAX_CHUNK_CHARS * 2) / sentence.length)),
    }

    const parts = chunkClause(vendor, long)

    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      expect(part.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
    // Nothing lost: rejoining the parts reproduces the clause word for word.
    const rejoined = parts
      .map((p) => p.content)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const original = `${long.section}. ${long.heading} — ${long.text}`.replace(/\s+/g, ' ').trim()
    expect(rejoined).toBe(original)
  })

  it('keeps continuation citations distinct and traceable', () => {
    const vendor = CONTRACT_VENDORS[0]!
    const long: Clause = { section: 99, heading: 'Overlong', text: 'Sentence here. '.repeat(200) }

    const refs = chunkClause(vendor, long).map((p) => p.sourceRef)

    expect(new Set(refs).size).toBe(refs.length)
    expect(refs[0]).toBe(`${vendor.msaRef} §99`)
    expect(refs[1]).toContain('cont.')
  })
})
