import { expect, test, type Page } from '@playwright/test'
import { createAssembly } from '../src/lib/assemblies'
import { attachPanel, createPanel, resolvePanels, validateProject } from '../src/lib/model'
import type { Project, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'

async function openProject(page: Page, project: Project, view = 'front') {
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key: STORAGE_KEY, project })
  await page.goto('/')
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(10000)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption(view)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function screenPoint(page: Page, position: Vec3) {
  return page.locator('canvas').evaluate(async (canvas, position) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld()
    const point = camera.position.clone().set(...position).multiplyScalar(0.001).project(camera)
    const rect = canvas.getBoundingClientRect()
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 }
  }, position)
}

async function cameraState(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, controls } = _roots.get(canvas).store.getState()
    const stable = (values: number[]) => values.map(value => Number(value.toFixed(10)))
    return { position: stable(camera.position.toArray()), target: stable(controls.target.toArray()), zoom: camera.zoom }
  })
}

async function beginDrag(page: Page, position: Vec3, dx = 90, dy = -45) {
  const start = await screenPoint(page, position)
  await page.mouse.move(start.x, start.y)
  await page.keyboard.down('Control')
  await page.mouse.down()
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
}

async function endDrag(page: Page) {
  await page.mouse.up()
  await page.keyboard.up('Control')
}

function freePanelProject(): Project {
  return { version: 1, name: 'Direct movement', panels: [createPanel({ name: 'Draggable panel', width: 400, height: 400, position: [0, 500, 0] })], connections: [] }
}

for (const view of ['front', 'perspective']) test(`Control-drag in ${view} moves a selected panel without moving the camera and commits one undo step`, async ({ page }) => {
  const project = freePanelProject()
  const panel = project.panels[0]
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project, view)
  const camera = await cameraState(page)
  await beginDrag(page, panel.position)
  // A preview can last longer than autosave's debounce without becoming history.
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: `test-results/preview-control-drag-${view}.png` })
  await endDrag(page)
  await expect.poll(async () => (await savedProject(page)).panels[0].position).not.toEqual(panel.position)
  const moved = await savedProject(page)
  expect(moved.panels[0].position[0]).toBeGreaterThan(panel.position[0])
  expect(moved.panels[0].position[1]).toBeGreaterThan(panel.position[1])
  const normal = camera.position.map((value, axis) => value - camera.target[axis])
  const depthChange = normal.reduce((sum, value, axis) => sum + value * (moved.panels[0].position[axis] - panel.position[axis]), 0)
  expect(depthChange).toBeCloseTo(0, 5)
  expect(moved.panels[0]).toMatchObject({ width: panel.width, height: panel.height, rotation: panel.rotation })
  expect(await cameraState(page)).toEqual(camera)
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(moved)
  await page.reload()
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  expect(await savedProject(page)).toEqual(moved)
  expect(errors).toEqual([])
})

test('Escape cancels an in-progress drag without clearing selection or adding history', async ({ page }) => {
  const project = freePanelProject()
  await openProject(page, project)
  const camera = await cameraState(page)
  await beginDrag(page, project.panels[0].position)
  await page.keyboard.press('Escape')
  await endDrag(page)
  await expect(page.getByLabel('Panel name')).toHaveValue(project.panels[0].name)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
  expect(await cameraState(page)).toEqual(camera)
  // Cancellation must release pointer capture and restore normal view controls.
  const start = await screenPoint(page, project.panels[0].position)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await cameraState(page)).target).not.toEqual(camera.target)
  expect(await savedProject(page)).toEqual(project)
})

test('Control-click without a drag keeps additive selection behavior', async ({ page }) => {
  const project = freePanelProject()
  await openProject(page, project)
  const point = await screenPoint(page, project.panels[0].position)
  await page.keyboard.down('Control')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.up('Control')
  await expect(page.getByLabel('Panel name')).not.toBeVisible()
  await page.keyboard.down('Control')
  await page.mouse.click(point.x, point.y)
  await page.keyboard.up('Control')
  await expect(page.getByLabel('Panel name')).toHaveValue(project.panels[0].name)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
})

