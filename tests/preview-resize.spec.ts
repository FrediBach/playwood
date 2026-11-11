import { panelSnapPoints } from '../src/lib/preview-snap'
import { expect, test, type Page } from './browser-fixture'
import { createPanel, createStarterProject, getProjectBounds, parseProject, resolvePanels, validateProject } from '../src/lib/model'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { preparePreviewResize } from '../src/lib/preview-resize'
import { hTableProject } from '../src/lib/example-geometry'
import { islandProject } from '../src/lib/platform-examples'
import { autoConnect } from '../src/lib/auto-connect'
import endShelves from '../src/test/fixtures/h-table-end-shelves.json' with { type: 'json' }
import fixedCuts from '../src/test/fixtures/h-table-fixed-cuts.json' with { type: 'json' }
import fixedGaps from '../src/test/fixtures/h-table-fixed-gaps.json' with { type: 'json' }
import hTable from '../src/test/fixtures/h-table-auto-connect.json' with { type: 'json' }
import type { Project, Vec3 } from '../src/lib/types'

import { readFileSync } from 'node:fs'
const cornerShelf = JSON.parse(readFileSync(new URL('../src/lib/fixtures/everyday-shelf-corner.json', import.meta.url), 'utf8'))

const STORAGE_KEY = 'playwood-studio-project-v1'

test('raising the table middle shelf keeps the back panels and desktop fixed through undo and reload', async ({ page }) => {
  let project = parseProject(hTable)
  for (const side of ['Left', 'Right']) {
    project = autoConnect(project, project.panels.filter(panel => [`${side} front leg`, `${side} rear leg`].includes(panel.name)).map(panel => panel.id)).project
  }
  await openProject(page, project)
  await page.getByRole('button', { name: 'Center divider', exact: true }).click()
  const before = await savedProject(page)
  const shelf = resolvePanels(before).find(panel => panel.name === 'Center divider')!
  const handle = directionHandle(before, { panelId: shelf.id }, [0, 1, 0])
  await beginResize(page, handle, 60)
  await page.mouse.up()
  await expect.poll(async () => resolvePanels(await savedProject(page)).find(panel => panel.id === shelf.id)!.position[1]).toBeGreaterThan(shelf.position[1] + 30)
  const after = await savedProject(page)
  const panels = resolvePanels(after)
  const distance = panels.find(panel => panel.id === shelf.id)!.position[1] - shelf.position[1]
  for (const original of resolvePanels(before)) {
    const current = panels.find(panel => panel.id === original.id)!
    const split = /^(Left|Right) rear leg/.test(original.name)
    expect(current.position[1], original.name).toBeCloseTo(original.position[1] + (original.id === shelf.id ? distance : split ? distance / 2 : 0), 4)
    expect(current.height, original.name).toBeCloseTo(original.height + (split ? original.name.endsWith('(section)') ? -distance : distance : 0), 4)
  }
  expectAnglesAndJoints(before, after)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(after)
  await page.reload()
  expect(await savedProject(page)).toEqual(after)
})

