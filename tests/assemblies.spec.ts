import { test, expect, type Page } from '@playwright/test'
import { Euler, Quaternion } from 'three'
import { createExampleProject } from '../src/lib/example-library'
import { validateProject } from '../src/lib/model'
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
    name: 'assemblies.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

async function createBoxAssembly(page: Page) {
  await page.goto('/')
  await importProject(page, createExampleProject('cube'))
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByLabel('Assembly name', { exact: true }).fill('Box')
  await page.getByRole('button', { name: 'Create assembly', exact: true }).click()
  await expect(page.getByLabel('Instance name', { exact: true })).toBeVisible()
}

function connectorCounts(project: Project) {
  return project.connections.reduce<Record<string, number>>((counts, connection) => {
    counts[connection.type] = (counts[connection.type] ?? 0) + connection.count
    return counts
  }, {})
}

function expectPanelsPreserved(before: Project, after: Project) {
  for (const panel of before.panels) {
    const current = after.panels.find(candidate => candidate.id === panel.id)!
    const { position, rotation, ...properties } = panel
    expect(current).toMatchObject(properties)
    position.forEach((coordinate, axis) => expect(current.position[axis]).toBeCloseTo(coordinate, 6))
    const previousRotation = new Quaternion().setFromEuler(new Euler(...rotation))
    const currentRotation = new Quaternion().setFromEuler(new Euler(...current.rotation))
    expect(Math.abs(previousRotation.dot(currentRotation))).toBeCloseTo(1, 10)
  }
}

test('reusable box copies share construction while finish overrides stay local', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  let phase = 'create assembly'
  page.on('pageerror', error => errors.push(`${phase}: ${error.stack ?? error.message}`))
  await createBoxAssembly(page)
  const first = await exportedProject(page)
  expect(first.assemblies?.definitions).toHaveLength(1)
  expect(first.assemblies?.instances).toHaveLength(1)
  expect(first.panels).toHaveLength(4)
  expect(connectorCounts(first)).toEqual({ '90': 8 })

  phase = 'duplicate'
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  const copied = await exportedProject(page)
  expect(copied.assemblies?.instances).toHaveLength(2)
  expect(copied.panels).toHaveLength(8)
  expect(connectorCounts(copied)).toEqual({ '90': 16 })
  expect(new Set(copied.assemblies!.instances.map(instance => instance.definitionId)).size).toBe(1)

  phase = 'attach existing copy'
  await page.getByLabel('Attach an existing instance', { exact: true }).selectOption(first.assemblies!.instances[0].id)
  const existingTarget = page.locator('.scene-container').getByRole('button', { name: 'Attach Top left', exact: true })
  await expect(existingTarget).toBeInViewport()
  await existingTarget.click()
  const attached = await exportedProject(page)
  expect(attached.assemblies?.instances).toHaveLength(2)
  expect(attached.assemblies?.links).toHaveLength(1)
  expect(attached.panels).toHaveLength(8)
  expect(connectorCounts(attached)).toEqual({ '90': 12, cross: 2 })

  phase = 'color override'
  await page.getByLabel('Instance panel color', { exact: true }).fill('#6b8f71')
  await expect(page.getByText('Custom color', { exact: true })).toBeVisible()
  const colored = await exportedProject(page)
  const overridden = colored.assemblies!.instances.find(instance => instance.finish?.color === '#6b8f71')!
  expect(overridden).toBeDefined()
  const overridePanels = new Set(Object.values(overridden.panelIds))
  expect(colored.panels.filter(panel => overridePanels.has(panel.id)).every(panel => panel.color === '#6b8f71')).toBe(true)
  expect(colored.panels.filter(panel => !overridePanels.has(panel.id)).map(panel => panel.color)).toEqual(first.panels.map(panel => panel.color))

  phase = 'reset color'
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByText('Using assembly color', { exact: true })).toBeVisible()
  const reset = await exportedProject(page)
  expect(reset.panels.filter(panel => overridePanels.has(panel.id)).map(panel => panel.color)).toEqual(first.panels.map(panel => panel.color))

  phase = 'edit shared source'
  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await expect(page.getByText(/Editing Box/)).toBeVisible()
  await page.getByLabel('Width', { exact: true }).fill('400')
  await page.getByLabel('Width', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  const edited = await exportedProject(page)
  const definition = edited.assemblies!.definitions[0]
  expect(definition.panels.some(panel => panel.width === 400)).toBe(true)
  for (const instance of edited.assemblies!.instances) {
    for (const part of definition.panels) {
      expect(edited.panels.find(panel => panel.id === instance.panelIds[part.id])).toMatchObject({ width: part.width, height: part.height, thickness: part.thickness })
    }
  }
  expect(validateProject(edited).filter(issue => issue.severity === 'error')).toEqual([])
  phase = 'undo'
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(reset)
  phase = 'redo'
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(edited)

  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  phase = 'reload'
  await page.reload()
  expect(await exportedProject(page)).toEqual(edited)
  phase = 'import original'
  await importProject(page, first)
  phase = 'import edited'
  await importProject(page, edited)
  expect(await exportedProject(page)).toEqual(edited)
  await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
  await page.screenshot({ path: 'test-results/assembly-linked-instances.png' })
  phase = 'mobile shared editing'
  await page.setViewportSize({ width: 800, height: 844 })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  expect(await page.locator('.right-sidebar .inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/assembly-inspector-mobile.png' })
  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  const done = page.getByRole('button', { name: 'Done editing', exact: true })
  await expect(done).toBeInViewport()
  await done.click()
  await expect(page.getByLabel('Instance name', { exact: true })).toBeVisible()
  expect(await exportedProject(page)).toEqual(edited)
  expect(errors).toEqual([])
})

