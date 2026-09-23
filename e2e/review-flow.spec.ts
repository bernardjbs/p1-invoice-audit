import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PDF = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/sample-invoice.pdf')

/**
 * Criterion 5: an invoice that fails the audit lands in the review queue paused,
 * and approving it (with a note) moves it out and records the decision.
 *
 * Runs under BOTH real engines — the mock job and the langgraph job both invoke
 * the whole suite unfiltered. What pauses the invoice differs between them: the
 * mock returns a fixed failing verdict, while the real engine runs the four
 * checks for real against the uploaded PDF and reaches the same pause on the
 * evidence. This spec asserts the REVIEW LOOP, which is identical either way, and
 * deliberately not which check fired — that is the engine specs' job.
 *
 * NOT tagged @swap, so it is excluded from the all-pass stub run, which never
 * pauses anything and would have nothing to approve.
 */
test('flagged invoice pauses for review and clears on approve', async ({ page }) => {
  const number = `E2E-REV-${Date.now()}`

  await page.goto('/upload')
  await page.getByLabel('Invoice number').fill(number)
  await page.getByRole('combobox').click()
  await page.getByRole('option').first().click()
  await page.getByLabel('Subtotal (AUD)', { exact: true }).fill('1000')
  await page.getByLabel('GST (AUD)', { exact: true }).fill('100')
  await page.getByLabel('Total (AUD)', { exact: true }).fill('1100')
  await page.getByLabel('Invoice PDF').setInputFiles(PDF)
  await page.getByRole('button', { name: /upload/i }).click()

  // Either engine flags it → paused for review.
  await expect(page.getByText('Paused for review')).toBeVisible({ timeout: 20_000 })

  // It appears in the review queue; approve it with a note.
  await page.getByRole('link', { name: 'Review queue' }).click()
  const card = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('link', { name: number }) })
  await expect(card).toBeVisible()
  await card.getByPlaceholder('Reason / note (optional)').fill('looks fine on manual review')
  await card.getByRole('button', { name: 'Approve' }).click()

  // Cleared from the queue.
  await expect(page.getByRole('link', { name: number })).toHaveCount(0, { timeout: 10_000 })
})
