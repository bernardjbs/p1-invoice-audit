import { z } from 'zod'
import type { ExtractedInvoice } from '../../extraction'
import { CONTRACT_TERMS_SYSTEM, buildContractTermsPrompt } from '../../prompts/contract-terms'
import { retrieveRelevantContext, type Chunk } from '../../retrieval'
import { VERDICTS, type CheckResult } from '../../types'

/**
 * The fourth check, and the only one that reads.
 *
 * The other three are arithmetic against numbers we already hold. This one
 * answers a question no sum can: does the contract's WORDING forbid what this
 * invoice is doing? A clause saying "no call-out fee without prior written
 * approval" cannot be checked by adding anything up; somebody has to read it.
 *
 * The node owns two things it does not control — what retrieval returns, and what
 * the model says — so its whole design is about what it does with answers it did
 * not choose. Nothing the model writes reaches the result except a verdict from a
 * fixed set and a sentence of prose.
 */

/**
 * What the model is allowed to return. Anything else is an error, not a verdict.
 *
 * Note what is NOT here: any clause REFERENCE. The model picks a clause by its
 * position in the list we showed it, and we resolve that position against our own
 * rows — so the citation is chosen by the model but authored by the database, and
 * an invented reference has nowhere to enter.
 *
 * The protection is two-layered, and the pair was measured rather than assumed:
 * mutating only the mapping below to trust a model-supplied citation left every
 * spec green, because this schema had already stripped the field. Both layers
 * have to fail together, which is why neither is redundant.
 */
const JudgementSchema = z.object({
  verdict: z.enum(VERDICTS),
  summary: z.string().min(1),
  /** 1-based position in the list shown to the model; null only when passing. */
  clause: z.number().int().positive().nullable(),
})

/** Thrown when the model's reply cannot be trusted to mean anything. */
export class ContractTermsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ContractTermsError'
  }
}

/** The clauses to judge against. `retrieveRelevantContext` satisfies it structurally. */
export type ClauseRetriever = (query: string, vendorId: string) => Promise<Chunk[]>

/** Prompt in, raw reply out. Mirrors the extraction reader seam — the parse stays visible here. */
export type ClauseJudge = (system: string, prompt: string) => Promise<string>

/** Enough clauses to reason over without burying the relevant one (matches the seam's default). */
const TOP_K = 4

/**
 * Sonnet rather than Haiku: this is the only step asked to reason about meaning
 * rather than transcribe. The tier is arbitrated by the eval, like extraction's.
 */
export const DEFAULT_JUDGE_MODEL = 'claude-sonnet-4-6'

/**
 * The question put to retrieval. Built from what is CHARGED — descriptions and
 * item codes — because that is what a clause would forbid. Amounts are left out
 * on purpose: they pull the search towards rate and payment clauses, which the
 * deterministic checks already cover, and away from the conduct clauses that only
 * reading can enforce.
 */
function buildQuery(invoice: ExtractedInvoice): string {
  const charges = invoice.lines.map((l) => `${l.itemCode} ${l.description}`).join('; ')
  return `Charges on this invoice: ${charges}. Which contract terms govern or forbid these charges?`
}

/**
 * The invoice as the model sees it — COMPLETE, unlike the retrieval query above.
 *
 * The two strings are built for different readers and the distinction is
 * load-bearing. The query is deliberately lean because amounts drag the search
 * towards rate clauses. This render must show everything the invoice states,
 * because clauses judge the document as rendered: an early version omitted the
 * ABN and the GST breakdown, and the model correctly reported every invoice as
 * incorrectly rendered under the payment-terms clause — 4 of 4 clean invoices
 * failed, for a defect that existed only in this function.
 */
