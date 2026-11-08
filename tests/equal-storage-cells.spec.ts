import { expect, test, type Page } from '@playwright/test'
import { synthStorageShelfProject } from '../src/lib/synth-storage-shelf'
import { openingMeasurements } from '../src/lib/design-constraints'
import { resolvePanels } from '../src/lib/model'
import { openInspectorSection } from './inspector-helpers'
import type { Project } from '../src/lib/types'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
const checkEqual = (project: Project) => {
  expect(project.constraints).toHaveLength(6)
  for (const rule of project.constraints!) {
    expect(rule.kind).toBe('opening-ratio')
    if (rule.kind !== 'opening-ratio') continue
    const [a, b] = openingMeasurements(rule, resolvePanels(project))
    expect(a).toBeCloseTo(b, 4)
  }
}

for (const axis of ['x', 'y'] as const) test(`three selected storage boundaries prepare an equal ${axis} opening rule`, async ({ page }) => {
  const source = { ...synthStorageShelfProject(), constraints: [] }
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'storage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) })
  await expect(page.locator('.project-name')).toHaveText(source.name)
  await expect.poll(async () => (await saved(page))?.name, { timeout: 15000 }).toBe(source.name)
  const names = axis === 'x' ? ['Storage upright 3.1', 'Storage upright 1.1', 'Storage upright 2.1'] : ['Storage shelf 1.3', 'Storage shelf 1.1', 'Storage shelf 1.2']
  await page.getByRole('button', { name: names[0], exact: true }).click()
  for (const name of names.slice(1)) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check()
  await openInspectorSection(page, 'Constraints')
  const before = await saved(page)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await expect(page.getByLabel('Constraint type', { exact: true })).toHaveValue('opening-ratio')
  await expect(page.getByLabel('Opening direction', { exact: true })).toHaveValue(axis)
  await expect(page.getByLabel('Opening 1 end panel', { exact: true })).toHaveValue(source.panels.find(panel => panel.name === names[2])!.id)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await expect.poll(async () => (await saved(page)).constraints?.length).toBe(1)
  const after = await saved(page)
  expect(after.constraints![0]).toMatchObject({ kind: 'opening-ratio', axis, ratio: 1, enabled: true })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})

test('library cell rules preserve equality through width and height resizing and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.locator('[data-example-id="synth-shelf-storage"]').click()
  await page.getByRole('dialog', { name: 'Replace current project?' }).getByRole('button', { name: 'Replace project', exact: true }).click()
  await expect.poll(async () => (await saved(page))?.constraints?.length, { timeout: 15000 }).toBe(6)
  checkEqual(await saved(page))
  await page.getByRole('button', { name: 'Assembly', exact: true }).click()
  for (const [name, value] of [['Storage shelf 1.1', 500], ['Storage upright 1.1', 360]] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await page.getByLabel('Width', { exact: true }).fill(String(value))
    await page.getByLabel('Width', { exact: true }).press('Enter')
    await expect.poll(async () => (await saved(page)).panels.find(panel => panel.name === name)!.width).toBe(value)
    checkEqual(await saved(page))
  }
  const after = await saved(page)
  await page.reload()
  expect(await saved(page)).toEqual(after)
  checkEqual(await saved(page))
})