test('making an attached instance independent preserves its joints; disconnecting restores box corners', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await createBoxAssembly(page)
  const initial = await exportedProject(page)
  await page.getByRole('button', { name: 'Attach a copy', exact: true }).click()
  const corner = page.locator('.scene-container').getByRole('button', { name: 'Attach Top right', exact: true })
  await corner.focus()
  await corner.press('Escape')
  await expect(page.getByRole('button', { name: 'Attach a copy', exact: true })).toBeVisible()
  expect(await exportedProject(page)).toEqual(initial)

  await page.getByRole('button', { name: 'Attach a copy', exact: true }).click()
  await corner.click()
  const joined = await exportedProject(page)
  expect(joined.assemblies?.instances).toHaveLength(2)
  expect(joined.assemblies?.links).toHaveLength(1)
  expect(connectorCounts(joined)).toEqual({ '90': 12, cross: 2 })

  await page.getByRole('button', { name: 'Make independent', exact: true }).click()
  const independent = await exportedProject(page)
  expect(new Set(independent.assemblies!.instances.map(instance => instance.definitionId)).size).toBe(2)
  expect(independent.assemblies?.links).toEqual(joined.assemblies?.links)
  expect(connectorCounts(independent)).toEqual(connectorCounts(joined))
  expect(independent.panels.map(panel => ({ id: panel.id, position: panel.position, rotation: panel.rotation }))).toEqual(joined.panels.map(panel => ({ id: panel.id, position: panel.position, rotation: panel.rotation })))

  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await page.getByLabel('Width', { exact: true }).fill('400')
  await page.getByLabel('Width', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  const edited = await exportedProject(page)
  const originalIds = new Set(initial.panels.map(panel => panel.id))
  expect(edited.panels.filter(panel => originalIds.has(panel.id)).map(panel => panel.width)).toEqual(initial.panels.map(panel => panel.width))
  expect(edited.panels.filter(panel => !originalIds.has(panel.id)).every(panel => panel.width === 400)).toBe(true)
  expect(validateProject(edited).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])

  await page.getByRole('button', { name: 'Disconnect from neighbors', exact: true }).click()
  const disconnected = await exportedProject(page)
  expect(disconnected.assemblies?.links).toHaveLength(0)
  expect(disconnected.panels).toHaveLength(8)
  expect(connectorCounts(disconnected)).toEqual({ '90': 16 })
  for (const panel of disconnected.panels.filter(panel => originalIds.has(panel.id))) {
    expect(panel.position).toEqual(edited.panels.find(original => original.id === panel.id)!.position)
  }
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(edited)
  expect(errors).toEqual([])
})

