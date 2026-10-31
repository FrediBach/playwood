import { expect, test, type Page } from '@playwright/test'
import { createPanel, createStarterProject, resolvePanels, validateProject } from '../src/lib/model'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { preparePreviewResize } from '../src/lib/preview-resize'
import type { Project, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'
type Handle = NonNullable<ReturnType<typeof preparePreviewResize>>['handles'][number]

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

async function cameraState(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, controls } = _roots.get(canvas).store.getState()
    const stable = (values: number[]) => values.map(value => Number(value.toFixed(10)))
    return { position: stable(camera.position.toArray()), target: stable(controls.target.toArray()), zoom: camera.zoom }
  })
}

function directionHandle(project: Project, selection: { panelId?: string; connectorId?: string }, direction: Vec3) {
  const session = preparePreviewResize(project, selection)
  expect(session).not.toBeNull()
  const handle = session!.handles.find(candidate => candidate.direction.reduce((dot, value, index) => dot + value * direction[index], 0) > 0.999)
  expect(handle, `A resize handle along ${direction.join(', ')} should be allowed`).toBeDefined()
  return handle!
}

async function beginResize(page: Page, handle: Handle, distance: number) {
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
  await page.mouse.move(x + delta.x, y + delta.y, { steps: 10 })
}

function freePanelProject(): Project {
  return { version: 1, name: 'Handle resizing', panels: [createPanel({ name: 'Resizable panel', width: 400, height: 400, position: [0, 500, 0] })], connections: [] }
}

function expectAnglesAndJoints(before: Project, after: Project) {
  const original = new Map(resolvePanels(before).map(panel => [panel.id, panel]))
  for (const panel of resolvePanels(after)) {
    panel.rotation.forEach((value, axis) => expect(value).toBeCloseTo(original.get(panel.id)!.rotation[axis], 6))
    expect(panel.thickness).toBe(original.get(panel.id)!.thickness)
  }
  expect(after.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type])).toEqual(
    before.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type]))
  expect(validateProject(after).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
}

for (const view of ['front', 'perspective']) test(`dragging a resize arrow in ${view} previews panel growth and commits one undo step`, async ({ page }) => {
  const project = freePanelProject()
  const panel = project.panels[0]
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project, view)
  const camera = await cameraState(page)
  const handle = directionHandle(project, { panelId: panel.id }, [1, 0, 0])
  await page.screenshot({ path: `test-results/preview-resize-idle-${view}.png` })
  await beginResize(page, handle, 100)
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: `test-results/preview-resize-active-${view}.png` })
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeGreaterThan(panel.width + 50)
  const resized = await savedProject(page)
  const current = resolvePanels(resized)[0]
  expect(current.position[0] - current.width / 2).toBeCloseTo(panel.position[0] - panel.width / 2, 5)
  expect(current.height).toBe(panel.height)
  expectAnglesAndJoints(project, resized)
  expect(await cameraState(page)).toEqual(camera)
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(resized)
  await page.reload()
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  expect(await savedProject(page)).toEqual(resized)
  expect(errors).toEqual([])
})

test('Escape cancels a resize, and the same arrow can push a panel edge inward', async ({ page }) => {
  const project = freePanelProject()
  const panel = project.panels[0]
  await openProject(page, project)
  const camera = await cameraState(page)
  const handle = directionHandle(project, { panelId: panel.id }, [1, 0, 0])
  await beginResize(page, handle, 100)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  expect(await cameraState(page)).toEqual(camera)
  await beginResize(page, handle, -60)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeLessThan(panel.width - 30)
  const pushed = resolvePanels(await savedProject(page))[0]
  expect(pushed.position[0] - pushed.width / 2).toBeCloseTo(panel.position[0] - panel.width / 2, 5)
  expect(await cameraState(page)).toEqual(camera)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  // Pointer capture and the camera must both be released after a completed drag.
  const canvas = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(canvas.x + 25, canvas.y + 25)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 90, canvas.y + 60, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await cameraState(page)).target).not.toEqual(camera.target)
})

test('pulling an interior shelf adjusts the spans above and below while keeping joints and outer shelves fixed', async ({ page }) => {
  const project = createStarterProject('shelf')
  const original = resolvePanels(project)
  const middle = original.find(panel => panel.name === 'Middle shelf')!
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Middle shelf$/ }).click()
  const camera = await cameraState(page)
  const handle = directionHandle(project, { panelId: middle.id }, [0, 1, 0])
  await page.screenshot({ path: 'test-results/preview-resize-shelf-idle.png' })
  await beginResize(page, handle, 80)
  await page.screenshot({ path: 'test-results/preview-resize-shelf-active.png' })
  await page.mouse.up()
  await expect.poll(async () => resolvePanels(await savedProject(page)).find(panel => panel.id === middle.id)!.position[1]).toBeGreaterThan(middle.position[1] + 40)
  const resized = await savedProject(page)
  const current = resolvePanels(resized)
  for (const name of ['Bottom shelf', 'Top shelf']) {
    current.find(panel => panel.name === name)!.position.forEach((value, axis) => expect(value).toBeCloseTo(original.find(panel => panel.name === name)!.position[axis], 5))
  }
  expect(current.find(panel => panel.name === 'Left side')!.width).toBeGreaterThan(original.find(panel => panel.name === 'Left side')!.width)
  expect(current.find(panel => panel.name === 'Left upper side')!.width).toBeLessThan(original.find(panel => panel.name === 'Left upper side')!.width)
  expectAnglesAndJoints(project, resized)
  expect(await cameraState(page)).toEqual(camera)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('pulling a single connector widens its connected structure without sliding the hardware', async ({ page }) => {
  const project = createStarterProject('shelf')
  const right = project.panels.find(panel => panel.name === 'Right side')!
  const piece = getPhysicalConnectors(project).find(piece => piece.connection.childId === right.id)!
  const handle = directionHandle(project, { connectorId: piece.id }, [1, 0, 0])
  await openProject(page, project)
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-row').filter({ has: page.locator(`input[aria-label*="Right side"]`) }).first().locator('.connector-list-select').click()
  const selectedId = await page.locator('.connector-list-row.selected').getAttribute('data-connector-id')
  expect(selectedId).toBe(piece.id)
  const camera = await cameraState(page)
  await beginResize(page, handle, 80)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels.some((panel, index) => Math.abs(panel.width - project.panels[index].width) > 20)).toBe(true)
  const resized = await savedProject(page)
  expect(resized.connectorOverrides).toEqual(project.connectorOverrides)
  expectAnglesAndJoints(project, resized)
  expect(await cameraState(page)).toEqual(camera)
  await expect(page.getByText('SELECTED CONNECTOR', { exact: true })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('resize handles are limited to one visible selection and disappear during attachment or exploded views', async ({ page }) => {
  const project = createStarterProject('shelf')
  await openProject(page, project)
  const handles = page.locator('[data-resize-handle]:visible')
  await expect(handles.first()).toBeVisible()
  await page.locator('.panel-list-select').nth(1).click({ modifiers: ['Shift'] })
  await expect(handles).toHaveCount(0)
  await page.locator('.panel-list-select').first().click()
  await expect(handles.first()).toBeVisible()
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(handles).toHaveCount(0)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(handles.first()).toBeVisible()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(handles).toHaveCount(0)
  await page.getByRole('button', { name: 'Panel', exact: true }).click()
  await expect(handles.first()).toBeVisible()
  await page.getByRole('button', { name: 'Hide Bottom shelf', exact: true }).click()
  await expect(handles).toHaveCount(0)
})
