/**
 * Post-deploy smoke: prove the upload → audit → pause → approve loop works on the
 * DEPLOYED URL, over plain HTTP, no browser. Exit 0 = live and usable; exit 1 = a
 * step failed (with the reason logged).
 *
 * Run against the deployed origin:
 *   SMOKE_URL=https://<app>.vercel.app bun run scripts/smoke.ts
 *
 * This is also the ONLY place the shipped artefact is exercised on the runtime it
 * ships to. Everything else runs the TypeScript source under Bun; production runs
 * one bundled module under Node. That is why the Node setup step was dropped from
 * the CI browser jobs rather than made to work (ruled 2026-09-23) — this script is
 * the Bun-vs-Node check, because it drives the thing that actually shipped.
 *
 * WHY A REAL PDF. The engine reads the invoice with a vision model, so the near
 * empty PDF this script used to generate would have been a blank page to it. It
 * uploads the clause-breach fixture instead: a real invoice document whose charges
 * breach an MSA clause, so the contract-terms agent has something to find and must
 * cite it. A single upload then exercises every stage — the prod pg_cron worker
 * draining the queue, extraction, all four checks, retrieval with a citation,
 * tracing, the pause, and the approve that clears it.
 *
 * WHAT IT PROVES THAT A 200 DOES NOT. The engine is chosen by an environment
 * variable that DEFAULTS TO THE MOCK. A deployment missing it looks completely
 * healthy: every endpoint answers, four checks appear, the invoice pauses and
 * approves. Asserting the engine by name is what separates "the app is up" from
 * "Phase B is live", and it is the assertion that would have caught this deploy's
 * production environment, which was missing that variable entirely.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = (process.env.SMOKE_URL ?? '').replace(/\/$/, '')
if (!BASE) {
  console.error('smoke: SMOKE_URL must be set (the deployed https origin)')
  process.exit(1)
}

const AUDIT_TIMEOUT_MS = 120_000
const POLL_MS = 5_000

function fail(step: string, detail: unknown): never {
  console.error(`smoke FAILED at: ${step}\n`, detail)
  process.exit(1)
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, body: await res.json().catch(() => null) }
}

/**
 * The clause-breach fixture the criterion-3 browser spec uses: a genuine invoice
 * document whose charges breach a clause of the vendor MSA. Read from disk rather
 * than generated, so the model is shown a real page.
 */
function readFixturePdf(): Blob {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../e2e/fixtures/clause-breach-invoice.pdf',
  )
  return new Blob([readFileSync(path)], { type: 'application/pdf' })
}

async function main(): Promise<void> {
  // 1. List loads.
  const list = await getJson('/api/invoices')
  if (list.status !== 200 || !Array.isArray(list.body)) fail('GET /api/invoices', list)
  console.log(`✓ list loads (${(list.body as unknown[]).length} invoices)`)

  // 2. A vendor to attach the upload to.
  const vendors = await getJson('/api/vendors')
  if (vendors.status !== 200 || !Array.isArray(vendors.body) || vendors.body.length === 0)
    fail('GET /api/vendors', vendors)
  const vendorId = (vendors.body as { id: string }[])[0]!.id

  // 3. Upload — non-zero subtotal → math fails → will pause for review.
  const invoiceNumber = `SMOKE-${Date.now()}`
  const form = new FormData()
  form.set('invoiceNumber', invoiceNumber)
  form.set('vendorId', vendorId)
  form.set('subtotalAud', '100')
  form.set('gstAud', '10')
  form.set('totalAud', '110')
  form.set('pdf', readFixturePdf(), `${invoiceNumber}.pdf`)
  const uploadRes = await fetch(`${BASE}/api/invoices`, { method: 'POST', body: form })
  const uploaded = (await uploadRes.json().catch(() => null)) as { id?: string } | null
  if (uploadRes.status !== 201 || !uploaded?.id)
    fail('POST /api/invoices', { status: uploadRes.status, uploaded })
  const id = uploaded.id
  console.log(`✓ uploaded ${invoiceNumber} (id ${id})`)

  // 4. Wait for the prod worker (pg_cron every ~10s) to audit it.
  type Check = {
    type: string
    verdict: string
    evidence: { summary?: string; sourceRef?: string }
  }
  type Detail = {
    invoice: { status: string }
    latestAudit: { engine: string; traceUrl: string | null; checks: Check[] } | null
  }
  const deadline = Date.now() + AUDIT_TIMEOUT_MS
  let detail: Detail | null = null
  while (Date.now() < deadline) {
    const res = await getJson(`/api/invoices/${id}`)
    detail = res.body as Detail | null
    const status = detail?.invoice.status
    if (status && status !== 'auditing' && status !== 'received') break
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  if (!detail || !detail.latestAudit) fail('audit did not complete in time', detail)
  const audit = detail.latestAudit
  if (audit.checks.length !== 4) fail('expected 4 check results', audit)
  if (detail.invoice.status !== 'paused_review') fail('expected paused_review', detail.invoice)
  console.log(`✓ audited: 4 checks, status paused_review`)

  /**
   * The real engine ran, not the mock. This is the assertion the rest of the
   * script cannot make for it: every step above passes identically under the
   * mock, because the mock also returns four checks and also pauses.
   */
  if (audit.engine !== 'langgraph')
    fail(
      `the deployed app audited with the '${audit.engine}' engine, not 'langgraph' — ` +
        'AUDIT_ENGINE is unset or wrong in the deployment environment',
      audit,
    )
  console.log(`✓ engine: ${audit.engine}`)

  /**
   * Criterion 3 live: the contract-terms verdict is backed by a clause retrieved
   * from the vendor's own MSA, and cites it. The citation comes from the stored
   * clause row rather than from model output, so a present sourceRef means
   * retrieval actually returned something.
   */
  const terms = audit.checks.find((c) => c.type === 'contract_terms')
  if (!terms) fail('no contract_terms check in the audit', audit.checks)
  if (!terms.evidence?.sourceRef)
    fail('contract_terms cited no source — retrieval returned nothing', terms)
  console.log(`✓ cited clause: ${terms.evidence.sourceRef} (verdict ${terms.verdict})`)

  /**
   * Criterion 7 live: the run recorded a trace, which is what the detail view
   * renders its "View trace" link from. Null here means tracing is off in the
   * deployment, and the link silently never appears.
   */
  if (!audit.traceUrl) fail('the run recorded no trace URL — LANGSMITH_TRACING is off', audit)
  console.log(`✓ trace recorded: ${audit.traceUrl}`)

  // 5. Reviewable: approve clears it out of the queue.
  const reviewRes = await fetch(`${BASE}/api/invoices/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', note: 'smoke' }),
  })
  if (reviewRes.status !== 200)
    fail('POST review', { status: reviewRes.status, body: await reviewRes.text() })
  const after = (await getJson(`/api/invoices/${id}`)).body as { invoice: { status: string } }
  if (after.invoice.status === 'paused_review')
    fail('review did not clear paused_review', after.invoice)
  console.log(`✓ approved → status ${after.invoice.status}`)

  console.log('\nSMOKE PASSED — the real engine audited, cited and paused on the live URL')
  /**
   * Criterion 8's live half cannot be asserted from out here: the notification
   * goes to Slack, and this script has no way to read it back. The pause above is
   * the trigger, so the message either arrived or the webhook is misconfigured —
   * which is a thing to LOOK at, not something to report as proven.
   */
  console.log('\nCheck Slack for the pause notification, and that its link opens the live app.')
  console.log('That is the one part of this run nothing here can prove for you.')
}

main().catch((err) => fail('unexpected error', err))
