import { test, expect, type Page } from './browser-fixture'
import { createPanel, resolvePanels } from '../src/lib/model'
import { createExampleProject } from '../src/lib/example-library'
import { createPreviewBenchProject } from '../src/lib/fixtures/preview-bench'
import { furnitureArchetypes } from '../src/lib/fixtures/furniture-archetypes'
import type { Panel } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

async function importPanels(page: Page, panels: Panel[]) {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.getByLabel('Import project file').setInputFiles({
    name: 'furnishing.playwood.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Furnishing test', panels, connections: [] })),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

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

test('Studio keeps the floor fixed for elevated furniture and Place on floor grounds it', async ({ page }) => {
  await page.goto('/')
  await importPanels(page, [createPanel({ name: 'Raised panel', width: 600, height: 400, position: [0, 700, 0] })])
  const grid = page.getByRole('button', { name: 'Show grid', exact: true })
  if (await grid.getAttribute('aria-pressed') !== 'true') await grid.click()
  const floorHeight = () => page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { scene } = _roots.get(canvas).store.getState()
    return scene.getObjectByName('studio-ground-grid')?.position.y
  })
  await expect.poll(floorHeight).toBe(-0.012)
  const raised = await exportedProject(page)
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expectRenderedRoom(page)
  expect(await exportedProject(page)).toEqual(raised)
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await page.getByRole('button', { name: 'Place on floor', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Move creation', exact: true }).click()
  expect((await exportedProject(page)).panels[0].position[1]).toBe(200)
  await expect.poll(floorHeight).toBe(-0.012)
})

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
  await expect(page.getByRole('complementary', { name: 'Inspector' })).not.toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Camera view' })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Exploded view', exact: true })).not.toBeVisible()
  await expect(page.getByLabel('Room scale reference')).toContainText('floor lamp 165 cm tall')
  await expectRenderedRoom(page)
  await page.screenshot({ path: 'test-results/realistic-preview-desktop.png' })

  // Keyboard focus preserves selection; clicking a room panel now selects it.
  await page.locator('canvas').focus()
  await page.keyboard.press('Delete')
  await page.keyboard.press('ControlOrMeta+d')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Reset room view (F)', exact: true }).click()
  await page.getByRole('button', { name: 'Show dimensions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show dimensions', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await exportedProject(page)).toEqual(original)

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Project panels' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
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
  await page.getByRole('button', { name: 'Show wireframe of Scale panel', exact: true }).click()
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
  const furnish = page.getByRole('checkbox', { name: 'Auto furnish', exact: true })
  await expect(furnish).toBeInViewport()
  await expect(furnish).not.toBeChecked()
  await furnish.check()
  await expect(furnish).toBeChecked()
  await expect(furnish).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Reset room view (F)', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/realistic-preview-mobile.png' })
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open panel list', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open inspector', exact: true })).toBeVisible()
})

