import { describe, expect, it } from 'vitest'
import type { ExtractedInvoice } from '../../extraction'
import type { Chunk } from '../../retrieval'
import { CheckResultSchema } from '../../types'
import { ContractTermsError, runContractTermsCheck } from './contract-terms-agent'

/**
 * The contract-terms agent, driven entirely by fakes.
 * Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T6.
 *
 * Unit tier — no database, no model, no network. What is under test is the
 * CONTAINMENT: the retrieval and the model are the two things this node cannot
 * control, so every case here asks what the node does with an answer it did not
 * choose. Whether the model reasons *well* is a different question, measured by
 * the eval harness, not asserted here.
 */

const INVOICE: ExtractedInvoice = {
  invoiceNumber: 'INV-0021',
  abn: '51000000680',
  subtotalAud: 5850,
  gstAud: 585,
  totalAud: 6435,
  lines: [
    {
      itemCode: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unitPriceAud: 5000,
      lineTotalAud: 5000,
    },
    {
      itemCode: 'CALLOUT-WE',
      description: 'Weekend call-out loading',
      qty: 1,
      unitPriceAud: 850,
      lineTotalAud: 850,
    },
  ],
}

const CLAUSE: Chunk = {
  id: 'chunk-1',
  contractId: 'contract-1',
  vendorId: 'vendor-1',
  sourceRef: 'MSA-1000 §6',
  content:
    'No surcharge, loading, penalty or call-out fee shall apply in respect of works performed ' +
    'outside standard hours unless expressly approved in writing in advance.',
  score: 0.51,
}

/** A retriever that always returns `chunks`, whatever it is asked. */
const retrieving = (chunks: Chunk[]) => async (): Promise<Chunk[]> => chunks

/** A model that always replies with `reply`, whatever it is prompted with. */
const replying = (reply: string) => async (): Promise<string> => reply

const BREACH_REPLY = JSON.stringify({
  verdict: 'flag',
  summary: 'A weekend call-out loading is charged with no evidence of prior written approval.',
  clause: 1,
})

describe('runContractTermsCheck', () => {
  it('returns a valid contract_terms result carrying the model’s verdict', async () => {
    const result = await runContractTermsCheck(INVOICE, 'vendor-1', {
      retrieve: retrieving([CLAUSE]),
      judge: replying(BREACH_REPLY),
    })

    expect(CheckResultSchema.safeParse(result).success).toBe(true)
    expect(result.type).toBe('contract_terms')
    expect(result.verdict).toBe('flag')
    expect(result.evidence.summary).toContain('call-out')
  })

  it('cites the retrieved clause, never the one the model made up', async () => {
    // The single most dangerous thing this node could do. A model asked about
    // contracts will happily produce a real-looking clause reference that does
    // not exist, and a fabricated citation attached to a confident verdict is
    // indistinguishable from a real one to whoever reads the audit.
    const inventing = replying(
      JSON.stringify({
        verdict: 'flag',
        summary: 'Breach of the call-out clause.',
        clause: 1,
        sourceRef: 'MSA-9999 §42',
      }),
    )

    const result = await runContractTermsCheck(INVOICE, 'vendor-1', {
      retrieve: retrieving([CLAUSE]),
      judge: inventing,
    })

    expect(result.evidence.sourceRef).toBe('MSA-1000 §6')
    expect(JSON.stringify(result)).not.toContain('MSA-9999')
  })

  it('passes, and cites nothing, when the vendor has no clauses on file', async () => {
    // No contract means no contract term to breach. It must say so rather than
    // crash, and it must not invent a citation for a document that is not there.
    const result = await runContractTermsCheck(INVOICE, 'vendor-1', {
      retrieve: retrieving([]),
      judge: replying('the model should never be asked'),
    })

    expect(CheckResultSchema.safeParse(result).success).toBe(true)
    expect(result.verdict).toBe('pass')
    expect(result.evidence.sourceRef).toBeUndefined()
  })

  it('throws rather than pass a reply it cannot understand into the audit', async () => {
    await expect(
      runContractTermsCheck(INVOICE, 'vendor-1', {
        retrieve: retrieving([CLAUSE]),
        judge: replying('I am not able to assess this invoice.'),
      }),
    ).rejects.toThrow(ContractTermsError)
  })

  it('rejects a verdict outside the three the audit allows', async () => {
    // 'approved' is not a verdict this system has. Letting it through would put a
    // value in the result that nothing downstream knows how to render.
    await expect(
      runContractTermsCheck(INVOICE, 'vendor-1', {
        retrieve: retrieving([CLAUSE]),
        judge: replying(JSON.stringify({ verdict: 'approved', summary: 'Looks fine.', clause: 1 })),
      }),
    ).rejects.toThrow(/verdict/)
  })

  it('cites the clause the model chose, not whichever ranked first', async () => {
    // Retrieval orders by topical similarity, and the clause a verdict rests on is
    // often not the top hit — measured live, where a call-out breach put "Term and
    // Scope" above the clause that actually forbids it. So the model picks from the
    // list by position, and we resolve that position against our own rows.
    const second: Chunk = { ...CLAUSE, id: 'chunk-2', sourceRef: 'MSA-1000 §2' }

    const result = await runContractTermsCheck(INVOICE, 'vendor-1', {
      retrieve: retrieving([CLAUSE, second]),
      judge: replying(JSON.stringify({ verdict: 'flag', summary: 'Breach.', clause: 2 })),
    })

    expect(result.evidence.sourceRef).toBe('MSA-1000 §2')
  })

  it('refuses a clause number that was never shown to the model', async () => {
    // An index outside the list means the model is pointing at a clause we did not
    // give it. Resolving that to anything — the top hit, or nothing — would attach
    // a citation nobody chose to a verdict somebody will act on.
    await expect(
      runContractTermsCheck(INVOICE, 'vendor-1', {
        retrieve: retrieving([CLAUSE]),
        judge: replying(JSON.stringify({ verdict: 'fail', summary: 'Breach.', clause: 7 })),
      }),
    ).rejects.toThrow(ContractTermsError)
  })

  it('asks retrieval about what is charged, not about the totals', async () => {
    // Retrieval only sees this string. Amounts in it pull the search towards rate
    // and payment clauses — which the deterministic checks already cover — and
    // away from the conduct clauses only reading can enforce.
    let asked = ''
    await runContractTermsCheck(INVOICE, 'vendor-1', {
      retrieve: async (query) => {
        asked = query
        return [CLAUSE]
      },
      judge: replying(BREACH_REPLY),
    })

    expect(asked).toContain('Weekend call-out loading')
    expect(asked).not.toContain('6435')
  })
})

