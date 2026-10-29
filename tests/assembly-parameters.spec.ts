import { test, expect, type Page } from '@playwright/test'
import { ASSEMBLY_LIBRARY } from '../src/lib/assembly-library'
import { createExampleProject } from '../src/lib/example-library'
import { getProjectBounds, parseProject, validateProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

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

async function importModule(page: Page, id: string) {
  const project = ASSEMBLY_LIBRARY.find(item => item.id === id)!.create()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'module.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.locator('.assembly-tree-select').first().click()
  return project
}

async function setValue(page: Page, name: string, value: number) {
  const input = page.getByLabel(name, { exact: true })
  await input.fill(String(value))
  await input.press('Enter')
  await expect(input).toHaveValue(String(value))
}

test('a cube size changes every bound dimension and survives undo, duplicate, save and reset', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await importModule(page, 'assembly-cube')
  await setValue(page, 'Side length', 420)
  const resized = await exportedProject(page)
  expect(resized.panels.every(panel => panel.width === 420 && panel.height === 420)).toBe(true)
  expect(resized.assemblies!.definitions).toEqual(original.assemblies!.definitions)
  expect(getProjectBounds(resized.panels).min[1]).toBeCloseTo(0)
  expect(validateProject(resized)).toEqual([])
  expect(parseProject(resized)).toEqual(resized)

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.getByLabel('Side length', { exact: true })).toHaveValue('350')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(page.getByLabel('Side length', { exact: true })).toHaveValue('420')
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByLabel('Side length', { exact: true })).toHaveValue('420')
  await setValue(page, 'Side length', 300)
  const varied = await exportedProject(page)
  const [first, second] = varied.assemblies!.instances
  expect(varied.assemblies!.definitions).toHaveLength(1)
  expect(first.parameterValues?.['side-length']).toBe(420)
  expect(second.parameterValues?.['side-length']).toBe(300)
  expect(validateProject(varied)).toEqual([])
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(varied)
  await page.locator('.assembly-tree-select').last().click()
  await page.getByRole('button', { name: 'Reset to assembly defaults', exact: true }).click()
  await expect(page.getByLabel('Side length', { exact: true })).toHaveValue('350')
  const reset = await exportedProject(page)
  expect(reset.assemblies!.instances[0].parameterValues).toEqual(first.parameterValues)
  expect(Object.keys(reset.assemblies!.instances[1].parameterValues ?? {})).toHaveLength(0)
  expect(validateProject(reset)).toEqual([])
  await page.screenshot({ path: 'test-results/assembly-configurable-cubes.png' })
  expect(errors).toEqual([])
})

test('authors one value driving multiple dimensions during creation and edits its shared default', async ({ page }) => {
  test.setTimeout(90000)
  const original = createExampleProject('cube')
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'cube.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(original)) })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByLabel('Assembly name', { exact: true }).fill('Adjustable cube')
  await page.locator('.assembly-create-values summary').click()
  await page.getByRole('button', { name: 'Add editable value', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create assembly', exact: true })).toBeDisabled()
  await page.getByLabel('Value name', { exact: true }).fill('Cube size')
  for (const panel of original.panels) {
    await page.getByRole('checkbox', { name: `${panel.name} width`, exact: true }).check()
    await page.getByRole('checkbox', { name: `${panel.name} height`, exact: true }).check()
  }
  await page.getByRole('button', { name: 'Create assembly', exact: true }).click()
  await expect(page.getByLabel('Cube size', { exact: true })).toHaveValue('350')
  await setValue(page, 'Cube size', 390)
  const configured = await exportedProject(page)
  expect(configured.panels.every(panel => panel.width === 390 && panel.height === 390)).toBe(true)
  expect(configured.assemblies!.definitions[0].parameters![0].bindings).toHaveLength(original.panels.length * 2)
  expect(validateProject(configured)).toEqual([])

  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await expect(page.getByLabel('Width', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Edit values', exact: true }).click()
  await page.locator('.assembly-parameter-toggle').click()
  await setValue(page, 'Default value', 370)
  await page.getByRole('button', { name: 'Save values', exact: true }).click()
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await expect(page.getByLabel('Cube size', { exact: true })).toHaveValue('390')
  await page.getByRole('button', { name: 'Reset to assembly defaults', exact: true }).click()
  await expect(page.getByLabel('Cube size', { exact: true })).toHaveValue('370')
  const reset = await exportedProject(page)
  expect(reset.panels.every(panel => panel.width === 370 && panel.height === 370)).toBe(true)
  expect(parseProject(reset)).toEqual(reset)
  expect(validateProject(reset)).toEqual([])
  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await page.getByRole('button', { name: 'Edit values', exact: true }).click()
  await page.locator('.assembly-parameter-toggle').click()
  await page.screenshot({ path: 'test-results/assembly-parameter-authoring.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.locator('.right-sidebar .inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/assembly-parameter-authoring-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.locator('.assembly-relationships summary').click()
  const multipliers = page.getByLabel('Multiplier', { exact: true })
  for (let index = 0; index < await multipliers.count(); index++) {
    await multipliers.nth(index).fill('0.125')
    await multipliers.nth(index).press('Enter')
    await expect(multipliers.nth(index)).toHaveValue('0.125')
  }
  await setValue(page, 'Default value', 2960)
  await page.getByRole('button', { name: 'Save values', exact: true }).click()
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await setValue(page, 'Cube size', 3200)
  const scaled = await exportedProject(page)
  expect(scaled.panels.every(panel => panel.width === 400 && panel.height === 400)).toBe(true)
  expect(validateProject(scaled)).toEqual([])
})

test('shelf width, height and depth are independent and controls fit a mobile inspector', async ({ page }) => {
  const original = await importModule(page, 'assembly-wide-box')
  await setValue(page, 'Width', 850)
  await setValue(page, 'Height', 320)
  await setValue(page, 'Depth', 420)
  const next = await exportedProject(page)
  expect(next.assemblies!.definitions).toEqual(original.assemblies!.definitions)
  expect(next.panels.filter(panel => panel.name.startsWith('Shelf')).every(panel => panel.width === 850)).toBe(true)
  expect(next.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 320)).toBe(true)
  expect(next.panels.every(panel => panel.height === 420)).toBe(true)
  expect(validateProject(next)).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByLabel('Depth', { exact: true })).toBeVisible()
  expect(await page.locator('.right-sidebar .inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/assembly-configurable-mobile.png' })
})
