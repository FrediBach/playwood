import { test, expect } from '@playwright/test'
import { createPanel, createStarterProject } from '../src/lib/model'

test('warning reviews, cancels, applies and undoes overlap repair', async ({ page }) => {
  const project = { ...createStarterProject('blank'), panels: [
    createPanel({ id: 'a', name: 'First', width: 200, height: 200, position: [0, 200, 0] }),
    createPanel({ id: 'b', name: 'Second', width: 200, height: 200, position: [190, 200, 0] }),
  ] }
  await page.goto('/')
  await page.getByLabel('Import project file', { exact: true }).setInputFiles({ name: 'overlaps.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const warning = page.locator('[data-panel-id="a"] .panel-overlap-indicator')
  await warning.click()
  const dialog = page.getByRole('dialog', { name: 'Fix panel overlaps' })
  await expect(dialog.getByRole('table', { name: 'Proposed panel changes' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(warning).toBeFocused()
  await warning.press('Enter')
  await page.screenshot({ path: 'test-results/overlap-repair-desktop.png' })
  await page.setViewportSize({ width: 700, height: 800 })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/overlap-repair-narrow.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: 'Apply automatic fix' }).click()
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(warning).toBeVisible()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(0)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-panel-id="a"]')).toBeVisible()
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(0)
})
