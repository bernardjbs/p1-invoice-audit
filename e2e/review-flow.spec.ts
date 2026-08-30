import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PDF = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/sample-invoice.pdf')

/**
 * Criterion 5: an invoice that fails the audit lands in the review queue paused,
 * and approving it (with a note) moves it out and records the decision. Mock-
 * only (NOT @swap): the all-pass stub never pauses anything, so this asserts the
 * mock engine's verdicts. An uploaded minimal invoice fails the arithmetic check
 * under the mock, which is what pauses it.
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

  // The mock flags it → paused for review.
  await expect(page.getByText('Paused for review')).toBeVisible({ timeout: 20_000 })

  // It appears in the review queue; approve it with a note.
  await page.getByRole('link', { name: 'Review queue' }).click()
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole('link', { name: number }) })
  await expect(card).toBeVisible()
  await card.getByPlaceholder('Reason / note (optional)').fill('looks fine on manual review')
  await card.getByRole('button', { name: 'Approve' }).click()

  // Cleared from the queue.
  await expect(page.getByRole('link', { name: number })).toHaveCount(0, { timeout: 10_000 })
})
