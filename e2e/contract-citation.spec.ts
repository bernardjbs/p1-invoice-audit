import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PDF = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/clause-breach-invoice.pdf')

/**
 * Criterion 3: the contract-terms check retrieves clauses from the generated MSA
 * corpus through pgvector and cites the retrieved source in `sourceRef`.
 *
 * WHAT THIS SPEC PROVES, AND WHAT IT DOES NOT. The criterion has two halves and
 * they are proven at different tiers. Do not tick the box on this file alone.
 *
 *   - THE CITATION HALF, proven here: real clauses reach a real model, a verdict
 *     comes back citing one of them, and the citation survives persistence and
 *     reaches the page. Nothing below the e2e tier covers that whole path.
 *   - THE PGVECTOR HALF, proven in `retrieval.integration.test.ts`: that the
 *     clauses are selected by embedding distance and scoped to the vendor. This
 *     spec canNOT prove it. Delete the `order by embedding <=> …` in
 *     `retrieval.ts` and Pilbara's eight chunks still come back, the model still
 *     cites one, and this spec stays green: the corpus is small enough that
 *     ordering does not change the top-k membership.
 *
 * REAL ENGINE ONLY, AND SELF-GATING. The mock engine emits no `sourceRef` at all
 * (`engines/mock.ts`), so this cannot live in `audit-flow.spec.ts`: that spec is
 * `@swap`-tagged and runs under the mock on every push, and the assertion would
 * redden the cheap tier for a thing the mock was never meant to do. The gate is
 * on the env var rather than on a new npm script so that a plain `bun run e2e`
 * reports this spec as SKIPPED in its output, where a reader can see it, instead
 * of it quietly not existing.
 *
 * WHY A SEPARATE FIXTURE. The other two specs upload an invoice from a vendor with
 * no contract, which makes the check short-circuit to `pass` before retrieval is
 * ever called. This one uploads `clause-breach-invoice.pdf`: Pilbara Pumps, whose
 * MSA is in the corpus, billing a weekend call-out loading that §6 forbids without
 * prior written approval. The invoice is arithmetically perfect and billed at the
 * contracted rate, so `math` and `price_vs_contract` both pass it and only reading
 * a clause can find the call-out breach.
 *
 * `po_match` still FLAGS, and that is not avoidable: the upload form has no PO
 * field, so nothing uploaded through the UI can carry one. It also means the model
 * is shown a PO-less invoice (`renderInvoice` omits the line), which makes MSA §2
 * and §4 breachable on that ground alone. The assertions below do not depend on
 * which clause is cited, so this does not make them wrong, but it does mean a green
 * run is not by itself proof that §6 was the clause that mattered. See
 * `fixtures/README.md`.
 *
 * WHY THE CITATION IS GUARANTEED RATHER THAN HOPED FOR. `contract-terms-agent.ts`
 * throws if a non-pass verdict cites no clause, so any verdict other than `pass`
 * carries a `sourceRef`. The assertions below therefore do not depend on WHICH
 * clause the model picks, only that it picked one from our own rows: the model
 * chooses a position in the list it was shown and the citation string is resolved
 * from the database, so an invented reference has no way in.
 */
test.describe('contract-terms citation (criterion 3)', () => {
  test.skip(
    process.env.AUDIT_ENGINE !== 'langgraph',
    'needs AUDIT_ENGINE=langgraph: the mock engine emits no sourceRef and never touches pgvector',
  )

  test('contract-terms cites the MSA clause it retrieved', async ({ page }) => {
    const number = `E2E-CITE-${Date.now()}`

    await page.goto('/upload')
    await page.getByLabel('Invoice number').fill(number)
    await page.getByRole('combobox').click()
    // By name, not `.first()`: the first option is alphabetically Dodgy Diggers,
    // which the seed gives no contract, and the check would short-circuit.
    await page.getByRole('option', { name: 'Pilbara Pumps Pty Ltd' }).click()
    await page.getByLabel('Subtotal (AUD)', { exact: true }).fill('5850')
    await page.getByLabel('GST (AUD)', { exact: true }).fill('585')
    await page.getByLabel('Total (AUD)', { exact: true }).fill('6435')
    await page.getByLabel('Invoice PDF').setInputFiles(PDF)
    await page.getByRole('button', { name: /upload/i }).click()

    await expect(page.getByRole('heading', { name: number })).toBeVisible()
    await expect(page.locator('[data-testid^="check-"]')).toHaveCount(4, { timeout: 20_000 })

    // Pinned FIRST, and the ordering is load-bearing: `not.toContainText` below
    // passes happily against an element that does not exist, so without a
    // positive assertion that the card is here, half two could go green on a page
    // that rendered no contract-terms card at all.
    const card = page.locator('[data-testid="check-contract_terms"]')
    await expect(card).toBeVisible()

    // DIAGNOSTIC SEPARATOR, asserted before the citation on purpose. A `pass`
    // verdict produces a missing citation, which is byte-identical to the failure
    // you get when the UI stops rendering `sourceRef` or when retrieval breaks.
    // Reading that failure on main, nobody could tell a model changing its mind
    // from a real regression. This fails first, and says which it was.
    await expect(
      card.locator('[data-slot="badge"]'),
      'contract-terms returned Pass: the model found no breach in the clauses it retrieved. ' +
        'That is a change in MODEL JUDGEMENT, not a UI or retrieval regression; the citation ' +
        'is only guaranteed for a non-pass verdict (contract-terms-agent.ts throws otherwise).',
    ).toHaveText(/^(Fail|Flag)$/)

    // Half one of the criterion: a citation reached the evidence and the UI.
    // The shape is asserted, not the clause number; which clause is the model's
    // judgement, but the string is resolved from our own rows, so any match here
    // is a real reference to a retrieved chunk.
    //
    // The optional `(cont. N)` tail is not decoration: `chunkClause`
    // (`db/contract-docs.ts`) splits any clause past MAX_CHUNK_CHARS and suffixes
    // the continuations, so a citation can legitimately read `MSA-1000 §5
    // (cont. 2)`. No seeded clause is near that limit today, so this is latent
    // coupling rather than live behaviour, and the pattern admits it so that growing
    // a clause does not break this spec for a reason unrelated to the criterion.
    const citation = card.getByTestId('evidence-source')
    await expect(
      citation,
      'no citation rendered on a non-pass contract-terms verdict: either the evidence lost its ' +
        'sourceRef, or the card stopped rendering it (check-results.tsx has dropped it before).',
    ).toBeVisible()
    await expect(citation).toHaveText(/^MSA-\d+ §\d+( \(cont\. \d+\))?$/)

    // Half two, and the reason this test cannot pass vacuously: retrieval
    // actually returned something. Without this, a run where pgvector silently
    // returned no rows would still be green if the citation ever became optional.
    await expect(
      card,
      'contract-terms short-circuited: retrieval returned zero clauses for this vendor, so the ' +
        'check never called the model and the criterion was not exercised.',
    ).not.toContainText('No contract clauses are on file')
  })
})
