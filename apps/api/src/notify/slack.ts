import { z } from 'zod'

/**
 * The pause-for-review Slack notification.
 *
 * ONE hard rule governs this whole file: **a Slack outage must never turn a
 * successful audit into a failed one.** By the time this is called the audit has
 * already run and the invoice's status has already been written, so there is
 * nothing left to fail. Every way this can go wrong — no webhook configured, a
 * malformed webhook URL, a non-2xx response, a network error, a timeout — is
 * logged and swallowed, and the function reports what happened by returning
 * rather than by throwing. Nothing in here is allowed to propagate.
 *
 * The webhook URL is read from `process.env` rather than through the validated
 * `config/env` module on purpose. `config/env` parses the WHOLE server
 * environment at import, so pulling it in here would make this leaf module — and
 * therefore its unit specs — require the Anthropic and OpenAI keys as well. The
 * unit tier runs in CI with no secrets, so it must be able to exercise this file
 * without any. `config/env` still declares and validates `SLACK_WEBHOOK_URL` for
 * processes that do load it; the same shape is re-checked here so a junk value
 * is refused rather than handed to `fetch`. (`pause-rule.ts` and `db/client.ts`
 * read their non-secret config the same way.)
 */

/**
 * Where the reviewer lands from the Slack message. `APP_URL` is the SAME key the
 * prod worker setup reads for the deployed origin — deliberately one name for one
 * value, rather than a second key holding a copy that can drift (ruled 2026-09-23).
 * Not a secret; unset locally, where the default below is correct.
 */
const DEFAULT_APP_URL = 'http://localhost:5173'

const WebhookUrlSchema = z.url()

export type InvoicePausedNotification = {
  /** The human-facing invoice number, e.g. `INV-2026-0042`. */
  invoiceNumber: string
  /** Vendor name, so a reviewer can triage without opening the app. */
  vendor: string
  /** Price variance as a FRACTION (0.12 = 12%), matching `AuditResult.variancePct`. */
  variancePct: number
  /**
   * Human-readable names of the checks that did not pass, already rendered by
   * the audit seam. Plain strings on purpose: this file may not name check
   * types (`scripts/seam-gate.sh`), and does not need to.
   */
  failedChecks: string[]
  /** Deep link to the invoice awaiting review. */
  url: string
}

/**
 * Why the notification either went out or did not. Returned rather than thrown —
 * the caller uses it for logging and tests assert on it; no branch of it is an
 * error the audit should react to.
 */
export type NotifyOutcome =
  { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'failed'; reason: string }

/** The reviewer's deep link for one invoice, from the public app base URL. */
export function invoiceReviewUrl(invoiceId: string): string {
  // `||`, not `??`: an env var set to the empty string means "unset" here, which
  // is what a platform that always defines its variables actually gives you.
  const base = process.env.APP_URL || DEFAULT_APP_URL
  return `${base.replace(/\/+$/, '')}/invoices/${invoiceId}`
}

/** Format the variance fraction the way a person reads it: `12.0%`. */
function formatVariance(variancePct: number): string {
  return `${(variancePct * 100).toFixed(1)}%`
}

/**
 * The Slack payload. Kept separate from the POST so the wording is unit-testable
 * without a fetch mock, and so the message stays one reviewable string.
 */
export function invoicePausedMessage(notification: InvoicePausedNotification): { text: string } {
  const { invoiceNumber, vendor, variancePct, url, failedChecks } = notification
  /**
   * Lead with WHY it paused, not with the variance. Leading with the variance
   * made a clause breach read as "price variance 0.0%", which tells a reviewer
   * nothing is wrong — the invoice can be arithmetically perfect and billed at
   * the contracted rate and still breach the contract.
   *
   * The variance is still shown, because it is the number a reviewer acts on
   * when price IS the problem; it just no longer speaks for the whole audit.
   * An empty list keeps the old wording rather than printing "failed: ".
   */
  const reason = failedChecks.length ? `${failedChecks.join(', ')} failed` : 'flagged for review'
  return {
    text:
      `:pause_button: Invoice *${invoiceNumber}* (${vendor}) is paused for review — ` +
      `${reason} (price variance ${formatVariance(variancePct)}).\n${url}`,
  }
}

/**
 * POST the pause notification to `SLACK_WEBHOOK_URL`. Never throws.
 *
 * An unset webhook is a normal configuration, not a fault: local dev and CI run
 * without one and must not log noise on every paused invoice, so that path is
 * `skipped` and silent.
 */
export async function notifyInvoicePaused(
  notification: InvoicePausedNotification,
): Promise<NotifyOutcome> {
  const configured = process.env.SLACK_WEBHOOK_URL
  if (!configured) return { status: 'skipped', reason: 'SLACK_WEBHOOK_URL is not set' }

  const webhook = WebhookUrlSchema.safeParse(configured)
  if (!webhook.success) {
    // Name the key, never the value — a malformed secret must not reach the logs.
    console.error('[notify] SLACK_WEBHOOK_URL is not a valid URL; pause notification skipped')
    return { status: 'skipped', reason: 'SLACK_WEBHOOK_URL is not a valid URL' }
  }

  try {
    const response = await fetch(webhook.data, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(invoicePausedMessage(notification)),
    })
    if (!response.ok) {
      // Log and carry on: the invoice is already paused in the database, and a
      // Slack 5xx must not undo that or fail the worker's job.
      const reason = `Slack webhook responded ${response.status}`
      console.error(`[notify] ${reason} for invoice ${notification.invoiceNumber}`)
      return { status: 'failed', reason }
    }
    return { status: 'sent' }
  } catch (err) {
    // Network-level failure (DNS, TLS, offline). Same rule: log, never rethrow.
    console.error(
      `[notify] Slack webhook request failed for invoice ${notification.invoiceNumber}:`,
      err,
    )
    return { status: 'failed', reason: 'Slack webhook request failed' }
  }
}
