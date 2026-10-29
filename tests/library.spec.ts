import { test, expect, type Page } from '@playwright/test'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
const plinthIds = ['plinth-closed-tall', 'plinth-closed-medium', 'plinth-closed-low', 'plinth-open-tall', 'plinth-open-wide']

async function savedProject(page: Page): Promise<Project | null> {
  return page.evaluate(key => {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }, storageKey)
}

test('library and templates expose separate builds with search, categories and a recoverable empty state', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Project panels' })
  await expect(library.locator('[data-example-id]')).toHaveCount(27)
  const allIds = await library.locator('[data-example-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-example-id')))
  expect(new Set(allIds).size).toBe(allIds.length)

  await library.getByRole('searchbox', { name: 'Search examples' }).fill('  PLINTH  ')
  await expect(library.locator('[data-example-id]')).toHaveCount(5)
  expect(await library.locator('[data-example-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-example-id')))).toEqual(expect.arrayContaining(plinthIds))
  // Variants have their own geometry in the cards, as well as their own labels.
  const previews = await library.locator('.example-art svg').evaluateAll(drawings => drawings.map(drawing => drawing.innerHTML))
  expect(new Set(previews).size).toBe(5)
  await library.getByRole('searchbox', { name: 'Search examples' }).fill('')
  await library.getByRole('combobox', { name: 'Example category' }).selectOption('Shelving')
  await expect(library.locator('.example-compact-caption small').first()).toBeVisible()
  expect(await library.locator('.example-compact-caption small').allTextContents()).toEqual(expect.arrayContaining(['Shelving']))
  expect((await library.locator('.example-compact-caption small').allTextContents()).every(category => category === 'Shelving')).toBe(true)
  await library.getByRole('searchbox', { name: 'Search examples' }).fill('no-such-furniture')
  await expect(library.getByText('No examples match your search.')).toBeVisible()
  await library.getByRole('button', { name: 'Show all examples' }).click()
  await expect(library.getByRole('searchbox', { name: 'Search examples' })).toHaveValue('')
  await expect(library.getByRole('combobox', { name: 'Example category' })).toHaveValue('all')
  await expect(library.locator('[data-example-id]')).toHaveCount(27)

  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-example-id]')).toHaveCount(27)
  expect(await dialog.locator('[data-example-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-example-id')))).toEqual(allIds)
  await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('plinth')
  await expect(dialog.locator('[data-example-id]')).toHaveCount(5)
  await page.screenshot({ path: 'test-results/library-plinth-variants.png' })
  expect(errors).toEqual([])
})

