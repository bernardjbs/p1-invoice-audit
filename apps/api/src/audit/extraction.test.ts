import { describe, expect, it } from 'vitest'
import { ExtractionError, extractInvoiceFields } from './extraction'

/**
 * Unit tier — no network, no database. Every case here drives the model through
 * an injected fake reader, so what is under test is the BOUNDARY: what happens
 * to whatever text the model returns before it becomes data the app trusts.
 *
 * The live counterpart (a real PDF through a real model) is in
 * extraction.integration.test.ts.
 */

const PDF = Buffer.from('%PDF-1.4 pretend bytes')

const VALID = {
  invoiceNumber: 'INV-0001',
  abn: '51000000680',
  subtotalAud: 6000,
  gstAud: 600,
  totalAud: 6600,
  lines: [
    {
      itemCode: 'PUMP-100',
      description: 'Centrifugal slurry pump',
      qty: 1,
      unitPriceAud: 5000,
      lineTotalAud: 5000,
    },
  ],
}

/** A reader that always answers with `reply`, whatever PDF it is handed. */
const replying =
  (reply: string): (() => Promise<string>) =>
  async () =>
    reply

describe('extractInvoiceFields', () => {
  it('returns typed fields when the model replies with a well-formed invoice', async () => {
    const result = await extractInvoiceFields(PDF, { reader: replying(JSON.stringify(VALID)) })

    expect(result.invoiceNumber).toBe('INV-0001')
    expect(result.totalAud).toBe(6600)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]?.itemCode).toBe('PUMP-100')
  })

  it('reads the JSON out of a reply that wraps it in prose or a code fence', async () => {
    const fenced = `Here are the fields I read:\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`

    const result = await extractInvoiceFields(PDF, { reader: replying(fenced) })

    expect(result.invoiceNumber).toBe('INV-0001')
  })

  it('throws ExtractionError when the model replies with something that is not JSON', async () => {
    const reader = replying("I'm sorry, I can't read that document.")

    await expect(extractInvoiceFields(PDF, { reader })).rejects.toBeInstanceOf(ExtractionError)
  })

  it('throws ExtractionError when a required field is missing, rather than returning a partial invoice', async () => {
    const missingGst: Record<string, unknown> = { ...VALID }
    delete missingGst.gstAud
    const reader = replying(JSON.stringify(missingGst))

    await expect(extractInvoiceFields(PDF, { reader })).rejects.toThrow(/gstAud/)
  })

  // '6600' is deliberately a string a lenient schema WOULD accept — Number('6600')
  // succeeds. A malformed one like '6,600.00' fails coercion anyway, so it could
  // not tell a strict schema from a coercing one. (Found by mutation-proving:
  // switching the field to z.coerce.number() left the malformed version green.)
  it('throws ExtractionError when a money field arrives as a string, rather than coercing it', async () => {
    const reader = replying(JSON.stringify({ ...VALID, totalAud: '6600' }))

    await expect(extractInvoiceFields(PDF, { reader })).rejects.toThrow(/totalAud/)
  })
})
