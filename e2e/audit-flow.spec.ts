import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const PDF = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/sample-invoice.pdf')

/**
 * Criterion 4 + criterion 7: upload → the audit runs via the queue → four check
 * results render in the detail view. Tagged @swap because it asserts only
 * engine-agnostic pipeline properties (an audit ran, four cards rendered), so it
 * passes under BOTH the mock and the all-pass stub engine.
 */
test('upload → audit runs via queue → four check cards render @swap', async ({ page }) => {
  const number = `E2E-${Date.now()}`

  await page.goto('/upload')
  await page.getByLabel('Invoice number').fill(number)
  await page.getByRole('combobox').click()
  await page.getByRole('option').first().click()
  await page.getByLabel('Subtotal (AUD)', { exact: true }).fill('1000')
  await page.getByLabel('GST (AUD)', { exact: true }).fill('100')
  await page.getByLabel('Total (AUD)', { exact: true }).fill('1100')
  await page.getByLabel('Invoice PDF').setInputFiles(PDF)
  await page.getByRole('button', { name: /upload/i }).click()

  // Redirected to the detail view; the page polls while auditing, so the four
  // check cards appear once the worker persists the run.
  await expect(page.getByRole('heading', { name: number })).toBeVisible()
  await expect(page.locator('[data-testid^="check-"]')).toHaveCount(4, { timeout: 20_000 })
})