describe('parseJudgement — replies that are not a single clean object', () => {
  const clauses = [
    { id: 'c1', contractId: 'k1', vendorId: 'v1', sourceRef: 'MSA §6', content: 'x', score: 1 },
  ]
  const retrieve = async () => clauses
  const invoice = {
    invoiceNumber: 'INV-0001',
    abn: '11 111 111 111',
    subtotalAud: 100,
    gstAud: 10,
    totalAud: 110,
    lines: [
      { itemCode: 'A', description: 'a thing', qty: 1, unitPriceAud: 100, lineTotalAud: 100 },
    ],
  }

  it('takes the final object when the model corrects itself mid-reply', async () => {
    // A real reply, 2026-09-08: a verdict, an argument into the opposite one,
    // "Wait, I must return only one JSON object", then a second object. The old
    // first-brace-to-last-brace slice spanned object + prose + object.
    const judge = async () =>
      '{"verdict": "fail", "summary": "first thoughts", "clause": 1}\n\n' +
      'Wait, I must return only one JSON object. Here it is:\n' +
      '{"verdict": "pass", "summary": "on reflection nothing is breached", "clause": null}'
    const result = await runContractTermsCheck(invoice, 'v1', { retrieve, judge })
    expect(result.verdict).toBe('pass')
    expect(result.evidence.summary).toBe('on reflection nothing is breached')
  })

  it('ignores prose wrapped around a single object', async () => {
    const judge = async () =>
      'Here is my judgement:\n{"verdict": "fail", "summary": "clause 1 forbids it", "clause": 1}\nHope that helps.'
    const result = await runContractTermsCheck(invoice, 'v1', { retrieve, judge })
    expect(result.verdict).toBe('fail')
  })

  it('is not confused by braces inside the summary text', async () => {
    const judge = async () =>
      '{"verdict": "fail", "summary": "the clause says {no call-out fees} without approval", "clause": 1}'
    const result = await runContractTermsCheck(invoice, 'v1', { retrieve, judge })
    expect(result.evidence.summary).toContain('{no call-out fees}')
  })

  it('still refuses a reply with no object at all', async () => {
    const judge = async () => 'I am not sure what to make of this invoice.'
    await expect(runContractTermsCheck(invoice, 'v1', { retrieve, judge })).rejects.toThrow(
      /no JSON object/,
    )
  })
})
