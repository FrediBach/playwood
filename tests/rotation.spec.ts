import { test, expect, type Page } from '@playwright/test'
import { createStarterProject, getProjectBounds, resolvePanels } from '../src/lib/model'
import { EXAMPLE_LIBRARY } from '../src/lib/example-library'
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

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'rotation.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

test('whole-creation quarter turn updates geometry, supports undo/redo, and persists through reload and import', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const original = await exportedProject(page)
  const before = getProjectBounds(resolvePanels(original))
  const selectedName = await page.getByLabel('Panel name').inputValue()
  await page.getByRole('button', { name: 'Rotate creation', exact: true }).click()
  await expect(page.getByLabel('Rotation axis')).toHaveValue('z')
  await expect(page.getByLabel('Rotation angle')).toHaveValue('90')
  await page.getByRole('button', { name: 'Rotate creation by +90°', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByLabel('Panel name')).toHaveValue(selectedName)
  await expect(page.getByRole('combobox', { name: 'Orientation', exact: true })).toHaveValue('custom')
  const rotated = await exportedProject(page)
  const after = getProjectBounds(resolvePanels(rotated))
  expect(after.width).toBeCloseTo(before.height, 3)
  expect(after.height).toBeCloseTo(before.width, 3)
  expect(after.depth).toBeCloseTo(before.depth, 3)
  expect(after.min[1]).toBeCloseTo(before.min[1], 3)
  expect(rotated.connections).toEqual(original.connections)
  await page.screenshot({ path: 'test-results/rotation-quarter-turn.png' })

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(rotated)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(rotated)
  await importProject(page, original)
  await importProject(page, rotated)
  expect(await exportedProject(page)).toEqual(rotated)
  expect(errors).toEqual([])
})

test('phone rotation dialog supports 45-degree tilt, cancel, room rotation, and empty creations', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/')
  const cube = EXAMPLE_LIBRARY.find(example => example.name === 'Cube')!.create()
  await importProject(page, cube)
  await page.getByRole('button', { name: 'Rotate creation', exact: true }).click()
  await page.getByLabel('Rotation angle').selectOption('45')
  await expect(page.getByRole('button', { name: 'Rotate creation by −45°', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Rotate creation by +45°', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/rotation-dialog-mobile.png' })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(cube)

  await page.getByRole('button', { name: 'Rotate creation', exact: true }).click()
  await page.getByLabel('Rotation angle').selectOption('45')
  await page.getByRole('button', { name: 'Rotate creation by −45°', exact: true }).click()
  const tilted = await exportedProject(page)
  const originalBounds = getProjectBounds(resolvePanels(cube))
  const tiltedBounds = getProjectBounds(resolvePanels(tilted))
  expect(tiltedBounds.width).toBeGreaterThan(originalBounds.width)
  expect(tiltedBounds.height).toBeGreaterThan(originalBounds.height)
  await page.screenshot({ path: 'test-results/rotation-diagonal-mobile.png' })

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  expect(await exportedProject(page)).toEqual(tilted)
  await page.getByRole('button', { name: 'Rotate creation', exact: true }).click()
  await page.getByLabel('Rotation axis').selectOption('y')
  await page.getByRole('button', { name: 'Rotate creation by +90°', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Realistic preview', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const turned = getProjectBounds(resolvePanels(await exportedProject(page)))
  expect(turned.depth).toBeCloseTo(tiltedBounds.width, 3)
  expect(turned.width).toBeCloseTo(tiltedBounds.depth, 3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await importProject(page, createStarterProject('blank'))
  await expect(page.getByRole('button', { name: 'Rotate creation', exact: true })).toBeDisabled()
})