test('auto furnishing is opt-in, renders desk props, and never changes the project', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await importPanels(page, [
    createPanel({ name: 'Panel A', width: 1400, height: 700, position: [0, 741, 0], rotation: [-Math.PI / 2, 0, 0] }),
    ...[-620, 620].map((x, index) => createPanel({ name: `Panel ${index + 2}`, width: 700, height: 732, position: [x, 366, 0], rotation: [0, Math.PI / 2, 0] })),
  ])
  const original = await exportedProject(page)
  const furnish = page.getByRole('checkbox', { name: 'Auto furnish', exact: true })
  const surface = page.locator('[data-preview-furnishings]')
  await expect(furnish).not.toBeVisible()
  await expect(surface).toHaveAttribute('data-preview-furnishings', '0')

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(furnish).not.toBeChecked()
  await expect(surface).toHaveAttribute('data-preview-furnishings', '0')
  await expectRenderedRoom(page)
  const unfurnished = await page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())

  await furnish.check()
  await expect(surface).toHaveAttribute('data-preview-furnishings', /^[1-9]\d*$/)
  const count = await surface.getAttribute('data-preview-furnishings')
  await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(unfurnished)
  await expectRenderedRoom(page)
  await page.screenshot({ path: 'test-results/realistic-preview-furnished-desk.png' })
  expect(await exportedProject(page)).toEqual(original)

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect(furnish).not.toBeVisible()
  await expect(surface).toHaveAttribute('data-preview-furnishings', '0')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(furnish).toBeChecked()
  await expect(surface).toHaveAttribute('data-preview-furnishings', count!)
  await furnish.uncheck()
  await expect(surface).toHaveAttribute('data-preview-furnishings', '0')
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('auto furnishing skips vertical, tilted, and hidden surfaces', async ({ page }) => {
  await page.goto('/')
  await importPanels(page, [
    createPanel({ name: 'Vertical', width: 1200, height: 800, position: [0, 500, 0] }),
    createPanel({ name: 'Tilted', width: 1200, height: 700, position: [0, 1000, 0], rotation: [-Math.PI / 3, 0, 0] }),
    createPanel({ name: 'Hidden horizontal', width: 1400, height: 700, position: [2000, 741, 0], rotation: [-Math.PI / 2, 0, 0], visible: false }),
  ])
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  await expect(page.locator('[data-preview-furnishings]')).toHaveAttribute('data-preview-furnishings', '0')
  await expect(page.getByText('No furnishings placed.', { exact: true })).toBeVisible()
  await expectRenderedRoom(page)
})

test('auto furnishing seats a person on the gallery bench', async ({ page }) => {
  await page.goto('/')
  await importPanels(page, resolvePanels(createExampleProject('bench')))
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expectRenderedRoom(page)
  const unfurnished = await page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  await expect(page.locator('[data-preview-furnishings]')).toHaveAttribute('data-preview-furnishings', /^[1-9]\d*$/)
  await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(unfurnished)
  await expect(page.getByRole('alert')).not.toBeVisible()
  await page.screenshot({ path: 'test-results/realistic-preview-furnished-bench.png' })
})

