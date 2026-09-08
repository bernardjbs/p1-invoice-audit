import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { langGraphDefaultDeps } from './audit/engines/langgraph'
import { getCheckpointer } from './audit/engines/langgraph/checkpointer'
import { buildAuditGraph } from './audit/engines/langgraph/graph'
import { enqueueAudit } from './queue/audit-queue'
import { submitReview } from './review/service'

/**
 * CRITERION 5: a paused audit survives the death of the worker that started it.
 *
 * This is the only test here that cannot pass by accident. If the run's progress
 * lived in the worker's memory, killing the process would destroy it and no
 * later approval could finish it. It passes only because the state is in
 * Postgres, keyed by the invoice id, and any process can pick it up.
 *
 * The kill is SIGKILL, not SIGTERM: nothing gets to flush, tidy up or hand over.
 * A graceful shutdown would let the process save on its way out, which would
 * prove something much weaker than what is claimed.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const sql = postgres(DATABASE_URL, { max: 1 })
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'worker-restart.fixture.ts')

const children: ChildProcess[] = []

/** Start a worker process and wait until it says it is polling. */
async function startWorker(): Promise<ChildProcess> {
  const child = spawn('bun', ['run', FIXTURE], {
    cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  children.push(child)

  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('worker did not start within 30s')), 30_000)
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('restart-fixture worker ready')) {
        clearTimeout(timer)
        done()
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`worker exited early with code ${code}`))
    })
  })
  return child
}

/** Has this child already gone? A signalled process reports on `signalCode`. */
function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * Kill a process outright and wait for the OS to reap it.
 *
 * Idempotent, because the cleanup hook also calls it on a child the test already
 * killed. Waiting on `exit` for a process that has ALREADY exited waits forever:
 * the event fired before the listener existed. `exitCode` alone does not detect
 * that case, since a signalled process leaves it null and sets `signalCode`.
 */
async function killHard(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGKILL')
  await exited
}

async function waitFor(what: string, check: () => Promise<boolean>, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function statusOf(id: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`select status from invoices where id = ${id}`
  return row!.status
}

/** Is a run still suspended under this invoice, waiting for a person? */
async function isWaiting(id: string): Promise<boolean> {
  const graph = buildAuditGraph(langGraphDefaultDeps(), await getCheckpointer())
  const snapshot = await graph.getState({ configurable: { thread_id: id } })
  return snapshot.tasks.some((task) => task.interrupts.length > 0)
}

const created: string[] = []

async function seedInvoice(): Promise<string> {
  const [vendor] = await sql<{ id: string }[]>`select id from vendors order by name limit 1`
  const [row] = await sql<{ id: string }[]>`
    insert into invoices (vendor_id, invoice_number, invoice_date, due_date,
                          subtotal_aud, gst_aud, total_aud, status, pdf_path)
    values (${vendor!.id}, ${`INV-RESTART-${crypto.randomUUID().slice(0, 8)}`},
            current_date, current_date + 30, 1000, 100, 1100, 'received', 'INV-0001.pdf')
    returning id`
  created.push(row!.id)
  return row!.id
}

afterEach(async () => {
  for (const child of children.splice(0)) await killHard(child)
}, 30_000)

/**
 * Remove what this spec created. A sibling asserts every invoice starts in
 * `received`, so a leftover row here fails it and reads as a broken seed.
 */
afterAll(async () => {
  if (created.length > 0) await sql`delete from invoices where id in ${sql(created)}`
  await sql.end()
})

describe('a paused audit and a dead worker', () => {
  it('resumes in a completely different process and completes', async () => {
    const invoiceId = await seedInvoice()

    // ── Process one: audit the invoice until it stops for a person.
    const first = await startWorker()
    await enqueueAudit(invoiceId)
    await waitFor(
      'the invoice to pause',
      async () => (await statusOf(invoiceId)) === 'paused_review',
    )
    expect(await isWaiting(invoiceId)).toBe(true)

    // ── Kill it outright. No shutdown hook, no flush, no chance to save.
    await killHard(first)
    expect(hasExited(first)).toBe(true)

    // The run is still there, in the database, with nothing running anywhere.
    expect(await isWaiting(invoiceId)).toBe(true)
    expect(await statusOf(invoiceId)).toBe('paused_review')

    // ── Process two: a brand new worker that has never seen this invoice.
    await startWorker()

    // ── A person approves. The decision is recorded and the continuation queued.
    await submitReview(invoiceId, 'approved', 'approved after the worker died')

    await waitFor('the resumed run to finish', async () => !(await isWaiting(invoiceId)))

    expect(await statusOf(invoiceId)).toBe('approved')

    const [decisions] = await sql<{ n: string }[]>`
      select count(*)::text as n from review_decisions where invoice_id = ${invoiceId}`
    expect(Number(decisions!.n)).toBe(1)

    // One run, from before the crash, finished by a process that did not start it.
    const [runs] = await sql<{ n: string }[]>`
      select count(*)::text as n from audit_runs where invoice_id = ${invoiceId}`
    expect(Number(runs!.n)).toBe(1)
  }, 90_000)
})
