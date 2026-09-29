import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatAud } from '@/lib/format'
import { useSampleHolds } from './api'
import samples from './samples.json'

export type Sample = (typeof samples)[number]

/**
 * How long until `iso`, in words, or null once it has passed.
 *
 * Minutes, never seconds. A ticking countdown invites a visitor to sit and
 * watch it, and the moment it reaches zero is an estimate anyway: the row goes
 * when the next scheduled sweep runs, not on the tick.
 */
export function freeIn(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return null
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * The invoices a visitor can audit without owning one.
 *
 * Laid out as a ledger rather than a set of cards, because that is this
 * product's own form: each row is identified by the CHECK it trips, named
 * exactly as the results page names it, so a visitor learns the vocabulary
 * before uploading rather than after. Amounts are right-set in tabular figures
 * so they compare down the column, and the action column is a fixed width so
 * the buttons and their status align across rows whatever the copy does.
 *
 * The numbers are not typed by hand: `samples.json` is written by the same
 * script that renders the PDFs, so what a visitor is told to submit is what is
 * printed on the page they submit it with.
 *
 * A sample somebody already uploaded is shown as taken, with the time until it
 * frees, rather than offered and then refused. The invoice number has to be
 * unique and the database is shared, so the visitor who would meet that refusal
 * is usually not the one who caused it.
 */
export function SampleInvoices({ onUse }: { onUse: (sample: Sample) => Promise<void> | void }) {
  const { data: holds } = useSampleHolds()
  // Re-render on a timer so the countdown moves without waiting for a refetch.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])

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

  const takenUntil = (invoiceNumber: string): string | null => {
    const hold = holds?.holds.find((h) => h.invoiceNumber === invoiceNumber)
    return hold ? freeIn(hold.freesAt, now) : null
  }

  return (
    <section aria-labelledby="samples-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="samples-heading" className="text-base font-medium">
          No invoice to hand?
        </h2>
        <p className="text-muted-foreground max-w-[60ch] text-sm">
          Three invoices, each with one fault planted in it. Choosing one fills in the form below
          and attaches the document, so all you do is send it.
        </p>
      </div>

      <ul className="divide-border divide-y border-y">
        {samples.map((sample) => {
          const taken = takenUntil(sample.invoiceNumber)
          const statusId = `sample-status-${sample.file}`
          return (
            <li key={sample.file} className="flex items-start gap-6 py-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{sample.check}</p>
                <p className="text-muted-foreground max-w-[58ch] text-sm">{sample.proves}</p>
                <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-4 text-xs">
                  <span>{sample.invoiceNumber}</span>
                  <span className="tabular-nums">{formatAud(sample.totalAud)}</span>
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

              <div className="flex w-32 shrink-0 flex-col items-end gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={taken !== null}
                  aria-describedby={taken !== null ? statusId : undefined}
                  onClick={() => void use(sample)}
                >
                  Use this
                </Button>
                {taken !== null && (
                  <span id={statusId} className="text-muted-foreground text-right text-xs">
                    free in {taken}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-muted-foreground max-w-[68ch] text-sm">
        Whichever you choose, PO match will flag: the form has no purchase-order field yet, so that
        check has nothing to match against, and the contract check often reports it too.
      </p>
    </section>
  )
}
