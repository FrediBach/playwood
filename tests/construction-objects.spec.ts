import { test, expect, type Page } from '@playwright/test'
import { createPanel, createStarterProject } from '../src/lib/model'
import { addConstructionBox, combineConstructionObjects } from '../src/lib/construction-objects'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
const stored = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), storageKey)
async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({ name: 'objects.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await stored(page)).name).toBe(project.name)
}

test('construction sources survive import, ordinary edits, undo, redo, reload and export; replacement clears them', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const first = addConstructionBox({ ...createStarterProject('blank'), panels: [createPanel({ name: 'Original panel' })] })
  const second = addConstructionBox(first.project)
  const source = { ...combineConstructionObjects(second.project, [first.objectId, second.objectId], 'subtract').project, name: 'Saved object sources' }
  await page.goto('/')
  await importProject(page, source)
  await expect.poll(async () => (await stored(page)).constructionObjects).toEqual(source.constructionObjects)
  await page.locator('.panel-list-select').first().click()
  await page.getByLabel('Panel name', { exact: true }).fill('Edited panel')
  await page.getByLabel('Panel name', { exact: true }).press('Tab')
  await expect.poll(async () => (await stored(page)).panels[0]?.name).toBe('Edited panel')
  expect((await stored(page)).constructionObjects).toEqual(source.constructionObjects)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await stored(page)).panels[0]?.name).toBe('Original panel')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(async () => (await stored(page)).panels[0]?.name).toBe('Edited panel')
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString()).constructionObjects).toEqual(source.constructionObjects)
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await importProject(page, { ...createStarterProject('blank'), name: 'Replacement without objects' })
  expect((await stored(page)).constructionObjects).toBeUndefined()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await stored(page)).constructionObjects).toEqual(source.constructionObjects)
  // Object-only documents must also remain valid browser saves before scene editing exists.
  await importProject(page, { ...source, name: 'Only objects', panels: [] })
  await page.reload()
  await expect(page.locator('.panel-list-row')).toHaveCount(0)
  await expect.poll(async () => (await stored(page)).constructionObjects).toEqual(source.constructionObjects)
  expect(errors).toEqual([])
})

test('narrow object warnings follow numeric drafts and cancellation without saving diagnostics', async ({ page }) => {
  const source = addConstructionBox(createStarterProject('blank')).project
  source.name = 'Narrow geometry preview'
  await page.goto('/')
  await importProject(page, source)
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.locator('.object-select').first().click()
  const width = page.getByLabel('Box width', { exact: true })
  await width.fill('60')
  await width.press('Tab')
  const warning = page.getByRole('img', { name: /narrow geometry may not fit connectors/ })
  await expect(warning).toBeVisible()
  await warning.focus()
  await expect(page.locator('.object-clearance-tooltip')).toBeVisible()
  expect((await stored(page)).constructionObjects).toEqual(source.constructionObjects)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(warning).toHaveCount(0)
  expect((await stored(page)).constructionObjects).toEqual(source.constructionObjects)
})
