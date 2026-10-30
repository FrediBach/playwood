import { test, expect } from '@playwright/test'
import { createExampleProject } from '../src/lib/example-library'
import { attachPanel, createPanel, resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'

test('automatically adds missing box connectors without moving panels, supports undo, and persists', async ({ page }) => {
  const original = createExampleProject('cube')
  const project = { ...original, panels: resolvePanels(original), connections: [] }
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'loose-box.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
  await expect(page.getByText('8 connectors added at 4 joints. Panel positions kept. Undo is available.')).toBeVisible()
  await expect(page.locator('.status-bar')).toContainText('8 connectors')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).connections.length)).toBe(4)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  expect(saved.panels).toEqual(project.panels)
  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).first().click()
  await expect(page.getByText('No compatible unconnected edges found. Check panel angles, edge alignment, and connector clearance.')).toBeVisible()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.status-bar')).toContainText('0 connectors')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(page.locator('.status-bar')).toContainText('8 connectors')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).connections.length)).toBe(4)
  await page.reload()
  await expect(page.locator('.status-bar')).toContainText('8 connectors')
})

test('auto-connect splits a shelf for an interior T and undo restores the continuous panel', async ({ page }) => {
  // A 635 mm continuous shelf spans a divider with 8.5 mm surface clearance.
  const project = { version: 1, name: 'Interior T', panels: [
    { id: 'shelf', name: 'Continuous shelf', width: 300, height: 635, thickness: 18, position: [0, 700, 0], rotation: [-Math.PI / 2, 0, 0], material: 'birch', color: '#d9bd8c', pattern: 'solid', visible: true, holeSize: 12, holeSpacing: 48 },
    { id: 'divider', name: 'Divider', width: 300, height: 300, thickness: 18, position: [0, 532.5, 0], rotation: [0, 0, 0], material: 'birch', color: '#d9bd8c', pattern: 'solid', visible: true, holeSize: 12, holeSpacing: 48 },
  ], connections: [] }
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'interior-t.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
  await expect(page.getByText('2 connectors added at 1 joint. 1 panel split for T joints; outer dimensions kept. Undo is available.')).toBeVisible()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  await expect(page.locator('.status-bar')).toContainText('2 connectors')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(3)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await expect(page.locator('.status-bar')).toContainText('0 connectors')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(3)
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  await expect(page.locator('.status-bar')).toContainText('2 connectors')
})

test('auto-connect upgrades a corner using an unselected upright and preserves the upgrade through undo, redo, and reload', async ({ page }) => {
  const green = createPanel({ name: 'Large green panel', width: 600, height: 600, color: '#899b80', position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0] })
  const complete = attachPanel({ version: 1, name: 'Corner upgrade', panels: [green], connections: [] }, green.id,
    createPanel({ name: 'White upright', width: 300, height: 300, color: '#ffffff' }),
    { side: 'right', type: 't', flip: true, offset: 0, inset: 0, color: '#222222', count: 2 })
  const panels = resolvePanels(complete).map((panel, index) => index === 2 ? { ...panel, name: 'Small white panel' } : panel)
  // The upright is already attached to the green panel; the coplanar white
  // panel is positioned at the third slot but has no connection yet.
  const project: Project = { ...complete, panels, connections: [{ ...complete.connections[0], type: '90' }] }
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'corner-upgrade.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('button', { name: 'Large green panel', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select Small white panel', exact: true }).check()
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(2)
  await expect(page.getByRole('checkbox', { name: 'Select White upright', exact: true })).not.toBeChecked()
  await expect(page.locator('.status-bar')).toContainText('2 connectors')

  const savedProject = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
  await expect(page.getByText(/1 existing joint upgraded/)).toBeVisible()
  await expect.poll(async () => (await savedProject()).connections.map((connection: { type: string }) => connection.type)).toEqual(['t', 't'])
  const upgraded = await savedProject()
  expect(upgraded.panels).toEqual(panels)
  expect(upgraded.connections.reduce((total: number, connection: { count: number }) => total + connection.count, 0)).toBe(2)
  await expect(page.locator('.status-bar')).toContainText('2 connectors')

  await page.getByRole('button', { name: 'Auto-add connectors', exact: true }).last().click()
  await expect(page.getByText('No compatible unconnected edges found. Check panel angles, edge alignment, and connector clearance.')).toBeVisible()
  expect(await savedProject()).toEqual(upgraded)

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(async () => (await savedProject()).connections).toEqual(project.connections)
  expect((await savedProject()).panels).toEqual(panels)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(savedProject).toEqual(upgraded)
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  await expect(page.locator('.status-bar')).toContainText('2 connectors')
  expect(await savedProject()).toEqual(upgraded)
})
