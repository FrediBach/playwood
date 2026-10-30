import { test, expect, type Page } from '@playwright/test'
import { createAssemblyFile } from '../src/lib/assembly-file'
import { updateAssemblyFinish, updateAssemblyParameterValues } from '../src/lib/assemblies'
import { createExampleProject } from '../src/lib/example-library'
import { parseProject, validateProject } from '../src/lib/model'
import type { Panel, Project } from '../src/lib/types'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
const upload = (value: unknown) => ({ name: 'cube.playwood-assembly.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
// Geometry evaluated in Chromium and Node can differ at floating-point precision.
const matchingPanel = (panel: Panel) => ({
  ...panel, position: panel.position.map(value => expect.closeTo(value, 8)), rotation: panel.rotation.map(value => expect.closeTo(value, 8)),
})

async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click()
}

async function load(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles(upload(project))
  await expect.poll(() => saved(page)).toEqual(project)
}

test('export and import preserve configured construction, create independent copies, and support undo and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let original = createExampleProject('assembly-cube')
  const source = original.assemblies!.instances[0]
  original = updateAssemblyParameterValues(original, source.id, { 'side-length': 450 })
  original = updateAssemblyFinish(original, source.id, { color: '#123456' })
  await load(page, original)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export assembly', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('cube-module.playwood-assembly.json')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const file = JSON.parse(Buffer.concat(chunks).toString())
  const expected = createAssemblyFile(original, source.id)
  expect(file).toEqual({ ...expected, definition: { ...expected.definition, panels: expected.definition.panels.map(matchingPanel) } })
  expect(await saved(page)).toEqual(original)

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await openLibrary(page)
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import assembly', exact: true }).click()
  await (await choosing).setFiles(upload(file))
  await expect(page.getByLabel('Side length', { exact: true })).toHaveValue('450')
  await expect.poll(async () => (await saved(page)).panels.length).toBe(8)
  const inserted = await saved(page)
  expect(inserted.name).toBe(original.name)
  expect(inserted.assemblies!.definitions).toHaveLength(2)
  for (const panel of original.panels) expect(inserted.panels).toContainEqual(matchingPanel(panel))
  expect(inserted.panels.every(panel => panel.color === '#123456')).toBe(true)
  expect(validateProject(inserted)).toEqual([])
  expect(parseProject(inserted)).toEqual(inserted)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(inserted)
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(inserted)
  expect(errors).toEqual([])
})

test('imports use library attachment previews, cancellation, shared-panel warnings and one undo step', async ({ page }) => {
  const original = createExampleProject('assembly-cube')
  const file = createAssemblyFile(original, original.assemblies!.instances[0].id)
  await load(page, original)
  await openLibrary(page)
  await page.getByLabel('Import assembly file').setInputFiles(upload(file))
  const shared = page.getByRole('button', { name: /Attach assembly at.*shared panel.*Requires disassembly:/ }).first()
  await expect(shared).toBeVisible()
  await shared.focus()
  await expect(page.locator('.assembly-workspace-hint')).toContainText('Requires disassembly:')
  expect(await saved(page)).toEqual(original)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Cancel placement', exact: true })).toHaveCount(0)
  expect(await saved(page)).toEqual(original)

  // Selecting the same file again must fire a new import.
  await page.getByLabel('Import assembly file').setInputFiles(upload(file))
  await shared.focus()
  await shared.press('Enter')
  await expect.poll(async () => (await saved(page)).panels.length).toBe(7)
  const placed = await saved(page)
  expect(validateProject(placed)).toEqual([])
  expect(parseProject(placed)).toEqual(placed)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(original)
})

test('invalid and oversized assembly files show an error and leave the project intact', async ({ page }) => {
  const original = createExampleProject('assembly-cube')
  await load(page, original)
  await openLibrary(page)
  await page.getByLabel('Import assembly file').setInputFiles(upload(original))
  await expect(page.getByRole('alert')).toContainText('Choose a Playwood assembly file')
  await page.getByLabel('Import assembly file').setInputFiles({ ...upload(null), buffer: Buffer.from('{') })
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByLabel('Import assembly file').setInputFiles({ ...upload(null), buffer: Buffer.alloc(2_000_001, ' ') })
  await expect(page.getByRole('alert')).toContainText('smaller than 2 MB')
  expect(await saved(page)).toEqual(original)
})
