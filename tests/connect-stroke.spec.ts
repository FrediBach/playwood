import { expect, test, type Page } from '@playwright/test'
import { attachPanel, createPanel, resolvePanels, validateProject } from '../src/lib/model'
import { getConnectorRail, connectorSlide } from '../src/lib/connector-movement'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import type { Project, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'

function cornerFixture() {
  const parent = createPanel({ name: 'Front board', width: 400, height: 500, position: [0, 450, 0] })
  const attached = attachPanel({ version: 1, name: 'Draw connectors', panels: [parent], connections: [] }, parent.id,
    createPanel({ name: 'Side board', width: 300, height: 500 }),
    { type: '90', side: 'right', count: 1, color: '#eeeeee', flip: false, offset: 0, inset: 0 })
  const panels = resolvePanels(attached)
  const rail = getConnectorRail(attached.connections[0], panels, attached.connections)!
  return { project: { ...attached, panels, connections: [] } as Project, seam: rail.placements[0].position }
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function openProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'draw-connectors.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await savedProject(page))?.name, { timeout: 15000 }).toBe(project.name)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective')
  await expect.poll(async () => (await sceneState(page)).panelIds.length).toBe(project.panels.length)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function sceneState(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const fiberUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const state = _roots.get(canvas).store.getState()
    const panelIds: string[] = [], connectors: { id: string; position: number[] }[] = []
    let previews = 0
    state.scene.updateMatrixWorld(true)
    state.scene.traverse((object: any) => {
      if (object.userData.panelId) panelIds.push(object.userData.panelId)
      if (object.userData.connectorId) connectors.push({ id: object.userData.connectorId, position: object.position.toArray() })
      if (object.userData.previewConnect) previews++
    })
    return { panelIds, connectors, previews, camera: [...state.camera.position.toArray(), ...state.camera.quaternion.toArray()], controlsEnabled: state.controls.enabled }
  })
}

// Choose real exposed panel surfaces close to the requested seam height, independent of camera fit.
async function panelPoint(page: Page, panelId: string, target: Vec3) {
  return page.locator('canvas').evaluate(async (canvas, { panelId, target }) => {
    const fiberUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const { Vector2, Vector3, Raycaster } = await import(fiberUrl.replace('@react-three_fiber.js', 'three.js'))
    const { scene, camera } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true)
    let mesh: any
    scene.traverse((object: any) => { if (object.userData.panelId === panelId) mesh = object })
    if (!mesh) throw new Error(`Panel ${panelId} is not rendered`)
    mesh.geometry.computeBoundingBox()
    const bounds = mesh.geometry.boundingBox
    const desired = new Vector3(...target).multiplyScalar(.001)
    const local = mesh.worldToLocal(desired.clone())
    const rect = canvas.getBoundingClientRect()
    const candidates: { x: number; y: number; distance: number; point: number[] }[] = []
    for (const fraction of [.06, .14, .28, .5, .72, .86, .94]) for (const z of [bounds.min.z, bounds.max.z]) {
      const world = new Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * fraction, local.y, z).applyMatrix4(mesh.matrixWorld)
      const projected = world.clone().project(camera)
      if (Math.abs(projected.x) > .95 || Math.abs(projected.y) > .95) continue
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(projected.x, projected.y), camera)
      const hit = ray.intersectObjects(scene.children, true).find((hit: any) => typeof hit.object.userData.panelId === 'string')
      if (hit?.object.userData.panelId !== panelId) continue
      candidates.push({ x: rect.x + (projected.x + 1) * rect.width / 2, y: rect.y + (1 - projected.y) * rect.height / 2, distance: hit.point.distanceTo(desired), point: hit.point.clone().multiplyScalar(1000).toArray() })
    }
    candidates.sort((a, b) => a.distance - b.distance)
    if (!candidates.length) throw new Error(`No exposed surface found for ${panelId}`)
    return candidates[0]
  }, { panelId, target })
}

async function beginStroke(page: Page, project: Project, target: Vec3) {
  const start = await panelPoint(page, project.panels[0].id, target)
  const end = await panelPoint(page, project.panels[1].id, target)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
  return start.point.map((value, axis) => (value + end.point[axis]) / 2)
}

function hardware(project: Project) {
  const panels = resolvePanels(project)
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const slide = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    return { id: piece.id, position: rail.placements[piece.index].position.map((value, axis) => value + rail.tangent[axis] * slide) }
  })
}