test('leg resize keeps the H-table end shelf cuts aligned through undo and reload', async ({ page }) => {
  const project = parseProject(endShelves)
  await openProject(page, project)
  await page.getByRole('button', { name: 'Left rear leg', exact: true }).click()
  const before = await savedProject(page)
  const leg = before.panels.find(panel => panel.name === 'Left rear leg')!
  await beginResize(page, directionHandle(before, { panelId: leg.id }, [1, 0, 0]), 100)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels.find(panel => panel.id === leg.id)!.position[0]).toBeGreaterThan(leg.position[0] + 50)
  const after = await savedProject(page)
  const distance = after.panels.find(panel => panel.id === leg.id)!.position[0] - leg.position[0]
  for (const original of before.panels.filter(panel => panel.position[0] < -1000)) {
    const current = after.panels.find(panel => panel.id === original.id)!
    expect(current.height, original.name).toBeCloseTo(original.height + distance, 4)
    expect(current.position[0], original.name).toBeCloseTo(original.position[0] + distance / 2, 4)
  }
  expectAnglesAndJoints(before, after)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(after)
  await page.reload()
  expect(await savedProject(page)).toEqual(after)
})

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
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true })
  await expect.poll(async () => Number(await width.inputValue())).toBeGreaterThan(panel.width + 50)
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue(String(panel.height))
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: `test-results/preview-resize-active-${view}.png` })
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeGreaterThan(panel.width + 50)
  const resized = await savedProject(page)
  const current = resolvePanels(resized)[0]
  await expect(width).toHaveValue(String(Math.round(current.width * 10) / 10))
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
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true })
  await expect.poll(async () => Number(await width.inputValue())).toBeGreaterThan(panel.width + 50)
  await page.keyboard.press('Escape')
  await expect(width).toHaveValue(String(panel.width))
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
  await expect(page.getByRole('heading', { name: / connector$/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('single-panel handles switch with selection and disappear during attachment or exploded views', async ({ page }) => {
  const project = createStarterProject('shelf')
  await openProject(page, project)
  const handles = page.locator('[data-resize-handle]:visible')
  await expect(handles.first()).toBeVisible()
  await page.locator('.panel-list-select').nth(1).click({ modifiers: ['Shift'] })
  await expect(page.locator('[data-resize-handle^="panel-"]:visible')).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Show wireframe of Bottom shelf', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Bottom shelf', exact: true }).click()
  await expect(handles).toHaveCount(0)
})


test('Shift-drag resizes only a shelf edge and can be undone', async ({ page }) => {
  const project = createStarterProject()
  const middle = resolvePanels(project).find(panel => panel.name === 'Middle shelf')!
  const handle = preparePreviewResize(project, { panelId: middle.id })!.handles.find(handle => handle.id === 'panel-height-positive')!
  await openProject(page, project, 'perspective')
  await page.locator('.panel-list-select').filter({ hasText: /^Middle shelf$/ }).click()
  await page.keyboard.down('Shift')
  await beginResize(page, handle, 80)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await savedProject(page)).panels.find(panel => panel.id === middle.id)!.height).toBeGreaterThan(middle.height + 40)
  const resized = await savedProject(page)
  for (const old of resolvePanels(project).filter(panel => panel.id !== middle.id)) {
    const next = resolvePanels(resized).find(panel => panel.id === old.id)!
    expect(next.width).toBeCloseTo(old.width, 5)
    expect(next.height).toBeCloseTo(old.height, 5)
    next.position.forEach((value, axis) => expect(value).toBeCloseTo(old.position[axis], 5))
  }
  expectAnglesAndJoints(project, resized)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})


test('blocked arrows show blockers on hover and keyboard focus without editing the project', async ({ page }) => {
  const project = parseProject(cornerShelf)
  const neighbor = project.panels.find(panel => panel.name === 'Left side copy')!
  project.constraints = [{ id: 'fixed-neighbor', kind: 'dimension', enabled: true, panelId: neighbor.id, dimension: 'height', value: neighbor.height }]
  const selected = project.panels.find(panel => panel.name === 'Right side copy')!
  project.constraints.push({ id: 'equal-neighbors', kind: 'equal-dimension', enabled: true, panelIds: [selected.id, neighbor.id], dimension: 'height' })
  const handle = directionHandle(project, { panelId: selected.id }, [-1, 0, 0])
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Right side copy$/ }).click()
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await expect(button).toHaveCSS('color', 'rgb(133, 129, 123)')
  const highlights = () => page.locator('canvas').evaluate(async (canvas, neighborId) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const result = { panel: false, connectors: [] as string[] }
    _roots.get(canvas).store.getState().scene.traverse((object: any) => {
      if (object.userData.panelId === neighborId) result.panel = object.parent.children.some((child: any) => child.isLineSegments)
      if (object.userData.connectorId && object.userData.selected) result.connectors.push(object.userData.connectorId)
    })
    return result
  }, neighbor.id)
  await button.hover()
  await expect.poll(highlights).toEqual({ panel: true, connectors: expect.arrayContaining(handle.blocked!.connectorIds) })
  await page.screenshot({ path: 'test-results/resize-blockers-hover.png' })
  await page.mouse.move(5, 5)
  await expect.poll(highlights).toEqual({ panel: false, connectors: [] })
  await button.focus()
  await expect.poll(highlights).toEqual({ panel: true, connectors: expect.arrayContaining(handle.blocked!.connectorIds) })
  await button.press('ArrowRight')
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('combobox', { name: 'Camera view' }).focus()
  await expect.poll(highlights).toEqual({ panel: false, connectors: [] })
})

