import { expect, test, type Page } from '@playwright/test'
import { createExampleProject } from '../src/lib/example-library'
import { gridProject } from '../src/lib/example-geometry'
import { attachPanel, createPanel } from '../src/lib/model'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

async function importProject(page: Page, project: Project) {
  await page.getByLabel('Import project file').setInputFiles({
    name: 'inspector.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`panel identity and dimensions are immediately usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    if (viewport.width < 680) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
    await expect(page.getByLabel('Panel name', { exact: true })).toBeInViewport()
    for (const label of ['Width', 'Height', 'Thickness']) {
      await expect(page.getByLabel(label, { exact: true })).toBeInViewport()
    }
    await expect(page.getByLabel('Corner radius', { exact: true })).toBeHidden()
    await expect(page.getByLabel('Material', { exact: true })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Attach a panel', exact: true })).toBeInViewport()
    expect(await page.locator('.inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
}

test('multiple panels keep properties first and expose construction tools on demand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.getByRole('heading', { name: '7 panels selected', exact: true })).toBeInViewport()
  await expect(page.getByLabel('Width', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Thickness', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Assembly name', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Opening to close', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Position X', { exact: true })).toBeHidden()
  await openInspectorSection(page, 'Placement details')
  await expect(page.getByLabel('Position X', { exact: true })).toBeDisabled()
  await openInspectorSection(page, 'Create assembly')
  await expect(page.getByLabel('Assembly name', { exact: true })).toBeVisible()
  await page.getByLabel('Assembly name', { exact: true }).fill('Inspector shelf')
  await page.locator('summary').and(page.getByLabel('Create assembly', { exact: true })).click()
  await openInspectorSection(page, 'Create assembly')
  await expect(page.getByLabel('Assembly name', { exact: true })).toHaveValue('Inspector shelf')
  await page.getByRole('button', { name: 'Create assembly', exact: true }).click()
  await expect(page.getByLabel('Instance name', { exact: true })).toHaveValue('Inspector shelf')
  await expect(page.getByLabel('Instance name', { exact: true })).toBeInViewport()
})

test('a context menu opens a hidden construction tool and keeps its draft when reopened', async ({ page }) => {
  await page.goto('/')
  await importProject(page, gridProject('Grid opening', [900], [600]))
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  const divisions = page.getByRole('spinbutton', { name: 'X dividers', exact: true })
  await expect(divisions).toHaveCount(0)
  const openFromMenu = async () => {
    await page.locator('canvas').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Divide into a grid', exact: true }).click()
  }
  await openFromMenu()
  await expect(divisions).toBeFocused()
  await divisions.fill('2')
  await page.locator('summary').and(page.getByLabel('Divide into a grid', { exact: true })).click()
  await expect(divisions).toBeHidden()
  await openFromMenu()
  await expect(divisions).toBeFocused()
  await expect(divisions).toHaveValue('2')
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
})

test('property disclosure preferences follow panel selection without changing values', async ({ page }) => {
  await page.goto('/')
  await openInspectorSection(page, 'Material & finish')
  await page.locator('.panel-list-select').nth(1).click()
  await expect(page.getByLabel('Material', { exact: true })).toBeVisible()
  await page.locator('summary').and(page.getByLabel('Material & finish', { exact: true })).click()
  await page.locator('.panel-list-select').first().click()
  await expect(page.getByLabel('Material', { exact: true })).toBeHidden()
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('1100')
})

test('attachment focuses the task and keeps an invalid preview reason beside Apply', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Build tools', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Panel to attach', { exact: true })).toBeVisible()
  const thickness = page.getByLabel('Thickness', { exact: true })
  await thickness.fill('25')
  await thickness.press('Tab')
  const apply = page.getByRole('button', { name: 'Attach panel', exact: true })
  await expect(apply).toBeDisabled()
  await expect(apply).toBeInViewport()
  await expect(page.locator('.inspector-footer')).toContainText('16–19 mm')
  await expect(page.getByRole('button', { name: 'Cancel preview', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Bottom shelf')
  await expect(page.getByLabel('Panel name', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Thickness', { exact: true })).toHaveValue('18')
})

test('connector construction guidance follows the number and fit of selected pieces', async ({ page }) => {
  const panel = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
  const project = attachPanel({ version: 1, name: 'Connector inspector', panels: [panel], connections: [] }, panel.id,
    createPanel({ width: 300, height: 300 }), { type: '90', side: 'right', flip: false, offset: 0, inset: 0, count: 2, color: '#ff0000' })
  await page.goto('/')
  await importProject(page, project)
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-select').first().click()
  await expect(page.getByRole('group', { name: 'Connector type', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect with a panel', exact: true })).toHaveCount(0)
  await page.locator('.connector-list-select').nth(1).click({ modifiers: ['Shift'] })
  const connect = page.getByRole('button', { name: 'Connect with a panel', exact: true })
  await expect(connect).toBeDisabled()
  await page.getByRole('group', { name: 'Connector type', exact: true }).getByRole('button', { name: 'T connector', exact: true }).click()
  await expect(connect).toBeEnabled()
  await expect(page.getByText('Hardware changed; panel angles stay unchanged.', { exact: false })).toBeVisible()
})

test('assembly values precede build tools and shared editing keeps its scope visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await importProject(page, createExampleProject('assembly-cube'))
  await expect(page.getByLabel('Instance name', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Side length', { exact: true })).toBeInViewport()
  await expect(page.getByRole('group', { name: 'Panel color', exact: true })).toBeHidden()
  await expect(page.getByLabel('Opening to close', { exact: true })).toHaveCount(0)
  await openInspectorSection(page, 'Appearance')
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Panel color', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit shared design', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Done editing', exact: true })).toBeInViewport()
  await expect(page.getByLabel('Width', { exact: true })).toBeDisabled()
  await expect(page.getByText(/affects 2 linked instances/i)).toBeVisible()
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await page.locator('.assembly-tree-toggle').first().click()
  await page.locator('.assembly-tree-panel').first().click()
  await expect(page.getByRole('button', { name: 'Select whole instance', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit shared design', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Done editing', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a copy', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancel attachment', exact: true })).toBeInViewport()
  await expect(page.getByLabel('Side length', { exact: true })).toHaveCount(0)
})
