import { test, expect, type Page } from '@playwright/test'
import { createPanel, createStarterProject } from '../src/lib/model'
import { createAssembly } from '../src/lib/assemblies'
import { createExampleProject } from '../src/lib/example-library'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

const storageKey = 'playwood-studio-project-v1'
const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Project palette', exact: true })
const swatch = (page: Page, name: string) => page.getByRole('button', { name: `${name} finish`, exact: true })

async function importProject(page: Page, project: unknown) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'palette.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

async function exportProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function closePalette(page: Page) {
  await paletteDialog(page).getByRole('button', { name: 'Close dialog', exact: true }).click()
}

async function addColor(page: Page, name: string, color: string) {
  await page.getByRole('button', { name: 'Add color', exact: true }).click()
  await paletteDialog(page).getByLabel('Color name', { exact: true }).fill(name)
  await paletteDialog(page).getByLabel('Hex color', { exact: true }).fill(color)
  await paletteDialog(page).getByRole('button', { name: 'Save color', exact: true }).click()
  await closePalette(page)
}

test('color drafts stay local until saved; named swatches support reuse, undo, reload, and export', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original: Project = { version: 1, name: 'Project palette', connections: [], panels: [
    createPanel({ name: 'First panel', color: '#d9bb87', position: [-400, 500, 0] }),
    createPanel({ name: 'Second panel', color: '#d9bb87', position: [400, 500, 0] }),
  ] }
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key: storageKey, project: original })
  await page.goto('/')
  await openInspectorSection(page, 'Material & finish')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  const before = await page.evaluate(key => localStorage.getItem(key), storageKey)
  await page.evaluate(key => {
    const setItem = Storage.prototype.setItem
    const state = window as Window & { paletteWrites?: number }
    state.paletteWrites = 0
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === key) state.paletteWrites!++
      setItem.call(this, storageKey, value)
    }
  }, storageKey)
  await page.getByRole('button', { name: 'Add color', exact: true }).click()
  await paletteDialog(page).getByLabel('Color name', { exact: true }).fill('Discarded draft')
  for (let step = 0; step < 20; step++) {
    await paletteDialog(page).getByLabel('Color value', { exact: true }).fill(`#${(0x123440 + step).toString(16)}`)
  }
  // Wait beyond the project's autosave debounce to catch accidental draft commits.
  await page.waitForTimeout(600)
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(before)
  expect(await page.evaluate(() => (window as Window & { paletteWrites: number }).paletteWrites)).toBe(0)
  await paletteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await closePalette(page)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  await expect(swatch(page, 'Natural')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.panel-color-field input[type=color]')).toHaveCount(0)

  await addColor(page, 'Ocean', '#123456')
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'false')
  await expect(swatch(page, 'Natural')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(swatch(page, 'Ocean')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await swatch(page, 'Ocean').click()
  await page.locator('.panel-list-select').nth(1).click()
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'false')
  await swatch(page, 'Ocean').click()
  const exported = await exportProject(page)
  expect(exported.customColors).toEqual([{ id: expect.any(String), name: 'Ocean', color: '#123456' }])
  expect(exported.panels.map(panel => panel.color)).toEqual(['#123456', '#123456'])
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await openInspectorSection(page, 'Material & finish')
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await importProject(page, exported)
  await expect(swatch(page, 'Ocean')).toHaveCount(1)
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')

  await swatch(page, 'Ocean').scrollIntoViewIfNeeded()
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-colors-desktop.png' })
  await page.getByRole('button', { name: 'Add color', exact: true }).click()
  await paletteDialog(page).getByLabel('Color name', { exact: true }).fill('Clay')
  await paletteDialog(page).getByLabel('Hex color', { exact: true }).fill('#ae6e50')
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-palette-manager-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(paletteDialog(page).getByLabel('Color name', { exact: true })).toBeInViewport()
  await expect(paletteDialog(page).getByLabel('Color value', { exact: true })).toBeInViewport()
  await expect(paletteDialog(page).getByRole('button', { name: 'Save color', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-palette-manager-mobile.png' })
  await paletteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await closePalette(page)
  await swatch(page, 'Ocean').scrollIntoViewIfNeeded()
  await expect(swatch(page, 'Ocean')).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Manage palette', exact: true })).toBeInViewport()
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-colors-mobile.png' })
  expect(errors).toEqual([])
})

test('renaming, recoloring, and removing a used color update panels and assembly finishes in one undo step', async ({ page }) => {
  const cube = createExampleProject('cube')
  const assembly = createAssembly({ ...cube, panels: cube.panels.map(panel => ({ ...panel, color: '#123456' })) }, cube.panels.map(panel => panel.id), 'Custom cube')
  const project: Project = {
    ...assembly,
    panels: [...assembly.panels, createPanel({ name: 'Loose panel', color: '#123456', position: [1500, 500, 0] })],
    assemblies: { ...assembly.assemblies!, instances: assembly.assemblies!.instances.map(instance => ({ ...instance, finish: { color: '#123456' } })) },
    customColors: [{ id: 'ocean', name: 'Ocean', color: '#123456' }, { id: 'sand', name: 'Sand', color: '#654321' }],
  }
  await page.goto('/')
  await importProject(page, project)
  await openInspectorSection(page, 'Appearance')
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.panel-color-field input[type=color]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Manage palette', exact: true }).click()
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-palette-list.png' })
  await paletteDialog(page).getByRole('button', { name: 'Edit Ocean', exact: true }).click()
  await paletteDialog(page).getByLabel('Color name', { exact: true }).fill('Deep ocean')
  await paletteDialog(page).getByRole('button', { name: 'Save color', exact: true }).click()
  await closePalette(page)
  await expect(swatch(page, 'Deep ocean')).toHaveAttribute('aria-pressed', 'true')
  const renamed = await exportProject(page)
  expect(renamed.customColors?.[0]).toEqual({ id: 'ocean', name: 'Deep ocean', color: '#123456' })
  expect(renamed.panels.every(panel => panel.color === '#123456')).toBe(true)

  await page.getByRole('button', { name: 'Manage palette', exact: true }).click()
  await paletteDialog(page).getByRole('button', { name: 'Edit Deep ocean', exact: true }).click()
  await paletteDialog(page).getByLabel('Hex color', { exact: true }).fill('#234567')
  await paletteDialog(page).getByRole('button', { name: 'Save color', exact: true }).click()
  await closePalette(page)
  const edited = await exportProject(page)
  expect(edited.customColors?.[0]).toEqual({ id: 'ocean', name: 'Deep ocean', color: '#234567' })
  expect(edited.panels.every(panel => panel.color === '#234567')).toBe(true)
  expect(edited.assemblies!.definitions[0].panels.every(panel => panel.color === '#234567')).toBe(true)
  expect(edited.assemblies!.instances[0].finish?.color).toBe('#234567')
  expect(edited.connections).toEqual(project.connections)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportProject(page)).toEqual(renamed)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportProject(page)).toEqual(edited)

  await page.getByRole('button', { name: 'Manage palette', exact: true }).click()
  await paletteDialog(page).getByRole('button', { name: 'Remove Deep ocean', exact: true }).click()
  await paletteDialog(page).getByLabel('Replacement color', { exact: true }).selectOption('#654321')
  await page.screenshot({ animations: 'disabled', path: 'test-results/custom-palette-remove.png' })
  await paletteDialog(page).getByRole('button', { name: 'Remove color', exact: true }).click()
  await closePalette(page)
  await expect(swatch(page, 'Deep ocean')).toHaveCount(0)
  await expect(swatch(page, 'Sand')).toHaveAttribute('aria-pressed', 'true')
  const removed = await exportProject(page)
  expect(removed.customColors).toEqual([{ id: 'sand', name: 'Sand', color: '#654321' }])
  expect(removed.panels.every(panel => panel.color === '#654321')).toBe(true)
  expect(removed.assemblies!.definitions[0].panels.every(panel => panel.color === '#654321')).toBe(true)
  expect(removed.assemblies!.instances[0].finish?.color).toBe('#654321')
  expect(removed.connections).toEqual(project.connections)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportProject(page)).toEqual(edited)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportProject(page)).toEqual(removed)
  await page.getByRole('button', { name: 'Edit shared design', exact: true }).click()
  await openInspectorSection(page, 'Material & finish')
  await expect(swatch(page, 'Sand')).toHaveAttribute('aria-pressed', 'true')
})

