import { test, expect, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'

async function exportedProject(page: Page) {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function expectRenderedRoom(page: Page) {
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  const canvas = page.locator('canvas')
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(30000)
  await expect(page.getByRole('alert')).not.toBeVisible()
}

test('room preview preserves the assembly, selection and studio controls', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const original = await exportedProject(page)
  const selectedName = await page.getByLabel('Panel name').inputValue()
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await page.getByRole('button', { name: 'Show grid', exact: true }).click()

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Realistic preview', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Preview mode' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Project panels' })).not.toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Panel inspector' })).not.toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Camera view' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Exploded view', exact: true })).not.toBeVisible()
  await expect(page.getByLabel('Room scale reference')).toContainText('floor lamp 165 cm tall')
  await expectRenderedRoom(page)
  await page.screenshot({ path: 'test-results/realistic-preview-desktop.png' })

  await page.locator('canvas').click()
  await page.keyboard.press('Delete')
  await page.keyboard.press('ControlOrMeta+d')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Reset room view (F)', exact: true }).click()
  await page.getByRole('button', { name: 'Show dimensions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show dimensions', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await exportedProject(page)).toEqual(original)

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Project panels' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Panel inspector' })).toBeVisible()
  await expect(page.getByLabel('Panel name')).toHaveValue(selectedName)
  await expect(page.getByRole('combobox', { name: 'Camera view' })).toHaveValue('front')
  await expect(page.getByRole('button', { name: 'Exploded view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Show grid', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
})

test('room dimensions use the actual visible panels and handle an empty assembly', async ({ page }) => {
  const panel = createPanel({ name: 'Scale panel', width: 1200, height: 800, thickness: 18, position: [2100, 650, -1400] })
  const hidden = createPanel({ name: 'Hidden panel', width: 2400, height: 2400, position: [-4000, 3000, 5000], visible: false })
  await page.goto('/')
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.getByLabel('Import project file').setInputFiles({
    name: 'scale.playwood.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Scale test', panels: [panel, hidden], connections: [] })),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel('Room scale reference')).toContainText(/1[,.\s]?200 × 800 × 18/)
  await expectRenderedRoom(page)
  await page.getByRole('button', { name: 'Show dimensions', exact: true }).click()
  await expect(page.getByText('1200 mm', { exact: true })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Studio', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Hide Scale panel', exact: true }).click()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel('Room scale reference')).toContainText('Add or show a panel in Studio to see it here.')
  await expectRenderedRoom(page)
  await expect(page.getByText(/^(800|700|600) mm$/)).toHaveCount(0)
})

test('phone room preview fits the screen and returns to the previous drawer state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expectRenderedRoom(page)
  await expect(page.getByLabel('Room scale reference')).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Reset room view (F)', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/realistic-preview-mobile.png' })
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open panel list', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open inspector', exact: true })).toBeVisible()
})
