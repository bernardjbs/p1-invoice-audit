import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoicePausedMessage, invoiceReviewUrl, notifyInvoicePaused } from './slack'

/**
 * Unit tier: `fetch` is stubbed, so NOTHING here reaches Slack and nothing here
 * needs a database or a real webhook. `SLACK_WEBHOOK_URL` is stubbed to an
 * example host that does not resolve, so even a regression that bypassed the
 * stub would fail rather than post somewhere real.
 */

// `.invalid` is reserved by RFC 2606 and can never resolve, so even a regression
// that escaped the fetch stub would fail rather than post to a real workspace.
const TEST_WEBHOOK = 'https://hooks.slack.invalid/services/team/channel/token'

const paused = {
  invoiceNumber: 'INV-2026-0042',
  vendor: 'Pilbara Fasteners Pty Ltd',
  variancePct: 0.123,
  url: 'https://audit.example/invoices/abc-123',
}

let fetchMock: ReturnType<typeof vi.fn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('SLACK_WEBHOOK_URL', TEST_WEBHOOK)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Slack pause notification', () => {
  it('POSTs the webhook with the invoice id and the variance on pause', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const outcome = await notifyInvoicePaused(paused)

    expect(outcome).toEqual({ status: 'sent' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(TEST_WEBHOOK)
    expect(init.method).toBe('POST')

    const body = JSON.parse(String(init.body)) as { text: string }
    // The three things a reviewer needs in the message: which invoice, how far
    // out it is, and where to go and decide.
    expect(body.text).toContain('INV-2026-0042')
    expect(body.text).toContain('12.3%')
    expect(body.text).toContain('https://audit.example/invoices/abc-123')
  })

  /**
   * The golden-success invariant, and an ABSENCE assertion — it claims something
   * does NOT happen, which is exactly the shape that passes for the wrong reason.
   * So it does not merely check that the call resolves: it records the caller's
   * steps around the notification and asserts the step AFTER it still ran. A
   * notifier that rethrew a Slack 500 would skip that step and fail here.
   */
  it('logs a webhook 500 and lets the run still pause cleanly', async () => {
    fetchMock.mockResolvedValue(new Response('internal error', { status: 500 }))

    const steps: string[] = []
    // Stands in for the worker's pause transition: the invoice status is already
    // written, the notification fires, then the job finishes.
    const pauseTransition = async (): Promise<void> => {
      steps.push('status=paused_review')
      await notifyInvoicePaused(paused)
      steps.push('job complete')
    }

    await expect(pauseTransition()).resolves.toBeUndefined()
    expect(steps).toEqual(['status=paused_review', 'job complete'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('500'))
  })

  it('survives a network-level failure the same way', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))

    await expect(notifyInvoicePaused(paused)).resolves.toEqual({
      status: 'failed',
      reason: 'Slack webhook request failed',
    })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('is silently skipped when no webhook is configured', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', '')

    await expect(notifyInvoicePaused(paused)).resolves.toEqual({
      status: 'skipped',
      reason: 'SLACK_WEBHOOK_URL is not set',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('refuses a malformed webhook URL without echoing it', async () => {
    vi.stubEnv('SLACK_WEBHOOK_URL', 'not-a-url-but-secret-looking')

    const outcome = await notifyInvoicePaused(paused)

    expect(outcome).toEqual({ status: 'skipped', reason: 'SLACK_WEBHOOK_URL is not a valid URL' })
    expect(fetchMock).not.toHaveBeenCalled()
    const logged = errorSpy.mock.calls.flat().join(' ')
    expect(logged).toContain('SLACK_WEBHOOK_URL')
    expect(logged).not.toContain('not-a-url-but-secret-looking')
  })
})

describe('the reviewer deep link', () => {
  it('points at the invoice under the configured app base URL', () => {
    vi.stubEnv('APP_URL', 'https://audit.example/')
    expect(invoiceReviewUrl('abc-123')).toBe('https://audit.example/invoices/abc-123')
  })

  it('falls back to the local dev origin when unset', () => {
    vi.stubEnv('APP_URL', '')
    expect(invoiceReviewUrl('abc-123')).toBe('http://localhost:5173/invoices/abc-123')
  })
})

describe('the pause message', () => {
  it('names the vendor so a reviewer can triage without opening the app', () => {
    expect(invoicePausedMessage(paused).text).toContain('Pilbara Fasteners Pty Ltd')
  })
})