test('legacy colors become project swatches, are available for new panels, and never extend connector colors', async ({ page }) => {
  const source = createStarterProject('shelf')
  const project = { ...source, panels: source.panels.map((panel, index) => index ? panel : { ...panel, color: '#abcdef' }), customColors: ['#123456'] }
  await page.goto('/')
  await importProject(page, project)
  await openInspectorSection(page, 'Material & finish')
  await expect(swatch(page, 'Custom #abcdef')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Custom #123456')).toBeVisible()
  const migrated = await exportProject(page)
  expect(migrated.customColors).toEqual(expect.arrayContaining([
    { id: expect.any(String), name: 'Custom #123456', color: '#123456' },
    { id: expect.any(String), name: 'Custom #abcdef', color: '#abcdef' },
  ]))
  await page.getByRole('button', { name: /^Add a panel/ }).first().click()
  const addDialog = page.getByRole('dialog', { name: 'Bring your own panel.', exact: true })
  await addDialog.getByRole('button', { name: 'Custom #123456 finish', exact: true }).click()
  await expect(addDialog.getByRole('button', { name: 'Custom #123456 finish', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(addDialog.locator('.panel-color-field input[type=color]')).toHaveCount(0)
  await addDialog.getByRole('button', { name: 'Add color', exact: true }).click()
  await paletteDialog(page).getByLabel('Color name', { exact: true }).fill('Clay')
  await paletteDialog(page).getByLabel('Hex color', { exact: true }).fill('#ae6e50')
  await paletteDialog(page).getByRole('button', { name: 'Save color', exact: true }).click()
  const editClay = paletteDialog(page).getByRole('button', { name: 'Edit Clay', exact: true })
  await editClay.focus()
  await editClay.press('Delete')
  await expect(editClay).toBeVisible()
  await closePalette(page)
  await expect(addDialog.getByRole('button', { name: 'Clay finish', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(addDialog.getByRole('button', { name: 'Custom #123456 finish', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await addDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(swatch(page, 'Clay')).toBeVisible()
  const withClay = await exportProject(page)
  expect(withClay.panels).toEqual(migrated.panels)
  expect(withClay.customColors).toEqual(expect.arrayContaining([{ id: expect.any(String), name: 'Clay', color: '#ae6e50' }]))

  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-select').first().click()
  await expect(page.getByRole('group', { name: 'Connector color', exact: true }).getByRole('button')).toHaveCount(6)
  await expect(page.getByRole('button', { name: 'Manage palette', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add color', exact: true })).toHaveCount(0)
  expect((await exportProject(page)).connections).toEqual(migrated.connections)

  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('button', { name: 'Start new project', exact: true }).click()
  await page.getByRole('button', { name: /^Add a panel/ }).first().click()
  await expect(addDialog.getByRole('button', { name: /^Custom #[0-9a-f]+ finish$/ })).toHaveCount(0)
  await expect(addDialog.getByRole('button', { name: 'Clay finish', exact: true })).toHaveCount(0)
  await addDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  await page.locator('.panel-list-select').first().click()
  await openInspectorSection(page, 'Material & finish')
  await expect(swatch(page, 'Custom #123456')).toBeVisible()
  await expect(swatch(page, 'Custom #abcdef')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Clay')).toBeVisible()
})

test('an attachment draft follows palette edits through undo and redo', async ({ page }) => {
  await page.goto('/')
  await importProject(page, {
    version: 1,
    name: 'Attachment palette',
    panels: [createPanel({ name: 'Ocean panel', color: '#123456', width: 600, height: 400, position: [0, 400, 0] })],
    connections: [],
    customColors: [{ id: 'ocean', name: 'Ocean', color: '#123456' }],
  })
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await openInspectorSection(page, 'Material & finish')
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Ocean')).toHaveCSS('background-color', 'rgb(18, 52, 86)')

  await page.getByRole('button', { name: 'Manage palette', exact: true }).click()
  await paletteDialog(page).getByRole('button', { name: 'Edit Ocean', exact: true }).click()
  await paletteDialog(page).getByLabel('Hex color', { exact: true }).fill('#234567')
  await paletteDialog(page).getByRole('button', { name: 'Save color', exact: true }).click()
  await closePalette(page)
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Ocean')).toHaveCSS('background-color', 'rgb(35, 69, 103)')

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Ocean')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect(swatch(page, 'Ocean')).toHaveAttribute('aria-pressed', 'true')
  await expect(swatch(page, 'Ocean')).toHaveCSS('background-color', 'rgb(35, 69, 103)')
})
