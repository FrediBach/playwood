import { test, expect } from '@playwright/test'
import { ASSEMBLY_LIBRARY } from '../src/lib/assembly-library'
import { getPhysicalConnectors } from '../src/lib/connector-selection'
import { validateProject } from '../src/lib/model'
import { gridProject } from '../src/lib/example-geometry'

test('choose one assembly opening, close the last directly, undo, and reload', async ({ page }) => {
  const project = ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-cube')!.create()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'box.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const close = page.getByRole('button', { name: 'Close hole', exact: true })
  await expect(close).toBeDisabled()
  const savedCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)
  const choice = page.getByLabel('Opening to close')
  await expect(choice.locator('option')).toHaveCount(3)
  await choice.selectOption({ label: 'Back · 350 × 350 mm' })
  await expect(close).toBeEnabled()
  await close.click()
  await expect(choice).toHaveCount(0)
  await expect(close).toBeEnabled()
  await expect.poll(savedCount).toBe(5)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  expect(getPhysicalConnectors(saved)).toHaveLength(16)
  expect(validateProject(saved)).toEqual([])
  await page.screenshot({ path: 'test-results/close-holes.png' })
  await close.click()
  await expect(close).toHaveCount(0)
  await expect.poll(savedCount).toBe(6)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(close).toBeEnabled()
  await expect.poll(savedCount).toBe(5)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect.poll(savedCount).toBe(6)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect.poll(savedCount).toBe(6)
})

test('selected loose panels expose the same hole choices', async ({ page }) => {
  const project = gridProject('Loose box', [350], [350])
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'loose.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  for (const panel of project.panels.slice(1)) {
    await page.locator('.panel-list-row').filter({ has: page.getByText(panel.name, { exact: true }) }).locator('.panel-list-select').click({ modifiers: ['Shift'] })
  }
  await page.getByLabel('Opening to close').selectOption({ label: 'Front · 350 × 350 mm' })
  await page.getByRole('button', { name: 'Close hole', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(5)
  await expect(page.getByLabel('Opening to close')).toHaveCount(0)
})


test('neighboring closure replaces 90 degree joints with T connectors', async ({ page }) => {
  const project = ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-double-cubby')!.create()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'cubby.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const choice = page.getByLabel('Opening to close')
  await choice.selectOption({ label: 'Front 1 · 350 × 350 mm' })
  await page.getByRole('button', { name: 'Close hole', exact: true }).click()
  await choice.selectOption({ label: 'Front · 350 × 350 mm' })
  await page.getByRole('button', { name: 'Close hole', exact: true }).click()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  await expect.poll(async () => (await saved()).panels.length).toBe(project.panels.length + 2)
  const result = await saved()
  expect(validateProject(result)).toEqual([])
  expect(getPhysicalConnectors(result).filter(connector => connector.type === 't')).toHaveLength(getPhysicalConnectors(project).filter(connector => connector.type === 't').length + 2)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(async () => getPhysicalConnectors(await saved()).filter(connector => connector.type === 't').length).toBe(getPhysicalConnectors(project).filter(connector => connector.type === 't').length)
})
