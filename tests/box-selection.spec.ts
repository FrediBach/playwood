import { openInspectorSection } from './inspector-helpers'
import { expect, test, type Page } from '@playwright/test'
import { createAssembly } from '../src/lib/assemblies'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { createExampleProject } from '../src/lib/example-library'
import { createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
const boxTool = (page: Page) => page.getByRole('button', { name: 'Box select (B)', exact: true })

function boards(): Project {
  return { version: 1, name: 'Box selection', connections: [], panels: [
    createPanel({ name: 'Left board', width: 240, height: 300, position: [-400, 500, 0] }),
    createPanel({ name: 'Middle board', width: 240, height: 300, position: [0, 500, 0] }),
    createPanel({ name: 'Right board', width: 240, height: 300, position: [400, 500, 0] }),
  ] }
}

async function openProject(page: Page, project: Project) {
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify(project)), { key: storageKey, project })
  await page.goto('/')
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(10000)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
}

// Inspect actual rendered transforms, so these gestures work independently of camera fit and layout.
async function sceneSnapshot(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { Vector3 } = await import(url.replace('@react-three_fiber.js', 'three.js'))
    const state = _roots.get(canvas).store.getState()
    state.scene.updateMatrixWorld(true)
    state.camera.updateMatrixWorld()
    const rect = canvas.getBoundingClientRect()
    const panels: Record<string, { left: number; right: number; top: number; bottom: number; highlighted: boolean }> = {}
    const connectors: Record<string, { left: number; right: number; top: number; bottom: number; highlighted: boolean }> = {}
    state.scene.traverse((object: any) => {
      const kind = object.userData.panelId ? panels : object.userData.connectorId ? connectors : null
      if (!kind) return
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
      object.traverse((mesh: any) => {
        if (!mesh.isMesh) return
        mesh.geometry.computeBoundingBox()
        const box = mesh.geometry.boundingBox
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          const point = new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).project(state.camera)
          const screenX = rect.left + (point.x + 1) * rect.width / 2
          const screenY = rect.top + (1 - point.y) * rect.height / 2
          left = Math.min(left, screenX); right = Math.max(right, screenX)
          top = Math.min(top, screenY); bottom = Math.max(bottom, screenY)
        }
      })
      kind[object.userData.panelId || object.userData.connectorId] = { left, right, top, bottom,
        highlighted: kind === panels ? object.parent.children.some((child: any) => child.isLineSegments) : !!object.userData.selected }
    })
    return { panels, connectors, camera: [...state.camera.position.toArray(), ...state.camera.quaternion.toArray()], viewport: { width: state.size.width, height: state.size.height }, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
  })
}

async function startBox(page: Page, ids: string[], options: { reverse?: boolean; kind?: 'panels' | 'connectors' | 'mixed' } = {}) {
  // Mode changes resize the canvas and refit its camera asynchronously.
  // Wait for matching render/DOM sizes and a stable projection before choosing screen coordinates.
  let previous = ''
  await expect.poll(async () => {
    const state = await sceneSnapshot(page)
    const current = JSON.stringify([state.camera, state.rect, state.viewport, state.panels])
    const ready = current === previous && Math.abs(state.rect.width - state.viewport.width) < 1 && Math.abs(state.rect.height - state.viewport.height) < 1
    previous = current
    return ready
  }).toBe(true)
  const snapshot = await sceneSnapshot(page)
  const bounds = ids.map(id => options.kind === 'mixed' ? snapshot.panels[id] ?? snapshot.connectors[id] : snapshot[options.kind ?? 'panels'][id])
  const start = { x: Math.min(...bounds.map(box => box.left)) - 6, y: Math.min(...bounds.map(box => box.top)) - 6 }
  const end = { x: Math.max(...bounds.map(box => box.right)) + 6, y: Math.max(...bounds.map(box => box.bottom)) + 6 }
  await expectCanvasAt(page, options.reverse ? end : start)
  await page.mouse.move(options.reverse ? end.x : start.x, options.reverse ? end.y : start.y)
  await page.mouse.down()
  await page.mouse.move(options.reverse ? start.x : end.x, options.reverse ? start.y : end.y, { steps: 8 })
  await expect(page.locator('.box-selection-rectangle')).toBeVisible()
}

async function expectCanvasAt(page: Page, point: { x: number; y: number }) {
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS')
}

async function highlightedPanels(page: Page) {
  return Object.entries((await sceneSnapshot(page)).panels).filter(([, panel]) => panel.highlighted).map(([id]) => id).sort()
}

