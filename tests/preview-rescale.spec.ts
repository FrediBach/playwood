import { readFileSync } from 'node:fs'
import { parseProject } from '../src/lib/model'
import { rescaleProject } from '../src/lib/project-rescale'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { createPanel, createStarterProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
async function importProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'sliders.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await expect.poll(async () => (await saved(page))?.name, { timeout: 15000 }).toBe(project.name)
  const disclosure = page.locator('.preview-rescale')
  if (await disclosure.count()) {
    await expect(disclosure.getByRole('group', { name: 'Common dimensions', includeHidden: true })).toHaveAttribute('aria-busy', 'false', { timeout: 15000 })
    await expect(disclosure).not.toHaveAttribute('open')
    await expect(disclosure.locator('.preview-rescale-count')).toHaveText(String(await disclosure.locator('input[type="range"]').count()))
    await disclosure.locator('summary').click()
  }
}
async function input(slider: Locator, amount: number) {
  await slider.evaluate((element, value) => {
    const input = element as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, amount)
}
function construction() {
  const project = createStarterProject('blank')
  project.name = 'Slider crossing regression'
  project.panels = [0, 2000].map(x => createPanel({ width: 600, height: 300, position: [x, 500, 0] }))
  project.niceValues = { enabled: true, step: 25 }
  return project
}

test('crossing dimensions stays separate during preview, commits once, and survives undo and reload', async ({ page }) => {
  const source = construction()
  source.panels.forEach(panel => { panel.height = 400 })
  await importProject(page, source)
  const original = await saved(page)
  const group = page.getByRole('group', { name: 'Common dimensions', includeHidden: true })
  await expect(group.getByRole('slider')).toHaveCount(2)
  const width = group.getByRole('slider', { name: 'Rescale 600 mm dimension', exact: true })
  const height = group.getByRole('slider', { name: 'Rescale 400 mm dimension', exact: true })
  await expect(width).toHaveAttribute('step', '25')
  const min = await width.getAttribute('min')
  const max = await width.getAttribute('max')
  await expect(width).toHaveAttribute('min', '300')
  await expect(width).toHaveAttribute('max', '1200')
  await input(width, 400)
  await expect(group.getByRole('slider')).toHaveCount(2)
  await expect(height).toHaveValue('400')
  await input(width, 350)
  await expect(width).toHaveValue('350')
  await expect(width).toHaveAttribute('min', min!)
  await expect(width).toHaveAttribute('max', max!)
  await expect(height).toHaveValue('400')
  expect(await saved(page)).toEqual(original)
  await width.dispatchEvent('pointerup')
  await expect.poll(async () => (await saved(page)).panels.map(panel => [panel.width, panel.height])).toEqual([[350, 400], [350, 400]])
  const changed = await saved(page)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(changed)
  await page.reload()
  await page.locator('.preview-rescale > summary').click()
  await expect(group.getByRole('slider', { name: 'Rescale 350 mm dimension', exact: true })).toHaveValue('350')
})

test('Escape cancels and keyboard changes use the configured step in both preview modes', async ({ page }) => {
  await importProject(page, construction())
  const original = await saved(page)
  let slider = page.getByRole('slider', { name: 'Rescale 600 mm dimension', exact: true })
  await input(slider, 800)
  await slider.press('Escape')
  await expect(slider).toHaveValue('600')
  expect(await saved(page)).toEqual(original)
  await slider.press('ArrowRight')
  await expect.poll(async () => (await saved(page)).panels[0].width).toBe(625)
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  slider = page.getByRole('slider', { name: 'Rescale 625 mm dimension', exact: true })
  await slider.press('ArrowLeft')
  await expect.poll(async () => (await saved(page)).panels[0].width).toBe(600)
  await page.setViewportSize({ width: 320, height: 720 })
  const group = page.getByRole('group', { name: 'Common dimensions', includeHidden: true })
  await expect(group).toBeInViewport()
  const heading = page.locator('.preview-rescale > summary')
  await expect(heading).toContainText('Rescale')
  await expect(heading.locator('.preview-rescale-count')).toHaveText('2')
  await heading.click()
  await expect(group).not.toBeVisible()
  await heading.press('Enter')
  await expect(group).toBeVisible()
  const bounds = await group.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  await page.screenshot({ path: 'test-results/preview-rescale-mobile.png' })
})

test('exposes at most four repeated dimensions and omits unique cuts', async ({ page }) => {
  const project = construction()
  project.panels = [100, 200, 300, 400, 500, 600].map((size, i) => createPanel({ width: size, height: size, position: [i * 1000, 500, 0] }))
  await importProject(page, project)
  const sliders = page.getByRole('group', { name: 'Common dimensions', includeHidden: true }).getByRole('slider')
  await expect(sliders).toHaveCount(4)
  project.name = 'No repeating dimensions'
  project.panels = [createPanel({ width: 400, height: 500 })]
  await importProject(page, project)
  await expect(sliders).toHaveCount(0)
})

test('connected slider bounds prevent invalid extremes and pointer cancellation discards the preview', async ({ page }) => {
  const source = createStarterProject()
  source.name = 'Connected slider limits'
  await importProject(page, source)
  const original = await saved(page)
  const slider = page.getByRole('slider', { name: 'Rescale 360 mm dimension', exact: true })
  await input(slider, 420)
  expect(Number(await slider.getAttribute('min'))).toBeGreaterThan(40)
  expect(Number(await slider.getAttribute('max'))).toBeLessThanOrEqual(720)
  await expect(slider).toHaveValue('420')
  await slider.dispatchEvent('pointercancel')
  await expect(slider).toHaveValue('360')
  expect(await saved(page)).toEqual(original)
})


test('synth storage exposes its common cuts and applies the same constrained rescale as the dialog', async ({ page }) => {
  const project = parseProject(JSON.parse(readFileSync(new URL('../src/lib/__fixtures__/synth-storage-resize.json', import.meta.url), 'utf8')))
  await importProject(page, project)
  const original = await saved(page)
  const expected = rescaleProject(original, { 'dimension:300': 310 })
  const slider = page.getByRole('slider', { name: 'Rescale 300 mm dimension', exact: true })
  await expect(slider).toBeVisible()
  await input(slider, 310)
  await expect(slider).toHaveValue('310')
  await slider.dispatchEvent('pointerup')
  await expect.poll(async () => (await saved(page)).panels.map(panel => [panel.width, panel.height])).toEqual(expected.panels.map(panel => [panel.width, panel.height]))
  const actual = await saved(page)
  expect(actual.connections).toEqual(expected.connections)
  expect(actual.constraints).toEqual(expected.constraints)
  for (const panel of expected.panels) {
    const result = actual.panels.find(item => item.id === panel.id)!
    for (let axis = 0; axis < 3; axis++) {
      expect(result.position[axis]).toBeCloseTo(panel.position[axis], 6)
      expect(result.rotation[axis]).toBeCloseTo(panel.rotation[axis], 6)
    }
  }
  await page.screenshot({ path: 'test-results/preview-rescale-synth.png' })
})

test('hides dimensions locked by constraints and shows them again when unlocked', async ({ page }) => {
  const source = construction()
  source.constraints = [{ id: 'locked-width', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', value: 600 }]
  await importProject(page, source)
  const group = page.getByRole('group', { name: 'Common dimensions', includeHidden: true })
  await expect(group.getByRole('slider')).toHaveCount(1)
  await expect(group.getByRole('slider', { name: 'Rescale 300 mm dimension', exact: true })).toBeVisible()
  source.name = 'Unlocked cuts'
  source.constraints = []
  await importProject(page, source)
  await expect(group.getByRole('slider')).toHaveCount(2)
})
