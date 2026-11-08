import { expect, test, type Page } from '@playwright/test'
import { createPanel, getProjectBounds, resolvePanels } from '../src/lib/model'
import { synthStorageShelfProject } from '../src/lib/synth-storage-shelf'
import type { Project } from '../src/lib/types'
import { openInspectorSection } from './inspector-helpers'

async function importProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'constraints.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
}

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

async function setValue(page: Page, label: string, value: number) {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(String(value))
  await field.press('Enter')
}

const shelfProject = (): Project => ({ version: 1, name: 'Shelf constraints', connections: [], panels: [
  createPanel({ id: 'lower', name: 'Lower shelf', width: 600, height: 400, thickness: 18, position: [0, 209, 0], rotation: [-Math.PI / 2, 0, 0] }),
  createPanel({ id: 'upper', name: 'Upper shelf', width: 600, height: 400, thickness: 18, position: [0, 609, 0], rotation: [-Math.PI / 2, 0, 0] }),
] })

test('duplicating constrained panels copies their shared rule and leaves the floor rule on the originals', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [
    { id: 'equal', enabled: true, kind: 'equal-dimension', panelIds: ['lower', 'upper'], dimension: 'height' },
    { id: 'floor', enabled: true, kind: 'floor', panelId: 'lower', reference: 'max', value: 218 },
  ]
  await importProject(page, project)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.locator('canvas').focus()
  await page.keyboard.press('ControlOrMeta+d')
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  const duplicated = await exportedProject(page)
  const copies = duplicated.panels.filter(panel => !project.panels.some(original => original.id === panel.id))
  expect(copies).toHaveLength(2)
  expect(duplicated.constraints).toHaveLength(3)
  expect(duplicated.constraints).toEqual(expect.arrayContaining(project.constraints))
  const copiedRule = duplicated.constraints!.find(rule => rule.id !== 'equal' && rule.id !== 'floor')!
  expect(copiedRule).toMatchObject({ kind: 'equal-dimension', dimension: 'height', enabled: true, panelIds: copies.map(panel => panel.id) })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  const undone = await exportedProject(page)
  expect(undone.panels).toHaveLength(2)
  expect(undone.constraints).toEqual(project.constraints)
})

