import { test, expect } from '@playwright/test'
import { attachPanel, createPanel, resolvePanels } from '../src/lib/model'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { getConnectorRail } from '../src/lib/connector-movement'
import { overlappingHardware } from '../src/lib/connector-hardware-test-helpers'

test('separate selected overlapping connectors through the context menu, undo, redo and reload', async ({ page }) => {
  const parent = createPanel({ width: 100, height: 300, position: [0, 500, 0] })
  const project = attachPanel({ version: 1, name: 'Overlapping hardware', panels: [parent], connections: [] }, parent.id,
    createPanel({ width: 100, height: 300 }), { side: 'top', type: '90', flip: false, offset: 0, inset: 0, color: '#123456', count: 2 })
  const pieces = getPhysicalConnectors(project)
  const rail = getConnectorRail(pieces[0].connection, resolvePanels(project), project.connections)!
  project.connectorOverrides = Object.fromEntries(pieces.map(piece => [piece.id, { slide: (rail.lower + rail.upper) / 2 - rail.along[piece.index] }]))
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'overlaps.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await expect(page.locator('.connector-list-select')).toHaveCount(2)
  await page.locator('.connector-list-select').first().click()
  await page.locator('.connector-list-select').nth(1).click({ modifiers: ['Shift'] })
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Separate overlapping connectors', exact: true }).click()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  await expect.poll(async () => overlappingHardware(await saved()).length).toBe(0)
  const repaired = await saved()
  expect(repaired.connections).toEqual(project.connections)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => overlappingHardware(await saved()).length).toBe(1)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(async () => overlappingHardware(await saved()).length).toBe(0)
  await page.reload()
  expect((await saved()).connectorOverrides).toEqual(repaired.connectorOverrides)
})
