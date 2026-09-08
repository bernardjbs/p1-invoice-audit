/**
 * The invoice page, as HTML. One renderer, two callers.
 *
 * `generate-invoice-pdfs.ts` renders every seeded invoice from the database;
 * `generate-e2e-fixture.ts` renders the single hand-written invoice the e2e
 * suite uploads. They must produce the SAME kind of document, because the
 * extraction prompt is written against this layout and the eval scores the model
 * on it. Two copies of the template would drift, and the drift would surface as
 * a model that reads seeded invoices well and the fixture badly.
 */

const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** One invoice's header fields. Snake_case because the seed reads these straight out of Postgres. */
export type InvoiceRow = {
  id: string
  invoice_number: string
  invoice_date: string
  due_date: string
  subtotal_aud: number
  gst_aud: number
  total_aud: number
  vendor_name: string
  vendor_abn: string
}

/** One line-item row. */
export type LineRow = {
  invoice_id: string
  item_code: string
  description: string
  qty: number
  unit_price_aud: number
  line_total_aud: number
}

export function renderHtml(inv: InvoiceRow, lines: LineRow[]): string {
  const rows = lines
    .map(
      (l) => `<tr>
        <td>${esc(l.item_code)}</td>
        <td>${esc(l.description)}</td>
        <td class="num">${l.qty}</td>
        <td class="num">${aud.format(l.unit_price_aud)}</td>
        <td class="num">${aud.format(l.line_total_aud)}</td>
      </tr>`,
    )
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12px; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { margin: 12px 0 20px; }
    .meta div { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f0f4f8; }
    .num { text-align: right; }
    tfoot td { font-weight: bold; }
  </style></head><body>
    <h1>Tax Invoice</h1>
    <div class="meta">
      <div><strong>Invoice:</strong> ${esc(inv.invoice_number)}</div>
      <div><strong>Vendor:</strong> ${esc(inv.vendor_name)}</div>
      <div><strong>ABN:</strong> ${esc(inv.vendor_abn)}</div>
      <div><strong>Invoice date:</strong> ${esc(inv.invoice_date)} &nbsp; <strong>Due:</strong> ${esc(inv.due_date)}</div>
    </div>
    <table>
      <thead><tr><th>Code</th><th>Description</th><th class="num">Qty</th><th class="num">Unit (AUD)</th><th class="num">Line (AUD)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" class="num">Subtotal</td><td class="num">${aud.format(inv.subtotal_aud)}</td></tr>
        <tr><td colspan="4" class="num">GST (10%)</td><td class="num">${aud.format(inv.gst_aud)}</td></tr>
        <tr><td colspan="4" class="num">Total</td><td class="num">${aud.format(inv.total_aud)}</td></tr>
      </tfoot>
    </table>
  </body></html>`
}