for (const width of [1440, 390]) test(`constraints stay hidden without selection unless explicitly opened at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const project = shelfProject()
  project.constraints = [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'lower', reference: 'max', value: 218 }]
  await importProject(page, project)
  const original = await exportedProject(page)
  if (width < 680) await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await openInspectorSection(page, 'Constraints')
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  const empty = page.getByRole('heading', { name: 'A little more detail.', exact: true })
  const section = page.locator('summary').and(page.getByLabel('Constraints', { exact: true }))
  await expect(empty).toBeVisible()
  await expect(section).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add constraint', exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('empty-inspector.png') })

  if (width < 680) await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  await expect(section).toBeVisible()
  await expect(empty).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Edit constraint:/ })).toBeVisible()
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByLabel('Constraint type', { exact: true }).press('Escape')
  await expect(page.getByRole('group', { name: 'New constraint', exact: true })).toHaveCount(0)
  await expect(section).toBeVisible()
  await page.getByRole('button', { name: 'Done managing constraints', exact: true }).click()
  await expect(empty).toBeVisible()
  await expect(section).toHaveCount(0)

  if (width < 680) await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await expect(empty).toBeVisible()
  await expect(section).toHaveCount(0)

  if (width === 1440) {
    await page.getByRole('button', { name: 'All constraints', exact: true }).click()
    await page.locator('.panel-list-select').first().click()
    await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Lower shelf')
    await page.locator('canvas').focus()
    await page.keyboard.press('Escape')
    await expect(section).toHaveCount(0)
    await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(empty).toBeVisible()
    await expect(section).toHaveCount(0)
  }
  expect(await exportedProject(page)).toEqual(original)
})

test('floor rules preview, reject conflicts, and persist as one undoable edit', async ({ page }) => {
  await importProject(page, shelfProject())
  await page.locator('.panel-list-select').first().click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await expect(page.getByLabel('Constraint type', { exact: true })).toBeFocused()
  await setValue(page, 'Height above floor', 800)
  await expect(page.locator('.constraint-status')).toContainText('Lower shelf')
  await page.screenshot({ path: test.info().outputPath('floor-preview.png') })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await exportedProject(page)).constraints ?? []).toHaveLength(0)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await setValue(page, 'Height above floor', 800)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const saved = await exportedProject(page)
  expect(saved.constraints).toHaveLength(1)
  expect(saved.constraints?.[0]).toMatchObject({ kind: 'floor', reference: 'max', value: 800, enabled: true })
  expect(getProjectBounds(resolvePanels(saved).filter(panel => panel.id === 'lower')).max[1]).toBeCloseTo(800)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  const undone = await exportedProject(page)
  expect(undone.constraints ?? []).toHaveLength(0)
  expect(resolvePanels(undone).find(panel => panel.id === 'lower')?.position[1]).toBe(209)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(saved)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await setValue(page, 'Height above floor', 900)
  await expect(page.getByRole('button', { name: 'Add constraint', exact: true })).toBeDisabled()
  await expect(page.locator('.constraint-status.is-blocked')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(saved)
  await page.reload()
  expect(await exportedProject(page)).toEqual(saved)
})

test('thickness edits maintain floor heights for one or multiple panels', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [
    { id: 'lower-height', kind: 'floor', enabled: true, panelId: 'lower', reference: 'max', value: 218 },
    { id: 'upper-height', kind: 'floor', enabled: true, panelId: 'upper', reference: 'max', value: 618 },
  ]
  await importProject(page, project)
  await page.locator('.panel-list-select').first().click()
  const original = await exportedProject(page)
  await setValue(page, 'Thickness', 20)
  const single = await exportedProject(page)
  expect(single.panels.map(panel => panel.thickness)).toEqual([20, 18])
  expect(single.panels.map(panel => panel.position[1])).toEqual([208, 609])
  expect(single.constraints).toEqual(original.constraints)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await setValue(page, 'Thickness', 20)
  const multiple = await exportedProject(page)
  expect(multiple.panels.map(panel => panel.thickness)).toEqual([20, 20])
  expect(multiple.panels.map(panel => panel.position[1])).toEqual([208, 608])
  expect(multiple.constraints).toEqual(original.constraints)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
})

test('legacy exact floor rules can become maximums and saved ranges without moving valid panels', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [{ id: 'floor-height', kind: 'floor', enabled: true, panelId: 'lower', reference: 'max', value: 218 }]
  await importProject(page, project)
  await page.locator('.panel-list-select').first().click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: /^Edit constraint:/ }).click()
  await expect(page.getByLabel('Measurement requirement', { exact: true })).toHaveValue('exact')
  await page.getByLabel('Measurement requirement', { exact: true }).selectOption('maximum')
  await setValue(page, 'Height above floor', 300)
  await expect(page.locator('.constraint-status')).toContainText('already meets')
  await page.getByRole('button', { name: 'Save constraint', exact: true }).click()
  const maximum = await exportedProject(page)
  expect(maximum.constraints?.[0]).toMatchObject({ relation: 'maximum', value: 300 })
  expect(maximum.panels.find(panel => panel.id === 'lower')?.position[1]).toBe(209)
  await page.getByRole('button', { name: /^Edit constraint:/ }).click()
  await page.getByLabel('Measurement requirement', { exact: true }).selectOption('range')
  await setValue(page, 'Minimum height', 100)
  await setValue(page, 'Maximum height', 400)
  await page.getByLabel('Measurement requirement', { exact: true }).selectOption('minimum')
  await expect(page.getByLabel('Height above floor', { exact: true })).toHaveValue('100')
  await page.getByLabel('Measurement requirement', { exact: true }).selectOption('range')
  await expect(page.getByLabel('Minimum height', { exact: true })).toHaveValue('100')
  await expect(page.getByLabel('Maximum height', { exact: true })).toHaveValue('400')
  await page.getByRole('button', { name: 'Save constraint', exact: true }).click()
  const range = await exportedProject(page)
  expect(range.constraints?.[0]).toMatchObject({ relation: 'range', min: 100, max: 400 })
  expect(range.constraints?.[0]).not.toHaveProperty('value')
  expect(range.panels).toEqual(maximum.panels)
  await page.reload()
  expect(await exportedProject(page)).toEqual(range)
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: /^Edit constraint:/ }).click()
  await expect(page.getByLabel('Measurement requirement', { exact: true })).toHaveValue('range')
  await setValue(page, 'Minimum height', 450)
  await expect(page.getByLabel('Minimum height', { exact: true })).toHaveValue('450')
  await expect(page.getByLabel('Maximum height', { exact: true })).toHaveValue('400')
  await expect(page.locator('.constraint-status.is-blocked')).toContainText('Minimum must be less than or equal to maximum')
  await expect(page.getByRole('button', { name: 'Save constraint', exact: true })).toBeDisabled()
  await setValue(page, 'Maximum height', 500)
  await expect(page.getByRole('button', { name: 'Save constraint', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(range)
})

test('dimension ranges allow interior edits and reject changes beyond either bound', async ({ page }) => {
  const project: Project = { version: 1, name: 'Dimension limits', connections: [], panels: [
    createPanel({ id: 'side', name: 'Side', width: 400, height: 400, position: [0, 500, 0] }),
  ] }
  await importProject(page, project)
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByLabel('Constraint type', { exact: true }).selectOption('dimension')
  await page.getByLabel('Measurement requirement', { exact: true }).selectOption('range')
  await setValue(page, 'Minimum dimension', 300)
  await setValue(page, 'Maximum dimension', 500)
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  expect((await exportedProject(page)).panels[0].height).toBe(400)
  await setValue(page, 'Height', 450)
  const inside = await exportedProject(page)
  expect(inside.panels[0].height).toBe(450)
  await setValue(page, 'Height', 550)
  expect(await exportedProject(page)).toEqual(inside)
  await setValue(page, 'Height', 250)
  expect(await exportedProject(page)).toEqual(inside)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect((await exportedProject(page)).panels[0].height).toBe(400)
})

test('maximum gap rules bring distant panels to their upper limit', async ({ page }) => {
  await importProject(page, shelfProject())
  await page.locator('.panel-list-select').first().click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByLabel('Constraint type', { exact: true }).selectOption('gap')
  await page.getByLabel('Gap requirement', { exact: true }).selectOption('maximum')
  await setValue(page, 'Required gap', 200)
  await expect(page.locator('.constraint-status')).toContainText('Upper shelf')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const saved = await exportedProject(page)
  expect(saved.constraints?.[0]).toMatchObject({ kind: 'gap', relation: 'maximum', value: 200 })
  expect(saved.panels.find(panel => panel.id === 'lower')?.position[1]).toBe(209)
  expect(saved.panels.find(panel => panel.id === 'upper')?.position[1]).toBe(427)
})

test('equal cut dimensions update both panels and preserve the shared rule', async ({ page }) => {
  const project: Project = { version: 1, name: 'Equal sides', connections: [], panels: [
    createPanel({ id: 'left', name: 'Left side', width: 300, height: 600, position: [-400, 300, 0] }),
    createPanel({ id: 'right', name: 'Right side', width: 300, height: 400, position: [400, 200, 0] }),
  ] }
  await importProject(page, project)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await expect(page.getByLabel('Constraint type', { exact: true })).toHaveValue('equal-dimension')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const matched = await exportedProject(page)
  expect(matched.panels.map(panel => panel.height)).toEqual([600, 600])
  await page.locator('.panel-list-select').first().click()
  await setValue(page, 'Height', 700)
  const resized = await exportedProject(page)
  expect(resized.panels.map(panel => panel.height)).toEqual([700, 700])
  expect(resized.constraints).toEqual(matched.constraints)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(matched)
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  await expect(page.getByRole('group', { name: 'New constraint', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.getByRole('group', { name: 'New constraint', exact: true })).toHaveCount(0)
  await page.locator('.panel-list-select').first().click()
  await expect(page.getByRole('group', { name: 'New constraint', exact: true })).toHaveCount(0)
})

test('minimum gaps remain slack and disabled rules require a preview to reactivate', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [{ id: 'shelf-gap', kind: 'gap', enabled: true, panelIds: ['lower', 'upper'], axis: 'y', relation: 'minimum', value: 200 }]
  await importProject(page, project)
  await page.locator('.panel-list-select').first().click()
  await openInspectorSection(page, 'Constraints')
  const unchanged = await exportedProject(page)
  expect(unchanged.panels.find(panel => panel.id === 'upper')?.position[1]).toBe(609)
  const enabled = page.getByRole('checkbox', { name: /^Enable constraint:/ })
  await enabled.uncheck()
  expect((await exportedProject(page)).constraints?.[0].enabled).toBe(false)
  await enabled.click()
  await expect(page.getByRole('group', { name: 'Edit constraint', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await exportedProject(page)).constraints?.[0].enabled).toBe(false)
  await enabled.click()
  await page.getByRole('button', { name: 'Save constraint', exact: true }).click()
  expect((await exportedProject(page)).constraints?.[0].enabled).toBe(true)
})

test('a panel picked in the scene updates the draft without changing selection', async ({ page }) => {
  const project: Project = { version: 1, name: 'Pick panels', connections: [], panels: [
    createPanel({ id: 'left', name: 'Left side', width: 300, height: 600, position: [-400, 300, 0] }),
    createPanel({ id: 'right', name: 'Right side', width: 300, height: 600, position: [400, 300, 0] }),
  ] }
  await importProject(page, project)
  await page.locator('.panel-list-select').first().click()
  await page.getByLabel('Camera view', { exact: true }).selectOption('front')
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByRole('button', { name: 'Pick constrained panel in preview', exact: true }).click()
  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  const zoom = Math.min(box.width / 1.26, box.height / 0.76) * 0.74
  await canvas.click({ position: { x: box.width / 2 + 0.4 * zoom, y: box.height / 2 } })
  await expect(page.getByLabel('Constrained panel', { exact: true })).toHaveValue('right')
  await expect(page.getByRole('checkbox', { name: 'Select Left side', exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await exportedProject(page)).constraints ?? []).toHaveLength(0)
})

test('constraint editing fits a narrow inspector and Escape restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const project = shelfProject()
  project.constraints = [
    { id: 'lower-height', kind: 'floor', enabled: true, panelId: 'lower', reference: 'max', value: 218 },
    { id: 'upper-height', kind: 'floor', enabled: true, panelId: 'upper', reference: 'max', value: 618 },
  ]
  await importProject(page, project)
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByLabel('Constraint type', { exact: true }).selectOption('gap')
  await expect(page.getByLabel('Lower panel', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Upper panel', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pick upper panel in preview', exact: true }).click()
  await expect(page.getByLabel('Upper panel', { exact: true })).toBeHidden()
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Upper panel', { exact: true })).toBeVisible()
  await page.getByLabel('Required gap', { exact: true }).scrollIntoViewIfNeeded()
  await setValue(page, 'Required gap', 500)
  await expect(page.locator('.constraint-status.is-blocked')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add constraint', exact: true })).toBeDisabled()
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('narrow-conflict.png') })
  await setValue(page, 'Required gap', 200)
  await page.getByLabel('Gap requirement', { exact: true }).selectOption('range')
  await setValue(page, 'Maximum gap', 500)
  await expect(page.getByLabel('Minimum gap', { exact: true })).toHaveValue('200')
  await expect(page.getByLabel('Maximum gap', { exact: true })).toHaveValue('500')
  await expect(page.locator('.constraint-status')).toContainText('already meets')
  await page.screenshot({ path: test.info().outputPath('narrow-range.png') })
  const apply = page.getByRole('button', { name: 'Add constraint', exact: true })
  await apply.scrollIntoViewIfNeeded()
  await expect(apply).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
  expect(await page.locator('.inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByLabel('Gap requirement', { exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'New constraint', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add constraint', exact: true })).toBeFocused()
})


test('matches different cut axes through preview, cancellation, history and reload', async ({ page }) => {
  const project: Project = { version: 1, name: 'Different cuts', connections: [], panels: [
    createPanel({ id: 'left', name: 'Left panel', width: 600, height: 250, position: [-1000, 1200, 0] }),
    createPanel({ id: 'right', name: 'Right panel', width: 350, height: 400, position: [1000, 1200, 0] }),
  ] }
  await importProject(page, project)
  const original = await exportedProject(page)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await openInspectorSection(page, 'Constraints')
  const start = async () => {
    await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
    await page.getByLabel('First panel cut dimension', { exact: true }).selectOption('width')
    await expect(page.getByLabel('Second panel cut dimension', { exact: true })).toHaveValue('height')
    await page.getByLabel('Second panel cut dimension', { exact: true }).selectOption('width')
    await page.getByLabel('Second panel cut dimension', { exact: true }).selectOption('height')
  }
  await start()
  await page.keyboard.press('Escape')
  expect(await exportedProject(page)).toEqual(original)
  await start()
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const matched = await exportedProject(page)
  expect(matched.panels.map(panel => [panel.width, panel.height])).toEqual([[600, 250], [350, 600]])
  expect(matched.constraints?.[0]).toMatchObject({ kind: 'equal-dimension', dimension: 'width', secondDimension: 'height' })
  await page.locator('.panel-list-select').first().click()
  await setValue(page, 'Width', 700)
  const resized = await exportedProject(page)
  expect(resized.panels.map(panel => [panel.width, panel.height])).toEqual([[700, 250], [350, 700]])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(matched)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(resized)
  await page.reload()
  expect(await exportedProject(page)).toEqual(resized)
})

for (const width of [1440, 390]) test(`saved opening proportions preview and persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const project: Project = { version: 1, name: 'Three shelves', connections: [], panels: [0, 318, 636].map((y, index) => createPanel({ id: ['a', 'b', 'c'][index], name: `Boundary ${index + 1}`, width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [0, 500 + y, 0] })) }
  await importProject(page, project)
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  const begin = async () => {
    await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
    await page.getByLabel('Constraint type', { exact: true }).selectOption('opening-ratio')
    await expect(page.getByLabel('Opening 1 end panel', { exact: true })).toHaveValue('b')
    await expect(page.getByLabel('Opening 2 start panel', { exact: true })).toHaveValue('b')
    await setValue(page, 'Opening 2 / opening 1', 2)
  }
  await begin()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await exportedProject(page)).constraints ?? []).toEqual([])
  await begin()
  await page.getByLabel('Opening 2 end panel', { exact: true }).selectOption('a')
  await expect(page.locator('.constraint-status.is-blocked')).toContainText('different openings')
  await page.getByLabel('Opening 2 end panel', { exact: true }).selectOption('c')
  await page.screenshot({ path: test.info().outputPath('opening-ratio.png') })
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const saved = await exportedProject(page)
  expect(saved.constraints?.[0]).toMatchObject({ kind: 'opening-ratio', panelIds: ['a', 'b', 'b', 'c'], axis: 'y', ratio: 2 })
  const first = saved.panels[1].position[1] - saved.panels[0].position[1] - 18
  const second = saved.panels[2].position[1] - saved.panels[1].position[1] - 18
  expect(second).toBeCloseTo(first * 2)
  expect(first).toBeGreaterThanOrEqual(0)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect((await exportedProject(page)).constraints ?? []).toEqual([])
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(saved)
  await page.reload()
  expect(await exportedProject(page)).toEqual(saved)
})

