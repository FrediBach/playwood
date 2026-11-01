import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createPanel } from '../src/lib/model'

for (const narrow of [false, true]) {
  test(`exports panel SVGs at ${narrow ? 'narrow' : 'desktop'} width`, async ({ page }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const panels = [createPanel({ name: 'Plain' }), createPanel({ name: 'Cut panel', width: 240, height: 240, pattern: 'pegboard', holeSize: 12, holeSpacing: 48, visible: false }), createPanel({ name: 'Rounded', cornerRadius: 20 })]
    await page.getByLabel('Import project file').setInputFiles({ name: 'cuts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Cut files', panels, connections: [] })) })
    await page.getByRole('button', { name: 'Export project', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Export SVG for Plain', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export SVG for Rounded', exact: true })).toBeVisible()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export SVG for Cut panel', exact: true }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe('cut-files-2-cut-panel.svg')
    const svg = await readFile((await download.path())!, 'utf8')
    expect(svg).toContain('width="240mm" height="240mm"')
    expect(svg.match(/id="cutout-/g)).toHaveLength(16)
    const parsed = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'image/svg+xml')
      return { errors: doc.querySelectorAll('parsererror').length, paths: doc.querySelectorAll('path').length }
    }, svg)
    expect(parsed).toEqual({ errors: 0, paths: 17 })
    const box = await page.getByRole('dialog').boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(narrow ? 390 : 1440)
    await page.screenshot({ path: `test-results/panel-svg-${narrow ? 'narrow' : 'desktop'}.png` })
  })
}
