import { expect, test, type Page } from '@playwright/test'
import { createStarterProject } from '../src/lib/model'
import type { Project } from '../src/lib/types'
const key = 'playwood-studio-project-v1'
async function saved(page: Page): Promise<Project> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key) }
async function open(page: Page) {
  await page.addInitScript(({ key, project }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project)) }, { key, project: createStarterProject('blank') })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Add a box', exact: true }).click()
  await expect.poll(async () => (await saved(page)).constructionObjects?.nodes.length).toBe(1)
}
async function convert(page: Page) {
  await page.getByRole('button', { name: 'Convert to panels', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
}
test('conversion previews appearance, cancels, accepts once, and supports panel removal, undo and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await open(page)
  const original = await saved(page)
  await convert(page)
  await page.waitForTimeout(500)
  expect(await saved(page)).toEqual(original)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await convert(page)
  await page.getByRole('checkbox', { name: 'Rectangular panels only', exact: true }).check()
  await page.getByLabel('Conversion material', { exact: true }).selectOption('oak')
  await page.getByLabel('Conversion finish coverage', { exact: true }).fill('50')
  await page.getByLabel('Conversion connector material', { exact: true }).selectOption('metal')
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: '6 panels · 24 connectors' })).toBeVisible()
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: 'test-results/object-conversion-desktop.png' })
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(6)
  const created = await saved(page)
  expect(created.panels.every(p => p.material === 'oak' && p.finishCoverage === .5 && !p.customOutline?.length)).toBe(true)
  expect(created.constructionObjects!.nodes[0].visible).toBe(false)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.locator('.panel-list-select').first().click()
  await page.locator('canvas').focus(); await page.keyboard.press('Delete')
  await expect.poll(async () => (await saved(page)).panels.length).toBe(5)
  const opened = await saved(page)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(opened)
  await page.reload()
  expect(await saved(page)).toEqual(opened)
  expect(errors).toEqual([])
})
test('narrow conversion is reviewable and a replacement project invalidates acceptance', async ({ page }) => {
  await open(page)
  await convert(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Create panels', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/object-conversion-narrow.png' })
  const replacement = { ...createStarterProject('blank'), name: 'Replacement' }
  await page.getByLabel('Import project file').setInputFiles({ name: 'replacement.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) })
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('project changed')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(replacement)
})
test('a colliding repeat conversion reports the problem and cannot commit', async ({ page }) => {
  await open(page); await convert(page)
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(6)
  const created = await saved(page)
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Box', exact: true }).click()
  await page.getByRole('button', { name: 'Convert to panels', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('overlap')
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeDisabled()
  expect(await saved(page)).toEqual(created)
})

test('a touching Boolean union converts once with no internal wall; a cavity reports unsupported geometry', async ({ page }) => {
  await open(page)
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['union'], nodes: [
    { id: 'a', name: 'First', visible: true, kind: 'box', width: 600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'Second', visible: true, kind: 'box', width: 600, height: 600, depth: 400, position: [600, 300, 0], rotation: [0, 0, 0] },
    { id: 'union', name: 'Combined', visible: true, kind: 'boolean', operation: 'union', children: ['a', 'b'] },
  ] } }
  const importProject = async (project: Project) => {
    await page.getByLabel('Import project file').setInputFiles({ name: 'boolean.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
    await page.getByRole('tab', { name: 'Objects', exact: true }).click()
    await page.getByRole('button', { name: 'Select object Combined', exact: true }).click()
  }
  await importProject(project)
  await convert(page)
  await expect(page.getByRole('status').filter({ hasText: '6 panels · 24 connectors' })).toContainText('1200 × 600 × 400 mm')
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(6)
  const created = await saved(page)
  expect(created.constructionObjects!.nodes).toEqual(project.constructionObjects!.nodes.map(node => node.id === 'union' ? { ...node, visible: false } : node))
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
  const cavity = structuredClone(project)
  const cutter = cavity.constructionObjects!.nodes[1], root = cavity.constructionObjects!.nodes[2]
  if (cutter.kind !== 'box' || root.kind !== 'boolean') throw new Error('Expected Boolean tree')
  cutter.width = 100; cutter.height = 100; cutter.depth = 100; cutter.position = [0, 300, 0]; root.operation = 'subtract'
  await importProject(cavity)
  await page.getByRole('button', { name: 'Convert to panels', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not a supported cuboid')
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect.poll(() => saved(page)).toEqual(cavity)
})

test('an L union previews eight panels, preserves the notch, and survives acceptance and reload', async ({ page }) => {
  await open(page)
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['l'], nodes: [
    { id: 'a', name: 'Wide', visible: true, kind: 'box', width: 600, height: 250, depth: 400, position: [300, 125, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'Tall', visible: true, kind: 'box', width: 250, height: 600, depth: 400, position: [125, 300, 0], rotation: [0, 0, 0] },
    { id: 'l', name: 'L shape', visible: true, kind: 'boolean', operation: 'union', children: ['a', 'b'] },
  ] } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'l.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object L shape', exact: true }).click()
  await convert(page)
  await expect(page.getByRole('status').filter({ hasText: '8 panels · 36 connectors' })).toContainText('600 × 600 × 400 mm')
  const rectangles = page.getByRole('checkbox', { name: 'Rectangular panels only', exact: true })
  await expect(rectangles).not.toBeChecked()
  await rectangles.check()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: '10 panels' })).toBeVisible()
  expect(await saved(page)).toEqual(project)
  await rectangles.uncheck()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: '8 panels · 36 connectors' })).toBeVisible()
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: 'test-results/object-conversion-l.png' })
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(8)
  const created = await saved(page)
  expect(created.panels.filter(p => p.customOutline?.length === 6)).toHaveLength(2)
  expect(created.connections).toHaveLength(18)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})

