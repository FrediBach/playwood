import { expect, test } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

for (const width of [1440, 390]) test(`inspector badges reflect saved settings at ${width}px`, async ({ page }) => {
  const project: Project = {
    version: 1, name: 'Inspector badges', connections: [],
    panels: [
      createPanel({ id: 'custom', name: 'Custom panel', position: [0, 400, 0], customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }),
      createPanel({ id: 'plain', name: 'Plain panel', position: [1200, 400, 0] }),
    ],
    constraints: [{ id: 'width', kind: 'dimension', panelId: 'custom', dimension: 'width', value: 600, enabled: false }],
  }
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'badges.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.locator('.panel-list-select').first().click()
  await page.setViewportSize({ width, height: 900 })
  const openInspector = page.getByRole('button', { name: 'Open inspector', exact: true })
  if (width < 680 && await openInspector.isVisible()) await openInspector.click()
  const shape = page.locator('summary').and(page.getByLabel('Shape & surface', { exact: true }))
  const constraints = page.locator('summary').and(page.getByLabel('Constraints', { exact: true }))
  const shapeBadge = shape.locator('.inspector-disclosure-badge')
  const constraintBadge = constraints.locator('.inspector-disclosure-badge')
  await expect(shape.locator('..')).not.toHaveAttribute('open')
  await expect(shapeBadge).toHaveText('Custom')
  await expect(shapeBadge).toBeVisible()
  await expect(constraintBadge).toHaveText('1')
  await expect(constraints).toHaveAccessibleDescription('1 saved constraints, 1 disabled')
  await expect(constraints).toContainText('0 active')
  await shape.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/inspector-badges-${width}.png` })

  await openInspectorSection(page, 'Shape & surface')
  await page.getByRole('button', { name: 'Remove custom outline', exact: true }).click()
  await expect(shapeBadge).toHaveCount(0)
  await shape.click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: /^Remove constraint:/ }).click()
  await expect(constraintBadge).toHaveCount(0)
  await constraints.click()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(constraintBadge).toHaveText('1')

  if (width < 680) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  }
  await page.locator('.panel-list-select').nth(1).click()
  await expect(shapeBadge).toHaveCount(0)
  await expect(constraintBadge).toHaveCount(0)
  await expect(constraints).toContainText('0 active')
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'All (1)', exact: true }).click()
  await expect(constraintBadge).toHaveText('1')
})
