import { expect, test, type Page } from '@playwright/test'
import { createStarterProject } from '../src/lib/model'
import { constructionBounds } from '../src/lib/object-geometry'
import type { Project, Vec3 } from '../src/lib/types'

const key = 'playwood-studio-project-v1'
function source(): Project {
  return { ...createStarterProject('blank'), constructionObjects: { roots: ['a', 'b'], nodes: [
    { id: 'a', name: 'Moving box', kind: 'box', visible: true, width: 200, height: 300, depth: 100, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'Fixed box', kind: 'box', visible: true, width: 200, height: 300, depth: 100, position: [400, 300, 0], rotation: [0, 0, 0] },
  ] } }
}
async function saved(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
}
async function open(page: Page, project: Project, view = 'front', geometry = false) {
  await page.addInitScript(({ key, project, geometry }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
    localStorage.setItem('playwood-snap', JSON.stringify({ grid: false, geometry, spacing: 50, tolerance: 10 }))
  }, { key, project, geometry })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Moving box', exact: true }).click()
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption(view)
  await expect(page.locator('[data-resize-handle="object-0-1"]')).toBeVisible()
  await expect(page.getByText('Updating object preview…', { exact: true })).not.toBeVisible()
}
async function point(page: Page, position: Vec3) {
  return page.locator('canvas').evaluate(async (canvas, position) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld()
    const p = camera.position.clone().set(...position).multiplyScalar(.001).project(camera)
    const r = canvas.getBoundingClientRect()
    return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 }
  }, position)
}
async function camera(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, controls } = _roots.get(canvas).store.getState()
    return { position: camera.position.toArray(), target: controls.target.toArray(), enabled: controls.enabled }
  })
}
async function drag(page: Page, distance = 80) {
  const p = await point(page, [0, 300, 50]), q = await point(page, [distance, 300, 50])
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control'); await page.mouse.down()
  await page.mouse.move(q.x, q.y, { steps: 8 })
}
async function release(page: Page) { await page.mouse.up(); await page.keyboard.up('Control') }
test('preview clicks select objects after switching from panels, including additive selection', async ({ page }) => {
  const project = source()
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify(project)), { key, project })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await expect(page.getByText('Updating object preview…', { exact: true })).not.toBeVisible()
  // Let the passive object meshes mount before activating object editing.
  await expect.poll(() => page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    return !!_roots.get(canvas).store.getState().scene.getObjectByName('Object a')
  })).toBe(true)
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('tab', { name: 'Objects', exact: true }).click()
    const first = await point(page, [0, 320, 50])
    await page.mouse.click(first.x, first.y)
    await expect(page.getByLabel('Object name', { exact: true })).toHaveValue('Moving box')
    const second = await point(page, [400, 320, 50])
    await page.keyboard.down('Shift')
    await page.mouse.click(second.x, second.y)
    await page.keyboard.up('Shift')
    await expect(page.getByRole('heading', { name: '2 objects', exact: true })).toBeVisible()
    await page.mouse.click(second.x, second.y)
    await expect(page.getByLabel('Object name', { exact: true })).toHaveValue('Fixed box')
    await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  }
  expect(await saved(page)).toEqual(project)
})
async function resize(page: Page, distance: number) {
  const b = (await page.locator('[data-resize-handle="object-0-1"]').boundingBox())!
  const p = await point(page, [100, 300, 0]), q = await point(page, [100 + distance, 300, 0])
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + q.x - p.x, b.y + b.height / 2 + q.y - p.y, { steps: 8 })
}
for (const view of ['front', 'perspective']) test(`object Control-drag in ${view} previews, commits once and restores camera controls`, async ({ page }) => {
  const project = source(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await open(page, project, view)
  const before = await camera(page)
  await drag(page)
  await expect(page.getByText(/Object move ·/)).toBeVisible()
  await page.waitForTimeout(500)
  expect(await saved(page)).toEqual(project)
  await release(page)
  await expect.poll(async () => (await saved(page)).constructionObjects!.nodes[0]).not.toEqual(project.constructionObjects!.nodes[0])
  const moved = await saved(page)
  expect(moved.constructionObjects!.nodes[1]).toEqual(project.constructionObjects!.nodes[1])
  expect(moved.constructionObjects!.nodes[0]).toMatchObject({ width: 200, height: 300, depth: 100 })
  expect(await camera(page)).toEqual(before)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => saved(page)).toEqual(moved)
  await page.reload()
  expect(await saved(page)).toEqual(moved)
  expect(errors).toEqual([])
})
test('object movement and resize snap to a neighbor, keep drafts out of storage, and cancel cleanly', async ({ page }) => {
  const project = source()
  await open(page, project, 'front', true)
  const before = await camera(page)
  await drag(page, 194)
  await release(page)
  await expect.poll(async () => constructionBounds((await saved(page)).constructionObjects!, ['a'])!.max[0]).toBeCloseTo(300, 4)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
  await resize(page, 194)
  await expect(page.getByText(/Object resize ·/)).toBeVisible()
  await page.waitForTimeout(500)
  expect(await saved(page)).toEqual(project)
  await page.screenshot({ path: 'test-results/object-resize.png' })
  await page.mouse.up()
  await expect.poll(async () => constructionBounds((await saved(page)).constructionObjects!, ['a'])!.max[0]).toBeCloseTo(300, 4)
  expect(constructionBounds((await saved(page)).constructionObjects!, ['a'])!.min[0]).toBeCloseTo(-100, 4)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
  await resize(page, 80); await page.keyboard.press('Escape'); await page.mouse.up()
  await drag(page); await page.keyboard.press('Escape'); await release(page)
  expect(await saved(page)).toEqual(project)
  expect(await camera(page)).toEqual(before)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  await page.locator('[data-resize-handle="object-0-1"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await saved(page)).constructionObjects!.nodes[0]).toMatchObject({ width: 210, position: [5, 300, 0] })
})
test('object box selection selects both roots and moves them together', async ({ page }) => {
  const project = source()
  await open(page, project)
  await page.locator('canvas').focus(); await page.keyboard.press('b')
  const p = await point(page, [-115, 465, 0]), q = await point(page, [515, 135, 0])
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up()
  await expect(page.getByRole('heading', { name: '2 objects', exact: true })).toBeVisible()
  await page.locator('canvas').focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await saved(page)).constructionObjects!.nodes).toMatchObject([{ position: [10, 300, 0] }, { position: [410, 300, 0] }])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
})