for (const rectangularOnly of [false, true]) for (const kind of ['U', 'Steps'] as const) test(`${kind} profile conversion with rectangularOnly=${rectangularOnly} commits both faces and all joints`, async ({ page }) => {
  await open(page)
  const boxes = kind === 'U' ? [
    { width: 900, height: 850, position: [450, 425, 0] },
    { width: 400, height: 600, position: [450, 550, 0] },
  ] : [
    { width: 900, height: 250, position: [450, 125, 0] },
    { width: 600, height: 550, position: [300, 275, 0] },
    { width: 300, height: 850, position: [150, 425, 0] },
  ]
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['profile'], nodes: [
    ...boxes.map((box, i) => ({ ...box, id: `box-${i}`, name: `Box ${i}`, kind: 'box' as const, visible: true, depth: 400, position: box.position as [number, number, number], rotation: [0, 0, 0] as [number, number, number] })),
    { id: 'profile', name: kind, kind: 'boolean', visible: true, operation: kind === 'U' ? 'subtract' : 'union', children: boxes.map((_, i) => `box-${i}`) },
  ] } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'profile.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: `Select object ${kind}`, exact: true }).click()
  await convert(page)
  if (rectangularOnly) await page.getByRole('checkbox', { name: 'Rectangular panels only', exact: true }).check()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: rectangularOnly ? '14 panels' : '10 panels · 48 connectors' })).toContainText('900 × 850 × 400 mm')
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: `test-results/object-conversion-${kind}-${rectangularOnly}.png` })
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(rectangularOnly ? 14 : 10)
  const created = await saved(page)
  const faces = created.panels.filter(p => p.customOutline?.length === 8)
  expect(faces).toHaveLength(rectangularOnly ? 0 : 2)
  if (rectangularOnly) expect(created.panels.every(p => !p.customOutline)).toBe(true)
  else expect(created.connections).toHaveLength(24)
  for (const face of faces) expect(new Set(created.connections.filter(c => c.childId === face.id).map(c => c.outlineEdge)).size).toBe(8)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})

for (const separation of [600, 1200]) test(`multiple roots at ${separation} mm convert as compartments in one undo step`, async ({ page }) => {
  await open(page)
  const shared = separation === 600
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['a', 'b', 'unselected'], nodes: [
    { id: 'a', name: 'First compartment', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'Second compartment', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [separation, 300, 0], rotation: [0, 0, 0] },
    { id: 'unselected', name: 'Unselected', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [3000, 300, 0], rotation: [0, 0, 0] },
  ] } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'compartments.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object First compartment', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Second compartment', exact: true }).click({ modifiers: ['Shift'] })
  await convert(page)
  await expect(page.getByText(`2 compartments · ${shared ? 1 : 0} shared walls`, { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: shared ? '11 panels · 40 connectors' : '12 panels · 48 connectors' })).toBeVisible()
  if (shared) {
    await page.getByLabel('Conversion thickness', { exact: true }).fill('16')
    await expect(page.getByRole('alert')).toContainText('18–19 mm')
    await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeDisabled()
    await page.getByLabel('Conversion thickness', { exact: true }).fill('18')
    await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
    await expect(page.getByText('First compartment · Clear interior 573 × 564 × 364 mm · Shared divider', { exact: true })).toBeVisible()
  }
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: `test-results/object-compartments-${separation}.png` })
  expect(await saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(shared ? 11 : 12)
  const created = await saved(page)
  expect(created.constructionObjects!.nodes.map(n => n.visible)).toEqual([false, false, true])
  expect(created.panels.filter(p => p.name.includes('Shared divider'))).toHaveLength(shared ? 1 : 0)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})

