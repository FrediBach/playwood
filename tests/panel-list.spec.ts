import { test, expect, type Page } from '@playwright/test'
import { createPanel, createStarterProject, resolvePanels } from '../src/lib/model'
import type { Panel, Project } from '../src/lib/types'

async function importProject(page: Page, project: Project) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.getByLabel('Import project file').setInputFiles({
    name: 'panel-list.playwood.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
}

function projectWith(panels: Panel[]): Project {
  return { version: 1, name: 'Panel list test', panels, connections: [] }
}

function row(page: Page, name: string) {
  return page.locator('.panel-list-row').filter({ has: page.getByText(name, { exact: true }) })
}

async function rename(page: Page, name: string) {
  await row(page, name).hover()
  await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click()
  return page.getByRole('textbox', { name: 'Rename panel', exact: true })
}

test('pointer sorting preserves attachments and selection, supports undo, and persists', async ({ page }) => {
  await page.goto('/')
  const names = page.locator('.panel-list-name')
  const original = ['Bottom shelf', 'Left side', 'Right side', 'Top shelf', 'Middle shelf']
  await expect(names).toHaveText(original)
  await page.locator('.panel-list-select').nth(3).click()
  const handle = await page.getByRole('button', { name: 'Reorder Top shelf', exact: true }).boundingBox()
  const target = await page.locator('.panel-list-row').first().boundingBox()
  expect(handle).not.toBeNull()
  expect(target).not.toBeNull()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 3, { steps: 15 })
  await page.mouse.up()
  const reordered = ['Top shelf', 'Bottom shelf', 'Left side', 'Right side', 'Middle shelf']
  await expect(names).toHaveText(reordered)
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Top shelf')
  await expect(page.locator('.attached-to')).toHaveText('Attached to Left side')
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(names).toHaveText(original)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  await expect(names).toHaveText(reordered)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(names).toHaveText(reordered)
  await expect(page.locator('.attached-to')).toHaveText('Attached to Left side')
})

test('keyboard sorting can be cancelled and commits the move as one undo step', async ({ page }) => {
  await importProject(page, projectWith(['A', 'B', 'C'].map((name, i) => createPanel({ name, position: [i * 800, 400, 0] }))))
  const names = page.locator('.panel-list-name')
  const handle = page.getByRole('button', { name: 'Reorder A', exact: true })
  await handle.focus()
  await handle.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(names).toHaveText(['A', 'B', 'C'])
  await expect(handle).toBeFocused()
  await handle.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
  await expect(page.locator('.panel-list')).not.toHaveClass(/is-sorting/)
  await expect(names).toHaveText(['A', 'B', 'C'])
  await handle.focus()
  await handle.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(names).toHaveText(['B', 'C', 'A'])
  await expect(handle).toBeFocused()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(names).toHaveText(['A', 'B', 'C'])
})

test('inline rename commits once, cancels safely, and keeps rows compact', async ({ page }) => {
  await page.goto('/')
  const before = await row(page, 'Bottom shelf').boundingBox()
  await row(page, 'Bottom shelf').hover()
  await page.screenshot({ path: 'test-results/panel-list-hover.png' })
  let input = await rename(page, 'Bottom shelf')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('maxlength', '120')
  await input.fill('  Books and records  ')
  await input.press('Enter')
  await expect(page.locator('.panel-list-name').first()).toHaveText('Books and records')
  await expect(row(page, 'Books and records').locator('.panel-list-select')).toBeFocused()
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Books and records')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-name').first()).toHaveText('Bottom shelf')

  input = await rename(page, 'Bottom shelf')
  await input.fill('Do not keep this')
  await input.press('Escape')
  await expect(page.locator('.panel-list-name').first()).toHaveText('Bottom shelf')
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(1)
  await expect(row(page, 'Bottom shelf').locator('.panel-list-select')).toBeFocused()

  input = await rename(page, 'Bottom shelf')
  await input.fill('   ')
  await input.press('Enter')
  await expect(page.locator('.panel-list-name').first()).toHaveText('Bottom shelf')

  input = await rename(page, 'Bottom shelf')
  await input.fill('A long but valid shelf name that must stay on a single line in the list')
  await page.getByRole('button', { name: 'Fit assembly (F)' }).click()
  await expect(page.getByRole('button', { name: 'Fit assembly (F)' })).toBeFocused()
  const after = await page.locator('.panel-list-row').first().boundingBox()
  expect(after!.height).toBe(before!.height)
  expect(after!.height).toBeLessThanOrEqual(60)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.panel-list-name').first()).toHaveText('A long but valid shelf name that must stay on a single line in the list')
  await page.screenshot({ path: 'test-results/panel-list-compact.png' })
})

