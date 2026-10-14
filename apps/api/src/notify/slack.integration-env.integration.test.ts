import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifyInvoicePaused } from './slack'

/**
 * Integration tier guard: this tier must never be able to post to the real
 * Slack channel.
 *
 * It runs under Doppler `dev`, which holds the real `SLACK_WEBHOOK_URL`. On
 * 2026-10-14 every integration test that paused an invoice made the worker post
 * a real "paused for review" message to Bernard's Slack. The tier's config now
 * clears the variable before any test module loads; this spec proves it stays
 * cleared, by asking the real notifier what it would do.
 *
 * `fetch` is stubbed so this file is itself incapable of posting: if the
 * clearing regresses, the first assertion fails before the notifier is called,
 * and even if it were reached the stub refuses rather than reaching Slack.
 */

const paused = {
  invoiceNumber: 'INV-2026-0042',
  vendor: 'Pilbara Fasteners Pty Ltd',
  variancePct: 0.123,
  failedChecks: ['price vs contract'],
  url: 'http://localhost:5173/invoices/abc-123',
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn(() => Promise.reject(new Error('this spec must never send a request')))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the integration tier and the Slack webhook', () => {
  it('runs with no webhook, so a paused invoice is skipped rather than posted', async () => {
    // Assert presence, never the value: a failure message must not print the
    // secret webhook into a terminal or a CI log.
    expect('SLACK_WEBHOOK_URL' in process.env, 'SLACK_WEBHOOK_URL is set in this tier').toBe(false)

    const outcome = await notifyInvoicePaused(paused)

    expect(outcome).toEqual({ status: 'skipped', reason: 'SLACK_WEBHOOK_URL is not set' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
