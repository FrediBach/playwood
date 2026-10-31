import { test, expect, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import { createExampleProject } from '../src/lib/example-library'
import type { Project } from '../src/lib/types'

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'finish.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

async function exportProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

// Inspect the rendered face itself: solid coverage must remove grain and bump
// shading, while an intermediate finish still shows a softer version of both.
async function faceVariation(page: Page) {
  return page.locator('canvas').evaluate(async element => {
    const image = new Image()
    image.src = (element as HTMLCanvasElement).toDataURL()
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')!
    context.drawImage(image, image.width * 0.4, image.height * 0.4, image.width * 0.2, image.height * 0.2, 0, 0, 128, 128)
    const pixels = context.getImageData(0, 0, 128, 128).data
    let sum = 0, square = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const value = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
      sum += value; square += value * value
    }
    const count = pixels.length / 4
    return Math.sqrt(Math.max(0, square / count - (sum / count) ** 2))
  })
}

test('finish fades rendered grain to solid color and survives undo, save and export', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await importProject(page, { version: 1, name: 'Finish test', connections: [], panels: [createPanel({ width: 1000, height: 1000, position: [0, 500, 0] })] })
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Show grid', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Finish coverage' })
  await expect(slider).toHaveValue('0')
  await expect.poll(() => faceVariation(page)).toBeGreaterThan(2)
  const natural = await faceVariation(page)
  await page.screenshot({ path: 'test-results/finish-natural.png' })

  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + 8, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.move(box.x + box.width / 2, box.y - 30)
  await page.mouse.up()
  await expect(slider).toHaveValue('50')
  await expect.poll(() => faceVariation(page)).toBeLessThan(natural * 0.8)
  expect(await faceVariation(page)).toBeGreaterThan(0.5)
  await page.screenshot({ path: 'test-results/finish-partial.png' })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(slider).toHaveValue('0')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(slider).toHaveValue('50')

  await slider.press('End')
  await expect(slider).toHaveValue('100')
  await expect.poll(() => faceVariation(page)).toBeLessThan(0.5)
  await page.screenshot({ path: 'test-results/finish-solid.png' })
  const exported = await exportProject(page)
  expect(exported.panels[0]).toMatchObject({ material: 'birch', finishCoverage: 1 })
  await page.reload()
  await expect(slider).toHaveValue('100')
  await importProject(page, exported)
  await expect(slider).toHaveValue('100')
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(slider).toHaveValue('100')
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  await expect(page.getByRole('alert')).not.toBeVisible()
  expect(errors).toEqual([])
})

test('shared finishes update together and painted boards remain solid', async ({ page }) => {
  await page.goto('/')
  await importProject(page, { version: 1, name: 'Finishes', connections: [], panels: [
    createPanel({ name: 'Natural', position: [-400, 500, 0] }),
    createPanel({ name: 'Walnut', material: 'walnut', position: [400, 500, 0] }),
    createPanel({ name: 'Painted', material: 'painted', position: [0, 1000, 0] }),
  ] })
  await page.locator('.panel-list-select').nth(1).click({ modifiers: ['Shift'] })
  const slider = page.getByRole('slider', { name: 'Finish coverage' })
  await slider.press('End')
  const finished = await exportProject(page)
  expect(finished.panels.slice(0, 2).map(panel => panel.finishCoverage)).toEqual([1, 1])
  expect(finished.panels.slice(0, 2).map(panel => panel.material)).toEqual(['birch', 'walnut'])
  await page.locator('.panel-list-select').nth(0).click()
  await slider.press('Home')
  await page.locator('.panel-list-select').nth(1).click({ modifiers: ['Shift'] })
  await expect(slider).toBeDisabled()
  await expect(slider).toHaveAttribute('aria-valuetext', 'Mixed')
  await page.locator('.panel-list-select').nth(2).click()
  await expect(slider).toBeDisabled()
  await expect(slider).toHaveValue('100')
  await page.getByLabel('Material', { exact: true }).selectOption('oak')
  await expect(slider).toBeEnabled()
  await expect(slider).toHaveValue('0')
  await page.setViewportSize({ width: 390, height: 844 })
  await slider.scrollIntoViewIfNeeded()
  await expect(slider).toBeInViewport()
  await slider.press('End')
  await expect(slider).toHaveValue('100')
  await page.screenshot({ path: 'test-results/finish-mobile.png' })
})

test('instance finish coverage and color overrides reset independently', async ({ page }) => {
  await page.goto('/')
  const cube = createExampleProject('cube')
  await importProject(page, { ...cube, panels: cube.panels.map(panel => ({ ...panel, material: 'birch' })) })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('button', { name: 'Create assembly', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Finish coverage' })
  await page.getByLabel('Instance panel color').fill('#94a18c')
  await slider.press('End')
  const finished = await exportProject(page)
  expect(finished.assemblies!.instances.map(instance => instance.finish?.finishCoverage ?? 0)).toEqual([0, 1])
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(slider).toHaveValue('100')
  expect((await exportProject(page)).assemblies!.instances[1].finish).toEqual({ finishCoverage: 1 })
  await page.getByLabel('Instance panel color').fill('#94a18c')
  await page.getByRole('button', { name: 'Reset instance finish coverage' }).click()
  await expect(slider).toHaveValue('0')
  expect((await exportProject(page)).assemblies!.instances[1].finish).toEqual({ color: '#94a18c' })
})
