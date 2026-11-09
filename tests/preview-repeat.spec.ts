import { expect, test, type Page } from './browser-fixture'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { gridProject } from '../src/lib/example-geometry'
import { createPanel, getProjectBounds, moveProject, parseProject, resolvePanels, validateProject } from '../src/lib/model'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { CONNECTOR_LOCAL_BOUNDS } from '../src/lib/connector-bounds'
import { connectorSlide, getConnectorRail } from '../src/lib/connector-movement'
import { samePanelPlacement } from '../src/lib/assembly-placement'
import { preparePreviewResize } from '../src/lib/preview-resize'
import type { Project, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'
const PITCH = 385

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function settleScene(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
}

async function openCube(page: Page, project = gridProject('Repeat cubby', [350], [350]), view = 'front', panelName = 'Shelf 1.2', direction: Vec3 = [1, 0, 0]) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'repeat.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption(view)
  await page.locator('.panel-list-select').getByText(panelName, { exact: true }).click()
  // Leave enough space to see two added compartments without moving the camera mid-gesture.
  for (let index = 0; index < 8; index++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await settleScene(page)
  const panel = project.panels.find(panel => panel.name === panelName)!
  const handle = preparePreviewResize(project, { panelId: panel.id })!.handles.find(handle => handle.direction.reduce((sum, value, axis) => sum + value * direction[axis], 0) > .999)!
  expect(handle).toBeDefined()
  return { project, panel, handle }
}

async function beginRepeat(page: Page, handle: NonNullable<ReturnType<typeof preparePreviewResize>>['handles'][number]) {
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const start = await page.locator('canvas').evaluate(async (canvas, { handle, origin }) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, raycaster: sceneRaycaster } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld()
    const root = camera.position.clone().set(...handle.position).multiplyScalar(.001)
    const axis = camera.position.clone().set(...handle.direction).normalize()
    const normal = camera.isOrthographicCamera ? camera.getWorldDirection(camera.position.clone()) : root.clone().sub(camera.position).normalize()
    normal.addScaledVector(axis, -normal.dot(axis)).normalize()
    const rect = canvas.getBoundingClientRect()
    const raycaster = new sceneRaycaster.constructor()
    raycaster.setFromCamera({ x: (origin.x - rect.left) / rect.width * 2 - 1, y: 1 - (origin.y - rect.top) / rect.height * 2 }, camera)
    const ray = raycaster.ray
    const length = root.clone().sub(ray.origin).dot(normal) / ray.direction.dot(normal)
    return ray.origin.clone().addScaledVector(ray.direction, length).toArray()
  }, { handle, origin })
  await page.keyboard.down('Control')
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  return async (distance: number) => {
    const destination = await page.locator('canvas').evaluate(async (canvas, { start, direction, distance }) => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
      const { _roots } = await import(url)
      const { camera } = _roots.get(canvas).store.getState()
      const point = camera.position.clone().set(...start).addScaledVector(camera.position.clone().set(...direction), distance * .001).project(camera)
      const rect = canvas.getBoundingClientRect()
      return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }
    }, { start, direction: handle.direction, distance })
    await page.mouse.move(destination.x, destination.y, { steps: 8 })
  }
}

async function releaseRepeat(page: Page) {
  await page.mouse.up()
  await page.keyboard.up('Control')
}

async function exportedProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

test('Control-pull previews two connected bays and saves one undoable, exportable edit', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { project, panel, handle } = await openCube(page)
  const move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  // A preview lasting beyond the autosave debounce must still leave the saved model alone.
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: 'test-results/preview-repeat-two-bays.png' })
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(10)
  const repeated = await savedProject(page)
  const resolved = resolvePanels(repeated)
  for (const before of resolvePanels(project)) {
    const after = resolved.find(panel => panel.id === before.id)!
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    after.position.forEach((value, axis) => expect(value).toBeCloseTo(before.position[axis], 5))
  }
  expect(repeated.connections.some(connection => connection.type === 't')).toBe(true)
  expect(getPhysicalConnectors(repeated)).toHaveLength(16)
  expect(validateProject(repeated)).toEqual([])
  expect(parseProject(repeated)).toEqual(repeated)
  await expect(page.getByLabel('Panel name')).toHaveValue(`${panel.name} (repeat 2)`)
  await page.screenshot({ path: 'test-results/preview-repeat-committed.png' })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  expect(await exportedProject(page)).toEqual(repeated)
  expect(errors).toEqual([])
})

