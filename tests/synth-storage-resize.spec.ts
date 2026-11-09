import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseProject, resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
const saved = (page: Page): Promise<Project> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey)
const original = parseProject(JSON.parse(readFileSync(new URL('../src/lib/__fixtures__/synth-storage-resize.json', import.meta.url), 'utf8')))

async function openConstruction(page: Page) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({
    name: 'synth-storage.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)),
  })
  await expect.poll(async () => (await saved(page))?.name).toBe(original.name)
}

function expectAccessoryCutsUnchanged(next: Project) {
  for (const panel of original.panels.filter(panel => /^(Synth tray|Front stopper)/.test(panel.name))) {
    const after = next.panels.find(item => item.id === panel.id)!
    expect(after.width, `${panel.name} width`).toBeCloseTo(panel.width, 6)
    expect(after.height, `${panel.name} height`).toBeCloseTo(panel.height, 6)
  }
  expect(next.constraints).toEqual(original.constraints)
}

for (const { name, field, value } of [
  { name: 'Upright 1.1', field: 'Width', value: 360 },
  { name: 'Storage upright 1.1', field: 'Height', value: 640 },
]) test(`resizing ${name} ${field.toLowerCase()} preserves accessory cuts`, async ({ page }) => {
  await openConstruction(page)
  const before = await saved(page)
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByLabel(field, { exact: true }).fill(String(value))
  await page.getByLabel(field, { exact: true }).press('Enter')
  const id = original.panels.find(panel => panel.name === name)!.id
  const dimension = field === 'Width' ? 'width' : 'height'
  await expect.poll(async () => (await saved(page)).panels.find(panel => panel.id === id)![dimension]).toBe(value)
  const after = await saved(page)
  expectAccessoryCutsUnchanged(after)
  if (name.startsWith('Storage')) {
    for (const panel of original.panels.filter(panel => /^(Upright|Shelf) /.test(panel.name))) {
      expect(after.panels.find(item => item.id === panel.id)!.height, `${panel.name} depth`).toBeCloseTo(panel.height, 6)
    }
  }
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})

test('lowering a synth shelf moves its tray and stopper without recutting them', async ({ page }) => {
  await openConstruction(page)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Shelf 1.2', exact: true }).click()
  const shelf = resolvePanels(original).find(panel => panel.name === 'Shelf 1.2')!
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => resolvePanels(await saved(page)).find(panel => panel.id === shelf.id)!.position[1]).toBeCloseTo(shelf.position[1] - 10, 4)
  expectAccessoryCutsUnchanged(await saved(page))
})
