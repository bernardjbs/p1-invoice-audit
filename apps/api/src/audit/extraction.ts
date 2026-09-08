import { z } from 'zod'
import { EXTRACTION_PROMPT } from './prompts/extraction'

/**
 * Read an invoice PDF with a vision model and hand back typed fields.
 *
 * This is the first place in the app where a MODEL produces data the app then
 * acts on, so the whole file is organised around one rule: raw model text never
 * leaves this module. Either it parses into an `ExtractedInvoice`, or an
 * `ExtractionError` is thrown. Callers never see the string, never see partial
 * fields, and never have to guess whether a number is real.
 *
 * How well it actually reads is not asserted here — that is measured, over every
 * seeded invoice, by the oracle gate in `evals/extraction/run.ts`, which scores
 * these fields against the answer key and fails below a threshold. Tests prove
 * the boundary holds; the gate proves the model is good enough.
 */

/**
 * The fields we ask the model for, and the ONLY fields the oracle scores.
 *
 * Deliberately narrower than `assets/invoices/ground-truth.json`, which also
 * holds the PO number and MSA reference: neither is printed on the PDF (see
 * `scripts/generate-invoice-pdfs.ts`), so asking for them would score the model
 * on text it cannot see. Those reach the checks from the database instead.
 */
export const ExtractedLineSchema = z.object({
  itemCode: z.string().min(1),
  description: z.string().min(1),
  qty: z.number(),
  unitPriceAud: z.number(),
  lineTotalAud: z.number(),
})
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>

export const ExtractedInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  abn: z.string().min(1),
  subtotalAud: z.number(),
  gstAud: z.number(),
  totalAud: z.number(),
  lines: z.array(ExtractedLineSchema).min(1),
})
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>

/**
 * Thrown for every way the boundary can fail: no JSON in the reply, JSON that
 * is not an invoice, a missing field, a string where a number belongs.
 *
 * One error type rather than several because the caller's options are the same
 * in every case (retry, or route the invoice to a human); `cause` carries the
 * detail for the log without putting model text on the happy path.
 */
export class ExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExtractionError'
  }
}

/**
 * The minimum a vision model must do: take a PDF and a prompt, return its raw
 * reply as text. Mirrors the `QueryEmbedder` seam in retrieval.ts — a structural
 * type, so the real client satisfies it without being named here, and a test
 * fake is one line.
 *
 * Text, not a parsed object: the parse is the thing under test, so it stays in
 * this file where it is visible, rather than inside a library's structured-output
 * helper.
 */
export type InvoiceReader = (pdfBase64: string, prompt: string) => Promise<string>

/**
 * Pull the JSON object out of a model reply. Models wrap JSON in prose or in a
 * ```json fence often enough that requiring a bare object would fail on replies
 * that are actually correct — so take the outermost braces and let Zod decide.
 */
function parseReply(reply: string): ExtractedInvoice {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new ExtractionError('model reply contained no JSON object')
  }

  let json: unknown
  try {
    json = JSON.parse(reply.slice(start, end + 1))
  } catch (cause) {
    throw new ExtractionError('model reply was not valid JSON', { cause })
  }

  const parsed = ExtractedInvoiceSchema.safeParse(json)
  if (!parsed.success) {
    throw new ExtractionError(
      `model reply did not match the invoice schema: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      { cause: parsed.error },
    )
  }
  return parsed.data
}

/**
 * Haiku is the cheapest model that can read a page, and this runs once per
 * invoice, so it is the default. The locked decision is that the tier is
 * arbitrated by the eval, not by taste: if the oracle gate scores below its
 * threshold, this moves up to Sonnet and both scores go in the record.
 */
export const DEFAULT_EXTRACTION_MODEL = 'claude-haiku-4-5'

/**
 * Claude vision through LangChain. Imported dynamically, together with the env,
 * so this module stays importable with an injected fake and no credentials — the
 * unit tier runs in CI with no secrets, and a top-level `serverEnv` import would
 * parse (and fail) at module load. Same reasoning as retrieval.ts.
 *
 * LangChain rather than the Anthropic SDK directly: extraction becomes a node in
 * the LangGraph engine, so it should be built from the same parts as every other
 * model step, and LangSmith then traces the call itself rather than just
 * recording that the step ran.
 */
export function claudeReader(model: string): InvoiceReader {
  return async (pdfBase64, prompt) => {
    const [{ ChatAnthropic }, { serverEnv }] = await Promise.all([
      import('@langchain/anthropic'),
      import('../config/env'),
    ])
    const chat = new ChatAnthropic({ model, apiKey: serverEnv.ANTHROPIC_API_KEY })
    const response = await chat.invoke([
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      },
    ])
    return response.text
  }
}

export type ExtractOptions = {
  /** Injected in tests; defaults to Claude vision. */
  reader?: InvoiceReader
  /** Overridden by the eval gate when arbitrating the model tier. */
  model?: string
}

/** Extract the invoice fields from a PDF's bytes, or throw `ExtractionError`. */
export async function extractInvoiceFields(
  pdf: Buffer,
  opts: ExtractOptions = {},
): Promise<ExtractedInvoice> {
  const reader = opts.reader ?? claudeReader(opts.model ?? DEFAULT_EXTRACTION_MODEL)

  let reply: string
  try {
    reply = await reader(pdf.toString('base64'), EXTRACTION_PROMPT)
  } catch (cause) {
    // A transport/API failure is still an extraction failure to the caller, and
    // wrapping it here keeps every failure mode of this module one error type.
    throw new ExtractionError('the model call failed', { cause })
  }
  return parseReply(reply)
}