test('pulling back retracts preview bays and Escape restores the original selection', async ({ page }) => {
  const { project, panel, handle } = await openCube(page)
  let move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await move(0)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 0 bays' })).toBeVisible()
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)

  move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await page.keyboard.press('Escape')
  await releaseRepeat(page)
  await expect(page.locator('.preview-resize-anchor.is-active')).toHaveCount(0)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)

  // Pointer capture and the source snapshot are reusable immediately after cancellation.
  move = await beginRepeat(page, handle)
  await move(PITCH)
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(7)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('a focused arrow supports consecutive Control-keyboard repetitions in perspective view', async ({ page }) => {
  const { project, handle } = await openCube(page, undefined, 'perspective')
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await button.focus()
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(7)
  const first = await savedProject(page)
  expect(validateProject(first)).toEqual([])
  await expect(page.getByLabel('Panel name')).toHaveValue('Shelf 1.2 (repeat 1)')
  await expect(button).toBeFocused()
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(10)
  expect(validateProject(await savedProject(page))).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(first)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('a repeat that intersects another panel stops without changing the construction', async ({ page }) => {
  const cube = gridProject('Blocked repeat', [350], [350])
  const obstacle = createPanel({ name: 'Obstacle', width: 300, height: 600, position: [385, 309, 0] })
  const { project, handle } = await openCube(page, { ...cube, panels: [...cube.panels, obstacle] })
  const move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption.is-limited')).toBeVisible()
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByLabel('Panel name')).toHaveValue('Shelf 1.2')
})

test('repeat feedback stays inside a narrow workspace with the inspectors closed', async ({ page }) => {
  const { project, handle } = await openCube(page)
  await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await settleScene(page)
  const move = await beginRepeat(page, handle)
  await move(PITCH)
  const caption = page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })
  await expect(caption).toBeVisible()
  const box = (await caption.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/preview-repeat-narrow.png' })
  await page.keyboard.press('Escape')
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)
})

function expectSourcePanelsUnchanged(original: Project, result: Project) {
  const current = new Map(resolvePanels(result).map(panel => [panel.id, panel]))
  for (const panel of resolvePanels(original)) {
    const after = current.get(panel.id)!
    expect(after.width).toBe(panel.width)
    expect(after.height).toBe(panel.height)
    expect(after.thickness).toBe(panel.thickness)
    after.position.forEach((value, axis) => expect(value).toBeCloseTo(panel.position[axis], 5))
    after.rotation.forEach((value, axis) => expect(value).toBeCloseTo(panel.rotation[axis], 5))
  }
}

function installedHardware(project: Project) {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const placement = rail.placements[piece.index]
    const position = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
    const rotation = new Quaternion().setFromEuler(new Euler(...placement.rotation))
    const matrix = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation))
    return { id: piece.id, type: piece.type, position: position.toArray(), parts: CONNECTOR_LOCAL_BOUNDS[piece.type].map(bounds => {
      const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max)
      // CAD part envelopes independently check the installed positions, including saved slides.
      // Ignore only 0.1 mm of face contact and exported-coordinate rounding.
      return new OBB(min.clone().add(max).multiplyScalar(.5).applyQuaternion(rotation).add(position),
        max.sub(min).multiplyScalar(.5).addScalar(-.05), matrix.clone())
    }) }
  })
}

function hardwareOverlaps(project: Project) {
  const pieces = installedHardware(project)
  return pieces.flatMap((piece, index) => pieces.slice(index + 1).flatMap(other =>
    piece.parts.some(part => other.parts.some(otherPart => part.intersectsOBB(otherPart, 1e-8)))
      ? [`${piece.type} ${piece.id} overlaps ${other.type} ${other.id}`] : []))
}

