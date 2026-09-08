import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
// The api's own client, rather than a second one here: `postgres` is a
// dependency of apps/api and resolves from that file's location, so reusing it
// keeps this root-level script free of dependencies of its own.
import { sql } from '../../apps/api/src/db/client'
import {
  accuracy,
  byField,
  compareInvoice,
  type FieldComparison,
  type ScorableInvoice,
} from '../../apps/api/src/audit/extraction-score'
import {
  claudeReader,
  DEFAULT_EXTRACTION_MODEL,
  extractInvoiceFields,
} from '../../apps/api/src/audit/extraction'
import { cachingReader, describe, newStats } from '../lib/model-cache'
import { downloadInvoicePdf } from '../../apps/api/src/lib/storage'

/**
 * The extraction ORACLE GATE. Plan: 2026-09-04-p1-phase-b-langgraph-engine, task T4.
 *
 * Runs the real extractor over every seeded invoice PDF, scores each answer
 * against the answer key, prints where the model is weak, and exits non-zero if
 * it is not good enough. That last clause is the whole point: it turns "the AI
 * seems fine" into a build that goes red when reading quality drops.
 *
 * Deterministic tests cannot do this job — you cannot assert on a model's output
 * without pinning it to one phrasing. So you assert on the SCORE instead, and the
 * threshold is the assertion.
 *
 *   doppler run -c dev -- bun evals/extraction/run.ts
 *
 * Needs the local Supabase seeded (`bun run seed`) and real credentials.
 * EXTRACTION_THRESHOLD (default 0.9) and EXTRACTION_MODEL override the gate and
 * the model, so re-running on a higher tier is one env var, not an edit.
 */

const THRESHOLD = Number(process.env.EXTRACTION_THRESHOLD ?? '0.9')
const MODEL = process.env.EXTRACTION_MODEL
/**
 * `--no-cache` re-reads every PDF at full price. The default caches, because
 * tuning a threshold means running this repeatedly over inputs that have not
 * changed, and each of those runs previously re-read every invoice.
 */
const USE_CACHE = !process.argv.includes('--no-cache')
const CACHE_STATS = newStats()
const READER = cachingReader(
  claudeReader(MODEL ?? DEFAULT_EXTRACTION_MODEL),
  MODEL ?? DEFAULT_EXTRACTION_MODEL,
  { enabled: USE_CACHE, stats: CACHE_STATS },
)
/** Enough to keep twenty calls brisk without tripping a rate limit. */
const CONCURRENCY = 4

const TRUTH_PATH = resolve(import.meta.dirname, '../../apps/api/assets/invoices/ground-truth.json')

type TruthFile = { note: string; invoices: (ScorableInvoice & { invoiceNumber: string })[] }

/**
 * What a failed extraction scores. Not zero-by-special-case: the truth is
 * compared against an invoice with nothing in it, so a failure is charged
 * exactly the fields it failed to produce, through the same scorer as everything
 * else. NaN never compares within tolerance, and an empty line list makes every
 * expected line missing.
 */
const NOTHING: ScorableInvoice = {
  invoiceNumber: '',
  abn: '',
  subtotalAud: NaN,
  gstAud: NaN,
  totalAud: NaN,
  lines: [],
}

type Row = { invoice_number: string; pdf_path: string }
type Outcome = {
  invoiceNumber: string
  comparisons: FieldComparison[]
  error?: string
}

async function scoreOne(row: Row, truth: ScorableInvoice): Promise<Outcome> {
  const pdf = await downloadInvoicePdf(row.pdf_path)
  try {
    const extracted = await extractInvoiceFields(pdf, { reader: READER })
    return { invoiceNumber: row.invoice_number, comparisons: compareInvoice(truth, extracted) }
  } catch (error) {
    return {
      invoiceNumber: row.invoice_number,
      comparisons: compareInvoice(truth, NOTHING),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function pct(n: number): string {
  return (n * 100).toFixed(1).padStart(5) + '%'
}

async function main(): Promise<void> {
  const truthFile = JSON.parse(await readFile(TRUTH_PATH, 'utf8')) as TruthFile
  const truthByNumber = new Map(truthFile.invoices.map((i) => [i.invoiceNumber, i]))

  const rows = await sql<Row[]>`
    select invoice_number, pdf_path from invoices
    where pdf_path is not null order by invoice_number`
  await sql.end()

  if (rows.length === 0) throw new Error('no seeded invoices with a pdf_path — run `bun run seed`')

  const missing = rows
    .filter((r) => !truthByNumber.has(r.invoice_number))
    .map((r) => r.invoice_number)
  if (missing.length > 0) {
    throw new Error(
      `no ground truth for ${missing.join(', ')} — regenerate with \`bun run invoices:truth\``,
    )
  }

  console.log(`scoring ${rows.length} invoices against ${MODEL ?? 'the default model'}…`)

  const outcomes: Outcome[] = []
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY)
    outcomes.push(
      ...(await Promise.all(
        batch.map((row) => scoreOne(row, truthByNumber.get(row.invoice_number)!)),
      )),
    )
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, rows.length)}/${rows.length}\r`)
  }

  const all = outcomes.flatMap((o) => o.comparisons)
  const overall = accuracy(all)

  console.log('\nper-field accuracy')
  console.log('  field                correct/total   accuracy')
  for (const row of byField(all).sort((a, b) => a.accuracy - b.accuracy)) {
    console.log(
      `  ${row.field.padEnd(20)} ${String(row.correct).padStart(4)}/${String(row.total).padEnd(6)} ${pct(row.accuracy)}`,
    )
  }

  // Name every invoice that was not perfect, and what was wrong — an aggregate
  // score says quality dropped but never says where to look.
  const imperfect = outcomes.filter((o) => o.comparisons.some((c) => !c.ok))
  if (imperfect.length > 0) {
    console.log('\nimperfect invoices')
    for (const o of imperfect) {
      console.log(
        `  ${o.invoiceNumber}  ${pct(accuracy(o.comparisons))}${o.error ? `  EXTRACTION FAILED: ${o.error}` : ''}`,
      )
      for (const c of o.comparisons.filter((x) => !x.ok)) {
        console.log(
          `    ${c.line ? `${c.line}.` : ''}${c.field}: expected ${c.expected}, got ${c.actual}`,
        )
      }
    }
  }

  console.log(
    `\noverall ${pct(overall)} over ${all.length} field comparisons (threshold ${pct(THRESHOLD)})`,
  )
  // Always report what the run actually cost in model reads. A cache that is
  // silently doing nothing looks exactly like one that is working.
  console.log(`model reads: ${describe(CACHE_STATS)}${USE_CACHE ? '' : '  (--no-cache)'}`)

  if (overall < THRESHOLD) {
    console.error(`FAIL — extraction accuracy ${overall.toFixed(4)} is below ${THRESHOLD}`)
    process.exit(1)
  }
  console.log('PASS')
}

await main()
