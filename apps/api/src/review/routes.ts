import { Hono } from 'hono'
import { z } from 'zod'
import { listReviewQueue, submitReview } from './service'

/**
 * Review routes (plan T8): the paused-review queue and the approve/reject
 * decision. Thin handlers (CONVENTIONS §5); the 409-on-not-paused rule lives in
 * the service. Mounted under /api by app.ts.
 */
export const reviewRoutes = new Hono()

const ReviewBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().optional(),
})

reviewRoutes.get('/review-queue', async (c) => c.json(await listReviewQueue(), 200))

reviewRoutes.post('/invoices/:id/review', async (c) => {
  const parsed = ReviewBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: { message: 'invalid review decision', code: 'bad_review' } }, 400)
  await submitReview(c.req.param('id'), parsed.data.decision, parsed.data.note)
  return c.json({ status: parsed.data.decision }, 200)
})