for (const { sign, view, label } of [
  { sign: 1, view: 'right', label: 'forward' },
  { sign: -1, view: 'perspective', label: 'backward' },
] as const) test(`Control-pull repeats ${label} in depth, cancels cached bays, and continues from the new top`, async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { project, panel, handle } = await openCube(page, undefined, view, 'Shelf 1.2', [0, 0, sign])
  let move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: `test-results/preview-repeat-depth-${label}.png` })
  await page.keyboard.press('Escape')
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)

  move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(14)
  const repeated = await savedProject(page)
  expectSourcePanelsUnchanged(project, repeated)
  expect(getPhysicalConnectors(repeated)).toHaveLength(40)
  expect(hardwareOverlaps(repeated)).toEqual([])
  expect(validateProject(repeated)).toEqual([])
  const edge = sign > 0 ? 'max' : 'min'
  expect(getProjectBounds(resolvePanels(repeated))[edge][2] - getProjectBounds(resolvePanels(project))[edge][2]).toBeCloseTo(sign * PITCH * 2, 5)
  await expect(page.getByLabel('Panel name')).toHaveValue(`${panel.name} (repeat 2)`)
  await expect(page.locator(`[data-resize-handle="${handle.id}"]`)).toBeFocused()
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(19)
  const continued = await savedProject(page)
  expect(validateProject(continued)).toEqual([])
  expect(hardwareOverlaps(continued)).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  expect(parseProject(await savedProject(page))).toEqual(repeated)
  const exported = await exportedProject(page)
  expect(exported).toEqual(repeated)
  expect(hardwareOverlaps(exported)).toEqual([])
  expect(errors).toEqual([])
})

for (const { sign, panelName, label, elevation } of [
  { sign: 1, panelName: 'Shelf 1.2', label: 'upward', elevation: 0 },
  { sign: -1, panelName: 'Shelf 1.1', label: 'downward', elevation: 1200 },
] as const) test(`Control-pull on a horizontal panel normal repeats ${label} without stretching the existing cube`, async ({ page }) => {
  const cube = moveProject(gridProject('Vertical repeat', [350], [350]), [0, elevation, 0])
  const { project, panel, handle } = await openCube(page, cube, 'front', panelName, [0, sign, 0])
  expect(handle.id).toMatch(/^panel-normal-/)
  const move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await page.screenshot({ path: `test-results/preview-repeat-normal-${label}.png` })
  expect(await savedProject(page)).toEqual(project)
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(7)
  const repeated = await savedProject(page)
  expectSourcePanelsUnchanged(project, repeated)
  expect(validateProject(repeated)).toEqual([])
  const edge = sign > 0 ? 'max' : 'min'
  expect(getProjectBounds(resolvePanels(repeated))[edge][1] - getProjectBounds(resolvePanels(project))[edge][1]).toBeCloseTo(sign * PITCH, 5)
  await expect(page.getByLabel('Panel name')).toHaveValue(`${panel.name} (repeat 1)`)
  await expect(page.locator(`[data-resize-handle="${handle.id}"]`)).toBeFocused()
  await page.keyboard.press('Control+ArrowUp')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(10)
  expect(validateProject(await savedProject(page))).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(repeated)
})

