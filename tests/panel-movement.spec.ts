import fixture from '../resources/library-3d/user-projects/h-table-monitor-speaker-stand.json' with { type: 'json' }
import { openInspectorSection } from './inspector-helpers'
import { test, expect, type Page } from '@playwright/test'
import { parseProject, createPanel, createStarterProject, getProjectBounds, resolvePanels, validateProject } from '../src/lib/model'
import type { Project, Vec3 } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'

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

async function expectPosition(page: Page, id: string, expected: Vec3) {
  await expect.poll(async () => {
    const panel = resolvePanels(await savedProject(page)).find(panel => panel.id === id)!
    return panel.position.map((value, axis) => Math.abs(value - expected[axis]) < 0.001)
  }).toEqual([true, true, true])
}

async function cameraView(page: Page, view: string) {
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption(view)
  // Let the default camera replacement and its fit effect both reach a frame.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  }))
}

test('clicking a panel enables exact camera-relative centimetre steps, undo, redo and persistence', async ({ page }) => {
  const panel = createPanel({ name: 'Keyboard panel', width: 400, height: 400, position: [0, 500, 0] })
  const project: Project = { version: 1, name: 'Keyboard movement', panels: [panel], connections: [] }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openProject(page, project)
  await cameraView(page, 'front')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Panel name')).not.toBeVisible()
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await canvas.click()
  await expect(page.getByLabel('Panel name')).toHaveValue(panel.name)
  await expect(canvas).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expectPosition(page, panel.id, [10, 500, 0])
  await page.keyboard.press('Shift+ArrowUp')
  await expectPosition(page, panel.id, [10, 600, 0])
  await page.keyboard.press('ControlOrMeta+z')
  await expectPosition(page, panel.id, [10, 500, 0])
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expectPosition(page, panel.id, [10, 600, 0])

  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await expectPosition(page, panel.id, [40, 600, 0])
  await page.keyboard.press('ControlOrMeta+z')
  await expectPosition(page, panel.id, [10, 600, 0])

  await cameraView(page, 'top')
  await canvas.focus()
  await page.keyboard.press('ArrowUp')
  await expectPosition(page, panel.id, [10, 600, -10])
  await page.keyboard.press('ArrowLeft')
  await expectPosition(page, panel.id, [0, 600, -10])
  await cameraView(page, 'right')
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expectPosition(page, panel.id, [0, 600, -20])
  await page.keyboard.press('ArrowDown')
  await expectPosition(page, panel.id, [0, 590, -20])
  const saved = await savedProject(page)
  expect(saved.panels[0].width).toBe(400)
  expect(saved.panels[0].height).toBe(400)
  await page.reload()
  await expect(page.getByLabel('Position Y', { exact: true })).toHaveValue('590')
  expect(await savedProject(page)).toEqual(saved)

  // OrbitControls rotates 2π for a horizontal drag equal to the viewport height.
  // A half turn reverses screen-right in world X without changing the view menu.
  await cameraView(page, 'perspective')
  const box = (await canvas.boundingBox())!
  const startX = box.x + box.width * 0.15
  const centerY = box.y + box.height * 0.5
  await page.mouse.move(startX, centerY)
  await page.mouse.down()
  await page.mouse.move(startX + box.height / 2, centerY, { steps: 20 })
  await page.mouse.up()
  // Allow the controls' damping tail to settle before asserting the new basis.
  await page.waitForTimeout(1000)
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expectPosition(page, panel.id, [-10, 590, -20])
  expect(errors).toEqual([])
})

test('moving a connected middle shelf resizes both spans and keeps its support joints aligned', async ({ page }) => {
  const project = createStarterProject('shelf')
  const before = resolvePanels(project)
  const middle = before.find(panel => panel.name === 'Middle shelf')!
  await openProject(page, project)
  await cameraView(page, 'front')
  await page.locator('.panel-list-select').filter({ hasText: /^Middle shelf$/ }).click()
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await expectPosition(page, middle.id, [middle.position[0], middle.position[1] + 10, middle.position[2]])
  const next = await savedProject(page)
  const after = resolvePanels(next)
  for (const name of ['Bottom shelf', 'Top shelf']) {
    const original = before.find(panel => panel.name === name)!
    const current = after.find(panel => panel.id === original.id)!
    current.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis], 3))
  }
  for (const name of ['Left side', 'Right side', 'Left upper side', 'Right upper side']) {
    const original = before.find(panel => panel.name === name)!
    const current = after.find(panel => panel.id === original.id)!
    expect(current.width).toBeCloseTo(original.width + (name.includes('upper') ? -10 : 10), 3)
  }
  expect(after.find(panel => panel.id === middle.id)!.width).toBe(middle.width)
  expect(after.find(panel => panel.id === middle.id)!.height).toBe(middle.height)
  expect(validateProject(next).filter(issue => issue.severity === 'error')).toEqual([])
  const originalBounds = getProjectBounds(before)
  const nextBounds = getProjectBounds(after)
  expect(nextBounds.height).toBeCloseTo(originalBounds.height, 3)
  await page.screenshot({ path: 'test-results/panel-keyboard-movement.png' })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => savedProject(page)).toEqual(next)
})