test('removing a row deletes only that panel and preserves attached survivors', async ({ page }) => {
  const project = createStarterProject('shelf')
  const leftSide = resolvePanels(project).find(panel => panel.name === 'Left side')!
  await importProject(page, project)
  await page.getByRole('checkbox', { name: 'Select Left side', exact: true }).check()
  await expect(page.locator('.panel-list-row.selected')).toHaveCount(2)
  await row(page, 'Bottom shelf').hover()
  await page.getByRole('button', { name: 'Remove Bottom shelf', exact: true }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(4)
  await expect(page.locator('.panel-list-name')).toHaveText(['Left side', 'Right side', 'Top shelf', 'Middle shelf'])
  await expect(page.getByLabel('Panel name', { exact: true })).toHaveValue('Left side')
  for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
    await expect(page.getByLabel(`Position ${axis}`, { exact: true })).toHaveValue(String(Math.round(leftSide.position[index] * 10) / 10))
  }
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(5)
  await expect(page.locator('.attached-to')).toHaveText('Attached to Bottom shelf')
})

test('overlap markers identify both panels and clear when the overlap is resolved', async ({ page }) => {
  await importProject(page, projectWith([
    createPanel({ name: 'Front panel', position: [0, 400, 0] }),
    createPanel({ name: 'Crossing panel', position: [80, 400, 0] }),
    createPanel({ name: 'Separate panel', position: [1600, 400, 0] }),
  ]))
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(2)
  await expect(row(page, 'Front panel').getByRole('button', { name: 'Overlaps with Crossing panel', exact: true })).toBeVisible()
  await expect(row(page, 'Crossing panel').getByRole('button', { name: 'Overlaps with Front panel', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/panel-list-overlaps.png' })
  await row(page, 'Crossing panel').hover()
  await page.getByRole('button', { name: 'Hide Crossing panel', exact: true }).click()
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(2)
  await page.getByRole('button', { name: 'Show Crossing panel', exact: true }).click()
  await row(page, 'Crossing panel').locator('.panel-list-select').click()
  await page.getByLabel('Position X', { exact: true }).fill('800')
  await page.getByLabel('Position X', { exact: true }).press('Tab')
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-overlap-indicator')).toHaveCount(2)
})

test('compact and touch layouts keep row actions available and support touch sorting', async ({ page, browser, baseURL }) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.goto('/')
  await row(page, 'Bottom shelf').hover()
  await expect(page.getByRole('button', { name: 'Rename Bottom shelf', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Bottom shelf', exact: true })).toBeVisible()
  expect(await page.locator('.panel-list-row').evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height === 55))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/panel-list-narrow.png' })

  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  try {
    const touchPage = await context.newPage()
    const errors: string[] = []
    touchPage.on('pageerror', error => errors.push(error.message))
    await touchPage.goto('/')
    await touchPage.getByRole('button', { name: 'Open panel list', exact: true }).tap()
    // Unselected rows also expose their controls without requiring hover.
    await expect(touchPage.getByRole('button', { name: 'Rename Middle shelf', exact: true })).toHaveCSS('opacity', '1')
    await expect(touchPage.getByRole('button', { name: 'Remove Middle shelf', exact: true })).toHaveCSS('opacity', '1')
    await expect(touchPage.getByRole('button', { name: 'Remove Middle shelf', exact: true })).toBeVisible()
    const handle = await touchPage.getByRole('button', { name: 'Reorder Middle shelf', exact: true }).boundingBox()
    const target = await touchPage.locator('.panel-list-row').first().boundingBox()
    const x = handle!.x + handle!.width / 2
    const startY = handle!.y + handle!.height / 2
    const endY = target!.y + 3
    // Real touch input exercises browser pointer capture and touch-action behavior.
    const input = await context.newCDPSession(touchPage)
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] })
    for (let step = 1; step <= 12; step++) {
      await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * step / 12 }] })
    }
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(touchPage.locator('.panel-list-name')).toHaveText(['Middle shelf', 'Bottom shelf', 'Left side', 'Right side', 'Top shelf'])
    expect(await touchPage.locator('.panel-list-row').evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height === 55))).toBe(true)
    expect(await touchPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    await touchPage.screenshot({ path: 'test-results/panel-list-touch.png' })
    await touchPage.getByRole('button', { name: 'Remove Middle shelf', exact: true }).tap()
    await expect(touchPage.locator('.panel-list-row')).toHaveCount(4)
    await touchPage.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).tap()
    await expect(touchPage.locator('.panel-list-name').first()).toHaveText('Middle shelf')
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
