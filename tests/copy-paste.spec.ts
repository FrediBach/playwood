import { test, expect, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import { createAssembly } from '../src/lib/assemblies'
import { createExampleProject } from '../src/lib/example-library'
import type { Project } from '../src/lib/types'

async function load(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'paste.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
}
async function saved(page: Page, panelCount: number): Promise<Project> {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(panelCount)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  return page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
}

test('copy from the list, choose a preview attachment, cancel, repeat and undo', async ({ page }) => {
  const panels = [createPanel({ name: 'Source', width: 250, height: 250, position: [-900, 600, 0], color: '#123456' }), createPanel({ name: 'Target', position: [0, 600, 0] })]
  await load(page, { version: 1, name: 'Clipboard test', panels, connections: [] })
  await page.locator('.panel-list-select').first().click()
  await page.keyboard.press('Control+c')
  await expect(page.getByText('Panel copied. Select a target and press Ctrl/Cmd+V.')).toBeVisible()
  await page.locator('.panel-list-select').nth(1).click()
  await page.keyboard.press('Control+v')
  const handles = page.getByRole('button', { name: /^Paste at / })
  await expect(handles.first()).toBeVisible()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await handles.first().hover()
  await page.keyboard.press('Escape')
  await expect(handles).toHaveCount(0)
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await page.keyboard.press('Meta+v')
  await handles.first().click()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  const pasted = await saved(page, 3)
  expect(pasted.panels[2]).toMatchObject({ name: 'Source copy', color: '#123456', width: 250 })
  expect(pasted.connections[0].parentId).toBe(panels[1].id)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await page.locator('.panel-list-select').nth(1).click()
  await page.keyboard.press('Control+v')
  await handles.first().click()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  // Text fields retain normal clipboard behavior.
  await page.getByLabel('Panel name', { exact: true }).fill('Typing here')
  await page.keyboard.press('Control+v')
  await expect(handles).toHaveCount(0)
})

test('pastes a copied assembly through corner handles and cancels stale previews on undo', async ({ page }) => {
  const cube = createExampleProject('cube')
  const project = createAssembly(cube, cube.panels.map(panel => panel.id), 'Box')
  await load(page, project)
  await page.locator('canvas').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.keyboard.press('Meta+c')
  await page.keyboard.press('Meta+v')
  const handles = page.getByRole('button', { name: /^Paste at / })
  await expect(handles.first()).toBeVisible()
  await handles.first().click()
  expect((await saved(page, 8)).assemblies!.instances).toHaveLength(2)
  await page.keyboard.press('Control+v')
  await expect(handles.first()).toBeVisible()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(handles).toHaveCount(0)
  expect((await saved(page, 4)).assemblies!.instances).toHaveLength(1)
})
