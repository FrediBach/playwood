import { test, expect, type Page } from '@playwright/test'
import { createPanel, createStarterProject, parseProject, validateProject } from '../src/lib/model'
import { getRescaleValues } from '../src/lib/project-rescale'
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

function valueLabel(project: Project, amount: number) {
  const value = getRescaleValues(project).find(item => item.value === amount)!
  expect(value).toBeDefined()
  return `${value.label} · ${value.value} mm`
}

test('rescales repeated dimensions across panel axes atomically, preserves joints, and persists', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const source = createStarterProject()
  source.panels.push(createPanel({ name: 'Matching loose panel', width: 360, height: 1100, position: [3000, 1000, 0] }))
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'rescale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) })
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rescale creation', exact: true })
  await expect(dialog.getByRole('spinbutton')).toHaveCount(getRescaleValues(original).length)
  await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeDisabled()
  await dialog.getByLabel(valueLabel(original, 1100), { exact: true }).fill('1200')
  await dialog.getByLabel(valueLabel(original, 360), { exact: true }).fill('420')
  await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeEnabled()
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: 'test-results/rescale-dialog.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const rescaled = await exportedProject(page)
  for (const before of original.panels) {
    const after = rescaled.panels.find(panel => panel.id === before.id)!
    for (const dimension of ['width', 'height'] as const) {
      if (before[dimension] === 1100) expect(after[dimension]).toBeCloseTo(1200, 6)
      if (before[dimension] === 360) expect(after[dimension]).toBeCloseTo(420, 6)
    }
    expect(after.thickness).toBe(before.thickness)
  }
  expect(rescaled.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type, connection.count]))
    .toEqual(original.connections.map(connection => [connection.id, connection.parentId, connection.childId, connection.type, connection.count]))
  expect(validateProject(rescaled)).toEqual([])
  expect(parseProject(rescaled)).toEqual(rescaled)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(rescaled)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(rescaled)
  expect(errors).toEqual([])
})

test('rejects invalid values, accepts corrections, and cancels without editing the project', async ({ page }) => {
  await page.goto('/')
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rescale creation', exact: true })
  const dimension = dialog.getByLabel(valueLabel(original, 1100), { exact: true })
  const thickness = dialog.getByLabel(valueLabel(original, 18), { exact: true })
  const apply = dialog.getByRole('button', { name: 'Apply rescale', exact: true })
  await expect(thickness).toHaveAttribute('min', '18')
  await expect(thickness).toHaveAttribute('max', '19')
  for (const invalid of ['', '39', '4001']) {
    await dimension.fill(invalid)
    await expect(apply).toBeDisabled()
  }
  await dimension.fill('1200')
  await expect(apply).toBeEnabled()
  await thickness.fill('20')
  await expect(apply).toBeDisabled()
  await thickness.fill('18')
  await expect(apply).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  await expect(dialog.getByLabel(valueLabel(original, 1100), { exact: true })).toHaveValue('1100')
  await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeDisabled()
})

test('rescale dialog fits a small phone and reset and Escape discard draft values', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rescale creation', exact: true })
  const dimension = dialog.getByLabel(valueLabel(original, 1100), { exact: true })
  await dimension.fill('1200')
  for (const name of ['Reset values', 'Apply rescale', 'Cancel']) {
    await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport()
  }
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: 'test-results/rescale-mobile.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Reset values', exact: true }).click()
  await expect(dimension).toHaveValue('1100')
  await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeDisabled()
  await dimension.fill('1200')
  await dimension.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await exportedProject(page)).toEqual(original)
})

test('keeps a rejected structural edit open for correction without adding an undo step', async ({ page }) => {
  await page.goto('/')
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Rescale creation', exact: true })
  const depth = dialog.getByLabel(valueLabel(original, 360), { exact: true })
  const apply = dialog.getByRole('button', { name: 'Apply rescale', exact: true })
  await depth.fill('40')
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toContainText(/connected|connectors|shared edge/i)
  await depth.fill('420')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await apply.click()
  await expect(dialog).not.toBeVisible()
  const rescaled = await exportedProject(page)
  expect(rescaled.panels.every(panel => panel.height === 420)).toBe(true)
  expect(validateProject(rescaled)).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(original)
})
