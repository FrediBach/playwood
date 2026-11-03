import { test, expect, type Page } from '@playwright/test'
import { Euler, Quaternion, Vector3 } from 'three'
import { attachPanel, createPanel, createStarterProject, parseProject, resolvePanels, validateProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

function shelfWithBack(): Project {
  const base = createPanel({ id: 'base', name: 'Base', width: 800, height: 500, position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0] })
  const options = { side: 'top' as const, type: '90' as const, offset: 0, inset: 0, flip: false, color: '#ff0000', count: 2 }
  let project = attachPanel({ version: 1, name: 'Shelf with back', panels: [base], connections: [] }, base.id,
    createPanel({ id: 'back', name: 'Back', width: 800, height: 400 }), options)
  project = attachPanel(project, 'back', createPanel({ id: 'top', name: 'Top', width: 800, height: 300 }), options)
  return project
}
async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
}
async function renderedPanels(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))
    if (!url) return {}
    const { _roots } = await import(url)
    const result: Record<string, { position: number[]; quaternion: number[] }> = {}
    const scene = _roots.get(canvas)?.store.getState().scene
    if (!scene) return result
    scene.updateMatrixWorld(true)
    scene.traverse((object: any) => {
      if (object.userData.panelId) result[object.userData.panelId] = {
        position: object.getWorldPosition(object.position.clone()).toArray(),
        quaternion: object.getWorldQuaternion(object.quaternion.clone()).toArray(),
      }
    })
    return result
  })
}

test('selected 90° connectors tilt the back and top to 150°, with one undo, export and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const project = shelfWithBack()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'back.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await savedProject(page))?.name).toBe(project.name)
  const before = await savedProject(page)
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  for (const index of [1, 2]) await page.getByRole('checkbox', { name: `Select 90° connector ${index}: Base ↔ Back`, exact: true }).check()
  await expect(page.getByRole('heading', { name: '2 connectors', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/connector-angle-before.png' })
  await page.getByRole('button', { name: '150° connector', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).connections[0].type).toBe('150')
  const changed = await savedProject(page)
  const beforePanels = resolvePanels(before), afterPanels = resolvePanels(changed)
  expect(afterPanels[0]).toEqual(beforePanels[0])
  for (const index of [1, 2]) {
    const normal = (rotation: [number, number, number]) => new Vector3(0, 0, 1).applyEuler(new Euler(...rotation))
    expect(normal(afterPanels[index].rotation).angleTo(normal(beforePanels[index].rotation))).toBeCloseTo(Math.PI / 3, 8)
    expect(afterPanels[index].position[2]).toBeLessThan(beforePanels[index].position[2])
  }
  await expect.poll(async () => {
    const rendered = await renderedPanels(page)
    return afterPanels.every(panel => rendered[panel.id] &&
      new Vector3(...panel.position).multiplyScalar(.001).distanceTo(new Vector3(...rendered[panel.id].position)) < 1e-7 &&
      new Quaternion().setFromEuler(new Euler(...panel.rotation)).angleTo(new Quaternion().fromArray(rendered[panel.id].quaternion)) < 1e-7)
  }).toBe(true)
  expect(validateProject(changed)).toEqual([])
  await expect(page.locator('.connector-type-warning')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/connector-angle-after.png' })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(changed)
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(parseProject(JSON.parse(Buffer.concat(chunks).toString()))).toEqual(changed)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(changed)
  await expect.poll(async () => Object.keys(await renderedPanels(page))).toHaveLength(3)

  // One selected clamp still updates the complete seam, in a narrow inspector.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.getByRole('button', { name: '150° connector 1: Base ↔ Back', exact: true }).click()
  await page.getByRole('button', { name: '105° connector', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).connections[0].type).toBe('105')
  await expect(page.getByRole('heading', { name: '105° connector', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/connector-angle-narrow.png' })
  expect(errors).toEqual([])
})

test('an incompatible angle keeps the closed frame and displays a persistent explanation', async ({ page }) => {
  const project = createStarterProject('shelf')
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'frame.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await savedProject(page))?.panels[0].id).toBe(project.panels[0].id)
  const before = await savedProject(page)
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-select').first().click()
  await page.getByRole('button', { name: '150° connector', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('support joint')
  await expect(page.getByRole('button', { name: '90° connector', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: '105° connector', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('support joint')
  expect(await savedProject(page)).toEqual(before)
})
