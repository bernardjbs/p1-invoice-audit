import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../app'

/**
 * The scheduled cleanup route's success path. Integration tier: it runs both
 * sweeps against the local Supabase, which must be up and seeded. The 503 and
 * 403 paths need no database and are covered in `app.test.ts`.
 *
 * What is asserted is the shape the pg_cron job's caller sees: both sweeps'
 * results in one body, so a run that resets a decision is as visible in the
 * pg_net response log as one that removes a sample.
 */
describe('POST /api/internal/cleanup-samples', () => {
  const original = process.env.WORKER_SECRET
  beforeEach(() => {
    process.env.WORKER_SECRET = 'test-secret'
  })
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_SECRET
    else process.env.WORKER_SECRET = original
  })

  it('runs both sweeps and returns removed, pdfsRemoved and reset', async () => {
    const res = await app.request('/api/internal/cleanup-samples', {
      method: 'POST',
      headers: { 'x-worker-secret': 'test-secret' },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('removed')
    expect(body).toHaveProperty('pdfsRemoved')
    expect(body).toHaveProperty('reset')
    expect(Array.isArray(body.reset)).toBe(true)
  })
})
