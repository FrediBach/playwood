import { test, expect, type Page } from '@playwright/test'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly, duplicateAssembly } from '../src/lib/assemblies'
import { createExampleProject } from '../src/lib/example-library'
import { createPanel, createStarterProject, getProjectBounds, resolvePanels, validateProject } from '../src/lib/model'
import type { Panel, Project, RotationAxis, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'
const orientation = (rotation: Vec3) => new Quaternion().setFromEuler(new Euler(...rotation))
const quarterTurn = (axis: RotationAxis) => new Quaternion().setFromAxisAngle(
  new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), Math.PI / 2,
)

async function openProject(page: Page, project: Project) {
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key: STORAGE_KEY, project })
  await page.goto('/')
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(10000)
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function expectOrientation(page: Page, id: string, expected: Quaternion) {
  await expect.poll(async () => {
    const panel = resolvePanels(await savedProject(page)).find(panel => panel.id === id)!
    return Math.abs(orientation(panel.rotation).dot(expected))
  }).toBeCloseTo(1, 8)
}

function expectTurn(before: Panel[], after: Panel[], axis: RotationAxis) {
  const bounds = getProjectBounds(before)
  const center = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5)
  const turn = quarterTurn(axis)
  for (const panel of before) {
    const current = after.find(candidate => candidate.id === panel.id)!
    const expectedPosition = new Vector3(...panel.position).sub(center).applyQuaternion(turn).add(center).toArray()
    current.position.forEach((value, index) => expect(value).toBeCloseTo(expectedPosition[index], 3))
    expect(Math.abs(orientation(current.rotation).dot(turn.clone().multiply(orientation(panel.rotation))))).toBeCloseTo(1, 8)
    const { position: _position, rotation: _rotation, ...properties } = panel
    expect(current).toMatchObject(properties)
  }
}

