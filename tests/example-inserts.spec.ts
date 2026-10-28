import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { getProjectBounds, resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
const legacyShelf = JSON.parse(readFileSync(new URL('../src/lib/fixtures/legacy-example-inserts.json', import.meta.url), 'utf8'))['modular-shelf'] as Project

async function savedProject(page: Page): Promise<Project | null> {
  return page.evaluate(key => {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }, storageKey)
}

function dividerHeights(project: Project | null): number[] {
  return project?.panels.filter(panel => panel.name.endsWith(' divider')).map(panel => panel.height) ?? []
}

/** Check both supporting faces, rather than just a template-specific height. */
function expectSupportedDividers(project: Project): void {
  const panels = resolvePanels(project)
  const shelves = panels.filter(panel => panel.thickness === 18).map(panel => getProjectBounds([panel]))
    .filter(bounds => Math.abs(bounds.height - 18) < 0.000001)
  const dividers = panels.filter(panel => panel.name.endsWith(' divider'))
  expect(dividers).toHaveLength(4)
  for (const divider of dividers) {
    const bounds = getProjectBounds([divider])
    const spanning = shelves.filter(shelf => shelf.min[0] < divider.position[0] && shelf.max[0] > divider.position[0])
    const floor = Math.max(...spanning.filter(shelf => shelf.max[1] < divider.position[1]).map(shelf => shelf.max[1]))
    const ceiling = Math.min(...spanning.filter(shelf => shelf.min[1] > divider.position[1]).map(shelf => shelf.min[1]))
    expect(bounds.min[1], `${divider.name} rests on the shelf below`).toBeCloseTo(floor, 6)
    expect(bounds.max[1], `${divider.name} reaches the shelf above`).toBeCloseTo(ceiling, 6)
  }
}

test('modular shelf inserts fill their compartments in the library and exported project', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search examples' }).fill('modular rectangular')
  await page.locator('[data-example-id="modular-shelf"]').click()
  await expect(page.locator('.project-name')).toHaveText('Modular rectangular shelf')
  await expect.poll(async () => dividerHeights(await savedProject(page))).toEqual([367, 367, 367, 367])
  expectSupportedDividers((await savedProject(page))!)

  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const download = await downloadPromise
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8')) as Project
  expectSupportedDividers(exported)
  await page.getByRole('button', { name: 'Close dialog' }).click()

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(30000)
  await page.getByRole('main', { name: '3D assembly workspace' }).screenshot({ path: 'test-results/modular-shelf-supported-inserts.png' })
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
  await page.getByRole('main', { name: '3D assembly workspace' }).screenshot({ path: 'test-results/modular-shelf-supported-inserts-front.png' })
  expect(errors).toEqual([])
})

test('saved floating dividers are repaired once, with undo, redo and persistence', async ({ page }) => {
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key: storageKey, project: legacyShelf })
  await page.goto('/')
  await expect(page.getByText('Library inserts fitted to their compartments. Undo is available.')).toBeVisible()
  // Initial software-WebGL compilation can defer the first autosave timer.
  await expect.poll(async () => dividerHeights(await savedProject(page)), { timeout: 15000 }).toEqual([367, 367, 367, 367])
  const repaired = (await savedProject(page))!
  expect(repaired.panels.map(panel => panel.id)).toEqual(legacyShelf.panels.map(panel => panel.id))
  expectSupportedDividers(repaired)

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(legacyShelf)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(repaired)
  await page.reload()
  await expect.poll(() => savedProject(page)).toEqual(repaired)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expectSupportedDividers((await savedProject(page))!)
})