async function highlightedSelection(page: Page) {
  const snapshot = await sceneSnapshot(page)
  const ids = (objects: typeof snapshot.panels) => Object.entries(objects).filter(([, object]) => object.highlighted).map(([id]) => id).sort()
  return { panels: ids(snapshot.panels), connectors: ids(snapshot.connectors) }
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey)
}

async function selectByBox(page: Page, ids: string[], options: Parameters<typeof startBox>[2] = {}) {
  await page.locator('canvas').focus()
  await page.keyboard.press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'true')
  await startBox(page, ids, options)
  await page.mouse.up()
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.box-selection-rectangle')).toHaveCount(0)
}

async function selectedPanels(page: Page) {
  return page.locator('.panel-list-row.selected').evaluateAll(rows => rows.map(row => row.getAttribute('data-panel-id')).sort())
}

test('B previews and replaces selection without moving the camera, then restores navigation', async ({ page }) => {
  const project = boards(), [, middle, right] = project.panels
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project)
  const initialCamera = (await sceneSnapshot(page)).camera
  await page.locator('canvas').press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'true')
  await startBox(page, [middle.id, right.id])
  await expect.poll(() => highlightedPanels(page)).toEqual([middle.id, right.id].sort())
  expect(await selectedPanels(page)).toEqual([project.panels[0].id])
  expect((await sceneSnapshot(page)).camera).toEqual(initialCamera)
  await page.screenshot({ path: 'test-results/box-selection-preview.png' })
  await page.mouse.up()
  await expect.poll(() => selectedPanels(page)).toEqual([middle.id, right.id].sort())
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  expect((await sceneSnapshot(page)).camera).toEqual(initialCamera)

  const { rect } = await sceneSnapshot(page)
  const panStart = { x: rect.left + 30, y: rect.top + 150 }
  await expectCanvasAt(page, panStart)
  await page.mouse.move(panStart.x, panStart.y)
  await page.mouse.down()
  await page.mouse.move(panStart.x + 70, panStart.y + 35, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await sceneSnapshot(page)).camera).not.toEqual(initialCamera)
  await expect.poll(() => selectedPanels(page)).toEqual([middle.id, right.id].sort())
  expect(errors).toEqual([])
})

test('toolbar selection adds with Shift, Escape cancels mid-drag, and text fields keep B', async ({ page }) => {
  const project = boards(), [left, middle, right] = project.panels
  await openProject(page, project)
  await page.getByLabel('Panel name', { exact: true }).press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await page.locator('canvas').press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await boxTool(page).click()
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'true')
  await boxTool(page).click()
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await boxTool(page).click()
  await startBox(page, [middle.id], { reverse: true })
  await expect.poll(() => highlightedPanels(page)).toEqual([middle.id])
  // Modifiers update the live result even while the pointer remains stationary.
  await page.keyboard.down('Shift')
  await expect.poll(() => highlightedPanels(page)).toEqual([left.id, middle.id].sort())
  await page.keyboard.up('Shift')
  await expect.poll(() => highlightedPanels(page)).toEqual([middle.id])
  await page.keyboard.down('Shift')
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => selectedPanels(page)).toEqual([left.id, middle.id].sort())

  await page.locator('canvas').press('b')
  await startBox(page, [right.id])
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.box-selection-rectangle')).toHaveCount(0)
  await expect.poll(() => selectedPanels(page)).toEqual([left.id, middle.id].sort())

  await selectByBox(page, [right.id], { reverse: true })
  await expect.poll(() => selectedPanels(page)).toEqual([right.id])
  await page.locator('canvas').press('b')
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedPanels(page)).toEqual([right.id])
})

test('boxes select occluded panels, exclude hidden panels, and require full enclosure', async ({ page }) => {
  const project = boards(), middle = project.panels[1]
  const behind = createPanel({ name: 'Behind middle', width: 200, height: 260, position: [0, 500, -100] })
  const hidden = createPanel({ name: 'Hidden middle', width: 200, height: 260, position: [0, 500, 100], visible: false })
  project.panels.push(behind, hidden)
  await openProject(page, project)
  await selectByBox(page, [middle.id])
  await expect.poll(() => selectedPanels(page)).toEqual([middle.id, behind.id].sort())
  await expect(page.getByRole('checkbox', { name: 'Select Hidden middle', exact: true })).not.toBeChecked()

  const bound = (await sceneSnapshot(page)).panels[middle.id]
  await page.locator('canvas').press('b')
  await page.mouse.move(bound.left - 5, bound.top - 5)
  await page.mouse.down()
  await page.mouse.move((bound.left + bound.right) / 2, bound.bottom + 5, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => selectedPanels(page)).toEqual([])
})

