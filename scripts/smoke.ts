/**
 * Post-deploy smoke (plan T14, criterion 8): prove the upload → audit → review
 * loop works on the DEPLOYED URL, over plain HTTP, no browser. Exit 0 = live and
 * usable; exit 1 = a step failed (with the reason logged).
 *
 * Run against the deployed origin:
 *   SMOKE_URL=https://<app>.vercel.app bun run scripts/smoke.ts
 *
 * An uploaded invoice has no lines/PO/contract, so a non-zero subtotal makes the
 * math check fail deterministically → the invoice lands in `paused_review` with
 * all four checks. That single upload exercises every stage: queue drain (prod
 * pg_cron worker), four results rendered, and the review approve that clears it.
 */
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

function makePdf(): Blob {
  // A minimal but valid single-page PDF — the audit never parses it (mock
  // engine), storage only needs bytes.
  const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
  return new Blob([pdf], { type: 'application/pdf' })
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
  form.set('pdf', makePdf(), `${invoiceNumber}.pdf`)
  const uploadRes = await fetch(`${BASE}/api/invoices`, { method: 'POST', body: form })
  const uploaded = (await uploadRes.json().catch(() => null)) as { id?: string } | null
  if (uploadRes.status !== 201 || !uploaded?.id) fail('POST /api/invoices', { status: uploadRes.status, uploaded })
  const id = uploaded.id
  console.log(`✓ uploaded ${invoiceNumber} (id ${id})`)

  // 4. Wait for the prod worker (pg_cron every ~10s) to audit it.
  type Detail = { invoice: { status: string }; latestAudit: { checks: unknown[] } | null }
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
  if (detail.latestAudit.checks.length !== 4) fail('expected 4 check results', detail.latestAudit)
  if (detail.invoice.status !== 'paused_review') fail('expected paused_review', detail.invoice)
  console.log(`✓ audited: 4 checks, status paused_review`)

  // 5. Reviewable: approve clears it out of the queue.
  const reviewRes = await fetch(`${BASE}/api/invoices/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', note: 'smoke' }),
  })
  if (reviewRes.status !== 200) fail('POST review', { status: reviewRes.status, body: await reviewRes.text() })
  const after = (await getJson(`/api/invoices/${id}`)).body as { invoice: { status: string } }
  if (after.invoice.status === 'paused_review') fail('review did not clear paused_review', after.invoice)
  console.log(`✓ approved → status ${after.invoice.status}`)

  console.log('\nSMOKE PASSED — upload → audit → review works on the live URL')
}

main().catch((err) => fail('unexpected error', err))