test('X, Y and Z turn the selected panel in place, with one undo step per press and persistence', async ({ page }) => {
  const panel = createPanel({ name: 'Turning panel', width: 400, height: 250, position: [120, 700, -80], rotation: [0.2, 0.4, -0.3] })
  const neighbor = createPanel({ name: 'Untouched panel', position: [1500, 700, 0] })
  const project: Project = { version: 1, name: 'Selection rotation', panels: [panel, neighbor], connections: [] }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project)
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  let expected = orientation(panel.rotation)
  const snapshots: Project[] = [project]
  for (const axis of ['x', 'y', 'z'] as const) {
    // The shortcut works with either the canvas or its selected sidebar row focused.
    if (axis === 'y') await page.locator('.panel-list-select').first().focus()
    else await canvas.focus()
    await page.keyboard.press(axis === 'y' ? 'Shift+Y' : axis)
    expected = quarterTurn(axis).multiply(expected)
    await expectOrientation(page, panel.id, expected)
    const current = await savedProject(page)
    expectTurn([snapshots.at(-1)!.panels[0]], current.panels, axis)
    expect(current.panels[1]).toEqual(neighbor)
    snapshots.push(current)
  }

  // Holding a key does not spin repeatedly or add history entries.
  await canvas.dispatchEvent('keydown', { key: 'z', repeat: true, bubbles: true })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(snapshots[2])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(snapshots[3])
  await page.screenshot({ path: 'test-results/selection-rotation-shortcuts.png' })
  await page.reload()
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue(panel.name)
  expect(await savedProject(page)).toEqual(snapshots[3])

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await canvas.focus()
  await page.keyboard.press('x')
  await expectOrientation(page, panel.id, quarterTurn('x').multiply(expected))
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(snapshots[3])
  await expect(page.getByRole('button', { name: 'Realistic preview', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('an assembly turns as one instance while its source and other copy stay unchanged', async ({ page }) => {
  const cube = createExampleProject('cube')
  const assembled = createAssembly(cube, cube.panels.map(panel => panel.id), 'Box')
  const project = duplicateAssembly(assembled, assembled.assemblies!.instances[0].id)
  const [neighbor, selected] = project.assemblies!.instances
  const selectedIds = new Set(Object.values(selected.panelIds))
  await openProject(page, project)
  await page.locator(`[data-assembly-id="${selected.id}"] .assembly-tree-select`).click()
  await expect(page.getByLabel('Instance name', { exact: true })).toHaveValue(selected.name)
  await page.keyboard.press('x')
  const first = project.panels.find(panel => selectedIds.has(panel.id))!
  await expectOrientation(page, first.id, quarterTurn('x').multiply(orientation(first.rotation)))
  const rotated = await savedProject(page)
  expectTurn(resolvePanels(project).filter(panel => selectedIds.has(panel.id)), resolvePanels(rotated), 'x')
  expect(rotated.panels.filter(panel => !selectedIds.has(panel.id))).toEqual(project.panels.filter(panel => !selectedIds.has(panel.id)))
  expect(rotated.assemblies!.instances.find(instance => instance.id === neighbor.id)).toEqual(neighbor)
  const turnedInstance = rotated.assemblies!.instances.find(instance => instance.id === selected.id)!
  expect(Math.abs(orientation(turnedInstance.rotation).dot(quarterTurn('x').multiply(orientation(selected.rotation))))).toBeCloseTo(1, 8)
  expect(rotated.assemblies!.definitions).toEqual(project.assemblies!.definitions)
  expect(rotated.connections).toEqual(project.connections)
  expect(validateProject(rotated).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(rotated)
  await page.reload()
  await expect(page.locator('[data-assembly-id]')).toHaveCount(2)
  expect(await savedProject(page)).toEqual(rotated)

  await page.getByRole('button', { name: 'Edit assembly', exact: true }).click()
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('y')
  await page.getByRole('button', { name: 'Done editing', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(rotated)
})

test('a connected panel cannot turn alone, but selecting its complete structure keeps joints aligned', async ({ page }) => {
  const project = createStarterProject('shelf')
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Middle shelf$/ }).click()
  await page.keyboard.press('z')
  await expect(page.locator('.toast')).toContainText(/select|detach/i)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)

  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.keyboard.press('z')
  const first = resolvePanels(project)[0]
  await expectOrientation(page, first.id, quarterTurn('z').multiply(orientation(first.rotation)))
  const rotated = await savedProject(page)
  expectTurn(resolvePanels(project), resolvePanels(rotated), 'z')
  expect(rotated.connections).toEqual(project.connections)
  expect(validateProject(rotated).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('typing, modified keys, composition, dialogs and placement previews do not rotate selections', async ({ page }) => {
  const panel = createPanel({ name: 'Keyboard guards', position: [0, 700, 0] })
  const project: Project = { version: 1, name: 'Rotation guards', panels: [panel], connections: [] }
  await openProject(page, project)
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  const name = page.getByLabel('Panel name', { exact: true })
  await name.focus()
  await name.pressSequentially('xyz')
  await name.fill(panel.name)
  await canvas.focus()
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey'] as const) {
    for (const key of ['x', 'y', 'z']) await canvas.dispatchEvent('keydown', { key, [modifier]: true, bubbles: true })
  }
  await canvas.dispatchEvent('keydown', { key: 'x', isComposing: true, bubbles: true })
  await page.evaluate(() => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    const child = editable.appendChild(document.createElement('span'))
    document.body.appendChild(editable)
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }))
    editable.remove()
  })

  await page.getByRole('button', { name: 'Shortcuts & help', exact: true }).click()
  await canvas.dispatchEvent('keydown', { key: 'z', bubbles: true })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await canvas.focus()
  await page.keyboard.press('x')
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(page.getByText('Attachment preview', { exact: false })).toBeVisible()
  await canvas.focus()
  await page.keyboard.press('y')
  await page.getByRole('button', { name: 'Panel', exact: true }).click()
  await canvas.focus()
  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.getByRole('button', { name: /^Paste at / }).first()).toBeVisible()
  await canvas.focus()
  await page.keyboard.press('z')
  await page.keyboard.press('Escape')

  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
  await page.keyboard.press('Escape')
  await page.keyboard.press('x')
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
})