test('fixed panel cuts still expose a Control-pull normal arrow for adding a bay', async ({ page }) => {
  const cube = gridProject('Fixed-cut repeat', [350], [350])
  cube.constraints = cube.panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({
    id: `${panel.id}-${dimension}`, kind: 'dimension' as const, enabled: true, panelId: panel.id,
    dimension, relation: 'exact' as const, value: panel[dimension],
  })))
  const { project, handle } = await openCube(page, cube, 'front', 'Shelf 1.2', [0, 1, 0])
  expect(handle.id).toMatch(/^panel-normal-/)
  expect(handle.repeatOnly).toBe(true)
  const move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(7)
  const repeated = await savedProject(page)
  expectSourcePanelsUnchanged(project, repeated)
  expect(validateProject(repeated)).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('Control-pull fills a lower row using the existing upper-row ceilings and shared cross joints', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const staircase = gridProject('Complete lower row', [350, 350, 350], [350, 350], { cells: [[0, 0], [0, 1], [1, 1], [2, 1]] })
  const ceilingNames = ['Shelf 2.2', 'Shelf 3.2']
  staircase.panels = staircase.panels.map(panel => ceilingNames.includes(panel.name)
    ? { ...panel, material: 'birch', color: panel.name === ceilingNames[0] ? '#b88b54' : '#76523b', finishCoverage: .35 }
    : panel)
  expect(staircase.panels).toHaveLength(13)
  expect(validateProject(staircase)).toEqual([])
  const { project, panel, handle } = await openCube(page, staircase, 'perspective', 'Shelf 1.1')
  // Filling the lower row keeps the same overall width, so show its existing ceilings clearly.
  for (let index = 0; index < 5; index++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  let move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await move(PITCH * 2)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: '2 existing panels reused' })).toBeVisible()
  await page.screenshot({ path: 'test-results/preview-repeat-reused-ceilings.png' })
  await page.keyboard.press('Escape')
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)

  move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(17)
  const completed = await savedProject(page)
  expectSourcePanelsUnchanged(project, completed)
  const resolved = resolvePanels(completed)
  for (const before of project.panels.filter(panel => ceilingNames.includes(panel.name))) {
    const after = completed.panels.find(panel => panel.id === before.id)!
    expect(after.name).toBe(before.name)
    expect(after.material).toBe(before.material)
    expect(after.color).toBe(before.color)
    expect(after.finishCoverage).toBe(before.finishCoverage)
  }
  for (let index = 0; index < resolved.length; index++) {
    expect(resolved.slice(index + 1).some(panel => samePanelPlacement(resolved[index], panel))).toBe(false)
  }
  const connectors = getPhysicalConnectors(completed)
  expect(connectors).toHaveLength(24)
  expect(connectors.filter(connector => connector.type === 'cross')).toHaveLength(4)
  expect(validateProject(completed)).toEqual([])
  expect(parseProject(completed)).toEqual(completed)
  await expect(page.getByLabel('Panel name')).toHaveValue(`${panel.name} (repeat 2)`)
  await expect(page.locator(`[data-resize-handle="${handle.id}"]`)).toBeFocused()
  await page.screenshot({ path: 'test-results/preview-repeat-reused-ceilings-committed.png' })
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(20)
  expect(validateProject(await savedProject(page))).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(completed)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(completed)
  expect(await exportedProject(page)).toEqual(completed)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(completed)
  expect(errors).toEqual([])
})

