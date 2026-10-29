import { test, expect } from '@playwright/test'
import { createExampleProject } from '../src/lib/example-library'
import { resolvePanels } from '../src/lib/model'

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
