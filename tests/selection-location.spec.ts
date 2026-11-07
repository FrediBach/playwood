import { expect, test } from '@playwright/test'
import { openInspectorSection } from './inspector-helpers'

for (const width of [1440, 390]) {
  test(`scene location stays readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    if (width === 390) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
    const info = page.getByRole('region', { name: 'Scene location', exact: true })
    await expect(info).toBeVisible()
    await expect(info.locator('summary .selection-ground-clearance')).toBeVisible()
    await expect(info.locator('summary .selection-ground-clearance')).toContainText('mm')
    await expect(info.getByText('Ground clearance', { exact: true })).toBeHidden()
    await openInspectorSection(page, 'Scene location')
    await expect(info.getByText('Ground clearance', { exact: true })).toBeVisible()
    await expect(info.getByRole('columnheader', { name: 'Center' })).toBeVisible()
    await expect(page.getByLabel('Width', { exact: true })).toBeInViewport()
    expect(await page.locator('.inspector-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await info.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(info.getByText('Ground clearance', { exact: true })).toBeHidden()
  })
}

test('summary follows panel, connector, and object selection and object drafts', async ({ page }) => {
  await page.goto('/')
  const info = page.getByRole('region', { name: 'Scene location', exact: true })
  await openInspectorSection(page, 'Scene location')
  await expect(info).toContainText('Panel stock bounds')
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-select').first().click()
  await expect(info).toContainText('CAD envelope')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Add a box', exact: true }).click()
  await openInspectorSection(page, 'Scene location')
  await expect(info).toContainText('Source-box bounds')
  const before = (await info.textContent())!
  await page.getByLabel('Object center Y', { exact: true }).fill('1000')
  await page.getByLabel('Object center Y', { exact: true }).press('Tab')
  await expect(info).not.toHaveText(before)
  await expect(info.locator('summary .selection-ground-clearance')).toContainText('700 mm')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(info).toHaveText(before)
})
