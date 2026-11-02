import { expect, test, type Page } from '@playwright/test'
import { createPanel, createStarterProject, parseProject, resolvePanels } from '../src/lib/model'
import { preparePreviewResize } from '../src/lib/preview-resize'
import type { Project } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'

function panelProject(width = 112, height = 118): Project {
  return { version: 1, name: 'Nice measurements', connections: [], panels: [
    createPanel({ id: 'panel', name: 'Test panel', width, height, thickness: 18, position: [0, 500, 0] }),
  ] }
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

async function importProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({
    name: 'nice-values.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect.poll(async () => (await savedProject(page))?.name).toBe(project.name)
}

async function exportedProject(page: Page): Promise<Project> {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export project', exact: true })).toBeFocused()
  return JSON.parse(Buffer.concat(chunks).toString())
}

async function rescaleDialog(page: Page) {
  await page.getByRole('button', { name: 'Rescale creation', exact: true }).click()
  return page.getByRole('dialog', { name: 'Rescale creation', exact: true })
}

test('enabling nice values rounds unique measurements in one saved, undoable edit; cancellation keeps the original', async ({ page }) => {
  await importProject(page, panelProject())
  const original = await exportedProject(page)
  let dialog = await rescaleDialog(page)
  await dialog.getByRole('checkbox', { name: 'Only nice values', exact: true }).check()
  await expect(dialog.getByLabel('Nice value step', { exact: true })).toHaveValue('10')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)

  dialog = await rescaleDialog(page)
  await expect(dialog.getByRole('checkbox', { name: 'Only nice values', exact: true })).not.toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Only nice values', exact: true }).check()
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const rounded = await exportedProject(page)
  expect(rounded.niceValues).toEqual({ enabled: true, step: 10 })
  expect(rounded.panels[0]).toMatchObject({ width: 110, height: 120, thickness: 18, id: 'panel' })
  expect(parseProject(rounded)).toEqual(rounded)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(rounded)
  await page.reload()
  expect(await exportedProject(page)).toEqual(rounded)
  dialog = await rescaleDialog(page)
  await expect(dialog.getByRole('checkbox', { name: 'Only nice values', exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Nice value step', { exact: true })).toHaveValue('10')
})

test('fields keep typing local, round on Enter or blur, support custom steps, and stop rounding when disabled', async ({ page }) => {
  const source = { ...panelProject(110, 120), niceValues: { enabled: true, step: 10 } }
  await importProject(page, source)
  const original = await exportedProject(page)
  const width = page.getByLabel('Width', { exact: true })
  await width.fill('112')
  await expect(width).toBeFocused()
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(original)
  await expect(width).toHaveValue('112')
  await width.press('Enter')
  await expect(width).toHaveValue('110')
  expect(await exportedProject(page)).toEqual(original)

  await width.fill('137')
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(original)
  await width.press('Tab')
  await expect(width).toHaveValue('140')
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeCloseTo(140)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)

  const position = page.getByLabel('Position X', { exact: true })
  await position.fill('127')
  await expect(position).toBeFocused()
  await page.waitForTimeout(500)
  await expect(position).toBeFocused()
  expect(await savedProject(page)).toEqual(original)
  await position.press('Enter')
  await expect(position).toHaveValue('130')
  await expect.poll(async () => (await savedProject(page)).panels[0].position[0]).toBeCloseTo(130)

  let dialog = await rescaleDialog(page)
  await dialog.getByLabel('Nice value step', { exact: true }).fill('5')
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await width.fill('127')
  await width.press('Enter')
  await expect(width).toHaveValue('125')
  const custom = await exportedProject(page)
  expect(custom.niceValues).toEqual({ enabled: true, step: 5 })
  expect(custom.panels[0].width).toBeCloseTo(125)
  await page.getByLabel('Thickness', { exact: true }).fill('19')
  await page.getByLabel('Thickness', { exact: true }).press('Enter')
  expect((await exportedProject(page)).panels[0].thickness).toBe(19)

  dialog = await rescaleDialog(page)
  await dialog.getByLabel('Nice value step', { exact: true }).fill('2.5')
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rescale creation', exact: true })).toBeFocused()
  await width.fill('127')
  await width.press('Enter')
  await expect(width).toHaveValue('127.5')
  const fractional = await exportedProject(page)
  expect(fractional.niceValues).toEqual({ enabled: true, step: 2.5 })
  expect(fractional.panels[0].width).toBeCloseTo(127.5)

  dialog = await rescaleDialog(page)
  await dialog.getByRole('checkbox', { name: 'Only nice values', exact: true }).uncheck()
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await width.fill('127')
  await width.press('Enter')
  await expect(width).toHaveValue('127')
  const disabled = await exportedProject(page)
  expect(disabled.niceValues?.enabled).toBe(false)
  expect(disabled.panels[0].width).toBeCloseTo(127)
})

async function beginResize(page: Page, project: Project, distance: number) {
  const handle = preparePreviewResize(project, { panelId: 'panel' })!.handles.find(item => item.id === 'panel-width-positive')!
  const button = page.locator(`[data-resize-handle="${handle.id}"]`)
  await expect(button).toBeVisible()
  const box = (await button.boundingBox())!
  const delta = await page.locator('canvas').evaluate(async (canvas, { position, direction, distance }) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera } = _roots.get(canvas).store.getState()
    camera.updateMatrixWorld()
    const origin = camera.position.clone().set(...position).multiplyScalar(0.001)
    const destination = origin.clone().add(camera.position.clone().set(...direction).multiplyScalar(distance * 0.001))
    origin.project(camera)
    destination.project(camera)
    const rect = canvas.getBoundingClientRect()
    return { x: (destination.x - origin.x) * rect.width / 2, y: (origin.y - destination.y) * rect.height / 2 }
  }, { position: handle.position, direction: handle.direction, distance })
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta.x, y + delta.y, { steps: 10 })
}

