import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { app } from './app'

describe('GET /health', () => {
  it('returns { ok: true }', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

// The drain endpoint's auth guard runs BEFORE any DB access, so both reject
// paths are unit-testable here (the 200 path needs the queue + DB and is covered
// by the worker integration tier). See internal/routes.ts.
describe('POST /api/internal/drain (auth guard)', () => {
  const original = process.env.WORKER_SECRET
  beforeEach(() => {
    delete process.env.WORKER_SECRET
  })
  afterEach(() => {
    if (original === undefined) delete process.env.WORKER_SECRET
    else process.env.WORKER_SECRET = original
  })

  it('503 when WORKER_SECRET is unset (fail closed)', async () => {
    const res = await app.request('/api/internal/drain', { method: 'POST' })
    expect(res.status).toBe(503)
  })

  it('403 when the secret header is missing or wrong', async () => {
    process.env.WORKER_SECRET = 'right-secret'
    const res = await app.request('/api/internal/drain', {
      method: 'POST',
      headers: { 'x-worker-secret': 'wrong-secret' },
    })
    expect(res.status).toBe(403)
  })
})
