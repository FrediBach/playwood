import { test, expect, type Page } from '@playwright/test'
import { createExampleProject } from '../src/lib/example-library'
import { parseProject, validateProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

async function saved(page: Page, panelCount: number): Promise<Project> {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(panelCount)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  return page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
}

for (const flow of ['attach copy', 'insert assembly'] as const) {
  test(`${flow} warns before sharing panels, disassembles on placement and restores everything on undo`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const original = createExampleProject('assembly-cube')
    await page.goto('/')
    await page.getByLabel('Import project file').setInputFiles({ name: 'cube.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) })
    if (flow === 'attach copy') await page.getByRole('button', { name: 'Attach a copy', exact: true }).click()
    else {
      await page.getByRole('button', { name: 'Library', exact: true }).click()
      await page.getByRole('button', { name: 'Assemblies', exact: true }).click()
      await page.getByRole('button', { name: 'Insert Cube module instance', exact: true }).click()
    }

    const shared = page.getByRole('button', { name: /shared panel.*Requires disassembly:/ }).first()
    await expect(shared).toBeVisible()
    await shared.focus()
    await expect(page.locator('.assembly-workspace-hint')).toContainText('Requires disassembly:')
    await expect(page.locator('.assembly-workspace-hint')).toContainText('Duplicate')
    expect(await saved(page, 4)).toEqual(original)
    await shared.press('Enter')

    await expect(page.locator('.toast')).toContainText('Disassembled:')
    const placed = await saved(page, 7)
    expect(placed.assemblies!.instances).toHaveLength(0)
    expect(placed.assemblies!.definitions).toEqual(original.assemblies!.definitions)
    expect(placed.connections.some(connection => connection.type === 't')).toBe(true)
    expect(validateProject(placed)).toEqual([])
    expect(parseProject(placed)).toEqual(placed)
    await expect(page.getByLabel('Instance name', { exact: true })).toHaveCount(0)
    await expect(page.locator('.assembly-attach-handle')).toHaveCount(0)

    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    expect(await saved(page, 4)).toEqual(original)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    expect(await saved(page, 7)).toEqual(placed)
    await page.reload()
    expect(await saved(page, 7)).toEqual(placed)
    expect(errors).toEqual([])
  })
}