test('editing a connected shelf width resizes the remaining shelves in one history step', async ({ page }) => {
  const project = createStarterProject('shelf')
  await openProject(page, project)
  await page.locator('.panel-list-select').filter({ hasText: /^Top shelf$/ }).click()
  await page.getByLabel('Width', { exact: true }).fill('')
  await page.getByLabel('Width', { exact: true }).pressSequentially('1200')
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.getByLabel('Width', { exact: true }).press('Tab')
  await expect.poll(async () => (await savedProject(page)).panels.filter(panel => panel.name.endsWith('shelf')).map(panel => Math.round(panel.width))).toEqual([1200, 1200, 1200])
  const resized = await savedProject(page)
  expect(validateProject(resized).filter(issue => issue.severity === 'error')).toEqual([])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
})

test('a move beyond adjacent stock limits requires review and cancellation adds no undo step', async ({ page }) => {
  const project = createStarterProject('shelf')
  const middle = resolvePanels(project).find(panel => panel.name === 'Middle shelf')!
  await openProject(page, project)
  await cameraView(page, 'front')
  await page.locator('.panel-list-select').filter({ hasText: /^Middle shelf$/ }).click()
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  let preceding: Project = project
  for (let step = 1; step <= 3; step++) {
    if (step === 3) preceding = await savedProject(page)
    await page.keyboard.press('Shift+ArrowUp')
    await expectPosition(page, middle.id, [middle.position[0], middle.position[1] + step * 100, middle.position[2]])
  }
  const lastValid = await savedProject(page)
  expect(lastValid.panels.find(panel => panel.name === 'Left upper side')!.width).toBeCloseTo(55, 3)
  await page.keyboard.press('Shift+ArrowUp')
  const review=page.getByRole('dialog', { name: 'Review wider movement' })
  await expect(review).toBeVisible()
  expect(await savedProject(page)).toEqual(lastValid)
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(preceding)
})

test('text fields, sidebar controls, attachment previews and exploded views do not nudge panels', async ({ page }) => {
  const panel = createPanel({ name: 'Keyboard panel', width: 400, height: 400, position: [0, 500, 0] })
  const project: Project = { version: 1, name: 'Keyboard guards', panels: [panel], connections: [] }
  await openProject(page, project)
  await page.getByLabel('Panel name').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.locator('.panel-list-select').focus()
  await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Exploded view', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(page.getByText('Attachment preview', { exact: false })).toBeVisible()
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.keyboard.press('ArrowUp')
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Panel', exact: true }).click()
  await page.getByRole('button', { name: 'Shortcuts & help', exact: true }).click()
  // Even a direct canvas event cannot edit while a modal owns keyboard input.
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await canvas.evaluate(element => (element as HTMLElement).focus())
  await canvas.dispatchEvent('keydown', { key: 'ArrowUp', bubbles: true })
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  expect(await savedProject(page)).toEqual(project)
})

test('room arrows leave panels unchanged and Studio retains panel movement and undo', async ({ page }) => {
  const panel = createPanel({ name: 'Room panel', width: 1600, height: 1600, position: [0, 900, 0] })
  const project: Project = { version: 1, name: 'Room movement', panels: [panel], connections: [] }
  await openProject(page, project)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel(/^Realistic furniture preview/)).toBeVisible()
  await page.getByLabel('3D preview canvas', { exact: true }).click()
  await page.keyboard.press('ArrowRight')
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.locator('.panel-list-select').click()
  await cameraView(page, 'front')
  await page.getByLabel('3D preview canvas', { exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expectPosition(page, panel.id, [10, 900, 0])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Studio', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('removing the last constraint leaves the selected divider ready for keyboard movement', async ({ page }) => {
  const project = parseProject(fixture)
  await openProject(page, project)
  await cameraView(page, 'front')
  await page.locator('.panel-list-select').filter({ hasText: /^Center divider$/ }).click()
  await openInspectorSection(page, 'Constraints')
  await page.getByRole('button', { name: /^All \(/ }).click()
  const remove = page.getByRole('button', { name: /^Remove constraint:/ })
  await expect(remove).toHaveCount(project.constraints!.length)
  for (let remaining = project.constraints!.length - 1; remaining >= 0; remaining--) {
    await remove.first().click()
    await expect(remove).toHaveCount(remaining)
    if (remaining) await expect(remove.first()).toBeFocused()
  }
  await expect.poll(async () => (await savedProject(page)).constraints).toEqual([])
  const before = await savedProject(page)
  expect(before.constraints).toEqual([])
  const divider = resolvePanels(before).find(panel => panel.name === 'Center divider')!
  await expect(page.getByLabel('3D preview canvas', { exact: true })).toBeFocused()
  await page.keyboard.press('Shift+ArrowDown')
  await expectPosition(page, divider.id, [divider.position[0], divider.position[1] - 100, divider.position[2]])
  const moved = resolvePanels(await savedProject(page))
  for (const support of resolvePanels(before).filter(panel => /leg$|spine/i.test(panel.name))) {
    expect(getProjectBounds([moved.find(panel => panel.id === support.id)!]).min[1], support.name)
      .toBeCloseTo(getProjectBounds([support]).min[1], 5)
  }
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => savedProject(page)).toEqual(before)
})