test('blur cancels gestures and replacing the project cannot accept an obsolete drag', async ({ page }) => {
  const project = source()
  await open(page, project)
  await resize(page, 80)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  expect(await saved(page)).toEqual(project)
  expect((await camera(page)).enabled).toBe(true)
  await drag(page)
  const replacement = { ...source(), name: 'Imported during gesture' }
  replacement.constructionObjects!.nodes[0].name = 'Imported box'
  await page.getByLabel('Import project file').setInputFiles({ name: 'replacement.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) })
  await release(page)
  await expect.poll(() => saved(page)).toEqual(replacement)
  expect((await camera(page)).enabled).toBe(true)
})

test('resizing a rotated object changes the corresponding local dimension', async ({ page }) => {
  const project = source()
  const box = project.constructionObjects!.nodes[0]
  if (box.kind !== 'box') throw new Error('Expected source box')
  box.rotation = [0, Math.PI / 2, 0]
  await open(page, project)
  await page.locator('[data-resize-handle="object-0-1"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => {
    const resized = (await saved(page)).constructionObjects!.nodes[0]
    return resized.kind === 'box' ? resized.depth : 0
  }).toBeCloseTo(110, 8)
  expect((await saved(page)).constructionObjects!.nodes[0]).toMatchObject({ width: 200, height: 300, position: [5, 300, 0], rotation: box.rotation })
  const bounds = constructionBounds((await saved(page)).constructionObjects!, ['a'])!
  expect(bounds.min[0]).toBeCloseTo(-50, 5)
})

test('top-view movement keeps both object surfaces visible on every frame', async ({ page }) => {
  await open(page, source(), 'top')
  await page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const store = _roots.get(canvas).store
    const samples: { missing: boolean; movingX?: number; fixedX?: number }[] = []
    const sample = () => {
      const scene = store.getState().scene
      const a = scene.getObjectByName('Object a'), b = scene.getObjectByName('Object b')
      a?.geometry.computeBoundingBox(); b?.geometry.computeBoundingBox()
      samples.push({ missing: !a || !b, movingX: a?.geometry.boundingBox.min.x, fixedX: b?.geometry.boundingBox.min.x })
      if (samples.length < 600) requestAnimationFrame(sample)
    }
    ;(window as unknown as { objectFrames: typeof samples }).objectFrames = samples
    requestAnimationFrame(sample)
  })
  const p = await point(page, [0, 450, 0])
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control'); await page.mouse.down()
  for (const distance of [20, 40, 60, 80]) {
    const q = await point(page, [distance, 450, 0])
    await page.mouse.move(q.x, q.y, { steps: 3 })
    await page.waitForTimeout(80)
  }
  await expect(page.getByText(/Object move ·/)).toBeVisible()
  await release(page)
  await expect.poll(async () => {
    const box = (await saved(page)).constructionObjects!.nodes[0]
    return box.kind === 'box' ? box.position[0] : 0
  }).toBeCloseTo(80, 3)
  const samples = await page.evaluate(() => (window as unknown as { objectFrames: { missing: boolean; movingX?: number; fixedX?: number }[] }).objectFrames)
  expect(samples.length).toBeGreaterThan(5)
  expect(samples.every(frame => !frame.missing)).toBe(true)
  expect(samples.every(frame => Math.abs(frame.fixedX! - .3) < 1e-6)).toBe(true)
  expect(samples.some(frame => Math.abs(frame.movingX! + .02) < 1e-6)).toBe(true)
})