test('draw one connector, add another on its seam, then undo, redo, export and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const { project, seam } = cornerFixture()
  await openProject(page, project)
  const before = await savedProject(page)
  const mode = page.getByRole('button', { name: 'Connect mode', exact: true })
  await mode.click()
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  const camera = (await sceneState(page)).camera
  const intended = await beginStroke(page, project, [seam[0], seam[1] - 80, seam[2]])
  await expect(page.getByLabel('Connection gesture', { exact: true })).toBeVisible()
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(before)
  expect((await sceneState(page)).camera).toEqual(camera)
  await page.screenshot({ path: 'test-results/connect-stroke-preview.png' })
  await page.mouse.up()
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).length).toBe(1)
  const first = await savedProject(page)
  expect(first.panels).toEqual(before.panels)
  expect(first.connections).toHaveLength(1)
  expect(first.connections[0]).toMatchObject({ type: '90', count: 1, role: 'support' })
  expect(validateProject(first).filter(issue => issue.severity === 'error')).toEqual([])
  const firstHardware = hardware(first)
  expect(firstHardware[0].position[1]).toBeCloseTo(intended[1], 1)
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await sceneState(page)).previews).toBe(0)

  await beginStroke(page, project, [seam[0], seam[1] + 80, seam[2]])
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  await page.mouse.up()
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).length).toBe(2)
  const second = await savedProject(page)
  await page.screenshot({ path: 'test-results/connect-stroke-result.png' })
  expect(second.panels).toEqual(before.panels)
  expect(second.connections).toHaveLength(1)
  expect(hardware(second).find(piece => piece.id === firstHardware[0].id)).toEqual(firstHardware[0])
  expect((await sceneState(page)).camera).toEqual(camera)

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(first)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(second)
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(second)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect.poll(async () => (await sceneState(page)).connectors.length).toBe(2)
  expect(await savedProject(page)).toEqual(second)
  expect(errors).toEqual([])
})

test('Escape and invalid release discard the preview and restore camera navigation', async ({ page }) => {
  const { project, seam } = cornerFixture()
  await openProject(page, project)
  const before = await savedProject(page)
  const mode = page.getByRole('button', { name: 'Connect mode', exact: true })
  await mode.click()
  await beginStroke(page, project, seam)
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(mode).toHaveAttribute('aria-pressed', 'false')
  await expect(mode).toBeFocused()
  await expect.poll(async () => (await sceneState(page)).previews).toBe(0)
  expect(await savedProject(page)).toEqual(before)
  expect((await sceneState(page)).controlsEnabled).toBe(true)

  await mode.click()
  await beginStroke(page, project, seam)
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  const canvas = await page.locator('canvas').boundingBox()
  await page.mouse.move(canvas!.x + 10, canvas!.y + 10, { steps: 5 })
  await expect.poll(async () => (await sceneState(page)).previews).toBe(0)
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(before)
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  await mode.click()
  const start = await panelPoint(page, project.panels[0].id, seam)
  const camera = (await sceneState(page)).camera
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x - 55, start.y + 30, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await sceneState(page)).camera).not.toEqual(camera)
  expect(await savedProject(page)).toEqual(before)
  await mode.click()
  const beforePan = (await sceneState(page)).camera
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(canvas!.x + canvas!.width / 2 + 60, canvas!.y + canvas!.height / 2 + 30, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await expect.poll(async () => (await sceneState(page)).camera).not.toEqual(beforePan)
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  expect((await sceneState(page)).controlsEnabled).toBe(true)
  expect(await savedProject(page)).toEqual(before)
})

test('click twice adds a connector and Connect remains reachable in a narrow viewport', async ({ page }) => {
  const { project, seam } = cornerFixture()
  await openProject(page, project)
  const mode = page.getByRole('button', { name: 'Connect mode', exact: true })
  await mode.click()
  const start = await panelPoint(page, project.panels[0].id, seam)
  const end = await panelPoint(page, project.panels[1].id, seam)
  await page.mouse.click(start.x, start.y)
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  await page.mouse.click(end.x, end.y)
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).length).toBe(1)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 800, height: 800 })
  await expect(mode).toBeVisible()
  await mode.click()
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/connect-stroke-narrow.png' })
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(mode).toBeVisible()
  await mode.click()
  await expect(mode).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/connect-stroke-mobile.png' })
})

test('arrow-key aiming and Enter choose both connector endpoints without dragging', async ({ page }) => {
  const { project } = cornerFixture()
  await openProject(page, project)
  await page.getByRole('button', { name: 'Connect mode', exact: true }).click()
  const canvas = page.locator('canvas'), rect = (await canvas.boundingBox())!
  const cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await page.mouse.move(cursor.x, cursor.y)
  await canvas.focus()
  const aimAt = async (target: { x: number; y: number }) => {
    for (const axis of ['x', 'y'] as const) {
      let steps = Math.round((target[axis] - cursor[axis]) / 10)
      const key = axis === 'x' ? steps > 0 ? 'ArrowRight' : 'ArrowLeft' : steps > 0 ? 'ArrowDown' : 'ArrowUp'
      const sign = Math.sign(steps)
      steps = Math.abs(steps)
      while (steps >= 4) { await page.keyboard.press(`Shift+${key}`); cursor[axis] += sign * 40; steps -= 4 }
      while (steps > 0) { await page.keyboard.press(key); cursor[axis] += sign * 10; steps-- }
    }
  }
  await aimAt(await panelPoint(page, project.panels[0].id, project.panels[0].position))
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Connection gesture', { exact: true })).toBeVisible()
  await aimAt(await panelPoint(page, project.panels[1].id, project.panels[1].position))
  await expect.poll(async () => (await sceneState(page)).previews).toBe(1)
  await page.keyboard.press('Enter')
  await expect.poll(async () => getPhysicalConnectors(await savedProject(page)).length).toBe(1)
  expect((await savedProject(page)).panels).toEqual(project.panels)
})