test('three touching roots form one row with two dividers and different middle clearance', async ({ page }) => {
  await open(page)
  const project: Project = { ...createStarterProject('blank'), constructionObjects: {
    roots: ['box-0', 'box-1', 'box-2'], nodes: [0, 1, 2].map(i => ({ id: `box-${i}`, name: `Compartment ${i + 1}`, kind: 'box', visible: true,
      width: 600, height: 600, depth: 400, position: [i * 600, 300, 0], rotation: [0, 0, 0] })),
  } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'row.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  for (const i of [3, 1, 2]) await page.getByRole('button', { name: `Select object Compartment ${i}`, exact: true }).click({ modifiers: i === 3 ? [] : ['Shift'] })
  await convert(page)
  await expect(page.getByRole('status').filter({ hasText: '16 panels · 56 connectors' })).toContainText('1800 × 600 × 400 mm')
  await expect(page.getByText('3 compartments · 2 shared walls', { exact: true })).toBeVisible()
  await expect(page.getByText('Compartment 2 · Clear interior 582 × 564 × 364 mm · Shared divider', { exact: true })).toBeVisible()
  await expect(page.getByText('Compartment 1 · Clear interior 573 × 564 × 364 mm · Shared divider', { exact: true })).toBeVisible()
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: 'test-results/object-compartments-row.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Create panels', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  expect(await saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(16)
  const created = await saved(page)
  expect(created.panels.filter(p => p.name.includes('Shared divider'))).toHaveLength(2)
  expect(created.connections).toHaveLength(36)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})

test('a strip subtraction creates separate pieces in one cancellable and persistent conversion', async ({ page }) => {
  await open(page)
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['split'], nodes: [
    { id: 'base', name: 'Base', kind: 'box', visible: true, width: 1600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'cut', name: 'Strip', kind: 'box', visible: false, width: 400, height: 800, depth: 800, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'split', name: 'Split box', kind: 'boolean', visible: true, operation: 'subtract', children: ['base', 'cut'] },
  ] } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'split.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Split box', exact: true }).click()
  await convert(page)
  await expect(page.getByRole('status').filter({ hasText: '12 panels · 48 connectors' })).toContainText('1600 × 600 × 400 mm')
  await expect(page.getByText('2 compartments · 0 shared walls', { exact: true })).toBeVisible()
  for (const piece of [1, 2]) await expect(page.getByText(`Split box · Piece ${piece} · Clear interior 564 × 564 × 364 mm`, { exact: true })).toBeVisible()
  expect(await saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await saved(page)).toEqual(project)
  await convert(page)
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: 'test-results/object-disconnected.png' })
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(12)
  const created = await saved(page)
  expect(created.constructionObjects!.nodes.find(n => n.id === 'split')!.visible).toBe(false)
  expect(created.constructionObjects!.nodes.filter(n => n.id !== 'split')).toEqual(project.constructionObjects!.nodes.filter(n => n.id !== 'split'))
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})

test('four roots convert as a rectangular grid with cross hardware in one undo step', async ({ page }) => {
  await open(page)
  const project: Project = { ...createStarterProject('blank'), constructionObjects: { roots: ['a', 'b', 'c', 'd'], nodes: [
    ...['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: `Grid ${id}`, kind: 'box' as const, visible: true, width: 600, height: 600, depth: 400,
      position: [Math.floor(i / 2) * 600, 300 + (i % 2) * 600, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] })),
  ] } }
  await page.getByLabel('Import project file').setInputFiles({ name: 'grid.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  for (const id of ['a', 'b', 'c', 'd']) await page.getByRole('button', { name: `Select object Grid ${id}`, exact: true }).click({ modifiers: id === 'a' ? [] : ['Shift'] })
  await convert(page)
  await expect(page.getByRole('status').filter({ hasText: '20 panels' })).toContainText('1200 × 1200 × 400 mm')
  await expect(page.getByText('4 compartments · 4 shared walls', { exact: true })).toBeVisible()
  await expect(page.getByText('Grid a · Clear interior 573 × 573 × 364 mm · Shared divider', { exact: true })).toBeVisible()
  await page.getByLabel('Conversion connector material', { exact: true }).selectOption('metal')
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeEnabled()
  await expect.poll(() => page.getByRole('dialog').locator('canvas').evaluate(canvas => canvas.toDataURL().length)).toBeGreaterThan(10000)
  await page.screenshot({ path: 'test-results/object-grid.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Create panels', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Create panels', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  expect(await saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Create panels', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(20)
  const created = await saved(page)
  expect(created.connections.filter(c => c.type === 'cross')).toHaveLength(3)
  expect(created.connections.filter(c => c.type === 'cross' || c.type === 't').every(c => c.material === 'plastic')).toBe(true)
  expect(created.constructionObjects!.nodes.every(n => !n.visible)).toBe(true)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(created)
  await page.reload()
  expect(await saved(page)).toEqual(created)
})