test('resize arrows preview intermediate sizes and round only on release, preserving the opposite edge and one undo step', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await importProject(page, { ...panelProject(400, 400), niceValues: { enabled: true, step: 10 } })
  const original = await exportedProject(page)
  await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption('front')
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))))
  await beginResize(page, original, 37)
  const caption = page.locator('.preview-resize-anchor.is-active .preview-resize-size')
  await expect(caption).toContainText(/Width = 43[67] mm/)
  const previewWidth = Number((await caption.innerText()).match(/= ([\d.]+)/)![1])
  expect(previewWidth % 10).not.toBe(0)
  await page.waitForTimeout(500)
  expect(await savedProject(page)).toEqual(original)
  await page.mouse.up()
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeCloseTo(440)
  const resized = await savedProject(page)
  const before = resolvePanels(original)[0], after = resolvePanels(resized)[0]
  expect(after.position[0] - after.width / 2).toBeCloseTo(before.position[0] - before.width / 2, 5)
  expect(after.thickness).toBe(before.thickness)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(resized)
  await beginResize(page, resized, 37)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await savedProject(page)).toEqual(resized)
  expect(errors).toEqual([])
})

test('a conflicting fixed dimension leaves nice values disabled and the construction unchanged', async ({ page }) => {
  const project = panelProject()
  project.constraints = [{ id: 'fixed-width', kind: 'dimension', panelId: 'panel', dimension: 'width', enabled: true, value: 112 }]
  await importProject(page, project)
  const original = await exportedProject(page)
  const dialog = await rescaleDialog(page)
  await dialog.getByRole('checkbox', { name: 'Only nice values', exact: true }).check()
  await dialog.getByRole('button', { name: 'Apply rescale', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await exportedProject(page)).toEqual(original)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  expect((await exportedProject(page)).name).not.toBe(original.name)
})

test('keyboard resize and movement use the nice step even when it exceeds the ordinary arrow increment', async ({ page }) => {
  await importProject(page, { ...panelProject(400, 400), niceValues: { enabled: true, step: 25 } })
  const original = await exportedProject(page)
  await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption('front')
  const width = page.getByLabel('Width', { exact: true })
  await width.press('ArrowUp')
  await expect(width).toHaveValue('425')
  await width.press('Tab')
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeCloseTo(425)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(original)
  const handle = page.locator('[data-resize-handle="panel-width-positive"]')
  await expect(handle).toBeVisible()
  await handle.press('ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels[0].width).toBeCloseTo(425)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(original)
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels[0].position[0]).toBeCloseTo(25)
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await savedProject(page)).panels[0].position[0]).toBeCloseTo(275)
})

test('a rejected rounded field edit restores the displayed and saved value', async ({ page }) => {
  const project: Project = { ...panelProject(400, 400), niceValues: { enabled: true, step: 10 }, constraints: [
    { id: 'fixed-height', kind: 'floor', panelId: 'panel', reference: 'center', value: 500, enabled: true },
  ] }
  await importProject(page, project)
  const original = await exportedProject(page)
  const position = page.getByLabel('Position Y', { exact: true })
  await position.fill('512')
  await position.press('Enter')
  await expect(position).toHaveValue('500')
  expect(await exportedProject(page)).toEqual(original)
})

test('nice-value options and actions fit a narrow rescale dialog and invalid steps stay local', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await importProject(page, createStarterProject())
  const original = await exportedProject(page)
  const dialog = await rescaleDialog(page)
  const toggle = dialog.getByRole('checkbox', { name: 'Only nice values', exact: true })
  await toggle.check()
  await expect(toggle).toBeInViewport()
  const step = dialog.getByLabel('Nice value step', { exact: true })
  await expect(step).toBeInViewport()
  for (const name of ['Cancel', 'Apply rescale']) await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport()
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  await page.screenshot({ path: test.info().outputPath('nice-values-mobile.png'), animations: 'disabled' })
  for (const value of ['', '0', '-5']) {
    await step.fill(value)
    await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeDisabled()
  }
  await step.fill('5')
  await expect(dialog.getByRole('button', { name: 'Apply rescale', exact: true })).toBeEnabled()
  await step.press('Escape')
  await expect(dialog).not.toBeVisible()
  expect(await exportedProject(page)).toEqual(original)
})