function renderInvoice(invoice: ExtractedInvoice, poNumber?: string): string {
  const lines = invoice.lines
    .map((l) => `- ${l.itemCode} | ${l.description} | qty ${l.qty} | unit ${l.unitPriceAud} AUD`)
    .join('\n')
  return [
    `Invoice ${invoice.invoiceNumber}`,
    `Supplier ABN: ${invoice.abn}`,
    poNumber === undefined ? null : `Purchase order: ${poNumber}`,
    `Lines:\n${lines}`,
    `Subtotal: ${invoice.subtotalAud} AUD`,
    `GST: ${invoice.gstAud} AUD`,
    `Total: ${invoice.totalAud} AUD`,
  ]
    .filter((part) => part !== null)
    .join('\n')
}

function renderClauses(chunks: Chunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
}

function parseJudgement(reply: string): z.infer<typeof JudgementSchema> {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new ContractTermsError('model reply contained no JSON object')
  }
  let json: unknown
  try {
    json = JSON.parse(reply.slice(start, end + 1))
  } catch (cause) {
    throw new ContractTermsError('model reply was not valid JSON', { cause })
  }
  const parsed = JudgementSchema.safeParse(json)
  if (!parsed.success) {
    throw new ContractTermsError(
      `model reply did not match the judgement schema: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      { cause: parsed.error },
    )
  }
  return parsed.data
}

/** Claude through LangChain, imported lazily so the unit tier needs no credentials. */
function claudeJudge(model: string): ClauseJudge {
  return async (system, prompt) => {
    const [{ ChatAnthropic }, { serverEnv }] = await Promise.all([
      import('@langchain/anthropic'),
      import('../../../config/env'),
    ])
    const chat = new ChatAnthropic({ model, apiKey: serverEnv.ANTHROPIC_API_KEY })
    const response = await chat.invoke([
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ])
    return response.text
  }
}

export type ContractTermsOptions = {
  /** The PO the invoice was raised against, if known — the payment-terms clause requires it. */
  poNumber?: string
  retrieve?: ClauseRetriever
  judge?: ClauseJudge
  model?: string
  k?: number
}

/** Judge one invoice against its vendor's contract clauses. */
export async function runContractTermsCheck(
  invoice: ExtractedInvoice,
  vendorId: string,
  opts: ContractTermsOptions = {},
): Promise<CheckResult> {
  const retrieve: ClauseRetriever =
    opts.retrieve ??
    ((query, vendor) => retrieveRelevantContext(query, vendor, { k: opts.k ?? TOP_K }))
  const judge = opts.judge ?? claudeJudge(opts.model ?? DEFAULT_JUDGE_MODEL)

  const clauses = await retrieve(buildQuery(invoice), vendorId)

  // No contract on file means no contract term to breach. Answer that plainly
  // rather than asking a model to judge against nothing — it would have no
  // grounds, and any citation it produced would be for a document we do not hold.
  if (clauses.length === 0) {
    return {
      type: 'contract_terms',
      verdict: 'pass',
      evidence: {
        summary: 'No contract clauses are on file for this vendor, so no contract term applies.',
      },
    }
  }

  const reply = await judge(
    CONTRACT_TERMS_SYSTEM,
    buildContractTermsPrompt(renderClauses(clauses), renderInvoice(invoice, opts.poNumber)),
  )
  const judgement = parseJudgement(reply)

  // Resolve the model's CHOICE into our own citation. Ranking cannot do this job:
  // retrieval orders by topical similarity, and the clause a verdict rests on is
  // frequently not the top hit — measured on the seeded corpus, where a call-out
  // breach retrieved "Term and Scope" above the clause that actually forbids it.
  const cited = judgement.clause === null ? null : (clauses[judgement.clause - 1] ?? null)
  if (judgement.verdict !== 'pass' && cited === null) {
    throw new ContractTermsError(
      `model returned verdict '${judgement.verdict}' citing clause ${judgement.clause}, which was not among the ${clauses.length} shown`,
    )
  }

  return {
    type: 'contract_terms',
    verdict: judgement.verdict,
    evidence: {
      summary: judgement.summary,
      ...(cited === null ? {} : { sourceRef: cited.sourceRef }),
    },
  }
}