test('Control-pull can pass through an existing bay without an edit, then add a bay beyond it', async ({ page }) => {
  await page.goto('/')
  await expect.poll(async () => !!(await savedProject(page))?.panels.length).toBe(true)
  const beforeImport = await savedProject(page)
  const row = gridProject('Continue existing row', [350, 350], [350])
  const { project, panel, handle } = await openCube(page, row, 'front', 'Shelf 1.1')
  const caption = page.locator('.preview-resize-caption')
  let move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(caption.filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await expect(caption.filter({ hasText: '3 existing panels reused' })).toBeVisible()
  await move(0)
  await expect(caption.filter({ hasText: 'Repeat · 0 bays' })).toBeVisible()
  await move(PITCH)
  await expect(caption.filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await releaseRepeat(page)
  expect(await savedProject(page)).toEqual(project)
  await expect(page.locator('.toast').filter({ hasText: /Added/ })).toHaveCount(0)
  // With no added geometry or hardware, Undo should reach the import immediately.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(beforeImport)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.locator('.panel-list-select').getByText(panel.name, { exact: true }).click()

  move = await beginRepeat(page, handle)
  await move(PITCH * 2)
  await expect(caption.filter({ hasText: 'Repeat · 2 bays' })).toBeVisible()
  await expect(caption.filter({ hasText: '3 existing panels reused' })).toBeVisible()
  expect(await savedProject(page)).toEqual(project)
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(10)
  const extended = await savedProject(page)
  expectSourcePanelsUnchanged(project, extended)
  expect(getPhysicalConnectors(extended)).toHaveLength(16)
  expect(validateProject(extended)).toEqual([])
  await expect(page.getByLabel('Panel name')).toHaveValue(`${panel.name} (repeat 2)`)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('keyboard repetition keeps its world direction when the selected reused floor has different local axes', async ({ page }) => {
  const cube = gridProject('Reuse turned floor', [350], [350], { depth: 260 })
  const floor = resolvePanels(cube).find(panel => panel.name === 'Shelf 1.1')!
  const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...floor.rotation))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)))
  const existingFloor = createPanel({ ...floor, id: 'existing-turned-floor', name: 'Existing turned floor',
    width: floor.height, height: floor.width, rotation: [rotation.x, rotation.y, rotation.z],
    position: [floor.position[0] + PITCH, floor.position[1], floor.position[2]],
  })
  const { project, handle } = await openCube(page, { ...cube, panels: [...cube.panels, existingFloor] }, 'front', floor.name)
  await page.locator(`[data-resize-handle="${handle.id}"]`).focus()
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(7)
  const first = await savedProject(page)
  expectSourcePanelsUnchanged(project, first)
  expect(validateProject(first)).toEqual([])
  await expect(page.getByLabel('Panel name')).toHaveValue(existingFloor.name)
  const continuedHandle = preparePreviewResize(first, { panelId: existingFloor.id })!.handles.find(candidate => candidate.direction[0] > .999)!
  expect(continuedHandle.id).not.toBe(handle.id)
  await expect(page.locator(`[data-resize-handle="${continuedHandle.id}"]`)).toBeFocused()
  await page.screenshot({ path: 'test-results/preview-repeat-reused-floor-focus.png' })
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(10)
  const second = await savedProject(page)
  expect(validateProject(second)).toEqual([])
  expect(getProjectBounds(resolvePanels(second)).max[0] - getProjectBounds(resolvePanels(first)).max[0]).toBeCloseTo(PITCH, 5)
  expect(getProjectBounds(resolvePanels(second)).max[2]).toBeCloseTo(getProjectBounds(resolvePanels(first)).max[2], 5)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(first)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('depth seam hardware clears frame corners in the exported and reloaded construction', async ({ page }) => {
  const cube = gridProject('Depth seam clearance', [350], [350], { connectorColor: '#222222' })
  const { project, handle } = await openCube(page, cube, 'perspective', 'Shelf 1.2', [0, 0, -1])
  const originalHardware = installedHardware(project)
  expect(hardwareOverlaps(project)).toEqual([])
  const move = await beginRepeat(page, handle)
  await move(PITCH)
  await expect(page.locator('.preview-resize-caption').filter({ hasText: 'Repeat · 1 bay' })).toBeVisible()
  await releaseRepeat(page)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(9)
  await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
  for (let index = 0; index < 2; index++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await settleScene(page)
  await page.mouse.move(300, 200)
  await page.screenshot({ path: 'test-results/preview-repeat-depth-seam-closeup.png' })

  const repeated = await exportedProject(page)
  expect(getPhysicalConnectors(repeated)).toHaveLength(24)
  expect(validateProject(repeated)).toEqual([])
  expect(hardwareOverlaps(repeated)).toEqual([])
  const currentHardware = new Map(installedHardware(repeated).map(piece => [piece.id, piece]))
  for (const piece of originalHardware) {
    const current = currentHardware.get(piece.id)!
    expect(current.type).toBe(piece.type)
    current.position.forEach((value, axis) => expect(value).toBeCloseTo(piece.position[axis], 5))
  }
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(repeated)
  expect(hardwareOverlaps(await exportedProject(page))).toEqual([])
})