test('corner handles build the four-box Diamond, reconcile hardware, and restore neighbors on removal', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await createBoxAssembly(page)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')

  for (const [index, corner] of ['Top right', 'Bottom right', 'Bottom left'].entries()) {
    await page.getByRole('button', { name: 'Attach a copy', exact: true }).click()
    const handle = page.locator('.scene-container').getByRole('button', { name: new RegExp(corner) })
    await expect(handle).toBeInViewport()
    // Keyboard focus must show the same preview as pointer hover.
    await handle.focus()
    await expect(page.getByText('Choose a connection', { exact: true })).toBeVisible()
    await handle.press('Enter')
    await expect(page.getByLabel('Instance name', { exact: true })).toBeVisible()
    const added = await exportedProject(page)
    expect(added.assemblies?.instances).toHaveLength(index + 2)
    expect(added.panels).toHaveLength((index + 2) * 4)
    expect(validateProject(added).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  }

  const diamond = await exportedProject(page)
  expect(diamond.assemblies?.definitions).toHaveLength(1)
  expect(diamond.assemblies?.instances).toHaveLength(4)
  expect(diamond.assemblies?.links).toHaveLength(4)
  expect(diamond.panels).toHaveLength(16)
  expect(connectorCounts(diamond)).toEqual({ '90': 16, cross: 8 })

  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await page.getByLabel('Thickness', { exact: true }).fill('17')
  await page.getByLabel('Thickness', { exact: true }).press('Tab')
  await expect(page.getByText(/Cross connectors.*18–19 mm panels/)).toBeVisible()
  expect(await exportedProject(page)).toEqual(diamond)
  await page.getByLabel('Width', { exact: true }).fill('400')
  await page.getByLabel('Width', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  const resized = await exportedProject(page)
  expect(resized.panels.every(panel => panel.width === 400)).toBe(true)
  expect(resized.assemblies?.links).toHaveLength(4)
  expect(validateProject(resized).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(diamond)

  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  const moved = await exportedProject(page)
  for (const panel of moved.panels) {
    const original = diamond.panels.find(before => before.id === panel.id)!
    expect(panel.width).toBe(original.width)
    expect(panel.height).toBe(original.height)
    panel.position.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(original.position[axis] + (axis === 0 ? 10 : 0), 6))
  }
  expect(moved.assemblies?.links).toEqual(diamond.assemblies?.links)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(diamond)

  await page.getByRole('button', { name: 'Rotate creation', exact: true }).click()
  await page.getByLabel('Rotation angle').selectOption('45')
  await page.getByRole('button', { name: 'Rotate creation by +45°', exact: true }).click()
  const tilted = await exportedProject(page)
  expect(tilted.assemblies?.links).toHaveLength(4)
  expect(connectorCounts(tilted)).toEqual({ '90': 16, cross: 8 })
  expect(validateProject(tilted).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.screenshot({ path: 'test-results/assembly-diamond.png' })

  await page.getByRole('button', { name: 'Delete assembly instance', exact: true }).click()
  const removed = await exportedProject(page)
  expect(removed.assemblies?.instances).toHaveLength(3)
  expect(removed.assemblies?.links).toHaveLength(2)
  expect(removed.panels).toHaveLength(12)
  expect(connectorCounts(removed)).toEqual({ '90': 16, cross: 4 })
  for (const panel of removed.panels) {
    const previous = tilted.panels.find(original => original.id === panel.id)!
    panel.position.forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(previous.position[axis], 6))
  }
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(tilted)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(tilted)
  await importProject(page, diamond)
  expect(await exportedProject(page)).toEqual(diamond)
  await importProject(page, tilted)
  expect(await exportedProject(page)).toEqual(tilted)
  expect(errors).toEqual([])
})

test('disassembling a free copy preserves its finish and hardware as independently editable panels', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await createBoxAssembly(page)
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click()
  await page.getByLabel('Instance panel color', { exact: true }).fill('#6b8f71')
  const before = await exportedProject(page)
  const selected = before.assemblies!.instances.find(instance => instance.finish?.color === '#6b8f71')!
  const looseIds = new Set(Object.values(selected.panelIds))

  await page.getByRole('button', { name: 'Disassemble', exact: true }).click()
  await expect(page.locator('[data-assembly-id]')).toHaveCount(1)
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: '4 panels selected', exact: true })).toBeVisible()
  const disassembled = await exportedProject(page)
  expect(disassembled.assemblies?.instances).toHaveLength(1)
  expect(disassembled.assemblies!.instances[0].id).not.toBe(selected.id)
  expect(disassembled.panels).toHaveLength(8)
  expect(connectorCounts(disassembled)).toEqual({ '90': 16 })
  expectPanelsPreserved(before, disassembled)
  expect(validateProject(disassembled).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])

  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Insert Box instance', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Assembly', exact: true }).click()
  await page.locator('.panel-list-select').first().click()
  await expect(page.getByLabel('Panel name', { exact: true })).toBeEnabled()
  await page.getByLabel('Panel name', { exact: true }).fill('My loose shelf')
  await page.getByLabel('Panel name', { exact: true }).press('Enter')
  await page.getByLabel('Custom finish color', { exact: true }).fill('#775599')
  const edited = await exportedProject(page)
  const changed = edited.panels.find(panel => panel.name === 'My loose shelf')!
  expect(looseIds.has(changed.id)).toBe(true)
  expect(changed.color).toBe('#775599')
  for (const panel of edited.panels.filter(panel => !looseIds.has(panel.id))) {
    expect(panel).toEqual(before.panels.find(original => original.id === panel.id))
  }

  for (let undo = 0; undo < 2; undo++) await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(disassembled)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(before)
  await expect(page.locator('[data-assembly-id]')).toHaveCount(2)
  await expect(page.locator('.panel-list-row')).toHaveCount(0)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(disassembled)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-assembly-id]')).toHaveCount(1)
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  expect(await exportedProject(page)).toEqual(disassembled)
  await importProject(page, edited)
  expect(await exportedProject(page)).toEqual(edited)
  expect(errors).toEqual([])
})