test('boxing an assembly member selects the whole instance', async ({ page }) => {
  const cube = createExampleProject('cube')
  const project = createAssembly(cube, cube.panels.map(panel => panel.id), 'Selection box')
  const instance = project.assemblies!.instances[0]
  await openProject(page, project)
  await page.locator('canvas').press('Escape')
  const members = Object.values(instance.panelIds)
  const snapshot = await sceneSnapshot(page)
  const target = members.sort((a, b) => {
    const first = snapshot.panels[a], second = snapshot.panels[b]
    return (first.right - first.left) * (first.bottom - first.top) - (second.right - second.left) * (second.bottom - second.top)
  })[0]
  await selectByBox(page, [target])
  await expect(page.getByLabel('Instance name', { exact: true })).toHaveValue('Selection box')
  await expect.poll(async () => Object.entries((await sceneSnapshot(page)).panels).filter(([, panel]) => panel.highlighted).map(([id]) => id).sort()).toEqual(members.sort())
})

test('mixed box selection follows the active tab and edits only its inspected category', async ({ page }, testInfo) => {
  const project = createExampleProject('cube')
  project.panels = project.panels.map(panel => ({ ...panel, color: '#d9bb87' }))
  await openProject(page, project)
  await page.getByRole('tab', { name: /Connectors/ }).click()
  await page.locator('.connector-list-select').first().click()
  const snapshot = await sceneSnapshot(page)
  const selection = { panels: Object.keys(snapshot.panels).sort(), connectors: Object.keys(snapshot.connectors).sort() }
  expect(selection.connectors.length).toBeGreaterThan(1)
  await page.locator('canvas').press('b')
  await startBox(page, [...selection.panels, ...selection.connectors], { kind: 'mixed' })
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await page.screenshot({ path: testInfo.outputPath('mixed-preview.png') })
  await page.mouse.up()
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await expect(page.locator('.connector-list-row.selected')).toHaveCount(selection.connectors.length)
  await expect(page.getByRole('heading', { name: `${selection.connectors.length} connectors`, exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mixed-connectors.png') })

  await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${selection.panels.length} panels selected`, exact: true })).toBeVisible()
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await page.screenshot({ path: testInfo.outputPath('mixed-panels.png') })
  await openInspectorSection(page, 'Material & finish')
  await page.getByRole('button', { name: 'Terracotta finish', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).panels.every(panel => panel.color === '#bc6c50')).toBe(true)
  expect(getPhysicalConnectors(await savedProject(page))).toEqual(getPhysicalConnectors(project))

  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await expect(page.getByRole('heading', { name: `${selection.connectors.length} connectors`, exact: true })).toBeVisible()
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await page.getByRole('button', { name: 'Blue connector color', exact: true }).click()
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).every(connector => connector.color === '#0000ff')).toBe(true)
  expect((await savedProject(page)).panels.every(panel => panel.color === '#bc6c50')).toBe(true)
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)

  // Keyboard actions follow the inspector too, preserving the other selected category.
  await page.locator('canvas').press('Delete')
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).length).toBe(0)
  await expect.poll(() => highlightedSelection(page)).toEqual({ panels: selection.panels, connectors: [] })
  expect((await savedProject(page)).panels).toHaveLength(selection.panels.length)
})

test('inspecting boxed connectors leaves shared assembly editing and preserves the mixed selection', async ({ page }) => {
  const cube = createExampleProject('cube')
  const project = createAssembly(cube, cube.panels.map(panel => panel.id), 'Shared box')
  await openProject(page, project)
  await page.getByRole('button', { name: 'Edit shared design', exact: true }).click()
  await expect(page.locator('.assembly-edit-breadcrumb')).toBeVisible()
  const snapshot = await sceneSnapshot(page)
  const selection = { panels: Object.keys(snapshot.panels).sort(), connectors: Object.keys(snapshot.connectors).sort() }
  await selectByBox(page, [...selection.panels, ...selection.connectors], { kind: 'mixed' })
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await expect(page.getByRole('tab', { name: 'Panels', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.assembly-edit-breadcrumb')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Done editing', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await expect(page.locator('.assembly-edit-breadcrumb')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Done editing', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Connector type', exact: true })).toBeVisible()
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)

  await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  await page.getByRole('button', { name: 'Edit shared design', exact: true }).click()
  await expect(page.locator('.assembly-edit-breadcrumb')).toBeVisible()
  await expect.poll(() => highlightedSelection(page)).toEqual({ panels: selection.panels, connectors: [] })
  await selectByBox(page, [selection.connectors[0]], { kind: 'connectors' })
  await expect(page.getByRole('tab', { name: 'Panels', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.assembly-edit-breadcrumb')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Done editing', exact: true })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Connector type', exact: true })).toBeVisible()
  await expect.poll(() => highlightedPanels(page)).toEqual([])
  await expect.poll(async () => (await highlightedSelection(page)).connectors).toContain(selection.connectors[0])
  await page.getByRole('button', { name: 'Blue connector color', exact: true }).click()
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).find(connector => connector.id === selection.connectors[0])?.color).toBe('#0000ff')
  expect((await savedProject(page)).assemblies!.definitions).toEqual(project.assemblies!.definitions)
})

test('single-category box results show their inspector even when the opposite tab is active', async ({ page }) => {
  const project = createExampleProject('cube')
  const loose = createPanel({ name: 'Isolated board', width: 240, height: 300, position: [1200, 500, 0] })
  project.panels.push(loose)
  await openProject(page, project)
  const connectorId = Object.keys((await sceneSnapshot(page)).connectors)[0]
  await expect(page.getByRole('tab', { name: 'Panels', exact: true })).toHaveAttribute('aria-selected', 'true')
  await selectByBox(page, [connectorId], { kind: 'connectors' })
  await expect.poll(async () => (await highlightedSelection(page)).connectors).toContain(connectorId)
  await expect.poll(() => highlightedPanels(page)).toEqual([])
  await expect(page.getByRole('group', { name: 'Connector type', exact: true })).toBeVisible()
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Panels', exact: true })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await selectByBox(page, [loose.id])
  await expect.poll(() => highlightedSelection(page)).toEqual({ panels: [loose.id], connectors: [] })
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue(loose.name)
  await expect(page.getByRole('group', { name: 'Connector color', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Connectors', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('Shift unions panels and connectors and Escape restores the complete mixed selection', async ({ page }) => {
  const project = createExampleProject('cube')
  const loose = createPanel({ name: 'Isolated board', width: 240, height: 300, position: [1200, 500, 0] })
  project.panels.push(loose)
  await openProject(page, project)
  await selectByBox(page, [loose.id])
  const snapshot = await sceneSnapshot(page)
  const selection = { panels: Object.keys(snapshot.panels).sort(), connectors: Object.keys(snapshot.connectors).sort() }
  await page.locator('canvas').press('b')
  await page.keyboard.down('Shift')
  await startBox(page, [...selection.panels.filter(id => id !== loose.id), ...selection.connectors], { kind: 'mixed' })
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await expect(page.getByRole('heading', { name: `${selection.panels.length} panels selected`, exact: true })).toBeVisible()

  await page.locator('canvas').press('b')
  await startBox(page, [selection.connectors[0]], { kind: 'connectors' })
  await expect.poll(() => highlightedPanels(page)).toEqual([])
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(() => highlightedSelection(page)).toEqual(selection)
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
})

test('attachment previews and dialogs disable the box-selection shortcut', async ({ page }) => {
  const project = boards()
  await openProject(page, project)
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(boxTool(page)).toBeDisabled()
  await page.locator('canvas').press('b')
  await expect(boxTool(page)).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(boxTool(page)).toBeEnabled()

  await boxTool(page).click()
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const hiddenTool = page.locator('[aria-label="Box select (B)"]')
  await expect(hiddenTool).toBeDisabled()
  await page.locator('canvas').dispatchEvent('keydown', { key: 'b', bubbles: true })
  await expect(hiddenTool).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(boxTool(page)).toBeEnabled()
  await expect.poll(() => selectedPanels(page)).toEqual([project.panels[0].id])
})

test('box selection works in perspective and realistic views', async ({ page }) => {
  const project = boards(), ids = project.panels.map(panel => panel.id).sort()
  await openProject(page, project)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective')
  await selectByBox(page, ids)
  await expect.poll(() => selectedPanels(page)).toEqual(ids)
  await page.locator('canvas').press('Escape')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await selectByBox(page, ids)
  await expect.poll(() => highlightedPanels(page)).toEqual(ids)
  await expect(page.getByRole('button', { name: 'Realistic preview', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