test('dragging an assembly member translates the whole instance and preserves its shared design', async ({ page }) => {
  const parent = createPanel({ name: 'Assembly face', width: 400, height: 400, position: [0, 500, 0] })
  const connected = attachPanel({ version: 1, name: 'Assembly movement', panels: [parent], connections: [] }, parent.id,
    createPanel({ name: 'Assembly side', width: 300, height: 400 }),
    { type: '90', side: 'right', count: 2, color: '#eeeeee', flip: false, offset: 0, inset: 0 })
  const project: Project = JSON.parse(JSON.stringify(createAssembly(connected, connected.panels.map(panel => panel.id), 'Draggable assembly')))
  const unrelated = createPanel({ name: 'Stationary panel', width: 300, height: 400, position: [-750, 500, 0] })
  project.panels.push(unrelated)
  await openProject(page, project)
  await expect(page.getByLabel('Instance name', { exact: true })).toHaveValue('Draggable assembly')
  const camera = await cameraState(page)
  await beginDrag(page, parent.position, 80, -50)
  await endDrag(page)
  await expect.poll(async () => (await savedProject(page)).assemblies!.instances[0].position).not.toEqual(project.assemblies!.instances[0].position)
  const moved = await savedProject(page)
  const originalPosition = project.assemblies!.instances[0].position
  const currentPosition = moved.assemblies!.instances[0].position
  const delta = currentPosition.map((value, axis) => value - originalPosition[axis])
  expect(delta[0]).toBeGreaterThan(0)
  expect(delta[1]).toBeGreaterThan(0)
  for (const panel of resolvePanels(project).filter(panel => panel.id !== unrelated.id)) {
    const current = resolvePanels(moved).find(candidate => candidate.id === panel.id)!
    current.position.forEach((value, axis) => expect(value).toBeCloseTo(panel.position[axis] + delta[axis], 5))
    current.rotation.forEach((value, axis) => expect(value).toBeCloseTo(panel.rotation[axis], 6))
  }
  expect(moved.panels.find(panel => panel.id === unrelated.id)).toEqual(unrelated)
  expect(moved.assemblies!.definitions).toEqual(project.assemblies!.definitions)
  expect(moved.assemblies!.instances[0].panelIds).toEqual(project.assemblies!.instances[0].panelIds)
  expect(validateProject(moved).filter(issue => issue.severity === 'error')).toEqual([])
  expect(await cameraState(page)).toEqual(camera)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('exploded view prevents Control-drag from editing panels', async ({ page }) => {
  const project = freePanelProject()
  await openProject(page, project)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await beginDrag(page, project.panels[0].position)
  await endDrag(page)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
})

test('dropping near a compatible edge snaps the panel and creates an aligned attachment', async ({ page }) => {
  const fixed = createPanel({ name: 'Fixed panel', width: 400, height: 400, position: [0, 500, 0], rotation: [0, Math.PI / 2, 0] })
  const attached = attachPanel({ version: 1, name: 'Snap movement', panels: [fixed], connections: [] }, fixed.id,
    createPanel({ name: 'Moving panel', width: 400, height: 400 }),
    { type: '90', side: 'right', count: 2, color: '#eeeeee', flip: false, offset: 0, inset: 0 })
  const expected = resolvePanels(attached)[1]
  const moving = { ...expected, position: [expected.position[0] + 100, expected.position[1], expected.position[2]] as Vec3 }
  const project: Project = { ...attached, panels: [fixed, moving], connections: [] }
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Moving panel$/ }).click()
  const start = await screenPoint(page, moving.position)
  const nearTarget = await screenPoint(page, [expected.position[0] + 5, expected.position[1], expected.position[2]])
  const camera = await cameraState(page)
  await beginDrag(page, moving.position, nearTarget.x - start.x, nearTarget.y - start.y)
  await expect(page.getByText('Snapped · release to attach', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/preview-drag-snapped.png' })
  await endDrag(page)
  await expect.poll(async () => (await savedProject(page)).connections.length).toBeGreaterThan(0)
  const snapped = await savedProject(page)
  const current = resolvePanels(snapped).find(panel => panel.id === moving.id)!
  current.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.position[axis], 4))
  expect(snapped.panels).toHaveLength(2)
  expect(snapped.connections.some(connection => [connection.parentId, connection.childId].includes(fixed.id) && [connection.parentId, connection.childId].includes(moving.id))).toBe(true)
  expect(validateProject(snapped).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  expect(await cameraState(page)).toEqual(camera)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(snapped)
})