test('disassembling a rotated Diamond box keeps shared connectors and isolates loose-panel edits from its source', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await page.goto('/')
  await importProject(page, createExampleProject('diamond-shelf'))
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByLabel('Instance panel color', { exact: true }).fill('#4d7f88')
  const before = await exportedProject(page)
  const selected = before.assemblies!.instances.find(instance => instance.finish?.color === '#4d7f88')!
  const looseIds = new Set(Object.values(selected.panelIds))

  await page.getByRole('button', { name: 'Disassemble', exact: true }).click()
  await expect(page.locator('[data-assembly-id]')).toHaveCount(3)
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(4)
  await expect(page.getByRole('heading', { name: '4 panels selected', exact: true })).toBeVisible()
  const disassembled = await exportedProject(page)
  expect(disassembled.assemblies?.instances).toHaveLength(3)
  expect(disassembled.panels).toHaveLength(16)
  expect(connectorCounts(disassembled)).toEqual({ '90': 16, cross: 8 })
  expectPanelsPreserved(before, disassembled)
  expect(validateProject(disassembled).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.screenshot({ path: 'test-results/assembly-disassembled-diamond.png' })

  await expect(page.getByLabel('Custom finish color', { exact: true })).toBeEnabled()
  await page.getByLabel('Custom finish color', { exact: true }).fill('#a76f5a')
  await page.locator('.panel-list-select').first().click()
  await expect(page.getByRole('button', { name: 'Detach for free placement', exact: true })).toBeVisible()
  await expect(page.getByLabel('Position X', { exact: true })).toBeDisabled()
  await page.getByLabel('Panel name', { exact: true }).fill('Loose diamond panel')
  await page.getByLabel('Panel name', { exact: true }).press('Enter')
  const looseEdited = await exportedProject(page)
  const loosePanels = looseEdited.panels.filter(panel => looseIds.has(panel.id))
  expect(loosePanels.every(panel => panel.color === '#a76f5a')).toBe(true)
  expect(loosePanels.some(panel => panel.name === 'Loose diamond panel')).toBe(true)

  await page.locator('[data-assembly-id] .assembly-tree-select').first().click()
  await page.getByLabel('Instance panel color', { exact: true }).fill('#337788')
  const instanceEdited = await exportedProject(page)
  for (const panel of loosePanels) expect(instanceEdited.panels.find(current => current.id === panel.id)).toEqual(panel)
  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await page.getByLabel('Custom finish color', { exact: true }).fill('#bccccc')
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  const sourceEdited = await exportedProject(page)
  expect(sourceEdited.assemblies?.instances).toHaveLength(3)
  expect(sourceEdited.assemblies!.definitions.find(definition => definition.id === selected.definitionId)!.panels.every(panel => panel.color === '#bccccc')).toBe(true)
  for (const panel of loosePanels) expect(sourceEdited.panels.find(current => current.id === panel.id)).toEqual(panel)
  expect(connectorCounts(sourceEdited)).toEqual({ '90': 16, cross: 8 })
  expect(validateProject(sourceEdited).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])

  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(instanceEdited)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(looseEdited)
  for (let undo = 0; undo < 3; undo++) await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(before)
  await expect(page.locator('[data-assembly-id]')).toHaveCount(4)
  await expect(page.locator('.panel-list-row')).toHaveCount(0)
  for (let redo = 0; redo < 5; redo++) await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(sourceEdited)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-assembly-id]')).toHaveCount(3)
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  expect(await exportedProject(page)).toEqual(sourceEdited)
  await importProject(page, before)
  await importProject(page, sourceEdited)
  expect(await exportedProject(page)).toEqual(sourceEdited)

  await page.locator('.panel-list-select').filter({ hasText: /^Loose diamond panel$/ }).click()
  await expect(page.getByLabel('Position X', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Detach for free placement', exact: true }).click()
  await expect(page.getByLabel('Position X', { exact: true })).toBeEnabled()
  const detached = await exportedProject(page)
  const detachedPanel = detached.panels.find(panel => panel.name === 'Loose diamond panel')!
  expect(detached.connections.some(connection => connection.parentId === detachedPanel.id || connection.childId === detachedPanel.id)).toBe(false)
  expect(detached.assemblies?.instances).toHaveLength(3)
  const movedX = Number(await page.getByLabel('Position X', { exact: true }).inputValue()) + 2000
  await page.getByLabel('Position X', { exact: true }).fill(String(movedX))
  await page.getByLabel('Position X', { exact: true }).press('Tab')
  const moved = await exportedProject(page)
  expect(moved.panels.find(panel => panel.id === detachedPanel.id)!.position[0]).toBeCloseTo(movedX, 6)
  expect(moved.assemblies?.instances).toHaveLength(3)
  expect(new Set(moved.connections.map(connection => connection.id)).size).toBe(moved.connections.length)
  expect(moved.connections.reduce((sum, connection) => sum + connection.count, 0)).toBeLessThanOrEqual(24)
  expect(validateProject(moved).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(detached)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(sourceEdited)
  for (let redo = 0; redo < 2; redo++) await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(moved)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(moved)
  await importProject(page, moved)
  expect(await exportedProject(page)).toEqual(moved)

  await importProject(page, sourceEdited)
  await page.locator('.panel-list-select').filter({ hasText: /^Loose diamond panel$/ }).click()
  await page.getByRole('button', { name: 'Delete selected panel', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  await expect(page.locator('[data-assembly-id]')).toHaveCount(3)
  const removed = await exportedProject(page)
  expect(removed.panels).toHaveLength(15)
  expect(removed.panels.some(panel => panel.id === detachedPanel.id)).toBe(false)
  expect(removed.assemblies?.instances).toHaveLength(3)
  expect(validateProject(removed).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await exportedProject(page)).toEqual(sourceEdited)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await exportedProject(page)).toEqual(removed)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  expect(await exportedProject(page)).toEqual(removed)
  await importProject(page, removed)
  expect(await exportedProject(page)).toEqual(removed)
  expect(errors).toEqual([])
})
