import { expect, test, type Page } from '@playwright/test'
import { TROFAST_ITEMS } from '../src/lib/trofast-catalog'
import type { Panel, Project } from '../src/lib/types'

function gallery(allColors: boolean): Project {
  const items = TROFAST_ITEMS.flatMap(item => (allColors ? item.colors : [item.colors[0]]).map(colorId => ({ item, colorId })))
  const columns = allColors ? 7 : 4
  const panels: Panel[] = items.map(({ item, colorId }, index) => ({
    id: `panel-${index}`, name: `${item.name} ${colorId}`, width: 520, height: 400, thickness: 18,
    material: 'birch', color: '#ddd4b8', finishCoverage: 0, pattern: 'solid', holeSize: 12, holeSpacing: 48, visible: true,
    position: [(index % columns - (columns - 1) / 2) * 620, 700, (Math.floor(index / columns) - 0.5) * 550],
    // Exercise both local faces while every installed box stays upright.
    rotation: [index % 2 ? Math.PI / 2 : -Math.PI / 2, 0, 0],
    trofastInserts: [{ id: `insert-${index}`, itemId: item.id, colorId, x: 260, y: 200, face: index % 2 ? -1 : 1 }],
  }))
  return { version: 1, name: 'TROFAST catalog render', panels, connections: [] }
}

async function importGallery(page: Page, allColors: boolean) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'trofast-gallery.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(gallery(allColors))),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.panel-list-select')).toHaveCount(allColors ? 21 : 8)
}

async function settleView(page: Page, room = false) {
  // Wait for the responsive canvas resize before requesting its fitted camera.
  await page.locator('canvas').evaluate(async () => {
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
  })
  await page.getByRole('button', { name: room ? 'Reset room view (F)' : 'Fit assembly (F)', exact: true }).click()
  await page.locator('canvas').evaluate(async () => {
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame)
  })
}

test('renders all TROFAST shapes and catalog colors in Studio and Realistic preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1800, height: 1200 })
  await page.goto('/')
  await importGallery(page, false)
  await page.getByRole('button', { name: 'Show grid', exact: true }).click()
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective')
  await settleView(page)
  await expect(page.getByRole('alert')).not.toBeVisible()
  await page.screenshot({ path: 'test-results/trofast-shapes-studio.png' })
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  await settleView(page, true)
  await page.screenshot({ path: 'test-results/trofast-shapes-room.png' })
  await page.keyboard.press('Escape')
  await importGallery(page, true)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('top')
  await settleView(page)
  await page.screenshot({ path: 'test-results/trofast-colors-top.png' })
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective')
  await settleView(page)
  await page.screenshot({ path: 'test-results/trofast-colors-studio.png' })
  await page.reload()
  await expect(page.locator('.panel-list-select')).toHaveCount(21)
  await expect(page.getByRole('alert')).not.toBeVisible()
  expect(errors).toEqual([])
})
