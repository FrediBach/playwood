import { expect, test, type Page } from '@playwright/test'
import { createPanel } from '../src/lib/model'
import type { Project, Side } from '../src/lib/types'

const STORAGE_KEY = 'playwood-studio-project-v1'
const sides: Side[] = ['left', 'right', 'top', 'bottom', 'front', 'back']

function rotatedPanelProject(): Project {
  return {
    version: 1, name: 'Attachment side guidance', connections: [],
    panels: [createPanel({ name: 'Rotated panel', width: 600, height: 400, position: [0, 500, 0], rotation: [0, 0, Math.PI] })],
  }
}

async function openAttachment(page: Page, project: Project) {
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify(project))
  }, { key: STORAGE_KEY, project })
  await page.goto('/')
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Rotated panel')
  await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption('front')
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await expect(page.locator('[data-attachment-side]')).toHaveCount(6)
}

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY)
}

test('side labels follow the panel rotation and link preview hover, focus and selection to the inspector', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const project = rotatedPanelProject()
  await openAttachment(page, project)
  const picker = page.getByRole('group', { name: 'Choose a side', exact: true })
  const inspector = (side: Side) => picker.locator(`[data-inspector-side="${side}"]`)
  const preview = (side: Side) => page.locator(`[data-attachment-side="${side}"]`)
  for (const side of sides) {
    await expect(inspector(side)).toHaveAccessibleName(side[0].toUpperCase() + side.slice(1))
    await expect(preview(side)).toHaveAccessibleName(`Choose ${side[0].toUpperCase() + side.slice(1)} side`)
    await expect(preview(side)).toBeInViewport()
  }
  const left = (await preview('left').boundingBox())!
  const right = (await preview('right').boundingBox())!
  expect(right.x).toBeLessThan(left.x)

  await inspector('left').hover()
  await expect(preview('left')).toHaveClass(/is-highlighted/)
  await expect(inspector('right')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview('right')).toHaveAttribute('aria-pressed', 'true')
  await preview('top').hover()
  await expect(inspector('top')).toHaveClass(/is-highlighted/)
  await expect(inspector('right')).toHaveAttribute('aria-pressed', 'true')
  await preview('top').click()
  await expect(inspector('top')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview('top')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.preview-badge')).toContainText('top')

  await inspector('back').focus()
  await expect(preview('back')).toHaveClass(/is-highlighted/)
  await expect(inspector('top')).toHaveAttribute('aria-pressed', 'true')
  await inspector('back').press('Enter')
  await expect(preview('back')).toHaveAttribute('aria-pressed', 'true')
  expect(await savedProject(page)).toEqual(project)
  await page.screenshot({ path: 'test-results/attachment-sides-linked.png' })
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(page.locator('[data-attachment-side]')).toHaveCount(0)
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Rotated panel')
  expect(await savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('choosing a side in the preview commits only on Apply and remains one undoable attachment', async ({ page }) => {
  const project = rotatedPanelProject()
  await openAttachment(page, project)
  const preview = page.getByRole('button', { name: 'Choose Left side', exact: true })
  await preview.focus()
  await preview.press('Space')
  await expect(page.locator('[data-inspector-side="left"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(preview).toHaveAttribute('aria-pressed', 'true')
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Attach panel', exact: true }).click()
  await expect(page.locator('[data-attachment-side]')).toHaveCount(0)
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(2)
  const attached = await savedProject(page)
  expect(attached.connections).toHaveLength(1)
  expect(attached.connections[0]).toMatchObject({ parentId: project.panels[0].id, side: 'left' })
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(project)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(() => savedProject(page)).toEqual(attached)
})

test('all six side labels stay separately reachable in perspective and orthographic views', async ({ page }) => {
  await openAttachment(page, rotatedPanelProject())
  for (const view of ['perspective', 'front', 'top', 'right']) {
    await page.getByRole('combobox', { name: 'Camera view', exact: true }).selectOption(view)
    const boxes = []
    for (const side of sides) {
      const button = page.locator(`[data-attachment-side="${side}"]`)
      await expect(button).toBeInViewport()
      await button.hover()
      await expect(page.locator(`[data-inspector-side="${side}"]`)).toHaveClass(/is-highlighted/)
      boxes.push({ side, ...(await button.boundingBox())! })
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      expect(overlapX <= 0 || overlapY <= 0, `${a.side} and ${b.side} overlap in ${view} view`).toBe(true)
    }
    await page.screenshot({ path: `test-results/attachment-sides-${view}.png` })
  }
})

test('the starter shelf exposes named sides among surrounding panels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Bottom shelf')
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  for (const side of sides) {
    const button = page.locator(`[data-attachment-side="${side}"]`)
    await expect(button).toBeInViewport()
    await button.hover()
    await expect(page.locator(`[data-inspector-side="${side}"]`)).toHaveClass(/is-highlighted/)
  }
  await page.locator('[data-inspector-side="right"]').hover()
  await expect(page.locator('[data-attachment-side="right"]')).toHaveClass(/is-highlighted/)
  await page.screenshot({ path: 'test-results/attachment-sides-starter-shelf.png' })
})

test('phone users can match inspector letters and choose a preview side with the drawer collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  const picker = page.getByRole('group', { name: 'Choose a side', exact: true })
  for (const [index, side] of sides.entries()) {
    const button = picker.locator(`[data-inspector-side="${side}"]`)
    await expect(button).toBeInViewport()
    await expect(button).toContainText(String.fromCharCode(65 + index))
  }
  expect(await page.locator('.inspector-scroll').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/attachment-sides-phone-inspector.png' })
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  const top = page.getByRole('button', { name: 'Choose Top side', exact: true })
  await expect(top).toBeInViewport()
  await top.click()
  await expect(top).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'test-results/attachment-sides-phone-preview.png' })
  await page.getByRole('button', { name: 'Open inspector', exact: true }).click()
  await expect(picker.locator('[data-inspector-side="top"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Attach to Bottom shelf', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  await expect(page.locator('[data-attachment-side]')).toHaveCount(0)
})

test('A and the context menu open new-panel attachment without committing until accepted', async ({ page }) => {
  const project = rotatedPanelProject()
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'attach.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  const name = page.getByLabel('Panel name', { exact: true })
  await name.focus()
  await page.keyboard.press('a')
  await expect(page.getByRole('group', { name: 'Choose a side', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('canvas').focus()
  await page.keyboard.press('a')
  await expect(page.getByRole('group', { name: 'Choose a side', exact: true })).toBeVisible()
  expect((await savedProject(page)).panels).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Choose a side', exact: true })).toHaveCount(0)
  await page.locator('.panel-list-select').first().click()
  await page.locator('canvas').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: 'Attach a panel (A)', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Choose a side', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Attach panel', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(2)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await savedProject(page)).panels.length).toBe(1)
})

test('reselecting attachment sides toggles flip in both controls without committing the draft', async ({ page }) => {
  const project = rotatedPanelProject()
  await openAttachment(page, project)
  const flip = page.getByLabel('Flip joint direction', { exact: true })
  await flip.uncheck()
  for (const side of sides) {
    const inspector = page.locator(`[data-inspector-side="${side}"]`)
    const preview = page.locator(`[data-attachment-side="${side}"]`)
    // Each new side preserves the current direction; reselecting it flips.
    await inspector.click()
    await expect(flip).not.toBeChecked()
    await inspector.click()
    await expect(flip).toBeChecked()
    await preview.click()
    await expect(flip).not.toBeChecked()
  }
  const left = page.locator('[data-inspector-side="left"]')
  await left.click()
  await left.press('Enter')
  await expect(flip).toBeChecked()
  await page.locator('[data-attachment-side="left"]').press('Space')
  await expect(flip).not.toBeChecked()
  await flip.check()
  await page.locator('[data-inspector-side="right"]').click()
  await expect(flip).toBeChecked()
  expect(await savedProject(page)).toEqual(project)
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await savedProject(page)).toEqual(project)
})
