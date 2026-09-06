import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { formatAud, formatPct } from '@/lib/format'
import { useReviewQueue, useSubmitReview } from './api'
import type { ReviewQueueItem } from '@/features/invoices/types'

export function ReviewPage() {
  const { data: queue, isPending, isError, error } = useReviewQueue()

  if (isPending) return <p className="text-muted-foreground">Loading…</p>
  if (isError) return <p className="text-destructive">Failed to load: {error.message}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review queue</h1>
      {queue.length === 0 ? (
        <p className="text-muted-foreground">Nothing awaiting review. 🎉</p>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => (
            <ReviewCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ item }: { item: ReviewQueueItem }) {
  const [note, setNote] = useState('')
  const submit = useSubmitReview()

  const decide = (decision: 'approved' | 'rejected') =>
    submit.mutate({ id: item.id, decision, note: note.trim() || undefined })

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          <Link to="/invoices/$id" params={{ id: item.id }} className="hover:underline">
            {item.invoiceNumber}
          </Link>{' '}
          <span className="text-muted-foreground font-normal">· {item.vendorName}</span>
        </CardTitle>
        <div className="text-muted-foreground text-sm">
          {formatAud(item.totalAud)}
          {item.variancePct !== null ? ` · variance ${formatPct(item.variancePct)}` : ''}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Reason / note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button onClick={() => decide('approved')} disabled={submit.isPending}>
            Approve
          </Button>
          <Button
            variant="destructive"
            onClick={() => decide('rejected')}
            disabled={submit.isPending}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
