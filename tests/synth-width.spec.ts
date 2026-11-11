import { test, expect } from './browser-fixture'
import { synthStorageShelfProject } from '../src/lib/synth-storage-shelf'

test('storage shelf arrow widening commits on release', async ({ page }) => {
  const source = synthStorageShelfProject()
  const panel = source.panels.find(panel => panel.name === 'Synth tray 1')!
  await page.goto('/')
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search examples' }).fill('synth')
  await page.locator('[data-example-id="synth-shelf-storage"]').click()
  await page.getByRole('dialog', { name: 'Replace current project?' }).getByRole('button', { name: 'Replace project', exact: true }).click()
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
  await expect.poll(async () => (await saved())?.name, { timeout: 20000 }).toBe(source.name)
  await page.getByRole('button', { name: 'Assembly', exact: true }).click()
  await page.getByRole('button', { name: panel.name, exact: true }).click()
  const handle = page.locator('[data-resize-handle="panel-width-positive"]')
  await expect(handle).toBeVisible({ timeout: 20000 })
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const before = await saved()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await saved()).panels.find((item: { name: string }) => item.name === panel.name).width, { timeout: 20000 }).toBeGreaterThan(panel.width)
  const after = await saved()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(saved).toEqual(before)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(saved).toEqual(after)
  await page.reload()
  expect(await saved()).toEqual(after)
})