test('distinct plinth examples load editable assemblies, support undo and persist changes', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Project panels' })
  await library.getByRole('searchbox', { name: 'Search examples' }).fill('plinth')
  await library.locator('[data-example-id="plinth-closed-tall"]').click()
  await expect(page.locator('.project-name')).toHaveText('Tall closed plinth')
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Tall closed plinth')
  const tall = (await savedProject(page))!
  expect(tall.panels.length).toBeGreaterThan(1)
  expect(tall.connections.length).toBeGreaterThan(0)
  await expect(page.getByRole('textbox', { name: 'Panel name', exact: true })).toHaveValue(tall.panels[0].name)

  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('plinth')
  await dialog.locator('[data-example-id="plinth-closed-low"]').click()
  await expect(dialog).not.toBeVisible()
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Low closed plinth')
  const low = (await savedProject(page))!
  expect(low.panels.map(panel => [panel.width, panel.height, panel.position])).not.toEqual(tall.panels.map(panel => [panel.width, panel.height, panel.position]))

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.project-name')).toHaveText('Tall closed plinth')
  await expect.poll(async () => await savedProject(page)).toEqual(tall)
  await page.getByRole('button', { name: 'Assembly', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(tall.panels.length)
  await page.locator('.panel-list-select').first().click()
  await page.getByRole('textbox', { name: 'Panel name', exact: true }).fill('My display panel')
  await page.getByRole('textbox', { name: 'Panel name', exact: true }).press('Enter')
  const width = Number(await page.getByLabel('Width', { exact: true }).inputValue()) + 20
  await page.getByLabel('Width', { exact: true }).fill(String(width))
  await page.getByLabel('Width', { exact: true }).press('Tab')
  await expect.poll(async () => (await savedProject(page))?.panels[0]).toMatchObject({ name: 'My display panel', width })
  await page.reload()
  await expect(page.locator('.project-name')).toHaveText('Tall closed plinth')
  await expect(page.locator('.panel-list-row')).toHaveCount(tall.panels.length)
  await expect(page.getByRole('textbox', { name: 'Panel name', exact: true })).toHaveValue('My display panel')
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue(String(width))
  await expect(page.locator('canvas')).toBeVisible()
})

test('mobile library and narrow template dialog keep the catalog scrollable inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const library = page.getByRole('complementary', { name: 'Project panels' })
  await library.getByRole('searchbox', { name: 'Search examples' }).fill('plinth')
  await expect(library.locator('[data-example-id]')).toHaveCount(5)
  await library.locator('[data-example-id="plinth-open-wide"]').scrollIntoViewIfNeeded()
  await expect(library.locator('[data-example-id="plinth-open-wide"]')).toBeVisible()
  expect(await library.locator('.sidebar-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/library-mobile.png' })

  // The header uses the Library drawer on phones; also keep an already-open
  // template dialog usable when its viewport becomes narrow.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-example-id]')).toHaveCount(27)
  await dialog.locator('[data-example-id="blank"]').scrollIntoViewIfNeeded()
  await expect(dialog.locator('[data-example-id="blank"]')).toBeVisible()
  expect(await dialog.evaluate(element => ({
    fits: element.getBoundingClientRect().left >= 0 && element.getBoundingClientRect().right <= innerWidth,
    horizontalOverflow: element.scrollWidth > element.clientWidth,
    canScroll: element.scrollHeight > element.clientHeight,
    scrolled: element.scrollTop > 0,
  }))).toEqual({ fits: true, horizontalOverflow: false, canScroll: true, scrolled: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/library-dialog-mobile.png' })
})

test('diamond shelf loads from its own preview, keeps the 45-degree build, and supports undo and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('diamond')
  const card = dialog.locator('[data-example-id="diamond-shelf"]')
  await expect(card).toContainText('Rotated 45°')
  await expect(card.locator('svg polygon').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/diamond-shelf-library.png' })
  await card.click()
  await expect(page.locator('.project-name')).toHaveText('Diamond shelf')
  await expect(page.locator('[data-assembly-id]')).toHaveCount(4)
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Diamond shelf')
  const saved = (await savedProject(page))!
  expect(saved.panels).toHaveLength(16)
  expect(saved.assemblies?.definitions).toHaveLength(1)
  expect(saved.assemblies?.instances).toHaveLength(4)
  expect(saved.assemblies?.links).toHaveLength(4)
  expect(saved.connections.reduce((count, connection) => count + connection.count, 0)).toBe(24)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(30000)
  await page.screenshot({ path: 'test-results/diamond-shelf-front.png' })
  const attachment = page.locator('.scene-container [data-attachment-id]').first()
  await expect(attachment).toBeInViewport()
  await attachment.hover()
  await expect(page.getByText('Corner connectors replaced with shared cross connectors.', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/diamond-shelf-instance-preview.png' })
  await page.getByRole('combobox', { name: 'Camera view' }).hover()
  expect(await savedProject(page)).toEqual(saved)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('perspective')
  await page.screenshot({ path: 'test-results/diamond-shelf-perspective.png' })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.project-name')).toHaveText('The everyday shelf')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(saved)
  await page.reload()
  await expect(page.locator('.project-name')).toHaveText('Diamond shelf')
  expect(await savedProject(page)).toEqual(saved)
})
