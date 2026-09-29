import { Link } from '@tanstack/react-router'

/**
 * The one way an invoice number is rendered as a link.
 *
 * Underlined at rest, not only on hover. The palette is greyscale (every token
 * in index.css has zero chroma), so colour cannot carry the "this is clickable"
 * cue the way it does in a themed app — a hover-only underline left the number
 * indistinguishable from bold text on a still page, and the detail view, which
 * is where the whole product lives, went undiscovered in a walkthrough of the
 * deployed app on 2026-09-24.
 */
export function InvoiceLink({ id, invoiceNumber }: { id: string; invoiceNumber: string }) {
  return (
    <Link
      to="/invoices/$id"
      params={{ id }}
      className="decoration-muted-foreground hover:decoration-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
    >
      {invoiceNumber}
    </Link>
  )
}
