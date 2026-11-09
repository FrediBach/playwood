import { expect, test, type Page } from './browser-fixture'
import { Euler, Vector3 } from 'three'
import { gridProject } from '../src/lib/example-geometry'
import { resolvePanels, rotateProject, validateProject } from '../src/lib/model'
import { preparePreviewResize } from '../src/lib/preview-resize'
import { synthStorageShelfProject } from '../src/lib/synth-storage-shelf'
import type { Project, Vec3 } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
type Handle = NonNullable<ReturnType<typeof preparePreviewResize>>['handles'][number]
const saved = (page: Page): Promise<Project> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey)

async function openProject(page: Page, project: Project, selectedIds: string[]) {
  await page.goto('/')
  await page.getByLabel('Import project file', { exact: true }).setInputFiles({
    name: 'selection-stretch.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect.poll(async () => (await saved(page))?.name).toBe(project.name)
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(10000)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  const selected = project.panels.filter(panel => selectedIds.includes(panel.id))
  await page.getByRole('button', { name: selected[0].name, exact: true }).click()
  for (const panel of selected.slice(1)) await page.getByRole('checkbox', { name: `Select ${panel.name}`, exact: true }).check()
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(selected.length)
}

function along(project: Project, panelIds: string[], direction: Vec3) {
  const handle = preparePreviewResize(project, { panelIds })?.handles.find(handle => !handle.blocked
    && handle.direction.reduce((dot, value, axis) => dot + value * direction[axis], 0) > 0.999)
  expect(handle, `A selection stretch along ${direction.join(', ')} should be available`).toBeDefined()
  return handle!
}

async function drag(page: Page, handle: Handle, distance: number) {
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  const delta = await page.locator('canvas').evaluate(async (canvas, { position, direction, distance }) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld()
    const origin = camera.position.clone().set(...position).multiplyScalar(0.001)
    const destination = origin.clone().add(camera.position.clone().set(...direction).multiplyScalar(distance * 0.001))
    origin.project(camera)
    destination.project(camera)
    const rect = canvas.getBoundingClientRect()
    return { x: (destination.x - origin.x) * rect.width / 2, y: (origin.y - destination.y) * rect.height / 2 }
  }, { position: handle.position, direction: handle.direction, distance })
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta.x, y + delta.y, { steps: 5 })
}

function expectStretch(before: Project, after: Project, selectedIds: string[], spanIds: string[], delta: Vec3) {
  const panels = resolvePanels(after)
  for (const original of resolvePanels(before)) {
    const current = panels.find(panel => panel.id === original.id)!
    expect(current.rotation).toEqual(original.rotation)
    expect(current.thickness).toBe(original.thickness)
    if (selectedIds.includes(original.id)) {
      expect(current.width).toBeCloseTo(original.width, 5)
      expect(current.height).toBeCloseTo(original.height, 5)
      current.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis] + delta[axis], 4))
    } else if (!spanIds.includes(original.id)) {
      expect(current.width).toBeCloseTo(original.width, 5)
      expect(current.height).toBeCloseTo(original.height, 5)
      current.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis], 5))
    }
  }
  expect(after.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type])).toEqual(
    before.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type]))
  expect(after.constraints).toEqual(before.constraints)
  expect(validateProject(after)).toEqual([])
}

