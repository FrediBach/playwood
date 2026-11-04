import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { resolvePanels, validateProject } from '../src/lib/model'
import { outlineConnectionAligned } from '../src/lib/outline-closures'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

const fixturePath = fileURLToPath(new URL('./fixtures/everyday-shelf-angled-opening.json', import.meta.url))
const upperRimNames = ['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side', 'Right upper side (section)']
const angledRimNames = ['Right side', 'Right upper side', 'Panel 8', 'Panel 10', 'Panel 11', 'Panel 12']
const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))

async function selectPanels(page: Page, names: string[]) {
  for (const [index, name] of names.entries()) {
    await page.locator('.panel-list-select').and(page.getByRole('button', { name, exact: true })).click(index ? { modifiers: ['Shift'] } : {})
  }
}

async function importShelf(page: Page) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles(fixturePath)
  await expect.poll(async () => (await saved(page))?.panels.length).toBe(12)
  return saved(page)
}

async function exportProject(page: Page) {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString()) as Project
}

test('the imported upper opening closes across its split T-joint side and survives undo and files', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await importShelf(page)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await openInspectorSection(page, 'Close holes')
  await expect(page.getByLabel('Opening to close').locator('option').filter({ hasText: /^Front \d+ · 752 × 355 mm · Custom outline$/ })).toHaveCount(1)
  await selectPanels(page, upperRimNames)
  await openInspectorSection(page, 'Close holes')
  const choice = page.getByLabel('Opening to close')
  const front = choice.locator('option').filter({ hasText: /^Front ·/ })
  await expect(front).toBeAttached()
  await choice.selectOption((await front.getAttribute('value'))!)
  await page.getByRole('button', { name: 'Close hole', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(13)

  const closed = await saved(page), originalIds = new Set(original.panels.map(panel => panel.id))
  const resolved = resolvePanels(closed), filler = resolved.find(panel => !originalIds.has(panel.id))!
  const supports = closed.connections.filter(connection => connection.childId === filler.id && connection.outlineEdge !== undefined)
  expect(filler.customOutline).toHaveLength(4)
  expect(supports).toHaveLength(5)
  expect(new Set(supports.map(connection => connection.outlineEdge)).size).toBe(4)
  expect(supports.map(connection => resolved.find(panel => panel.id === connection.parentId)!.name).sort()).toEqual([...upperRimNames].sort())
  for (const support of supports) expect(outlineConnectionAligned(resolved.find(panel => panel.id === support.parentId)!, filler, support)).toBe(true)
  for (const originalPanel of resolvePanels(original)) {
    const panel = resolved.find(item => item.id === originalPanel.id)!
    expect([panel.width, panel.height, panel.thickness]).toEqual([originalPanel.width, originalPanel.height, originalPanel.thickness])
    for (let axis = 0; axis < 3; axis++) expect(panel.position[axis]).toBeCloseTo(originalPanel.position[axis], 5)
  }
  expect(validateProject(closed)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(closed)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.screenshot({ path: 'test-results/imported-split-rim-closed.png' })
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(closed)
  expect(await exportProject(page)).toEqual(closed)
  expect(errors).toEqual([])
})

test('the imported angled opening reviews edge alignment and closes beside the upper fill atomically', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const original = await importShelf(page)
  await selectPanels(page, angledRimNames)
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Review hole fit · Front', exact: true }).click()
  const alignment = page.getByRole('region', { name: 'Align frame edges', exact: true })
  const accept = page.getByRole('button', { name: 'Align edges & close hole', exact: true })
  await expect(alignment).toBeVisible()
  await expect(accept).toBeEnabled()
  for (const name of ['Right side', 'Right upper side', 'Panel 8', 'Panel 10']) await expect(alignment).toContainText(name)
  expect(await saved(page)).toEqual(original)

  await page.getByRole('button', { name: 'Collapse panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await accept.scrollIntoViewIfNeeded()
  const alignmentBounds = (await alignment.boundingBox())!
  expect(alignmentBounds.x).toBeGreaterThanOrEqual(0)
  expect(alignmentBounds.x + alignmentBounds.width).toBeLessThanOrEqual(391)
  await page.screenshot({ path: 'test-results/imported-alignment-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Reviewing from the context menu and closing the inspector never accepts
  // the proposed edge extensions. Reload also flushes the current history.
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(original)
  await selectPanels(page, angledRimNames)
  await openInspectorSection(page, 'Close holes')
  const choice = page.getByLabel('Opening to close')
  await choice.selectOption((await choice.locator('option').filter({ hasText: /^Front ·/ }).getAttribute('value'))!)
  await expect(alignment).toBeVisible()
  await accept.click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(13)
  const closed = await saved(page), originalIds = new Set(original.panels.map(panel => panel.id))
  const resolved = resolvePanels(closed), filler = resolved.find(panel => !originalIds.has(panel.id))!
  const supports = closed.connections.filter(connection => connection.childId === filler.id && connection.outlineEdge !== undefined)
  expect(filler.customOutline).toHaveLength(5)
  expect(supports).toHaveLength(6)
  expect(new Set(supports.map(connection => connection.outlineEdge)).size).toBe(5)
  expect(supports.map(connection => resolved.find(panel => panel.id === connection.parentId)!.name).sort()).toEqual([...angledRimNames].sort())
  for (const support of supports) expect(outlineConnectionAligned(resolved.find(panel => panel.id === support.parentId)!, filler, support)).toBe(true)
  const originalPanels = resolvePanels(original)
  expect(resolved.filter(panel => originalIds.has(panel.id) && panel.height > originalPanels.find(item => item.id === panel.id)!.height + 0.1)).toHaveLength(4)
  for (const originalPanel of originalPanels) {
    const panel = resolved.find(item => item.id === originalPanel.id)!
    expect(panel.width).toBeCloseTo(originalPanel.width, 5)
    expect(panel.thickness).toBe(originalPanel.thickness)
    expect(panel.position[0]).toBeCloseTo(originalPanel.position[0], 5)
    expect(panel.position[1]).toBeCloseTo(originalPanel.position[1], 5)
    expect(panel.position[2] - panel.height / 2).toBeCloseTo(originalPanel.position[2] - originalPanel.height / 2, 5)
  }
  expect(validateProject(closed)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(closed)

  await selectPanels(page, upperRimNames)
  await openInspectorSection(page, 'Close holes')
  await choice.selectOption((await choice.locator('option').filter({ hasText: /^Front ·/ }).getAttribute('value'))!)
  await accept.click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(14)
  const both = await saved(page)
  expect(both.panels.filter(panel => panel.customOutline).map(panel => panel.customOutline!.length).sort()).toEqual([4, 5])
  expect(validateProject(both)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(closed)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(both)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.screenshot({ path: 'test-results/imported-both-openings-closed.png' })
  await page.reload()
  await expect.poll(() => saved(page)).toEqual(both)
  const exported = await exportProject(page)
  expect(exported).toEqual(both)
  await writeFile('test-results/everyday-shelf-filled.playwood.json', JSON.stringify(exported, null, 2))
  expect(errors).toEqual([])
})
