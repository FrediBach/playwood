import { test, expect, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import { ASSEMBLY_LIBRARY } from '../src/lib/assembly-library'

async function ready(page: Page) {
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(10000)
}
async function panelPoint(page: Page, id: string) {
  return page.locator('canvas').evaluate(async (canvas, id) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, scene } = _roots.get(canvas).store.getState()
    let panel: any
    scene.traverse((object: any) => { if (object.userData.panelId === id) panel = object })
    const point = panel.getWorldPosition(camera.position.clone()).project(camera)
    const rect = canvas.getBoundingClientRect()
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 }
  }, id)
}

test('right click targets a panel, preserves multi-selection, and right drag stays pan', async ({ page }) => {
  const panels = [createPanel({ name: 'Left', width: 250, height: 250, position: [-250, 500, 0] }), createPanel({ name: 'Right', width: 250, height: 250, position: [250, 500, 0] })]
  await page.addInitScript(project => localStorage.setItem('playwood-studio-project-v1', JSON.stringify(project)), { version: 1, name: 'Menu', panels, connections: [] })
  await page.goto('/')
  await ready(page)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  const point = await panelPoint(page, panels[1].id)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Preview actions' })
  await expect(menu).toBeVisible()
  await expect(menu.getByText('Right', { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Disassemble', exact: true })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: 'Disconnect panels' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Panel name')).toHaveValue('Right')
  await page.keyboard.press('ControlOrMeta+a')
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(menu.getByText('2 panels', { exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(point.x + 80, point.y + 50, { steps: 10 })
  await page.mouse.up({ button: 'right' })
  await expect(menu).toHaveCount(0)
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  await page.keyboard.press('End')
  await expect(menu.getByRole('menuitem', { name: 'Fit view' })).toBeFocused()
  await page.keyboard.press('Escape')
  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.click(box.x + box.width - 8, box.y + box.height - 8, { button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Add panel' })).toBeVisible()
  const bounds = (await menu.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
})

test('assembly menu fills holes and disassembles with undo', async ({ page }) => {
  const project = ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-cube')!.create()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'box.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await ready(page)
  const open = async () => { await page.locator('canvas').focus(); await page.keyboard.press('Shift+F10') }
  const menu = page.getByRole('menu')
  await open()
  await expect(menu.getByRole('menuitem', { name: 'Disassemble', exact: true })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Fill hole · Back', exact: true }).click()
  const savedCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)
  await expect.poll(savedCount).toBe(5)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(savedCount).toBe(4)
  await open()
  await menu.getByRole('menuitem', { name: 'Disassemble', exact: true }).click()
  await expect(page.getByLabel('Instance name')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await open()
  await expect(menu.getByRole('menuitem', { name: 'Disassemble', exact: true })).toBeVisible()
})
