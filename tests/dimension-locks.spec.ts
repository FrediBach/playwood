import { expect, test, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const shelfProject = (): Project => ({ version: 1, name: 'Dimension locks', connections: [], panels: [
  createPanel({ id: 'lower', name: 'Lower shelf', width: 600, height: 400, thickness: 18, position: [0, 209, 0], rotation: [-Math.PI / 2, 0, 0] }),
  createPanel({ id: 'upper', name: 'Upper shelf', width: 500, height: 400, thickness: 18, position: [0, 609, 0], rotation: [-Math.PI / 2, 0, 0] }),
] })

async function importProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'locks.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
}

async function exportedProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

test('dimension label locks are keyboard accessible, undoable, and retained on reload', async ({ page }) => {
  await importProject(page, shelfProject())
  await page.locator('.panel-list-select').first().click()
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true })
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true })
  const lock = page.getByRole('button', { name: 'Lock width', exact: true })
  await lock.focus()
  await lock.press('Enter')
  const unlock = page.getByRole('button', { name: 'Unlock width', exact: true })
  await expect(unlock).toBeFocused()
  await expect(unlock).toHaveAttribute('aria-pressed', 'true')
  await expect(width).toBeDisabled()
  await expect(height).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('dimension-lock-desktop.png') })
  const locked = await exportedProject(page)
  expect(locked.constraints).toHaveLength(1)
  expect(locked.constraints?.[0]).toMatchObject({ kind: 'dimension', panelId: 'lower', dimension: 'width', value: 600, enabled: true })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(width).toBeEnabled()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect(width).toBeDisabled()
  await unlock.click()
  await expect(width).toBeEnabled()
  const paused = await exportedProject(page)
  expect(paused.constraints).toEqual(locked.constraints!.map(rule => ({ ...rule, enabled: false })))
  await lock.click()
  expect((await exportedProject(page)).constraints).toEqual(locked.constraints)
  await page.reload()
  await page.locator('.panel-list-select').first().click()
  await expect(width).toBeDisabled()
  expect((await exportedProject(page)).constraints).toEqual(locked.constraints)

  await page.setViewportSize({ width: 390, height: 844 })
  if (!await unlock.isVisible()) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await unlock.focus()
  await expect(unlock).toBeFocused()
  const bounds = await unlock.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: test.info().outputPath('dimension-lock-narrow.png') })
  await unlock.press('Space')
  await expect(width).toBeEnabled()
  await expect(lock).toBeFocused()
})

test('mixed selection locks each current cut and unlocks only that dimension', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [
    { id: 'lower-width', kind: 'dimension', enabled: true, panelId: 'lower', dimension: 'width', value: 600 },
    { id: 'lower-height', kind: 'dimension', enabled: true, panelId: 'lower', dimension: 'height', value: 400 },
    { id: 'minimum-width', kind: 'dimension', enabled: true, panelId: 'upper', dimension: 'width', relation: 'minimum', value: 450 },
  ]
  await importProject(page, project)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  const lock = page.getByRole('button', { name: 'Lock width', exact: true })
  await expect(lock).toHaveAttribute('aria-pressed', 'mixed')
  await expect(lock).toBeEnabled()
  await lock.focus()
  await expect(lock).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('dimension-lock-mixed-focus.png') })
  await lock.press('Enter')
  const unlock = page.getByRole('button', { name: 'Unlock width', exact: true })
  await expect(unlock).toBeFocused()
  await expect(unlock).toHaveAttribute('aria-pressed', 'true')
  const locked = await exportedProject(page)
  expect(locked.constraints).toHaveLength(4)
  expect(locked.constraints?.at(-1)).toMatchObject({ panelId: 'upper', dimension: 'width', value: 500, enabled: true })
  expect(locked.panels.map(panel => panel.width)).toEqual([600, 500])
  await unlock.click()
  const unlocked = await exportedProject(page)
  expect(unlocked.constraints?.map(rule => rule.enabled)).toEqual([false, true, true, false])
  expect(unlocked.panels).toEqual(locked.panels)
  await expect(lock).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Lock height', exact: true })).toHaveAttribute('aria-pressed', 'mixed')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect((await exportedProject(page)).constraints).toEqual(locked.constraints)
})
