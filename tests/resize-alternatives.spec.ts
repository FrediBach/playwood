import { expect, test, type Page } from '@playwright/test'
import { attachPanel, createPanel, validateProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const key = 'playwood-studio-project-v1'
const saved = (page: Page): Promise<Project> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)

for (const width of [1440, 390]) test(`reviewed setback resize cancels, applies once, and persists at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const parent = createPanel({ id: 'parent', name: 'Parent', width: 600, height: 400, position: [0, 800, 0] })
  const project = attachPanel({ version: 1, name: 'Resize review', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'child', name: 'Child', width: 400, height: 300 }),
    { type: '90', side: 'right', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 })
  project.constraints = [{ id: 'fixed', enabled: true, kind: 'dimension', panelId: 'child', dimension: 'height', value: 300 }]
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'resize.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await saved(page))?.name).toBe('Resize review')
  if (width < 680) await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Parent', exact: true }).click()
  const field = page.getByLabel('Height', { exact: true })
  await expect(field).toHaveValue('400')
  const before = await saved(page)
  const request = async () => { await field.fill('500'); await field.press('Enter') }
  await request()
  const dialog = page.getByRole('dialog', { name: 'Review resize alternatives' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('radio')).toHaveCount(2)
  await expect(dialog.getByRole('table', { name: 'Resize changes' })).toContainText('400 → 500')
  expect(await saved(page)).toEqual(before)
  await page.screenshot({ path: test.info().outputPath('resize-review.png') })
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(field).toBeFocused()
  expect(await saved(page)).toEqual(before)
  await request()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await saved(page)).toEqual(before)
  await request()
  await dialog.getByRole('radio').last().check()
  await dialog.getByRole('button', { name: 'Apply resize', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await saved(page)).panels[0].height).toBe(500)
  const after = await saved(page)
  expect(after.panels[1].height).toBe(300)
  expect(after.constraints).toEqual(before.constraints)
  expect(Math.abs(after.connections[0].offset)).toBe(50)
  expect(validateProject(after)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})