test('Shift-drag keeps a corner shelf neighbor and its hardware fixed', async ({ page }) => {
  const project = parseProject(cornerShelf)
  const neighbor = project.panels.find(panel => panel.name === 'Left side copy')!
  project.constraints = [{ id: 'fixed-neighbor', kind: 'dimension', enabled: true, panelId: neighbor.id, dimension: 'height', value: neighbor.height }]
  const selected = project.panels.find(panel => panel.name === 'Right side copy')!
  const handle = directionHandle(project, { panelId: selected.id }, [-1, 0, 0])
  expect(handle.repeatOnly).toBe(true)
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Right side copy$/ }).click()
  await page.keyboard.down('Shift')
  await beginResize(page, handle, 100)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(project)
  await beginResize(page, handle, 100)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await savedProject(page)).panels.find(panel => panel.id === selected.id)!.height).toBeGreaterThan(selected.height + 50)
  const resized = await savedProject(page)
  for (const old of resolvePanels(project).filter(panel => panel.id !== selected.id)) {
    const next = resolvePanels(resized).find(panel => panel.id === old.id)!
    expect(next.width).toBeCloseTo(old.width, 5)
    expect(next.height).toBeCloseTo(old.height, 5)
    next.position.forEach((value, axis) => expect(value).toBeCloseTo(old.position[axis], 5))
  }
  expectAnglesAndJoints(project, resized)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(resized)
  await page.reload()
  expect(await savedProject(page)).toEqual(resized)
})


test('a connected corner wing grows its attached side panels', async ({ page }) => {
  const project = parseProject(JSON.parse(readFileSync(new URL('../src/lib/fixtures/everyday-shelf-connected-corner.json', import.meta.url), 'utf8')))
  const panel = project.panels.find(panel => panel.name === 'Bottom shelf copy')!
  const handle = directionHandle(project, { panelId: panel.id }, [1, 0, 0])
  await openProject(page, project, 'perspective')
  await page.locator('.panel-list-select').filter({ hasText: /^Bottom shelf copy$/ }).click()
  await beginResize(page, handle, 100)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(project)
  await beginResize(page, handle, 100)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels.find(p => p.id === panel.id)!.height).toBeGreaterThan(panel.height + 50)
  const resized = await savedProject(page)
  expectAnglesAndJoints(project, resized)
  for (const name of ['Right side copy', 'Left side copy', 'Middle shelf copy']) {
    expect(resized.panels.find(p => p.name === name)!.height).toBeGreaterThan(project.panels.find(p => p.name === name)!.height + 50)
  }
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(resized)
  await page.reload()
  expect(await savedProject(page)).toEqual(resized)
})


for (const distance of [-50, 50]) test(`moving the H-table desktop arrow by ${distance} preserves the feet with fixed shelf gaps`, async ({ page }) => {
  const project = parseProject(distance < 0 ? fixedCuts : fixedGaps)
  const desktop = project.panels.find(panel => panel.name === 'Desktop')!
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Desktop$/ }).click()
  const handle = directionHandle(project, { panelId: desktop.id }, [0, Math.sign(distance), 0])
  await beginResize(page, handle, Math.abs(distance))
  await page.mouse.up()
  await expect.poll(async () => (resolvePanels(await savedProject(page)).find(panel => panel.id === desktop.id)!.position[1] - desktop.position[1]) * Math.sign(distance)).toBeGreaterThan(20)
  const after = resolvePanels(await savedProject(page))
  for (const panel of project.panels.filter(panel => /leg$|spine/i.test(panel.name))) {
    expect(getProjectBounds([after.find(candidate => candidate.id === panel.id)!]).min[1], panel.name)
      .toBeCloseTo(getProjectBounds([panel]).min[1], 4)
  }
  expectAnglesAndJoints(project, await savedProject(page))
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

