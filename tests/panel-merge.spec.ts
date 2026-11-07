import { test, expect } from '@playwright/test'
import { openInspectorSection } from './inspector-helpers'

for (const width of [1440, 390]) test(`merge the supplied front panels, undo, redo and reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles('src/lib/__fixtures__/panel-merge.json')
  await expect(page.locator('.panel-list-row')).toHaveCount(28)
  if (width < 900) await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.locator('[data-panel-id="62c43893-6d06-4bf7-9a9f-6a9327225b62"] .panel-list-select').click()
  await page.getByRole('checkbox', { name: 'Select Upright 3.2 copy', exact: true }).check()
  if (width < 900) {
    await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
    if (await page.getByRole('button', { name: 'Open inspector', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  }
  if (width === 1440) {
    await page.locator('canvas').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Merge panels', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  } else {
    await openInspectorSection(page, 'Merge panels')
    await page.getByRole('button', { name: 'Merge panels', exact: true }).click()
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('.panel-list-row')).toHaveCount(27)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(28)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(27)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(27)
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(27)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  expect(saved.panels.find((panel: { id: string }) => panel.id === '62c43893-6d06-4bf7-9a9f-6a9327225b62').width).toBeCloseTo(635)
})

test('preview merge is absent for one panel and rejects panels in different planes', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles('src/lib/__fixtures__/panel-merge.json')
  await expect(page.locator('.panel-list-row')).toHaveCount(28)
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menuitem', { name: 'Merge panels', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('checkbox', { name: 'Select Shelf 1.2', exact: true }).check()
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Merge panels', exact: true }).click()
  await expect(page.getByText('The panels must lie in the same plane.', { exact: true })).toBeVisible()
  await expect(page.locator('.panel-list-row')).toHaveCount(28)
})