test('a selected upper construction previews boundary stretch, cancels, and commits one persistent undo step', async ({ page }) => {
  const project = synthStorageShelfProject()
  const spans = project.panels.filter(panel => ['Upright 1.1', 'Upright 2.1'].includes(panel.name)).map(panel => panel.id)
  const ids = project.panels.filter(panel => !panel.name.startsWith('Storage ') && !spans.includes(panel.id)).map(panel => panel.id)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project, ids)
  const before = await saved(page)
  const handle = along(before, ids, [0, 1, 0])
  await page.screenshot({ path: 'test-results/selection-stretch-desktop-idle.png' })
  await drag(page, handle, 100)
  await expect(page.locator('.preview-resize-anchor.is-active')).toContainText('mm')
  await page.screenshot({ path: 'test-results/selection-stretch-desktop-active.png' })
  expect(await saved(page)).toEqual(before)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.preview-resize-anchor.is-active')).toHaveCount(0)
  expect(await saved(page)).toEqual(before)

  await drag(page, handle, 100)
  await page.mouse.up()
  const first = resolvePanels(before).find(panel => panel.id === ids[0])!
  await expect.poll(async () => resolvePanels(await saved(page)).find(panel => panel.id === first.id)!.position[1]).toBeGreaterThan(first.position[1] + 50)
  const after = await saved(page)
  const distance = resolvePanels(after).find(panel => panel.id === first.id)!.position[1] - first.position[1]
  expectStretch(before, after, ids, spans, [0, distance, 0])
  for (const id of spans) {
    expect(after.panels.find(panel => panel.id === id)!.width).toBeCloseTo(before.panels.find(panel => panel.id === id)!.width + distance, 4)
  }
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(after)
  expect(errors).toEqual([])
})

test('rotated shared-joint selections stretch with focused keys in a narrow viewport and retain mode guards', async ({ page }) => {
  const angle = 27 * Math.PI / 180
  const project = rotateProject(gridProject('Rotated selection stretch', [300, 300], [300]), 'z', 27)
  const ids = project.panels.filter(panel => /^Shelf [12]\.2$/.test(panel.name)).map(panel => panel.id)
  const spans = project.panels.filter(panel => panel.name.startsWith('Upright')).map(panel => panel.id)
  const direction = new Vector3(0, 1, 0).applyEuler(new Euler(0, 0, angle)).toArray() as Vec3
  await openProject(page, project, ids)
  for (const name of ['Collapse panel list', 'Collapse inspector']) {
    await page.getByRole('button', { name, exact: true }).click()
  }
  await page.setViewportSize({ width: 600, height: 900 })
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
  const before = await saved(page)
  const handle = along(before, ids, direction)
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toBeInViewport()
  await page.screenshot({ path: 'test-results/selection-stretch-narrow.png' })
  await button.focus()
  await page.keyboard.press('ArrowUp')
  const first = resolvePanels(before).find(panel => panel.id === ids[0])!
  await expect.poll(async () => resolvePanels(await saved(page)).find(panel => panel.id === first.id)!.position[1]).toBeCloseTo(first.position[1] + direction[1] * 10, 4)
  const after = await saved(page)
  expectStretch(before, after, ids, spans, direction.map(value => value * 10) as Vec3)
  await button.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => resolvePanels(await saved(page)).find(panel => panel.id === first.id)!.position[1]).toBeCloseTo(first.position[1], 4)
  expectStretch(before, await saved(page), ids, spans, [0, 0, 0])
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(page.locator('[data-resize-handle]:visible')).toHaveCount(0)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(button).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a saved boundary cut rule blocks selection stretch without creating an undo step', async ({ page }) => {
  const original = gridProject('Locked selection supports', [300, 300], [300])
  const spans = original.panels.filter(panel => panel.name.startsWith('Upright'))
  const project: Project = { ...original, constraints: spans.map(panel => ({
    id: `locked-${panel.id}`, kind: 'dimension', enabled: true, panelId: panel.id, dimension: 'width', value: panel.width,
  })) }
  const ids = project.panels.filter(panel => /^Shelf [12]\.2$/.test(panel.name)).map(panel => panel.id)
  await openProject(page, project, ids)
  const before = await saved(page)
  const handle = preparePreviewResize(before, { panelIds: ids })!.handles.find(handle => handle.direction[1] > 0.99)!
  expect(handle.blocked).toBeDefined()
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await expect(button).toHaveAttribute('aria-description', handle.blocked!.reason)
  await button.focus()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Control+ArrowUp')
  await expect(page.locator('.preview-resize-anchor.is-active')).toHaveCount(0)
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(async () => (await saved(page)).name).not.toBe(project.name)
})
