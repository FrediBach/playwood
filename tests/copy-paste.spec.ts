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

for (const selection of ['panel', 'multiple panels', 'assembly'] as const) {
  test(`library insertion waits for preview placement on ${selection}`, async ({ page }) => {
    const project: Project = selection === 'assembly' ? createExampleProject('assembly-cube') : {
      version: 1, name: 'Library attachment', connections: [], panels: [
        createPanel({ name: 'Target one', position: [-800, 700, 0] }),
        createPanel({ name: 'Target two', position: [800, 700, 0] }),
      ],
    }
    await load(page, project)
    if (selection === 'multiple panels') await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: 'Assemblies', exact: true }).click()
    const card = page.getByRole('button', { name: selection === 'assembly' ? 'Insert Cube module instance' : 'Cube module', exact: true })
    await card.click()
    const handles = page.getByRole('button', { name: /^Attach assembly at / })
    await expect(handles.first()).toBeVisible()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await handles.first().hover()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await page.getByRole('button', { name: 'Cancel placement', exact: true }).click()
    await expect(handles).toHaveCount(0)
    await card.click()
    await expect(handles.first()).toBeVisible()
    await handles.first().click()
    const next = await saved(page, project.panels.length + 4)
    expect(next.assemblies!.instances).toHaveLength(selection === 'assembly' ? 2 : 1)
    if (selection === 'assembly') {
      expect(next.assemblies!.definitions).toHaveLength(1)
      expect(next.assemblies!.links).toHaveLength(1)
    }
    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    expect(await saved(page, next.panels.length)).toEqual(next)
  })
}
