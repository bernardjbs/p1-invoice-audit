import type { ExtractedInvoice } from '../../apps/api/src/audit/extraction'

/**
 * Render an invoice as plain text for the grading judge.
 *
 * The judge scores each claim in a summary against the documents it was given.
 * Those documents were the contract clauses and nothing else, which marked a
 * correct answer down: the rubric REQUIRES a summary to say what the invoice
 * did, so a good answer makes claims about amounts and line items that had no
 * source in view. Measured on the prose-only-breach row: 0.33 with the clause
 * alone, 0.67 with the invoice.
 *
 * That was a defect in what we handed the judge, not in the engine. The rubric
 * already allows a claim to rest on the cited clause *or the invoice as
 * rendered*; only the second half was missing.
 *
 * Rendered from the EXTRACTED fields, not the database row and not the raw PDF
 * text, because those are what the engine actually read. Grading against the
 * database would fold extraction accuracy into a metric about prose, and a
 * metric that can fail for two reasons does not tell you which to fix.
 * Extraction has its own eval.
 */
export function renderInvoice(invoice: ExtractedInvoice): string {
  const lines = invoice.lines.map(
    (line) =>
      `  ${line.itemCode}  ${line.description}  qty ${line.qty} @ ${money(line.unitPriceAud)} = ${money(line.lineTotalAud)}`,
  )

  return [
    `Invoice ${invoice.invoiceNumber}`,
    `Supplier ABN ${invoice.abn}`,
    '',
    'Line items:',
    ...lines,
    '',
    `Subtotal ${money(invoice.subtotalAud)}`,
    `GST ${money(invoice.gstAud)}`,
    `Total ${money(invoice.totalAud)}`,
  ].join('\n')
}

/**
 * Two decimal places always. A whole-dollar amount printed bare reads as a
 * count rather than money, and the judge is being asked whether a figure in the
 * prose appears in the document.
 */
function money(aud: number): string {
  return `$${aud.toFixed(2)}`
}