test('deep cubby shelves mix furnishings with empty spaces and face books toward their openings', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const panels: Panel[] = []
  const columns = [-597, -199, 199, 597]
  const levels = [49, 417, 785, 1153, 1521]
  // Each opening is narrower than its depth. The side walls and back, rather
  // than the longest shelf edge or a panel name, establish the reading direction.
  for (const [column, x] of columns.entries()) {
    for (const [row, y] of levels.entries()) {
      panels.push(createPanel({
        id: `cubby-${column}-${row}`, name: `Panel ${column}-${row}`,
        width: 380, height: 420, position: [x, y, 0], rotation: [-Math.PI / 2, 0, 0],
      }))
    }
  }
  for (const [index, x] of [-796, -398, 0, 398, 796].entries()) {
    panels.push(createPanel({
      id: `cubby-divider-${index}`, name: `Panel D${index}`,
      width: 420, height: 1530, position: [x, 765, 0], rotation: [0, Math.PI / 2, 0],
    }))
  }
  panels.push(createPanel({ id: 'cubby-rear', name: 'Panel R', width: 1610, height: 1530, position: [0, 765, -219] }))
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.goto('/')
  await importPanels(page, panels)
  const original = await exportedProject(page)
  // Clear the imported panel selection through the Studio shortcut so handles
  // do not cover books in the visual review image.
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expectRenderedRoom(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const unfurnished = await page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  const surface = page.locator('[data-preview-furnishings]')
  await expect(surface).toHaveAttribute('data-preview-furnishings', /^[1-9]\d*$/)
  await expect.poll(async () => Number(await surface.getAttribute('data-preview-furnishings'))).toBeLessThan(columns.length * levels.length)
  await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(unfurnished)
  await expectRenderedRoom(page)
  await page.screenshot({ path: 'test-results/realistic-preview-varied-books.png' })
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('auto furnishing seats a person on a bench extending from a shelf', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1680, height: 1100 })
  await page.goto('/')
  await importPanels(page, resolvePanels(createPreviewBenchProject({ hutch: true })))
  const original = await exportedProject(page)
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expectRenderedRoom(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const unfurnished = await page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  await expect(page.locator('[data-preview-furnishings]')).toHaveAttribute('data-preview-furnishings', /^[1-9]\d*$/)
  await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(unfurnished)
  await expectRenderedRoom(page)
  await page.screenshot({ path: 'test-results/realistic-preview-shelf-bench.png' })
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('auto furnish recognises a dining table, varies it, and follows a chosen purpose', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await importPanels(page, furnitureArchetypes().find(item => item.id === 'dining')!.panels)
  const original = await exportedProject(page)
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  const status = page.locator('.room-furnishing-status')
  const surface = page.locator('[data-preview-furnishings]')
  await expect(status).toHaveText('1 dining table')
  await expect(page.getByRole('radio', { name: 'Balanced', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expectRenderedRoom(page)
  const frame = () => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())
  const balanced = await frame()
  // Lived-in seats a second diner in place of an empty chair.
  await page.getByRole('radio', { name: 'Lived-in', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Lived-in', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(frame).not.toBe(balanced)
  const settled = await frame()
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click()
  await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL())).not.toBe(settled)
  await page.screenshot({ path: 'test-results/realistic-preview-furnished-dining.png' })

  const openMenu = async () => {
    await page.getByLabel('3D preview canvas', { exact: true }).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Furnish as', exact: true }).click()
  }
  await openMenu()
  await expect(page.getByRole('menuitemradio', { name: 'Automatic · Dining table', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Desk', exact: true }).click()
  await expect(status).toHaveText('1 desk · 1 set by you')
  await openMenu()
  await expect(page.getByRole('menuitemradio', { name: 'Desk', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('menuitemradio', { name: 'Leave empty', exact: true }).click()
  await expect(status).toHaveText('No furnishings placed. · 1 set by you')
  await expect(surface).toHaveAttribute('data-preview-furnishings', '0')
  // The purpose is saved with the board, so Reset keeps it.
  expect((await exportedProject(page)).panels.find((panel: Panel) => panel.id === 'dine-top').furnishingRole).toBe('empty')

  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(status).toHaveText('No furnishings placed. · 1 set by you')
  await expect(page.getByRole('radio', { name: 'Balanced', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0)
  await openMenu()
  await page.getByRole('menuitemradio', { name: 'Automatic · Dining table', exact: true }).click()
  await expect(status).toHaveText('1 dining table')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/realistic-preview-furnishing-controls-narrow.png' })
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('the panel inspector saves a furnishing purpose that Auto furnish follows', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await importPanels(page, furnitureArchetypes().find(item => item.id === 'dining')!.panels)
  const original = await exportedProject(page)
  const purpose = page.getByRole('combobox', { name: 'Furnish as', exact: true })

  await page.locator('.panel-list-select').and(page.getByRole('button', { name: 'Side', exact: true })).first().click()
  await expect(page.locator('.right-sidebar').getByText('Furnishing purpose', { exact: true })).toHaveCount(0)

  await page.locator('.panel-list-select').and(page.getByRole('button', { name: 'Board', exact: true })).click()
  await openInspectorSection(page, 'Furnishing purpose')
  await expect(purpose).toHaveValue('auto')
  await purpose.selectOption('desk')
  await expect(purpose).toHaveValue('desk')
  await page.locator('.right-sidebar').getByText('Furnishing purpose', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/panel-furnishing-purpose.png' })
  expect((await exportedProject(page)).panels.find((panel: Panel) => panel.id === 'dine-top').furnishingRole).toBe('desk')

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  await expect(page.locator('.room-furnishing-status')).toHaveText('1 desk · 1 set by you')
  await page.getByRole('button', { name: 'Studio', exact: true }).click()

  // A mixed selection edits only its level boards.
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+a')
  await openInspectorSection(page, 'Furnishing purpose')
  await expect(page.getByText('Applies to the 1 level board in the selection.')).toBeVisible()
  await expect(purpose).toHaveValue('desk')
  await purpose.selectOption('auto')
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})
