import { test, expect, type Page } from './browser-fixture'
import { createPanel } from '../src/lib/model'
import { gridProject } from '../src/lib/example-geometry'
import { MATERIALS } from '../src/lib/materials'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

test('background material generation supplies full-resolution, unchanged texture pixels', async ({ page }) => {
  await page.addInitScript(() => {
    const completed: Record<string, number> = {}
    Object.assign(window, { materialWarmResults: completed })
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (String(url).includes('material-raster.worker')) this.addEventListener('message', event => {
          if (event.data.raster) completed[event.data.material] = event.data.raster.data.byteLength
        })
      }
    }
  })
  await page.goto('/')
  const completed = () => page.evaluate(() => (window as Window & { materialWarmResults?: Record<string, number> }).materialWarmResults)
  await expect.poll(completed, { timeout: 20000 }).toMatchObject({ osb: 5242880, nazena: 5242880, oak: 1572864, walnut: 1572864, mdf: 1572864 })
  const texture = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/src/components/wood-texture.ts'))!
    const { createWoodTextures } = await import(moduleUrl)
    const maps = createWoodTextures('osb')
    const { width, height, data } = maps.color.image
    const hash = await crypto.subtle.digest('SHA-256', data)
    const colorHash = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
    maps.color.dispose(); maps.surface.dispose()
    return { width, height, colorHash }
  })
  expect(texture).toEqual({ width: 1024, height: 1024, colorHash: '0ea1e19f7e9b28e020ca5b328f3e2b1b30aa88c2d0c624043bddcf2e271d755c' })
})

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'materials.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
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

// Sample only the middle of a front-facing board, excluding outlines and handles.
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

for (const material of ['osb', 'nazena'] as const) {
  test(`${material} renders a natural surface and retains edits through history, saving and files`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    const naturalColor = MATERIALS.find(option => option.id === material)!.color
    await page.goto('/')
    await importProject(page, {
      version: 1, name: 'Panel material study', connections: [],
      panels: [createPanel({ name: 'Material sample', width: 800, height: 800, position: [0, 400, 0] })],
    })
    await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
    await page.getByRole('button', { name: 'Show grid', exact: true }).click()
    await openInspectorSection(page, 'Material & finish')
    const selector = page.getByLabel('Material', { exact: true })
    const coverage = page.getByRole('slider', { name: 'Finish coverage' })
    await selector.selectOption(material)
    await expect(selector).toHaveValue(material)
    await expect(coverage).toHaveValue('0')
    await expect.poll(() => faceVariation(page)).toBeGreaterThan(2)
    await page.screenshot({ path: `test-results/panel-${material}-natural.png` })

    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
    await expect(selector).toHaveValue('birch')
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
    await expect(selector).toHaveValue(material)
    await coverage.press('End')
    await expect(coverage).toHaveValue('100')
    await expect.poll(() => faceVariation(page)).toBeLessThan(0.5)
    const exported = await exportProject(page)
    expect(exported.panels[0]).toMatchObject({ material, color: naturalColor, finishCoverage: 1 })
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('playwood-studio-project-v1')!)
      return { material: saved.panels[0].material, finishCoverage: saved.panels[0].finishCoverage }
    })).toEqual({ material, finishCoverage: 1 })

    await page.reload()
    await openInspectorSection(page, 'Material & finish')
    await expect(selector).toHaveValue(material)
    await expect(coverage).toHaveValue('100')
    await importProject(page, exported)
    await expect(selector).toHaveValue(material)
    await expect(coverage).toHaveValue('100')
    await coverage.press('Home')
    await expect.poll(() => faceVariation(page)).toBeGreaterThan(2)

    const cabinet = gridProject(`${material} cabinet`, [450], [650], { depth: 400, connectorColor: '#292b27' })
    await importProject(page, { ...cabinet, panels: cabinet.panels.map(panel => ({ ...panel, material, color: naturalColor })) })
    await page.locator('canvas').press('Escape')
    await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
    await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
    await expect.poll(() => page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(30000)
    await page.screenshot({ path: `test-results/panel-${material}-room.png` })
    await expect(page.getByRole('alert')).not.toBeVisible()
    expect(errors).toEqual([])
  })
}
