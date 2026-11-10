import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { attachPanel, createPanel, createStarterProject, parseProject, getProjectBounds, resolvePanels, validateProject } from '../src/lib/model'
import { connectorSlide, getConnectorRail } from '../src/lib/connector-movement'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { resizePanelEdge } from '../src/lib/structure-edit'
import { autoConnect } from '../src/lib/auto-connect'
import { Vector3 } from 'three'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

const STORAGE_KEY = 'playwood-studio-project-v1'

async function openProject(page: Page, project: Project) {
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key: STORAGE_KEY, project })
  await page.goto('/')
  await expect(page.getByLabel('Panel name')).toHaveValue(project.panels[0].name)
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

function hardwarePositions(project: Project) {
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
    return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)).toArray()
  })
}

function benchWithShortSide(): Project {
  let project: Project = { version: 1, name: 'Bench corner', panels: [
    createPanel({ id: 'top', name: 'Bench top', width: 1200, height: 400, position: [450, 417.5, -217.5], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'side', name: 'Bench side', width: 400, height: 400, position: [-167.5, 200, -217.5], rotation: [0, Math.PI / 2, 0] }),
    createPanel({ id: 'small', name: 'Small side panel', width: 300, height: 388, position: [0, 194, 0] }),
  ], connections: [] }
  project = autoConnect(project, ['top', 'side']).project
  return JSON.parse(JSON.stringify(autoConnect(project, ['side', 'small']).project)) as Project
}

test('extend to ground keeps the upper edge fixed and supports one-step undo, redo and persistence', async ({ page }) => {
  const panel = createPanel({ name: 'Short side panel', width: 300, height: 400, position: [120, 500, 40] })
  const project: Project = { version: 1, name: 'Extend panel to ground', panels: [panel], connections: [] }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project)

  const extend = page.getByRole('button', { name: 'Extend to ground', exact: true })
  await expect(extend).toBeEnabled()
  await extend.click()
  await expect.poll(async () => (await savedProject(page)).panels[0].height).toBe(700)
  const extended = await savedProject(page)
  const resized = resolvePanels(extended)[0]
  expect(resized.position).toEqual([120, 350, 40])
  expect(resized.position[1] - resized.height / 2).toBe(0)
  expect(resized.position[1] + resized.height / 2).toBe(panel.position[1] + panel.height / 2)
  expect(resized.width).toBe(panel.width)
  expect(resized.rotation).toEqual(panel.rotation)
  expect(validateProject(extended).filter(issue => issue.severity === 'error')).toEqual([])
  await expect(extend).toBeDisabled()
  await page.screenshot({ path: 'test-results/panel-extended-to-ground.png', animations: 'disabled' })

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await expect(extend).toBeEnabled()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(extended)
  await page.reload()
  await expect(extend).toBeDisabled()
  expect(await savedProject(page)).toEqual(extended)
  expect(errors).toEqual([])
})

