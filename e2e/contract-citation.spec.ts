import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PDF = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/clause-breach-invoice.pdf')

/**
 * Criterion 3: the contract-terms check retrieves clauses from the generated MSA
 * corpus through pgvector and cites the retrieved source in `sourceRef`.
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
 * contracted rate, so the three deterministic checks pass it. Only reading the
 * clause catches it, which is the whole point of the check under test.
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

    const card = page.locator('[data-testid="check-contract_terms"]')

    // Half one of the criterion: a citation reached the evidence and the UI.
    // The shape is asserted, not the clause number — which clause is the model's
    // judgement, but the string is resolved from our own rows, so any match here
    // is a real reference to a retrieved chunk.
    const citation = card.getByTestId('evidence-source')
    await expect(citation).toBeVisible()
    await expect(citation).toHaveText(/^MSA-\d+ §\d+$/)

    // Half two, and the reason this test cannot pass vacuously: retrieval
    // actually returned something. Without this, a run where pgvector silently
    // returned no rows would still be green if the citation ever became optional.
    await expect(card).not.toContainText('No contract clauses are on file')
  })
})
