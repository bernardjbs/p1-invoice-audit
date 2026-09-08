import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sql } from '../../apps/api/src/db/client'
import { retrieveRelevantContext } from '../../apps/api/src/audit/retrieval'

/**
 * Where does the clause that decides an invoice actually rank?
 *
 *   doppler run -c dev -- bun evals/ragas/probe-retrieval-rank.ts
 *
 * The dataset showed the engine judging three invoices without the clause that
 * decides them: it looks at the top four, and the clause was not there. The
 * obvious fix is to look at more. That is a guess, and it is only right if the
 * clause is sitting just below the cut.
 *
 * The alternative is that the QUESTION is wrong. The retrieval query is built
 * from line items and deliberately omits amounts, so a clause about purchase
 * orders or arithmetic may match it poorly however deep we look. Depth and
 * wording are different repairs, and the rank tells you which you need.
 *
 * Read-only. One embedding per invoice, no judge, no writes.
 */

const DATASET = resolve(import.meta.dirname, 'dataset.jsonl')
/** Deep enough that "not in the top 4" and "not in the corpus at all" separate. */
const DEEP_K = 20

type Row = {
  invoice_number: string
  case: string
  question: string
  expected_ref: string | null
  retrieved_refs: string[]
}

async function main(): Promise<void> {
  const rows = (await readFile(DATASET, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.expected_ref !== null)

  const vendors = await sql<{ invoice_number: string; vendor_id: string }[]>`
    select invoice_number, vendor_id from invoices`
  const vendorByInvoice = new Map(vendors.map((v) => [v.invoice_number, v.vendor_id]))

  console.log(`probing ${rows.length} invoices that expect a clause, at k=${DEEP_K}\n`)
  console.log('invoice    case                  needed        rank   verdict')

  for (const row of rows) {
    const vendorId = vendorByInvoice.get(row.invoice_number)
    if (!vendorId) continue
    const chunks = await retrieveRelevantContext(row.question, vendorId, { k: DEEP_K })
    const refs = chunks.map((c) => c.sourceRef)
    const rank = refs.indexOf(row.expected_ref!)
    // 0-based index to a human rank; -1 means it never appeared at all.
    const shown = rank === -1 ? `none/${refs.length}` : `${rank + 1}/${refs.length}`
    const verdict =
      rank === -1
        ? 'NOT RETRIEVABLE — the query does not match it'
        : rank < 4
          ? 'already in the top 4'
          : 'below the cut — more depth would find it'
    console.log(
      `${row.invoice_number}  ${row.case.padEnd(20)}  ${row.expected_ref!.padEnd(12)}  ${shown.padEnd(6)} ${verdict}`,
    )
  }

  await sql.end()
}

await main()