for (const example of ['H-table', 'Island display', 'Island depth']) for (const [worker, viewport] of [[false, 1440], [true, 1440], [false, 390], [true, 390]] as const) test(`${example} connected edge ${worker ? 'worker' : 'main thread'} at ${viewport}px grows the structure and commits once`, async ({ page }) => {
  await page.setViewportSize({ width: viewport, height: 900 })
  let project = example === 'H-table' ? hTableProject('H-table', 1800) : islandProject()
  const dimension = example === 'Island depth' ? 'height' : 'width'
  const name = example === 'H-table' ? 'Desktop' : 'Island base'
  if (worker) project = { ...project, panels: [...project.panels, ...Array.from({ length: 12 - project.panels.length }, (_, i) =>
    createPanel({ id: `unrelated-${i}`, visible: false, position: [5000 + i * 1000, 800, 0] }))] }
  project = parseProject(project)
  const panel = project.panels.find(p => p.name === name)!
  await openProject(page, project, 'perspective')
  if (viewport < 680) await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
  if (viewport < 680) {
    await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
    const closeInspector = page.getByRole('button', { name: 'Collapse inspector', exact: true })
    if (await closeInspector.isVisible()) await closeInspector.click()
  }
  const handle = preparePreviewResize(project, { panelId: panel.id })!.handles.find(item => item.id === `panel-${dimension}-positive`)!
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await button.click()
  expect(await savedProject(page)).toEqual(project)
  await beginResize(page, handle, 100)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(project)
  await expect(page.locator('.preview-resize-anchor.is-active')).toHaveCount(0)
  await beginResize(page, handle, 100)
  expect(await savedProject(page)).toEqual(project)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels.find(p => p.id === panel.id)![dimension]).toBeGreaterThan(panel[dimension] + 50)
  await expect(page.getByRole('dialog', { name: 'Review resize alternatives' })).toHaveCount(0)
  const after = await savedProject(page)
  const growth = after.panels.find(p => p.id === panel.id)![dimension] - panel[dimension]
  if (example === 'H-table') {
    for (const side of ['Left', 'Right']) {
      const pair = (source: Project) => source.panels.filter(p => [`${side} front leg`, `${side} rear leg`].includes(p.name)).reduce((sum, p) => sum + p.width, 0)
      expect(pair(after) - pair(project), `${side} split-leg span`).toBeCloseTo(growth, 4)
      for (const end of ['front', 'rear']) {
        const old = project.panels.find(p => p.name === `${side} ${end} leg`)!
        expect(after.panels.find(p => p.id === old.id)!.width - old.width).toBeCloseTo(growth / 2, 4)
      }
    }
  } else for (const name of dimension === 'height' ? ['Island middle platform'] : ['Island middle platform', 'Island upper shelf']) {
    const old = project.panels.find(p => p.name === name)!, current = after.panels.find(p => p.name === name)!
    expect(current[dimension] - old[dimension], name).toBeCloseTo(growth, 4)
  }
  if (example !== 'H-table') {
    const panels = resolvePanels(after), upper = panels.find(p => p.name === 'Island upper shelf')!
    const base = panels.find(p => p.id === panel.id)!
    expect(upper.position[0]).toBeCloseTo(base.position[0], 4)
    expect(upper.position[2]).toBeCloseTo(base.position[2], 4)
    expect(upper.height).toBeCloseTo(350, 4)
  }
  expectAnglesAndJoints(project, after)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(after)
  await page.reload()
  expect(await savedProject(page)).toEqual(after)
})

for (const worker of [false, true]) test(`pulling a downward arrow stops at ground (worker=${worker}) and the toggle releases it`, async ({ page }) => {
  const project = freePanelProject()
  project.panels[0].position[1] = 250
  if (worker) for (let index = 0; index < 11; index++) project.panels.push(createPanel({ name: `Hidden ${index}`, visible: false, position: [2000 + index * 500, 1000, 0] }))
  await openProject(page, project)
  const id = project.panels[0].id
  const handle = directionHandle(project, { panelId: id }, [0, -1, 0])
  await beginResize(page, handle, 150)
  await page.mouse.up()
  await expect.poll(async () => panelSnapPoints(resolvePanels(await savedProject(page)).find(panel => panel.id === id)!)[0][1]).toBeCloseTo(0, 3)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Keep above ground', exact: true }).click()
  await beginResize(page, handle, 150)
  await page.mouse.up()
  await expect.poll(async () => panelSnapPoints(resolvePanels(await savedProject(page)).find(panel => panel.id === id)!)[0][1]).toBeLessThan(-90)
})
