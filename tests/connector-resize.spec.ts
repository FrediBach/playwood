import { expect, test, type Page } from '@playwright/test'
import { connectorSlide, getConnectorRail } from '../src/lib/connector-movement'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { resolvePanels } from '../src/lib/model'
import type { Project } from '../src/lib/types'

const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
const fractions = (project: Project) => getPhysicalConnectors(project).filter(piece => piece.type === '150').map(piece => {
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
  return (rail.along[piece.index] + connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    - rail.lower) / (rail.upper - rail.lower)
})

test('synth shelf width scales custom connector spacing and survives undo and reload', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles('resources/library-3d/user-projects/three-tier-synth-shelf.json')
  await expect.poll(async () => (await saved(page)).name).toBe('Three-tier synth shelf')
  await page.getByRole('button', { name: 'Deep floor base', exact: true }).click()
  const before = await saved(page)
  const width = page.getByLabel('Width', { exact: true })
  await width.fill('1200')
  await width.press('Enter')
  await expect.poll(async () => (await saved(page)).panels[0].width).toBe(1200)
  const after = await saved(page)
  const original = fractions(before)
  fractions(after).forEach((fraction, index) => expect(fraction).toBeCloseTo(original[index], 7))
  expect(after.connectorOverrides).not.toEqual(before.connectorOverrides)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(() => saved(page)).toEqual(after)
  await page.reload()
  expect(await saved(page)).toEqual(after)
})
