import { expect, test, type Page } from '@playwright/test'
import { gridProject } from '../src/lib/example-geometry'
import { resolvePanels, validateProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const key = 'playwood-studio-project-v1'
const saved = (page: Page): Promise<Project> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!

for (const width of [1440, 390]) test(`wider movement is reviewed and undoable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const project = gridProject('Staged movement', [400], [200, 100, 250, 300])
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'stages.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await saved(page))?.name).toBe(project.name)
  if (width < 680) await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Shelf 1.2', exact: true }).click()
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  const before = await saved(page)
  const request = async () => { await page.locator('canvas').focus(); await page.keyboard.press('Shift+ArrowUp') }
  await request()
  const dialog = page.getByRole('dialog', { name: 'Review wider movement' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio')).toHaveCount(2)
  await expect(dialog.getByRole('table', { name: 'Movement changes' })).toContainText('Shelf 1.3')
  expect(await saved(page)).toEqual(before)
  await page.screenshot({ path: test.info().outputPath('movement-review.png') })
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('canvas')).toBeFocused()
  expect(await saved(page)).toEqual(before)
  await request()
  await dialog.getByRole('button', { name: 'Apply movement', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => named(await saved(page), 'Shelf 1.2').position[1]).toBeCloseTo(named(before, 'Shelf 1.2').position[1] + 100)
  const after = await saved(page)
  expect(named(after, 'Shelf 1.3').position[1]).toBeGreaterThan(named(before, 'Shelf 1.3').position[1])
  expect(named(after, 'Shelf 1.4')).toEqual(named(before, 'Shelf 1.4'))
  expect(validateProject(after)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})
