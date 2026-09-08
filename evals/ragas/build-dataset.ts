import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from '../../apps/api/src/db/client'
import {
  claudeReader,
  DEFAULT_EXTRACTION_MODEL,
  extractInvoiceFields,
} from '../../apps/api/src/audit/extraction'
import {
  claudeJudge,
  DEFAULT_JUDGE_MODEL,
  runContractTermsCheck,
  type ClauseRetriever,
} from '../../apps/api/src/audit/engines/langgraph/contract-terms-agent'
import { retrieveRelevantContext } from '../../apps/api/src/audit/retrieval'
import { loadPo } from '../../apps/api/src/audit/engines/langgraph/loaders'
import { PLANTED_VIOLATIONS } from '../../apps/api/src/db/contract-docs'
import { downloadInvoicePdf } from '../../apps/api/src/lib/storage'
import { cachingJudge, cachingReader, describe, newStats } from '../lib/model-cache'
import { renderInvoice } from '../lib/render-invoice'

/**
 * Build the fixed grading dataset for the contract-terms step.
 *
 *   doppler run -c dev -- bun evals/ragas/build-dataset.ts [--no-cache]
 *
 * Every row is a REAL audit: the engine reads the invoice, retrieves clauses and
 * writes a verdict, exactly as it would in production. That is what makes the
 * dataset worth grading, and also why it costs something to produce — a row is
 * model output before it is eval input.
 *
 * Fixed, not sampled. The same twenty invoices every time, so two runs are
 * comparable and a moving score means the engine moved.
 *
 * Cached by content, so re-running after a prompt tweak re-reads only what the
 * tweak actually changed.
 */

const OUT = resolve(import.meta.dirname, 'dataset.jsonl')
const USE_CACHE = !process.argv.includes('--no-cache')
const CONCURRENCY = 4

/**
 * The dataset's shape: 7 one-off situations, then clean invoices.
 *
 * The clean rows are not padding, and calling them duplicates was wrong. They
 * share an outcome but not an input — different vendors, line items, clauses
 * retrieved and prose written — and they are the FALSE-POSITIVE surface, where
 * an over-eager auditor invents a breach that is not there. A breach-heavy
 * dataset never measures that, and it is the failure a user notices first.
 */
const CLEAN_COUNT = 13

/** Which situation each planted invoice exercises. Keyed by invoice number. */
const CASE_BY_INVOICE: Record<string, string> = {
  'INV-0016': 'rate-cap-20pct',
  'INV-0017': 'rate-cap-10pct',
  'INV-0018': 'arithmetic',
  'INV-0019': 'po-mismatch',
  'INV-0020': 'no-contract',
  'INV-0021': 'prose-only-breach',
  'INV-0022': 'adversarial-breach',
}

/**
 * A verdict is graded as pass-or-breach, not on its exact label.
 *
 * The engine may answer `flag` or `fail`, and the answer key does not say which
 * a given breach deserves — that is a matter of degree nobody has ruled on.
 * Grading the exact label would measure a distinction the ground truth does not
 * make, and would fail the engine for a defensible answer.
 */
type VerdictClass = 'pass' | 'breach'
function classify(verdict: string): VerdictClass {
  return verdict === 'pass' ? 'pass' : 'breach'
}

type Row = {
  invoice_number: string
  case: string
  /** The retrieval query, which is also the question the judge is answering about. */
  question: string
  retrieved_refs: string[]
  retrieved_contexts: string[]
  /**
   * The invoice as the engine read it, for the judge to check invoice claims
   * against. Kept OUT of `retrieved_contexts` deliberately: that field is the
   * honest record of what the retriever returned, and `retrieval_recall` is a
   * statement about retrieval alone. Assembling the judge's view from the two
   * is a grading-time decision, visible in the grading code.
   */
  invoice_rendered: string
  /** The prose under judgement. The only field that needs a model to grade. */
  answer: string
  cited_ref: string | null
  verdict: VerdictClass
  raw_verdict: string
  expected_ref: string | null
  expected_verdict: VerdictClass
  /** Why the answer key says what it says — the judge's reference answer. */
  reference: string
}

type InvoiceRow = { id: string; invoice_number: string; vendor_id: string; pdf_path: string }

const readerStats = newStats()
const judgeStats = newStats()
const reader = cachingReader(claudeReader(DEFAULT_EXTRACTION_MODEL), DEFAULT_EXTRACTION_MODEL, {
  enabled: USE_CACHE,
  stats: readerStats,
})

