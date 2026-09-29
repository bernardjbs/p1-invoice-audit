import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { formatAud } from '@/lib/format'
import samples from './samples.json'

export type Sample = (typeof samples)[number]

/**
 * The sample invoices a visitor can audit without owning one.
 *
 * The numbers here are not typed by hand: `samples.json` is written by the same
 * script that renders the PDFs, so what a visitor is told to submit is what is
 * printed on the page they submit it with. Typing them twice would let the two
 * drift, and an invoice header contradicting its own checks is the exact fault
 * this app exists to catch.
 */
export function SampleInvoices({ onUse }: { onUse: (sample: Sample) => Promise<void> | void }) {
  // One at a time: two concurrent fetches would race to fill the same form.
  const busy = useRef(false)

  const use = async (sample: Sample) => {
    if (busy.current) return
    busy.current = true
    try {
      await onUse(sample)
    } finally {
      busy.current = false
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="space-y-1">
        <h2 className="font-medium">No invoice to hand? Audit one of these.</h2>
        <p className="text-muted-foreground text-sm">
          Each one carries a single planted fault, so you can watch one check react to it.
          &ldquo;Use this&rdquo; fills the form and attaches the PDF; you press Upload.
        </p>
      </div>

      <ul className="divide-y">
        {samples.map((sample) => (
          <li key={sample.file} className="flex items-start justify-between gap-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{sample.title}</p>
              <p className="text-muted-foreground text-sm">{sample.proves}</p>
              <p className="text-muted-foreground text-xs">
                {sample.vendorName} · {sample.invoiceNumber} · {formatAud(sample.totalAud)} ·{' '}
                <a
                  href={`/samples/${sample.file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="decoration-muted-foreground hover:decoration-foreground underline underline-offset-4"
                >
                  open the PDF
                </a>
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void use(sample)}>
              Use this
            </Button>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-sm">
        Read the check named above; the others will have findings of their own. Whichever sample you
        pick, the upload form carries no purchase-order reference yet, so{' '}
        <span className="font-medium">PO match</span> always flags, and the contract check usually
        reports that same missing purchase order alongside whatever else it finds. Uploading the
        same sample twice needs a different invoice number — edit the field before pressing Upload.
      </p>
    </section>
  )
}
