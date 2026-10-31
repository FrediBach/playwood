import { createPanel } from '../src/lib/model'
import { expect, test } from '@playwright/test'

test('preview snapping controls, shortcuts and saved preferences', async ({ page }) => {
  await page.goto('/')
  const settings = page.getByLabel('Snapping settings', { exact: true })
  await expect(settings).toHaveText('Snap · Off')
  await settings.click()
  await page.getByLabel('Global grid', { exact: false }).check()
  await page.getByLabel('Grid spacing (mm)').fill('25')
  await page.getByLabel('Snap tolerance (mm)').fill('6')
  await page.getByLabel('Align to geometry', { exact: false }).check()
  await expect(settings).toHaveText('Snap · On')
  // Typing in a field must never toggle snapping.
  await page.getByLabel('Grid spacing (mm)').focus()
  await page.keyboard.press('g')
  await expect(page.getByLabel('Global grid', { exact: false })).toBeChecked()
  await settings.click()
  await page.getByLabel('3D preview canvas').focus()
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(settings).toHaveText('Snap · Off')
  await page.keyboard.press('g')
  await page.reload()
  await settings.click()
  await expect(page.getByLabel('Global grid', { exact: false })).toBeChecked()
  await expect(page.getByLabel('Align to geometry', { exact: false })).not.toBeChecked()
  await expect(page.getByLabel('Grid spacing (mm)')).toHaveValue('25')
  await expect(page.getByLabel('Snap tolerance (mm)')).toHaveValue('6')
  await page.screenshot({ path: 'test-results/preview-snap-settings.png' })
})


test('resize keyboard follows grid spacing and commits one undo step', async ({ page }) => {
  const panel = createPanel({ id: 'snap-panel', width: 400, height: 300, position: [0, 400, 0] })
  await page.addInitScript(panel => {
    localStorage.setItem('playwood-studio-project-v1', JSON.stringify({ version: 1, name: 'Snap test', panels: [panel], connections: [] }))
    localStorage.setItem('playwood-snap', JSON.stringify({ grid: true, geometry: false, spacing: 50, tolerance: 10 }))
  }, panel)
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  const handle = page.locator('[data-resize-handle="panel-width-positive"]')
  await expect(handle).toBeVisible()
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  const width = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels[0].width)
  await expect.poll(width).toBe(450)
  await page.keyboard.press('ArrowRight')
  await expect.poll(width).toBe(500)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(width).toBe(450)
})

test('geometry guides darken at alignment and the dropdown covers resize handles', async ({ page }) => {
  const panels = [
    createPanel({ id: 'moving', width: 400, height: 300, position: [0, 400, 0] }),
    createPanel({ id: 'target', width: 400, height: 300, position: [410, 950, 0] }),
  ]
  await page.addInitScript(panels => {
    localStorage.setItem('playwood-studio-project-v1', JSON.stringify({ version: 1, name: 'Guide feedback', panels, connections: [] }))
    localStorage.setItem('playwood-snap', JSON.stringify({ grid: false, geometry: true, spacing: 50, tolerance: 10 }))
  }, panels)
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  const handle = page.locator('[data-resize-handle="panel-width-positive"]')
  await expect(handle).toBeVisible()
  const activeGuides = () => page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { scene } = _roots.get(canvas).store.getState()
    let count = 0
    scene.traverse((object: { name: string; userData: { snapActive?: boolean }; material?: { opacity: number } }) => {
      if (object.name === 'geometry-snap-guide' && object.userData.snapActive && object.material?.opacity === 0.9) count++
    })
    return count
  })
  await expect.poll(activeGuides).toBe(0)
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(activeGuides).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/geometry-snap-highlight.png' })
  await expect.poll(activeGuides).toBe(0)

  await page.getByLabel('Snapping settings', { exact: true }).click()
  const box = (await handle.boundingBox())!
  // Place the real menu over a real handle to exercise their stacking contexts,
  // independently of camera zoom and the user's panel dimensions.
  await page.locator('.snap-panel').evaluate((panel, box) => {
    Object.assign((panel as HTMLElement).style, { position: 'fixed', left: `${box.x - 30}px`, top: `${box.y - 30}px`, right: 'auto' })
  }, box)
  const covered = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.snap-panel'),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  expect(covered).toBe(true)
  await page.screenshot({ path: 'test-results/snap-dropdown-stacking.png' })
})