for (const width of [1440, 390]) test(`fixed references and signed setbacks persist at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  const project: Project = { version: 1, name: 'Reference rules', connections: [], panels: [
    createPanel({ id: 'a', name: 'Reference shelf', width: 600, height: 300, position: [-1000, 1000, 0], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'b', name: 'Inset shelf', width: 500, height: 200, position: [1000, 1000, -40], rotation: [-Math.PI / 2, 0, 0] }),
  ] }
  await importProject(page, project)
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  const fixed = async () => {
    await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
    await page.getByLabel('Constraint type', { exact: true }).selectOption('position')
    await expect(page.getByLabel('Fixed coordinate', { exact: true })).toHaveValue('-1300')
    await setValue(page, 'Fixed coordinate', -1400)
  }
  await fixed()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await exportedProject(page)).constraints ?? []).toEqual([])
  await fixed()
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const positioned = await exportedProject(page)
  expect(positioned.panels[0].position[0]).toBeCloseTo(-1100)
  expect(positioned.constraints?.[0]).toMatchObject({ kind: 'position', axis: 'x', reference: 'min', value: -1400 })
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  await page.getByLabel('Constraint type', { exact: true }).selectOption('setback')
  await expect(page.getByLabel('Signed setback', { exact: true })).toHaveValue('-90')
  await page.getByLabel('First panel reference', { exact: true }).selectOption('center')
  await expect(page.getByLabel('Signed setback', { exact: true })).toHaveValue('60')
  await page.getByLabel('First panel reference', { exact: true }).selectOption('max')
  await setValue(page, 'Signed setback', -50)
  await page.screenshot({ path: test.info().outputPath('setback.png') })
  await page.getByRole('button', { name: 'Add constraint', exact: true }).click()
  const saved = await exportedProject(page)
  expect(saved.constraints?.[1]).toMatchObject({ kind: 'setback', panelIds: ['a', 'b'], axis: 'z', references: ['max', 'max'], value: -50 })
  expect(saved.panels[1].position[2]).toBeCloseTo(0)
  expect(saved.panels[0].position[0]).toBeCloseTo(-1100)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(positioned)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(saved)
  await page.reload()
  expect(await exportedProject(page)).toEqual(saved)
})

test('all constraints shows details only on hover or focus and follows the inspector lifecycle', async ({ page }) => {
  const project = shelfProject()
  project.constraints = [
    { id: 'equal', enabled: true, kind: 'equal-dimension', panelIds: ['lower', 'upper'], dimension: 'width' },
    { id: 'floor', enabled: true, kind: 'floor', panelId: 'lower', reference: 'max', value: 218 },
    { id: 'gap', enabled: false, kind: 'gap', panelIds: ['lower', 'upper'], axis: 'y', relation: 'exact', value: 382 },
  ]
  project.spaceConstraint = { enabled: true, width: 1200, height: 1200, depth: 800, centerX: 0, centerZ: 0 }
  await importProject(page, project)
  const button = page.getByRole('button', { name: 'All constraints', exact: true })
  const markers = page.locator('button[data-constraint-id][data-constraint-kind]')
  const tooltips = page.locator('[role="tooltip"][data-constraint-tooltip]')
  await expect(button.locator('.constraints-toolbar-badge')).toHaveText('4')
  await expect(markers).toHaveCount(0)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(markers).toHaveCount(4)
  await expect(tooltips).toHaveCount(0)
  await expect(markers.filter({ has: page.locator('svg') })).toHaveCount(4)
  const equal = markers.and(page.locator('[data-constraint-kind="equal-dimension"]'))
  await expect(equal).toHaveCount(2)
  const floor = markers.and(page.locator('[data-constraint-kind="floor"]'))
  await expect(floor).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('constraints-overview.png') })
  const gap = markers.and(page.locator('[data-constraint-kind="gap"]'))
  await gap.hover()
  await expect(tooltips).toHaveCount(1)
  await expect(tooltips).toContainText('Paused')
  await expect(tooltips).toContainText('382 mm')
  await button.hover()
  await expect(tooltips).toHaveCount(0)
  await floor.focus()
  await expect(tooltips).toHaveCount(1)
  await expect(tooltips).toContainText('Floor height')
  await expect(tooltips).toContainText('218 mm')
  await expect(tooltips).toHaveAttribute('id', /\S+/)
  await expect(floor).toHaveAttribute('aria-describedby', await tooltips.getAttribute('id') ?? '')
  await page.locator('canvas').focus()
  await expect(tooltips).toHaveCount(0)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(markers).toHaveCount(0)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await expect(markers).toHaveCount(4)
  await page.locator('canvas').focus()
  await page.keyboard.press('Escape')
  await expect(markers).toHaveCount(0)
  await expect(tooltips).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await button.click()
  await expect(markers).toHaveCount(4)
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await expect(markers).toHaveCount(0)
  await expect(button.locator('.constraints-toolbar-badge')).toHaveText('4')
})

test('synth compartment constraint markers separate coincident measurements and keep details within the viewport', async ({ page }) => {
  await importProject(page, synthStorageShelfProject())
  await page.getByRole('button', { name: 'All constraints', exact: true }).click()
  const markers = page.locator('button[data-constraint-id][data-constraint-kind]')
  const tooltips = page.locator('[role="tooltip"][data-constraint-tooltip]')
  await expect(markers).toHaveCount(12)
  const checkLayout = async () => {
    await expect(tooltips).toHaveCount(0)
    await expect.poll(async () => markers.evaluateAll(elements => {
      const boxes = elements.map(element => element.getBoundingClientRect())
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return boxes.every((box, index) => box.width > 0 && box.left >= canvas.left && box.right <= canvas.right &&
        box.top >= canvas.top && box.bottom <= canvas.bottom && boxes.slice(index + 1).every(other =>
          box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom))
    })).toBe(true)
    await markers.first().focus()
    await expect(tooltips).toHaveCount(1)
    await expect.poll(async () => tooltips.evaluate(element => {
      const box = element.getBoundingClientRect()
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      return box.width > 0 && box.left >= canvas.left && box.right <= canvas.right &&
        box.top >= canvas.top && box.bottom <= canvas.bottom
    })).toBe(true)
    await page.locator('canvas').focus()
    await expect(tooltips).toHaveCount(0)
  }
  await checkLayout()
  await page.screenshot({ path: test.info().outputPath('synth-compartment-constraint-markers.png') })
  await markers.first().hover()
  await expect(tooltips).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('synth-compartment-constraint-hover.png') })
  await page.getByRole('button', { name: 'All constraints', exact: true }).hover()
  await page.getByLabel('Camera view', { exact: true }).selectOption('front')
  await checkLayout()
  await page.setViewportSize({ width: 1000, height: 800 })
  await checkLayout()
  await page.getByLabel('Camera view', { exact: true }).selectOption('perspective')
  await checkLayout()
})

test('hovering an opening guide highlights both measurements and shows one shared ratio tooltip', async ({ page }) => {
  const project: Project = { version: 1, name: 'Proportional openings', connections: [], panels: [0, 318, 936].map((y, index) =>
    createPanel({ id: ['a', 'b', 'c'][index], name: `Boundary ${index + 1}`, width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [0, 300 + y, 0] })),
  constraints: [{ id: 'openings', enabled: true, kind: 'opening-ratio', panelIds: ['a', 'b', 'b', 'c'], axis: 'y', ratio: 2 }] }
  await importProject(page, project)
  const original = await exportedProject(page)
  const button = page.getByRole('button', { name: 'All constraints', exact: true })
  await button.click()
  const markers = page.locator('button[data-constraint-id="openings"]')
  const tooltips = page.locator('[role="tooltip"][data-constraint-tooltip]')
  await expect(markers).toHaveCount(2)
  await expect(tooltips).toHaveCount(0)
  const line = page.locator('[data-constraint-line="openings"]').first()
  const lineBox = (await line.boundingBox())!
  const lineMidpoint = { x: lineBox.x + lineBox.width / 2, y: lineBox.y + lineBox.height / 2 }
  await page.mouse.move(lineMidpoint.x, lineMidpoint.y)
  await expect(tooltips).toHaveCount(1)
  await expect(tooltips).toHaveAttribute('data-constraint-tooltip', 'openings')
  await expect(tooltips).toContainText('Opening 1 · Y gap · 300 mm')
  await expect(tooltips).toContainText('Opening 2 · Y gap · 600 mm')
  await expect(tooltips).toContainText('Ratio 1 : 2')
  for (const marker of await markers.all()) await expect(marker).toHaveAttribute('data-active', 'true')
  await page.screenshot({ path: test.info().outputPath('opening-guide-hover.png') })
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(lineMidpoint.x + 80, lineMidpoint.y + 40, { steps: 8 })
  await page.mouse.up({ button: 'right' })
  await expect.poll(async () => {
    const moved = (await line.boundingBox())!
    return Math.hypot(moved.x - lineBox.x, moved.y - lineBox.y)
  }).toBeGreaterThan(30)
  await button.hover()
  await expect(tooltips).toHaveCount(0)
  await markers.last().focus()
  await expect(tooltips).toHaveCount(1)
  await expect(tooltips).toContainText('Opening 1 · Y gap · 300 mm')
  await expect(tooltips).toContainText('Opening 2 · Y gap · 600 mm')
  for (const marker of await markers.all()) await expect(marker).toHaveAttribute('data-active', 'true')
  await page.locator('canvas').focus()
  await expect(tooltips).toHaveCount(0)
  expect(await exportedProject(page)).toEqual(original)
})