test('extend to ground accounts for bench connector seats without moving the bench or its hardware', async ({ page }) => {
  const project = createStarterProject('desk')
  const original = resolvePanels(project)
  const leg = original.find(panel => panel.name === 'Left side')!
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Left side$/ }).click()
  await page.getByRole('button', { name: 'Extend to ground', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).panels.find(panel => panel.id === leg.id)!.width).toBe(722.5)

  const extended = await savedProject(page)
  const after = resolvePanels(extended)
  const fitted = after.find(panel => panel.id === leg.id)!
  expect(getProjectBounds([fitted]).min[1]).toBeCloseTo(0, 6)
  expect(getProjectBounds([fitted]).max[1]).toBeCloseTo(getProjectBounds([leg]).max[1], 6)
  expect(after.filter(panel => panel.id !== leg.id)).toEqual(original.filter(panel => panel.id !== leg.id))
  expect(extended.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
  const initialHardware = hardwarePositions(project)
  hardwarePositions(extended).forEach((position, index) => position.forEach((value, axis) => expect(value).toBeCloseTo(initialHardware[index][axis], 6)))
  expect(validateProject(extended).filter(issue => issue.severity === 'error')).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('auto-connect asks before resizing a short bench side, then resizes and connects in one undo step', async ({ page }) => {
  const project = benchWithShortSide()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Small side panel$/ }).click()
  await page.getByRole('checkbox', { name: 'Select Bench top', exact: true }).check()
  await openInspectorSection(page, 'Auto-add connectors')
  const autoAdd = page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last()
  await autoAdd.click()

  const confirmation = page.getByRole('dialog', { name: 'Resize panel to connect?' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText('Small side panel')
  await expect(confirmation).toContainText('Bench top')
  await expect(confirmation).toContainText('388 → 400 mm')
  await expect(confirmation).toContainText('Extend by 12 mm')
  expect(await savedProject(page)).toEqual(project)
  await expect(confirmation).toHaveCSS('opacity', '1')
  await page.screenshot({ path: 'test-results/panel-connector-fit-confirmation.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(confirmation.getByRole('button', { name: 'Resize and connect', exact: true })).toBeInViewport()
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
  expect(await confirmation.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/panel-connector-fit-confirmation-phone.png', animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()

  await autoAdd.click()
  await expect(confirmation).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirmation).not.toBeVisible()
  expect(await savedProject(page)).toEqual(project)
  await autoAdd.click()
  await confirmation.getByRole('button', { name: 'Resize and connect', exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect.poll(async () => (await savedProject(page)).connections.length).toBe(project.connections.length + 1)
  const fitted = await savedProject(page)
  const small = resolvePanels(fitted).find(panel => panel.id === 'small')!
  expect(small.height).toBe(400)
  expect(small.position[1] - small.height / 2).toBe(0)
  expect(resolvePanels(fitted).filter(panel => panel.id !== 'small')).toEqual(resolvePanels(project).filter(panel => panel.id !== 'small'))
  expect(validateProject(fitted)).toEqual([])
  const initialHardware = hardwarePositions(project)
  hardwarePositions(fitted).slice(0, initialHardware.length).forEach((position, index) => position.forEach((value, axis) => expect(value).toBeCloseTo(initialHardware[index][axis], 6)))

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(fitted)
  await page.reload()
  await expect(page.getByLabel('Panel name')).toHaveValue('Bench top')
  expect(await savedProject(page)).toEqual(fitted)
  expect(errors).toEqual([])
})


test('auto-connect proposes both angled panel lengths, cancels safely, and commits one persistent edit', async ({ page }) => {
  let project: Project = { version: 1, name: 'Angled gap', panels: [createPanel({ id: 'lower', name: 'Lower slope', width: 300, height: 400, position: [0, 700, 0] })], connections: [] }
  const options = { type: '150' as const, side: 'top' as const, flip: false, offset: 0, inset: 0, count: 2, color: '#222222' }
  project = attachPanel(project, 'lower', createPanel({ id: 'upper', name: 'Upper slope', width: 300, height: 200 }), options)
  const missing = project.connections[0].id
  project = attachPanel(project, 'lower', createPanel({ id: 'base', width: 300, height: 300 }), { ...options, side: 'bottom', type: '90' })
  project = attachPanel(project, 'upper', createPanel({ id: 'top', width: 300, height: 300 }), { ...options, type: '105' })
  project = { ...project, panels: resolvePanels(project), connections: project.connections.filter(connection => connection.id !== missing) }
  project = resizePanelEdge(project, 'lower', 'height', 1, -20, true)
  project = resizePanelEdge(project, 'upper', 'height', -1, -30, true)
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'angled-gap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('button', { name: 'Lower slope', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(4)
  const before = await savedProject(page)
  await openInspectorSection(page, 'Auto-add connectors')
  const connect = page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last()
  await connect.click()
  const dialog = page.getByRole('dialog', { name: 'Resize panels to connect?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Lower slope · Height')).toBeVisible()
  await expect(dialog.getByText('Upper slope · Height')).toBeVisible()
  await expect(dialog.getByText('380 → 400 mm')).toBeVisible()
  await expect(dialog.getByText('170 → 200 mm')).toBeVisible()
  expect(await savedProject(page)).toEqual(before)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await savedProject(page)).toEqual(before)
  await connect.click()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await savedProject(page)).toEqual(before)
  await connect.click()
  await page.setViewportSize({ width: 540, height: 800 })
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(540)
  await page.screenshot({ path: test.info().outputPath('coordinated-fit-narrow.png') })
  await dialog.getByRole('button', { name: 'Resize and connect', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).connections.length).toBe(3)
  const fitted = await savedProject(page)
  expect(fitted.panels.find(panel => panel.id === 'lower')!.height).toBeCloseTo(400, 5)
  expect(fitted.panels.find(panel => panel.id === 'upper')!.height).toBeCloseTo(200, 5)
  expect(validateProject(fitted)).toEqual([])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(fitted)
  await page.reload()
  expect(await savedProject(page)).toEqual(fitted)
})


test('extended corner panels and long top fit through reviewed trims with undo and reload', async ({ page }) => {
  const project = parseProject(JSON.parse(readFileSync(new URL('../src/lib/fixtures/everyday-shelf-extended-corner.json', import.meta.url), 'utf8')))
  await openProject(page, project)
  let before = project
  for (const names of [['Left upper side', 'Right side copy'], ['Top shelf', 'Right side copy'], ['Left side', 'Right upper side copy']]) {
    await page.locator('.panel-list-select').filter({ hasText: new RegExp(`^${names[0]}$`) }).click()
    await page.getByRole('checkbox', { name: `Select ${names[1]}`, exact: true }).check()
    await openInspectorSection(page, 'Auto-add connectors')
    await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
    const confirmation = page.getByRole('dialog', { name: /Resize panels? to connect/ })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('1,010 → 1,005 mm')
    expect(await savedProject(page)).toEqual(before)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await savedProject(page)).toEqual(before)
    await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
    await confirmation.getByRole('button', { name: 'Resize and connect', exact: true }).click()
    await expect.poll(async () => (await savedProject(page)).connections.length).toBe(before.connections.length + 1)
    const fitted = await savedProject(page)
    expect(validateProject(fitted)).toEqual([])
    const hardware = hardwarePositions(before)
    hardwarePositions(fitted).slice(0, hardware.length).forEach((position, index) => position.forEach((value, axis) => expect(value).toBeCloseTo(hardware[index][axis], 5)))
    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    await expect.poll(() => savedProject(page)).toEqual(before)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    await expect.poll(() => savedProject(page)).toEqual(fitted)
    before = fitted
  }
  await page.reload()
  expect(await savedProject(page)).toEqual(before)
})
