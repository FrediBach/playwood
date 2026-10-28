import { test, expect, type Page } from '@playwright/test'
import type { Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { attachPanel, createPanel, getProjectBounds, resolvePanels } from '../src/lib/model'
import type { AttachmentOptions, ConnectorType, Project } from '../src/lib/types'

function legacyShelf(): Project {
  const bottom = createPanel({ id: 'legacy-bottom', name: 'Warm base', width: 1100, height: 360,
    color: '#d8af73', position: [0, 28, 0], rotation: [-Math.PI / 2, 0, 0] })
  const left = createPanel({ id: 'legacy-left', name: 'Left cabinet wall', width: 780, height: 360, color: '#557466', material: 'painted' })
  const right = createPanel({ id: 'legacy-right', name: 'Right cabinet wall', width: 780, height: 360, color: '#496a82', material: 'painted' })
  const top = createPanel({ id: 'legacy-top', name: 'Custom top', width: 1100, height: 360, color: '#76523b', material: 'walnut' })
  const middle = createPanel({ id: 'legacy-middle', name: 'Display shelf', width: 1100, height: 360, color: '#b88b54', material: 'oak' })
  const options: AttachmentOptions = { side: 'left', type: '90', offset: 0, inset: 0, flip: false, color: '#ae5838', count: 2 }
  let project: Project = { version: 1, name: 'My saved cabinet', panels: [bottom], connections: [] }
  project = attachPanel(project, bottom.id, left, options)
  project = attachPanel(project, bottom.id, right, { ...options, side: 'right' })
  project = attachPanel(project, left.id, top, options)
  project = attachPanel(project, left.id, middle, { ...options, inset: 390, color: '#6746a8' })
  project.connections.push(
    { ...options, id: 'legacy-top-support:0', parentId: right.id, childId: top.id, side: 'right', role: 'support' },
    { ...options, id: 'legacy-middle-support:0', parentId: right.id, childId: middle.id, side: 'right', inset: 390, color: '#6746a8', role: 'support' },
  )
  return project
}

async function importProject(page: Page, project: Project) {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.getByLabel('Import project file').setInputFiles({
    name: 'connector-check.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

async function exportedProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function importSinglePanel(page: Page) {
  await page.goto('/')
  await importProject(page, { version: 1, name: 'Connector check', panels: [
    createPanel({ name: 'Test panel', width: 240, height: 240, thickness: 18, position: [0, 200, 0] }),
  ], connections: [] })
}

// Inspect the scene already rendered by the app; no test-only app state is needed.
async function renderedConnectors(page: Page, checkPanelIntersections = false) {
  return page.locator('canvas').evaluate(async (canvas, checkIntersections) => {
    const fiberUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => url.includes('/@react-three_fiber.js'))
    if (!fiberUrl) return []
    const { _roots } = await import(fiberUrl) as {
      _roots: Map<HTMLCanvasElement, { store: { getState: () => { scene: Object3D } } }>
    }
    const scene = _roots.get(canvas as HTMLCanvasElement)?.store.getState().scene
    const panels: Mesh[] = []
    if (checkIntersections) {
      scene?.updateMatrixWorld(true)
      scene?.traverse(object => {
        const mesh = object as Mesh
        if (mesh.isMesh && mesh.geometry.type === 'ExtrudeGeometry') panels.push(mesh)
      })
    }
    const triangle = checkIntersections
      ? new (await import(fiberUrl.replace('@react-three_fiber.js', 'three.js'))).Triangle()
      : null
    const connectors: { type: ConnectorType; source: string; parts: {
      name: string; geometryType: string; vertices: number; finite: boolean;
      transparent: boolean; depthWrite: boolean; opacity: number; color: string;
    }[]; testedPanels: number; intersections: string[] }[] = []
    scene?.traverse(object => {
      if (!object.userData.connectorType) return
      const parts: typeof connectors[number]['parts'] = []
      const intersections: string[] = []
      object.traverse(child => {
        const mesh = child as Mesh
        if (!mesh.isMesh) return
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial
        const position = mesh.geometry.getAttribute('position')
        parts.push({ name: mesh.name, geometryType: mesh.geometry.type, vertices: position.count,
          finite: Array.from(position.array).every(Number.isFinite),
          transparent: material.transparent, depthWrite: material.depthWrite,
          opacity: material.opacity, color: material.color.getHexString() })
        if (triangle) for (const panel of panels) {
          panel.geometry.computeBoundingBox()
          // Test actual CAD faces against solid panel interiors; allow 0.1 mm
          // of surface contact and source-export rounding at the clamp jaws.
          const interior = panel.geometry.boundingBox!.clone().expandByScalar(-0.0001)
          const relative = panel.matrixWorld.clone().invert().multiply(mesh.matrixWorld)
          const indices = mesh.geometry.index
          const count = indices?.count ?? position.count
          for (let i = 0; i < count; i += 3) {
            triangle.a.fromBufferAttribute(position, indices ? indices.getX(i) : i).applyMatrix4(relative)
            triangle.b.fromBufferAttribute(position, indices ? indices.getX(i + 1) : i + 1).applyMatrix4(relative)
            triangle.c.fromBufferAttribute(position, indices ? indices.getX(i + 2) : i + 2).applyMatrix4(relative)
            if (interior.intersectsTriangle(triangle)) {
              intersections.push(`${mesh.name} intersects ${panel.name}`)
              break
            }
          }
        }
      })
      connectors.push({ type: object.userData.connectorType, source: object.userData.source,
        parts, testedPanels: panels.length, intersections })
    })
    return connectors
  }, checkPanelIntersections)
}

for (const [type, label, branches] of [
  ['90', '90°', 1], ['105', '105°', 1], ['150', '150°', 1], ['t', 'T', 2], ['cross', 'Cross', 3],
] as const) {
  test(`${label} uses the supplied connector parts for preview and committed joints`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await importSinglePanel(page)
    await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
    await page.getByRole('button', { name: 'Left', exact: true }).click()
    await page.getByRole('button', { name: `${label} connector`, exact: true }).click()
    await page.getByLabel('Connector color', { exact: true }).fill('#286c72')
    await expect.poll(async () => (await renderedConnectors(page)).length).toBe(2)
    const preview = await renderedConnectors(page)
    for (const connector of preview) {
      expect(connector.type).toBe(type)
      expect(connector.source).toBe('resources/connectors-3d/Connettori sharing.obj')
      expect(connector.parts.length).toBeGreaterThanOrEqual(2)
      for (const part of connector.parts) {
        expect(part.name).toMatch(/^object_\d+$/)
        expect(part.geometryType).toBe('BufferGeometry')
        expect(part.vertices).toBeGreaterThan(72)
        expect(part.finite).toBe(true)
        expect(part.transparent).toBe(true)
        expect(part.depthWrite).toBe(false)
        expect(part.opacity).toBeGreaterThan(0)
        expect(part.opacity).toBeLessThan(1)
      }
    }
    await page.getByRole('button', { name: branches === 1 ? 'Attach panel' : `Attach ${branches} panels`, exact: true }).click()
    await expect(page.locator('.panel-list-row')).toHaveCount(branches + 1)
    await expect.poll(async () => (await renderedConnectors(page)).filter(connector =>
      connector.parts.every(part => !part.transparent && part.opacity === 1)).length).toBe(2)
    const committed = await renderedConnectors(page)
    expect(committed).toHaveLength(2)
    expect(committed.map(connector => connector.parts.map(part => part.name))).toEqual(
      preview.map(connector => connector.parts.map(part => part.name)))
    for (const connector of committed) for (const part of connector.parts) {
      expect(part.color).toBe('286c72')
      expect(part.depthWrite).toBe(true)
    }
    await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
    await expect.poll(() => page.locator('canvas').evaluate(element =>
      (element as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(10000)
    await page.screenshot({ path: `test-results/connector-${type}.png` })

    // One physical T/cross connector belongs to the whole joint, not to each branch.
    await page.getByRole('button', { name: 'Hide Test panel', exact: true }).click()
    await expect.poll(async () => (await renderedConnectors(page)).length).toBe(0)
    await page.getByRole('button', { name: 'Show Test panel', exact: true }).click()
    await expect.poll(async () => (await renderedConnectors(page)).length).toBe(2)
    if (branches > 1) {
      await page.getByRole('button', { name: 'Hide Panel 2 2', exact: true }).click()
      await expect.poll(async () => (await renderedConnectors(page)).length).toBe(0)
      await page.getByRole('button', { name: 'Show Panel 2 2', exact: true }).click()
      await expect.poll(async () => (await renderedConnectors(page)).length).toBe(2)
    }
    await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
    await expect.poll(async () => (await renderedConnectors(page)).length).toBe(0)
    await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
    await expect.poll(async () => (await renderedConnectors(page)).length).toBe(2)
    expect(errors).toEqual([])
  })
}

test('realistic preview keeps the imported connector models, quantities and finishes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect.poll(async () => (await renderedConnectors(page)).length, { timeout: 15000 }).toBe(12)
  const studio = await renderedConnectors(page)
  expect(studio.filter(connector => connector.type === '90')).toHaveLength(8)
  expect(studio.filter(connector => connector.type === 't')).toHaveLength(4)
  await page.screenshot({ path: 'test-results/connectors-shelf.png' })
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  await expect.poll(() => renderedConnectors(page)).toEqual(studio)
  await expect.poll(() => page.locator('canvas').evaluate(canvas =>
    Math.abs(canvas.getBoundingClientRect().width - canvas.closest('.workspace')!.getBoundingClientRect().width))).toBeLessThan(1)
  await page.getByRole('button', { name: 'Reset room view (F)', exact: true }).click()
  await expect.poll(() => page.locator('canvas').evaluate(canvas =>
    (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(30000)
  await page.screenshot({ path: 'test-results/connectors-room.png' })
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect.poll(() => renderedConnectors(page)).toEqual(studio)
  await expect(page.getByRole('alert')).not.toBeVisible()
  expect(errors).toEqual([])
})

test('middle T hardware fits the shelf side openings without penetrating panels', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.panel-list-row')).toHaveCount(7)
  await expect.poll(async () => (await renderedConnectors(page)).length, { timeout: 15000 }).toBe(12)
  const connectors = await renderedConnectors(page, true)
  const middle = connectors.filter(connector => connector.type === 't')
  expect(middle).toHaveLength(4)
  for (const connector of connectors) {
    expect(connector.testedPanels).toBe(7)
    expect(connector.intersections).toEqual([])
  }
  await page.getByRole('button', { name: 'Middle shelf', exact: true }).click()
  await expect(page.getByLabel('Panel name')).toHaveValue('Middle shelf')
  await expect(page.getByLabel('Connector type')).toContainText('T connector')
  await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption('front')
  await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
  await page.screenshot({ path: 'test-results/connectors-shelf-middle.png' })
  await page.locator('canvas').evaluate(async canvas => {
    const fiberUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const state = _roots.get(canvas).store.getState()
    const joints: { object: Object3D; position: Vector3 }[] = []
    state.scene.traverse((object: Object3D) => {
      if (object.userData.connectorType === 't') joints.push({ object,
        position: object.getWorldPosition(object.position.clone()) })
    })
    // View the front left middle joint from above and inside the shelf.
    joints.sort((a, b) => a.position.x - b.position.x || b.position.z - a.position.z)
    const target = joints[0].position
    state.controls.target.copy(target)
    state.camera.position.copy(target).add(target.clone().set(0.24, 0.16, 0.34))
    state.camera.lookAt(target)
    state.camera.zoom = 2400
    state.camera.updateProjectionMatrix()
    state.controls.update()
    state.invalidate()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.screenshot({ path: 'test-results/connectors-middle-closeup.png' })
  expect(errors).toEqual([])
})

test('importing an older shelf repairs its middle joints while preserving finishes and dimensions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const legacy = legacyShelf()
  await importSinglePanel(page)
  await importProject(page, legacy)
  await expect(page.locator('.panel-list-row')).toHaveCount(7)
  await expect.poll(async () => (await renderedConnectors(page)).filter(connector => connector.type === 't').length,
    { timeout: 15000 }).toBe(4)
  const repaired = await exportedProject(page)
  expect(repaired.name).toBe(legacy.name)
  expect(repaired.connections.reduce((total, connection) => total + connection.count, 0)).toBe(12)
  for (const original of legacy.panels) {
    const retained = repaired.panels.find(panel => panel.id === original.id)
    expect(retained).toMatchObject({ name: original.name, color: original.color, material: original.material })
  }
  for (const color of ['#557466', '#496a82']) expect(repaired.panels.filter(panel => panel.color === color)).toHaveLength(2)
  const before = getProjectBounds(resolvePanels(legacy))
  const after = getProjectBounds(resolvePanels(repaired))
  for (const dimension of ['width', 'height', 'depth'] as const) expect(after[dimension]).toBeCloseTo(before[dimension], 3)
  const middleBefore = resolvePanels(legacy).find(panel => panel.id === 'legacy-middle')!.position
  const middleAfter = resolvePanels(repaired).find(panel => panel.id === 'legacy-middle')!.position
  middleAfter.forEach((coordinate, index) => expect(coordinate).toBeCloseTo(middleBefore[index], 6))
  for (const connector of await renderedConnectors(page, true)) expect(connector.intersections).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Test panel', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('opening an older saved shelf repairs it once and keeps that repair undoable', async ({ page }) => {
  await page.addInitScript(project => localStorage.setItem('playwood-studio-project-v1', JSON.stringify(project)), legacyShelf())
  await page.goto('/')
  await expect(page.locator('.panel-list-row')).toHaveCount(7)
  await expect.poll(async () => (await renderedConnectors(page)).filter(connector => connector.type === 't').length,
    { timeout: 15000 }).toBe(4)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(5)
  await expect.poll(async () => (await renderedConnectors(page)).filter(connector => connector.type === '90').length).toBe(12)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(7)
  await expect.poll(async () => (await renderedConnectors(page)).filter(connector => connector.type === 't').length).toBe(4)
})
