import { test, expect, type Page } from '@playwright/test'
import { createPanel, createStarterProject } from '../src/lib/model'
import type { ConstructionObjects } from '../src/lib/types'

const key = 'playwood-studio-project-v1'
async function savedObjects(page: Page): Promise<ConstructionObjects> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').constructionObjects, key)
}
async function ready(page: Page) {
  await expect(page.getByText('Updating object preview…', { exact: true })).not.toBeVisible()
}
async function field(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByLabel(label, { exact: true }).press('Tab')
}
async function apply(page: Page) {
  await page.getByRole('button', { name: 'Apply object changes', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Apply object changes', exact: true })).not.toBeVisible()
  await ready(page)
}
async function objectPixels(page: Page, color: 'blue' | 'magenta' = 'magenta') {
  return page.locator('canvas').evaluate((canvas, color) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    if (!gl) return 0
    const pixels = new Uint8Array(canvas.width * canvas.height * 4)
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = pixels.subarray(i, i + 3)
      if (color === 'blue' ? b > r + 20 && b > g + 5 : r > g + 20 && b > g + 20) count++
    }
    return count
  }, color)
}

test('box drafts, Boolean operands, keyboard movement and persistence form one usable editing workflow', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(({ key, project }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project)) }, { key, project: createStarterProject('blank') })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Add a box', exact: true }).click()
  await expect.poll(async () => (await savedObjects(page))?.nodes.length).toBe(1)
  await expect.poll(() => objectPixels(page)).toBeGreaterThan(3000)
  await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  await expect.poll(() => objectPixels(page, 'blue')).toBeGreaterThan(3000)
  await expect.poll(() => objectPixels(page)).toBeLessThan(100)
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Box', exact: true }).click()
  await expect.poll(() => objectPixels(page)).toBeGreaterThan(3000)
  const original = await savedObjects(page)
  await field(page, 'Box width', '800')
  await ready(page)
  expect(await savedObjects(page)).toEqual(original)
  await page.getByLabel('Box height', { exact: true }).press('Escape')
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('600')
  await field(page, 'Box width', '800')
  await page.getByLabel('Object name', { exact: true }).fill('Outer')
  await apply(page)
  await expect.poll(async () => (await savedObjects(page)).nodes[0]).toMatchObject({ width: 800, name: 'Outer' })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('600')
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
  await page.getByRole('button', { name: 'Duplicate objects', exact: true }).click()
  await field(page, 'Box width', '400')
  await page.getByLabel('Object name', { exact: true }).fill('Cutter')
  await apply(page)
  await page.getByRole('button', { name: 'Select object Outer', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Cutter', exact: true }).click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: 'Subtract', exact: true }).click()
  // The earlier single box also has one root; wait for the Boolean result to save.
  await expect.poll(async () => {
    const objects = await savedObjects(page)
    return { count: objects.roots.length, root: objects.nodes.find(node => node.id === objects.roots[0]) }
  }).toMatchObject({ count: 1, root: { kind: 'boolean', operation: 'subtract' } })
  await ready(page)
  await expect.poll(() => objectPixels(page)).toBeGreaterThan(1000)
  const beforeMove = await savedObjects(page)
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await canvas.focus()
  await canvas.press('ArrowRight')
  await expect.poll(async () => (await savedObjects(page)).nodes[0]).not.toEqual(beforeMove.nodes[0])
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedObjects(page)).toEqual(beforeMove)
  await canvas.focus()
  await canvas.press('Control+c')
  await canvas.press('Control+v')
  await expect.poll(async () => (await savedObjects(page)).roots.length).toBe(2)
  const pasted = await savedObjects(page)
  expect(new Set(pasted.nodes.map(node => node.id)).size).toBe(6)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedObjects(page)).toEqual(beforeMove)
  await page.getByRole('button', { name: 'Select object Cutter', exact: true }).click()
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('400')
  await page.getByRole('button', { name: 'Show wireframe of object subtract', exact: true }).click()
  await page.getByRole('button', { name: 'Hide object subtract', exact: true }).click()
  await page.getByRole('button', { name: 'Select object subtract', exact: true }).click()
  await page.getByRole('button', { name: 'Show object subtract', exact: true }).click()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect.poll(() => objectPixels(page)).toBeLessThan(100)
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect.poll(() => objectPixels(page)).toBeGreaterThan(1000)
  await page.screenshot({ path: 'test-results/object-editor-desktop.png' })
  const final = await savedObjects(page)
  await page.reload()
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object subtract', exact: true }).click()
  await expect.poll(() => savedObjects(page)).toEqual(final)
  await expect(page.locator('.panel-list-row')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Cutter', exact: true }).click()
  await expect(page.getByLabel('Box width', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/object-editor-narrow.png' })
  expect(errors).toEqual([])
})

test('passive blue volumes do not steal panel selection or panel shortcuts', async ({ page }) => {
  const project = { ...createStarterProject('blank'), panels: [createPanel({ name: 'Inside box', position: [0, 300, 0], width: 300, height: 300 })] }
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify(project)), { key, project })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Add a box', exact: true }).click()
  await ready(page)
  await page.getByRole('tab', { name: 'Panels', exact: true }).click()
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  await canvas.click({ position: { x: (await canvas.boundingBox())!.width / 2, y: (await canvas.boundingBox())!.height / 2 } })
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Inside box')
  const objects = await savedObjects(page)
  await canvas.press('ArrowRight')
  expect(await savedObjects(page)).toEqual(objects)
})

test('preview clicks preserve inspector dimension drafts until Apply or Cancel', async ({ page }) => {
  await page.addInitScript(({ key, project }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project))
  }, { key, project: createStarterProject('blank') })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Add a box', exact: true }).click()
  await expect.poll(async () => (await savedObjects(page))?.nodes.length).toBe(1)
  const original = await savedObjects(page)
  await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
  await page.getByRole('button', { name: 'Fit assembly (F)', exact: true }).click()
  const canvas = page.getByLabel('3D preview canvas', { exact: true })
  const bounds = (await canvas.boundingBox())!
  const center = { x: bounds.width / 2, y: bounds.height / 2 }
  await page.getByLabel('Box width', { exact: true }).fill('800')
  // Clicking the object also blurs the field, starting the draft.
  await canvas.click({ position: center })
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
  await ready(page)
  await canvas.click({ position: center, modifiers: ['Shift'] })
  await canvas.click({ position: { x: 10, y: 10 } })
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
  await expect(page.getByRole('button', { name: 'Apply object changes', exact: true })).toBeVisible()
  expect(await savedObjects(page)).toEqual(original)
  await apply(page)
  await expect.poll(async () => (await savedObjects(page)).nodes[0]).toMatchObject({ width: 800 })
  await canvas.click({ position: center })
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedObjects(page)).toEqual(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await field(page, 'Box width', '900')
  await canvas.click({ position: center })
  await canvas.press('Escape')
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
  await page.reload()
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  await page.getByRole('button', { name: 'Select object Box', exact: true }).click()
  await expect(page.getByLabel('Box width', { exact: true })).toHaveValue('800')
})
