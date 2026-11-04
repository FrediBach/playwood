import { expect, test, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const key = 'playwood-studio-project-v1'
const project: Project = { version: 1, name: 'Spaced shelves', connections: [], panels: [100, 300, 1100].map((y, i) => createPanel({ id: `s${i}`, name: `Shelf ${i}`, width: 500, height: 300, position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0] })) }
const saved = (page: Page): Promise<Project> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)

for (const width of [1440, 390]) test(`distribute through inspector and preview menu with history and reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 })
  await page.addInitScript(({ key, project }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project)) }, { key, project })
  await page.goto('/')
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await expect(canvas).toBeVisible()
  await canvas.focus()
  await page.keyboard.press('ControlOrMeta+a')
  const button = page.getByRole('button', { name: 'Distribute evenly', exact: true })
  await expect(button).toBeVisible()
  await button.click()
  await expect.poll(async () => (await saved(page)).panels[1].position[1]).toBeCloseTo(600, 5)
  const next = await saved(page)
  expect(next.panels[0].position).toEqual(project.panels[0].position)
  expect(next.panels[2].position).toEqual(project.panels[2].position)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => saved(page)).toEqual(next)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(project)
  if (width === 390) await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await canvas.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Distribute evenly', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(next)
  await page.reload()
  expect(await saved(page)).toEqual(next)
})

test('nonparallel selections do not offer distribution', async ({ page }) => {
  const mixed = { ...project, panels: project.panels.map((panel, index) => index === 1 ? { ...panel, rotation: [0, 0, 0] } : panel) }
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify(project)), { key, project: mixed })
  await page.goto('/')
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+a')
  await expect(page.getByRole('button', { name: 'Distribute evenly' })).toHaveCount(0)
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Distribute evenly' })).toHaveCount(0)
})

test('the imported everyday shelf distributes from the context menu without moving its outer shelves', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles('tests/fixtures/everyday-shelf-distribution.json')
  await expect.poll(async () => (await saved(page))?.panels.length).toBe(15)
  const original = await saved(page)
  for (const [index, name] of ['Bottom shelf', 'Middle shelf', 'Top shelf'].entries()) {
    await page.locator('.panel-list-select').and(page.getByRole('button', { name, exact: true })).click(index ? { modifiers: ['Shift'] } : {})
  }
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Distribute evenly', exact: true }).click()
  const bottom = original.panels.find(panel => panel.name === 'Bottom shelf')!
  const top = original.panels.find(panel => panel.name === 'Top shelf')!
  await expect.poll(async () => (await saved(page)).panels.find(panel => panel.name === 'Middle shelf')!.position[1]).toBeCloseTo((bottom.position[1] + top.position[1]) / 2, 4)
  const next = await saved(page)
  for (const panel of [bottom, top]) next.panels.find(item => item.id === panel.id)!.position.forEach((value, axis) => expect(value).toBeCloseTo(panel.position[axis], 4))
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => saved(page)).toEqual(original)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => saved(page)).toEqual(next)
  await page.reload()
  expect(await saved(page)).toEqual(next)
})
