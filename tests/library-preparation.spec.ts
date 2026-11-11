import { expect, test, type Page } from '@playwright/test'
import type { Project } from '../src/lib/types'

const storageKey = 'playwood-studio-project-v1'
type WorkerProbe = { mode: 'delay' | 'fail'; completed: number }

async function delayedPreparation(page: Page) {
  await page.addInitScript(() => {
    const probe: WorkerProbe = { mode: 'delay', completed: 0 }
    Object.assign(window, { exampleWorkerProbe: probe })
    const NativeWorker = Worker
    window.Worker = class extends NativeWorker {
      private library: boolean
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.library = String(url).includes('library-preview.worker')
      }
      postMessage(message: { kind?: string }) {
        if (!this.library) { super.postMessage(message); return }
        // Keep this test on the uncached opening path, independent of card visibility.
        if (message.kind !== 'project') return
        if (probe.mode === 'fail') {
          setTimeout(() => this.dispatchEvent(new ErrorEvent('error', { message: 'Preparation unavailable', cancelable: true })), 50)
          return
        }
        setTimeout(() => { super.postMessage(message); probe.completed++ }, 1500)
      }
    }
  })
  await page.goto('/')
  await expect.poll(() => savedProject(page), { timeout: 15000 }).not.toBeNull()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search examples' }).fill('cat tower')
}

const savedProject = (page: Page): Promise<Project | null> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKey)
const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Replace current project?' })
const replace = (page: Page) => confirmation(page).getByRole('button', { name: 'Replace project', exact: true })
const chooseTower = (page: Page) => page.locator('[data-example-id="cat-tower"]').click()

test('preparing an example is cancellable and reopening it preserves fresh identities and one-step undo', async ({ page }) => {
  await delayedPreparation(page)
  const original = await savedProject(page)
  await chooseTower(page)
  await expect(confirmation(page)).toBeVisible()
  await expect(confirmation(page).getByRole('status')).toContainText('Preparing example…')
  await expect(replace(page)).toBeDisabled()
  await expect(confirmation(page).getByRole('button', { name: 'Export current project' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(confirmation(page)).not.toBeVisible()
  expect(await savedProject(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()

  await chooseTower(page)
  await expect(replace(page)).toBeDisabled()
  await replace(page).click()
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Cat tower')
  const first = (await savedProject(page))!
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
  await chooseTower(page)
  await replace(page).click()
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Cat tower')
  const second = (await savedProject(page))!
  expect(second.panels.map(panel => panel.id)).not.toEqual(first.panels.map(panel => panel.id))
  expect(second.panels.map(panel => [panel.name, panel.width, panel.height])).toEqual(first.panels.map(panel => [panel.name, panel.width, panel.height]))
})

test('failed preparation preserves the workspace and can be retried', async ({ page }) => {
  await delayedPreparation(page)
  const original = await savedProject(page)
  await page.evaluate(() => { (window as Window & { exampleWorkerProbe: WorkerProbe }).exampleWorkerProbe.mode = 'fail' })
  await chooseTower(page)
  await expect(confirmation(page).getByRole('alert')).toBeVisible()
  await expect(replace(page)).toBeDisabled()
  expect(await savedProject(page)).toEqual(original)
  await confirmation(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(() => { (window as Window & { exampleWorkerProbe: WorkerProbe }).exampleWorkerProbe.mode = 'delay' })
  await chooseTower(page)
  await replace(page).click()
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Cat tower')
})

test('importing a different project discards an outstanding example preparation', async ({ page }) => {
  await delayedPreparation(page)
  await chooseTower(page)
  await expect(replace(page)).toBeDisabled()
  const imported: Project = { version: 1, name: 'Keep the imported workspace', panels: [], connections: [] }
  await page.getByLabel('Import project file').setInputFiles({
    name: 'replacement.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)),
  })
  await expect(confirmation(page)).not.toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { exampleWorkerProbe: WorkerProbe }).exampleWorkerProbe.completed)).toBe(1)
  await expect.poll(async () => (await savedProject(page))?.name).toBe(imported.name)
  expect((await savedProject(page))!.panels).toEqual([])
  await expect(page.locator('.project-name')).toHaveText(imported.name)
})

for (const narrow of [false,true]) test(`opening a large library build shows feedback and supports cancellation (${narrow?'phone':'desktop'})`, async ({ page }) => {
  await delayedPreparation(page)
  const original = await savedProject(page)
  await chooseTower(page)
  await expect(replace(page)).toBeEnabled({ timeout: 20000 })
  if(narrow) await page.setViewportSize({width:390,height:844})
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
  await replace(page).click()
  await expect(confirmation(page).getByRole('status')).toContainText('Opening Cat tower…')
  await expect(confirmation(page).getByRole('button', { name: 'Opening…', exact: true })).toBeDisabled()
  await expect(confirmation(page).getByRole('button', { name: 'Opening…', exact: true })).toHaveAttribute('aria-busy', 'true')
  const statusBox=await confirmation(page).getByRole('status').boundingBox()
  expect(statusBox!.x).toBeGreaterThanOrEqual(0)
  expect(statusBox!.x+statusBox!.width).toBeLessThanOrEqual(narrow?390:1440)
  expect(await savedProject(page)).toEqual(original)
  // One paint is allowed before the commit can start.
  await page.clock.runFor(16)
  await expect(confirmation(page).getByRole('status')).toContainText('Opening Cat tower…')
  await page.keyboard.press('Escape')
  await page.clock.runFor(1000)
  await expect(confirmation(page)).not.toBeVisible()
  expect(await savedProject(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()

  await page.clock.resume()
  if(narrow) {
    await page.setViewportSize({width:1440,height:1000})
    await page.getByRole('button',{name:'Templates',exact:true}).click()
    await page.getByRole('searchbox',{name:'Search examples'}).fill('cat tower')
    await page.getByRole('dialog').locator('[data-example-id="cat-tower"]').click()
  } else await chooseTower(page)
  await expect(replace(page)).toBeEnabled({ timeout: 20000 })
  await replace(page).click()
  await expect(confirmation(page)).not.toBeVisible({ timeout: 20000 })
  await expect.poll(async () => (await savedProject(page))?.name).toBe('Cat tower')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect.poll(() => savedProject(page)).toEqual(original)
  await expect(page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' })).toBeDisabled()
})
