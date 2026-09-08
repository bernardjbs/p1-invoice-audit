import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cachingReader, describe as describeStats, newStats } from './model-cache'

/**
 * The cache decides what an eval scores, so a stale entry does not look like a
 * bug — it looks like a result. These pin the only property that makes it safe
 * to trust: the key is the content, so anything that should change the answer
 * changes the key.
 *
 * A fake reader throughout. No model, no credentials, no cost.
 */

let dir: string

beforeAll(async () => {
  // Point the cache at a scratch directory so a run here can never serve, or
  // poison, the real one.
  dir = await mkdtemp(join(tmpdir(), 'model-cache-test-'))
  vi.stubEnv('EVAL_CACHE_DIR', dir)
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

const PDF = Buffer.from('a pdf').toString('base64')
const OTHER_PDF = Buffer.from('a different pdf').toString('base64')

function countingReader(reply = 'the reply') {
  let calls = 0
  const fn = async () => {
    calls += 1
    return reply
  }
  return { fn, calls: () => calls }
}

describe('cachingReader', () => {
  it('reads once for identical inputs', async () => {
    const inner = countingReader()
    const stats = newStats()
    const reader = cachingReader(inner.fn, 'model-a', { stats })

    expect(await reader(PDF, 'a prompt')).toBe('the reply')
    expect(await reader(PDF, 'a prompt')).toBe('the reply')

    expect(inner.calls()).toBe(1)
    expect(stats).toEqual({ hits: 1, misses: 1 })
  })

  it('re-reads when the prompt changes', async () => {
    const inner = countingReader()
    const reader = cachingReader(inner.fn, 'model-b', {})
    await reader(PDF, 'first wording')
    await reader(PDF, 'second wording')
    expect(inner.calls()).toBe(2)
  })

  it('re-reads when the model changes', async () => {
    const inner = countingReader()
    await cachingReader(inner.fn, 'model-c', {})(PDF, 'same prompt')
    await cachingReader(inner.fn, 'model-d', {})(PDF, 'same prompt')
    expect(inner.calls()).toBe(2)
  })

  it('re-reads when the document changes', async () => {
    const inner = countingReader()
    const reader = cachingReader(inner.fn, 'model-e', {})
    await reader(PDF, 'p')
    await reader(OTHER_PDF, 'p')
    expect(inner.calls()).toBe(2)
  })

  it('cannot collide two different splits of the same characters', async () => {
    // Without length-prefixing, ("ab","c") and ("a","bc") hash identically and
    // one invoice's reading would be served for another's.
    const inner = countingReader()
    const reader = cachingReader(inner.fn, 'model-f', {})
    await reader('c', 'ab')
    await reader('bc', 'a')
    expect(inner.calls()).toBe(2)
  })

  it('still counts what it paid for when disabled', async () => {
    // The bug this pins: reporting "no model reads" on the one run where every
    // read was paid for.
    const inner = countingReader()
    const stats = newStats()
    const reader = cachingReader(inner.fn, 'model-g', { enabled: false, stats })
    await reader(PDF, 'p')
    await reader(PDF, 'p')
    expect(inner.calls()).toBe(2)
    expect(stats).toEqual({ hits: 0, misses: 2 })
    expect(describeStats(stats)).toContain('2 paid for')
  })

  it('treats an unreadable entry as a miss rather than failing the run', async () => {
    const inner = countingReader()
    const stats = newStats()
    const reader = cachingReader(inner.fn, 'model-h', { stats })
    await expect(reader(PDF, 'p')).resolves.toBe('the reply')
    expect(stats.misses).toBe(1)
  })
})

describe('describe', () => {
  it('says plainly when nothing was read', () => {
    expect(describeStats(newStats())).toBe('no model reads')
  })

  it('reports the share served from cache', () => {
    expect(describeStats({ hits: 3, misses: 1 })).toContain('75%')
  })
})
