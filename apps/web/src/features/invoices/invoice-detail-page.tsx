import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useInvoice } from './api'
import { CheckResults } from './check-results'
import { StatusBadge } from './status-badge'
import { formatAud, formatDate, formatPct } from '@/lib/format'

export function InvoiceDetailPage({ id }: { id: string }) {
  const { data, isPending, isError, error } = useInvoice(id)

  if (isPending) return <p className="text-muted-foreground">Loading…</p>
  if (isError) return <p className="text-destructive">Failed to load: {error.message}</p>

  const { invoice, vendor, lines, latestAudit, reviewDecision, pdfUrl } = data

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{invoice.invoiceNumber}</h1>
          <p className="text-muted-foreground">
            {vendor.name}
            {vendor.abn ? ` · ABN ${vendor.abn}` : ''}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Invoice date" value={formatDate(invoice.invoiceDate)} />
        <Field label="Due date" value={formatDate(invoice.dueDate)} />
        <Field label="Total" value={formatAud(invoice.totalAud)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Line items</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={`${l.itemCode}-${i}`}>
                  <TableCell className="font-medium">{l.itemCode}</TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right">{l.qty}</TableCell>
                  <TableCell className="text-right">{formatAud(l.unitPriceAud)}</TableCell>
                  <TableCell className="text-right">{formatAud(l.lineTotalAud)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-medium">Audit</h2>
          {latestAudit && (
            <span className="text-muted-foreground text-sm">
              {latestAudit.engine} · variance {formatPct(latestAudit.variancePct)}
            </span>
          )}
        </div>
        {latestAudit ? (
          <CheckResults checks={latestAudit.checks} />
        ) : (
          <p className="text-muted-foreground">
            {invoice.status === 'auditing' ? 'Audit in progress…' : 'Not audited yet.'}
          </p>
        )}
      </section>

      {reviewDecision && (
        <section className="space-y-1">
          <h2 className="text-lg font-medium">Review decision</h2>
          <p className="text-sm">
            <span className="font-medium capitalize">{reviewDecision.decision}</span>
            {reviewDecision.note ? ` — ${reviewDecision.note}` : ''}
            {reviewDecision.decidedAt
              ? ` (${formatDate(reviewDecision.decidedAt.slice(0, 10))})`
              : ''}
          </p>
        </section>
      )}

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm underline"
        >
          View invoice PDF
        </a>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-muted-foreground text-sm font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent className="text-lg font-semibold">{value}</CardContent>
    </Card>
  )
}
