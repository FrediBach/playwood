import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Project } from '../src/lib/types'
import { getProjectBounds, resolvePanels } from '../src/lib/model'

async function exportedProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

test('move creation in the room, center and place near wall, undo and persist', async ({ page }) => {
  await page.goto('/')
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await page.getByLabel('Left / right · X').fill('300')
  await page.getByLabel('Back / forward · Z').fill('-200')
  await page.getByRole('dialog').getByRole('button', { name: 'Move creation', exact: true }).click()
  const moved = await exportedProject(page)
  const before = getProjectBounds(resolvePanels(original))
  const after = getProjectBounds(resolvePanels(moved))
  expect(after.min[0]).toBeCloseTo(before.min[0] + 300)
  expect(after.min[2]).toBeCloseTo(before.min[2] - 200)
  expect(moved.connections).toEqual(original.connections)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await page.getByRole('button', { name: 'Center horizontally', exact: true }).click()
  await page.getByRole('button', { name: 'Near back wall', exact: true }).click()
  await page.getByRole('button', { name: 'Place on floor', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('0 mm above floor · 50 mm from wall')
  await page.screenshot({ path: 'test-results/move-creation-dialog.png', animations: 'disabled' })
  await page.getByRole('dialog').getByRole('button', { name: 'Move creation', exact: true }).click()
  const placed = await exportedProject(page)
  const bounds = getProjectBounds(resolvePanels(placed))
  expect(bounds.min[0] + bounds.max[0]).toBeCloseTo(0)
  expect(bounds.min[1]).toBeCloseTo(0)
  expect(bounds.min[2]).toBeCloseTo(-bounds.depth / 2 - 600)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(placed)
})

test('movement dialog fits a phone and cancel leaves the creation unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Top view movement preview' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Front view movement preview' })).toBeVisible()
  const initialPreview = await page.getByRole('img', { name: 'Top view movement preview' }).innerHTML()
  await page.getByLabel('Left / right · X').fill('500')
  await page.getByLabel('Left / right · X').press('Tab')
  expect(await page.getByRole('img', { name: 'Top view movement preview' }).innerHTML()).not.toBe(initialPreview)
  for (const name of ['Center horizontally', 'Near back wall', 'Place on floor', 'Move creation', 'Cancel']) {
    await expect(page.getByRole('dialog').getByRole('button', { name, exact: true })).toBeInViewport()
  }
  await page.screenshot({ path: 'test-results/move-creation-mobile.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
})