async function buildRow(inv: InvoiceRow): Promise<Row> {
  const planted = PLANTED_VIOLATIONS.find((v) => v.invoiceNumber === inv.invoice_number)
  const caseName = CASE_BY_INVOICE[inv.invoice_number] ?? 'clean'

  const pdf = await downloadInvoicePdf(inv.pdf_path)
  const extracted = await extractInvoiceFields(pdf, { reader })
  const po = await loadPo(inv.id)

  // Wrap the real retriever so the chunks it returned can be recorded. The
  // engine's own behaviour is untouched; we are only watching it.
  let seen: { sourceRef: string; text: string }[] = []
  let question = ''
  const retrieve: ClauseRetriever = async (query, vendorId) => {
    question = query
    const chunks = await retrieveRelevantContext(query, vendorId)
    seen = chunks.map((c) => ({ sourceRef: c.sourceRef, text: c.content }))
    return chunks
  }

  const judge = cachingJudge(claudeJudge(DEFAULT_JUDGE_MODEL), DEFAULT_JUDGE_MODEL, {
    enabled: USE_CACHE,
    stats: judgeStats,
  })

  const check = await runContractTermsCheck(extracted, inv.vendor_id, {
    ...(po?.poNumber ? { poNumber: po.poNumber } : {}),
    retrieve,
    judge,
  })

  return {
    invoice_number: inv.invoice_number,
    case: caseName,
    question,
    retrieved_refs: seen.map((c) => c.sourceRef),
    retrieved_contexts: seen.map((c) => c.text),
    invoice_rendered: renderInvoice(extracted),
    answer: check.evidence.summary,
    cited_ref: check.evidence.sourceRef ?? null,
    verdict: classify(check.verdict),
    raw_verdict: check.verdict,
    expected_ref: planted?.sourceRef ?? null,
    expected_verdict: planted ? 'breach' : 'pass',
    reference: planted
      ? planted.breach
      : 'No contract term is breached by this invoice, so the correct answer explains why the contract does not object.',
  }
}

async function main(): Promise<void> {
  const planted = Object.keys(CASE_BY_INVOICE)
  const rows = await sql<InvoiceRow[]>`
    select id, invoice_number, vendor_id, pdf_path from invoices
    where pdf_path is not null order by invoice_number`

  const byNumber = new Map(rows.map((r) => [r.invoice_number, r]))
  const chosen: InvoiceRow[] = []
  for (const number of planted) {
    const row = byNumber.get(number)
    if (!row) throw new Error(`${number} is not seeded — run \`bun run seed\``)
    chosen.push(row)
  }
  const clean = rows.filter((r) => !(r.invoice_number in CASE_BY_INVOICE)).slice(0, CLEAN_COUNT)
  if (clean.length < CLEAN_COUNT) {
    throw new Error(`only ${clean.length} clean invoices seeded, need ${CLEAN_COUNT}`)
  }
  chosen.push(...clean)

  console.log(`building ${chosen.length} rows (${planted.length} planted, ${clean.length} clean)…`)

  const built: Row[] = []
  const failed: { invoice: string; error: string }[] = []
  for (let i = 0; i < chosen.length; i += CONCURRENCY) {
    const batch = chosen.slice(i, i + CONCURRENCY)
    // Per row, not per batch. One invoice the engine cannot answer must not
    // discard the nineteen it could -- those rows are already paid for.
    const settled = await Promise.all(
      batch.map(async (inv) => {
        try {
          return await buildRow(inv)
        } catch (error) {
          failed.push({
            invoice: inv.invoice_number,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        }
      }),
    )
    built.push(...settled.filter((r): r is Row => r !== null))
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, chosen.length)}/${chosen.length}\r`)
  }
  await sql.end()

  built.sort((a, b) => a.invoice_number.localeCompare(b.invoice_number))
  await writeFile(OUT, built.map((r) => JSON.stringify(r)).join('\n') + '\n')

  if (failed.length > 0) {
    console.log(`\n${failed.length} row(s) the engine could not answer:`)
    for (const f of failed) console.log(`  ${f.invoice}: ${f.error}`)
  }
  console.log(`\nwrote ${built.length} rows to ${OUT}`)
  console.log(`  pdf reads   : ${describe(readerStats)}`)
  console.log(`  judge calls : ${describe(judgeStats)}`)

  // A quick read on the free metrics, before anything is paid to grade prose.
  const wrongVerdict = built.filter((r) => r.verdict !== r.expected_verdict)
  const wrongClause = built.filter((r) => r.expected_ref !== null && r.cited_ref !== r.expected_ref)
  const missedRetrieval = built.filter(
    (r) => r.expected_ref !== null && !r.retrieved_refs.includes(r.expected_ref),
  )
  console.log(`\nfree checks over the fresh dataset:`)
  console.log(
    `  wrong verdict     : ${wrongVerdict.map((r) => r.invoice_number).join(', ') || '—'}`,
  )
  console.log(`  wrong clause cited: ${wrongClause.map((r) => r.invoice_number).join(', ') || '—'}`)
  console.log(
    `  clause not found  : ${missedRetrieval.map((r) => r.invoice_number).join(', ') || '—'}`,
  )
}

await main()
