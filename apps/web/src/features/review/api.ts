import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { invoiceKeys } from '@/features/invoices/api'
import type { ReviewQueueItem } from '@/features/invoices/types'

/** Review-queue server state + the approve/reject mutation (plan T12). */
export const reviewKeys = { queue: ['review-queue'] as const }

export function useReviewQueue() {
  return useQuery({ queryKey: reviewKeys.queue, queryFn: () => api.get<ReviewQueueItem[]>('/review-queue') })
}

export type ReviewInput = { id: string; decision: 'approved' | 'rejected'; note?: string }

export function useSubmitReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decision, note }: ReviewInput) =>
      api.postJson<{ status: string }>(`/invoices/${id}/review`, { decision, note }),
    // Optimistic: drop the reviewed invoice from the queue immediately
    // (CONVENTIONS §16 — cancel, snapshot, setQueryData, rollback on error).
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: reviewKeys.queue })
      const previous = qc.getQueryData<ReviewQueueItem[]>(reviewKeys.queue)
      qc.setQueryData<ReviewQueueItem[]>(reviewKeys.queue, (old) => (old ?? []).filter((r) => r.id !== id))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(reviewKeys.queue, ctx.previous)
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: reviewKeys.queue })
      void qc.invalidateQueries({ queryKey: invoiceKeys.detail(id) })
      void qc.invalidateQueries({ queryKey: invoiceKeys.all })
    },
  })
}
