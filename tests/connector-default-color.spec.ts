import { test, expect, type Page } from '@playwright/test'
import { createAssembly } from '../src/lib/assemblies'
import { connectorId, getPhysicalConnectors } from '../src/lib/connector-selection'
import { gridProject } from '../src/lib/example-geometry'
import { createPanel, resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))

function coloredFrame(name: string, color = '#000000'): Project {
  const project = gridProject(name, [350], [350], { connectorColor: '#ff0000' })
  // The structural defaults stay red. Installed per-piece colors determine the
  // majority, with two red pieces left to make the default genuinely mixed.
  project.connectorOverrides = Object.fromEntries(project.connections.slice(0, 3).flatMap(connection =>
    Array.from({ length: connection.count }, (_, index) => [connectorId(connection.id, index), { color }])))
  return project
}

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({ name: 'connector-colors.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await saved(page))?.name).toBe(project.name)
}

async function openAttachment(page: Page) {
  await page.getByRole('button', { name: 'Attachment target', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await openInspectorSection(page, 'Connector finish')
}

test('attachment defaults follow installed colors, restart with the current majority, and honor a chosen color', async ({ page }) => {
  const project = coloredFrame('Black connector majority')
  project.panels.push(createPanel({ name: 'Attachment target', width: 300, height: 300, position: [1000, 500, 0] }))
  await page.goto('/')
  await importProject(page, project)
  await openAttachment(page)
  await expect(page.getByRole('button', { name: 'Black connector color', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'White connector color', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await openAttachment(page)
  await expect(page.getByRole('button', { name: 'Black connector color', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'White connector color', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).fill('320')
  await page.getByRole('spinbutton', { name: 'Height', exact: true }).press('Tab')
  await expect(page.getByRole('button', { name: 'White connector color', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Attach panel', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(project.panels.length + 1)
  const attached = await saved(page), originalIds = new Set(project.connections.map(connection => connection.id))
  expect(attached.connections.filter(connection => !originalIds.has(connection.id)).map(connection => connection.color)).toEqual(['#ffffff'])
  expect(attached.connectorOverrides).toEqual(project.connectorOverrides)
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(attached)

  const green = coloredFrame('Green connector majority', '#008002')
  green.panels.push(createPanel({ name: 'Attachment target', width: 300, height: 300, position: [1000, 500, 0] }))
  await importProject(page, green)
  await openAttachment(page)
  await expect(page.getByRole('button', { name: 'Green connector color', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('closing an assembly uses the project hardware colors and retains them through undo and reload', async ({ page }) => {
  const frame = coloredFrame('Assembly with black hardware')
  const project = createAssembly(frame, frame.panels.map(panel => panel.id), 'Colored box')
  expect(project.assemblies!.definitions[0].connections.every(connection => connection.color === '#ff0000')).toBe(true)
  const originalIds = new Set(getPhysicalConnectors(project).map(piece => piece.id))
  await page.goto('/')
  await importProject(page, project)
  await openInspectorSection(page, 'Close holes')
  await page.getByLabel('Opening to close').selectOption({ label: 'Front · 350 × 350 mm' })
  await page.getByRole('button', { name: 'Close hole', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(5)
  const closed = await saved(page)
  const added = getPhysicalConnectors(closed).filter(piece => !originalIds.has(piece.id))
  expect(added).toHaveLength(8)
  expect(added.every(piece => piece.color === '#000000')).toBe(true)
  for (const [id, override] of Object.entries(project.connectorOverrides!)) expect(closed.connectorOverrides?.[id]).toEqual(override)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await saved(page)).connections).toEqual(project.connections)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(closed)
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(closed)
})

test('auto-add uses the existing installed color for every newly fitted joint', async ({ page }) => {
  const frame = coloredFrame('Automatic black connectors')
  const project: Project = { ...frame, panels: resolvePanels(frame), connections: [frame.connections[0]] }
  await page.goto('/')
  await importProject(page, project)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await openInspectorSection(page, 'Auto-add connectors')
  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
  await expect.poll(async () => (await saved(page)).connections.length).toBe(4)
  const connected = await saved(page)
  expect(getPhysicalConnectors(connected)).toHaveLength(8)
  expect(getPhysicalConnectors(connected).every(piece => piece.color === '#000000')).toBe(true)
  expect(connected.connections.find(connection => connection.id === project.connections[0].id)).toEqual(project.connections[0])
})
