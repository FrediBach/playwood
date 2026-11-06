import { test, expect, type Page } from '@playwright/test'
import { createAssemblyFile, parseAssemblyFile } from '../src/lib/assembly-file'
import { createExampleProject } from '../src/lib/example-library'
import type { Project } from '../src/lib/types'

const folderName = 'Playwood projects'
const workspace: Project = { version: 1, name: 'Workspace', panels: [], connections: [] }
const diskProject: Project = { version: 1, name: 'Disk project', panels: [], connections: [] }
const syncDialog = (page: Page) => page.getByRole('dialog', { name: 'Sync projects', exact: true })
const saved = (page: Page): Promise<Project> => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))

// Keep native handles, writable streams, and IndexedDB structured cloning. Only
// the OS picker and permission responses are replaced for browser automation.
async function prepare(page: Page, project = workspace) {
  await page.addInitScript(({ project, folderName }) => {
    if (!sessionStorage.getItem('sync-test-initialized')) {
      localStorage.setItem('playwood-studio-project-v1', JSON.stringify(project))
      sessionStorage.setItem('sync-test-initialized', 'yes')
    }
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('sync-test-picker-count', String(Number(sessionStorage.getItem('sync-test-picker-count') || 0) + 1))
        const root = await navigator.storage.getDirectory()
        return root.getDirectoryHandle(folderName, { create: true })
      },
    })
    Object.defineProperty(FileSystemDirectoryHandle.prototype, 'queryPermission', {
      configurable: true,
      value: async () => sessionStorage.getItem('sync-test-permission') || 'granted',
    })
    Object.defineProperty(FileSystemDirectoryHandle.prototype, 'requestPermission', {
      configurable: true,
      value: async () => {
        sessionStorage.setItem('sync-test-request-count', String(Number(sessionStorage.getItem('sync-test-request-count') || 0) + 1))
        return sessionStorage.getItem('sync-test-permission') || 'granted'
      },
    })
  }, { project, folderName })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeVisible()
}

async function writeFile(page: Page, name: string, content: string) {
  await page.evaluate(async ({ folderName, name, content }) => {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(folderName, { create: true })
    const handle = await directory.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
  }, { folderName, name, content })
}

async function readFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async folderName => {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(folderName, { create: true })
    const files: Record<string, string> = {}
    for await (const entry of directory.values()) {
      if (entry.kind === 'file') files[entry.name] = await (await entry.getFile()).text()
    }
    return files
  }, folderName)
}

async function readProject(page: Page, name: string): Promise<Project | null> {
  const content = (await readFiles(page))[name]
  return content ? JSON.parse(content) : null
}

async function openSync(page: Page) {
  if (!(await syncDialog(page).isVisible())) await page.getByRole('button', { name: 'Sync', exact: true }).click()
  await expect(syncDialog(page)).toBeVisible()
}

async function chooseFolder(page: Page) {
  await openSync(page)
  await syncDialog(page).getByRole('button', { name: 'Choose folder', exact: true }).click()
  await expect(syncDialog(page).getByRole('button', { name: 'Save project', exact: true })).toBeEnabled()
}

async function closeSync(page: Page) {
  if (await syncDialog(page).isVisible()) await syncDialog(page).getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(syncDialog(page)).toHaveCount(0)
}

async function rename(page: Page, name: string) {
  await closeSync(page)
  await page.getByTitle('Rename project', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
  await page.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter')
  await expect.poll(async () => (await saved(page)).name).toBe(name)
}

test('folder projects support saving, autosave, collision-safe copies, discovery and opening', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await prepare(page)
  await writeFile(page, 'existing.json', JSON.stringify(diskProject))
  await writeFile(page, 'notes.json', JSON.stringify({ notes: 'Unrelated JSON' }))
  await writeFile(page, 'broken.playwood.json', '{')
  await chooseFolder(page)
  const dialog = syncDialog(page)
  await expect(dialog.getByRole('button', { name: 'Open Disk project', exact: true })).toBeVisible()
  await expect(dialog).toContainText('broken.playwood.json')
  await expect(dialog.getByRole('button', { name: 'Open Unrelated JSON' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(() => readProject(page, 'workspace.playwood.json')).toEqual(workspace)

  await rename(page, 'Manual save')
  expect((await readProject(page, 'workspace.playwood.json'))!.name).toBe('Workspace')
  await openSync(page)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(async () => (await readProject(page, 'workspace.playwood.json'))?.name).toBe('Manual save')
  await dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true }).check()
  await rename(page, 'Autosaved workspace')
  await expect.poll(async () => (await readProject(page, 'workspace.playwood.json'))?.name).toBe('Autosaved workspace')

  await openSync(page)
  await dialog.getByRole('button', { name: 'Duplicate project', exact: true }).click()
  await expect.poll(() => readProject(page, 'autosaved-workspace-copy.playwood.json')).toEqual({ ...workspace, name: 'Autosaved workspace copy' })
  await dialog.getByRole('button', { name: 'Duplicate project', exact: true }).click()
  await expect.poll(() => readProject(page, 'autosaved-workspace-copy-2.playwood.json')).toEqual({ ...workspace, name: 'Autosaved workspace copy' })
  await dialog.getByRole('button', { name: 'Duplicate Disk project', exact: true }).click()
  await expect.poll(() => readProject(page, 'disk-project-copy.playwood.json')).toEqual({ ...diskProject, name: 'Disk project copy' })
  expect((await readProject(page, 'workspace.playwood.json'))!.name).toBe('Autosaved workspace')

  await dialog.getByRole('button', { name: 'Open Disk project', exact: true }).click()
  await expect.poll(async () => (await saved(page)).name).toBe('Disk project')
  await openSync(page)
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).not.toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await closeSync(page)
  const sync = page.getByRole('button', { name: 'Sync', exact: true })
  await expect(sync).toHaveAttribute('data-sync-status', 'connected')
  await expect(sync.locator('.sync-status-badge')).toBeInViewport()
  expect(errors).toEqual([])
})

test('external changes pause autosave and unsaved opening can cancel, preserve a copy, or reload disk', async ({ page }) => {
  await prepare(page)
  await writeFile(page, 'disk.playwood.json', JSON.stringify(diskProject))
  await chooseFolder(page)
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Open Disk project', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Open without saving', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await saved(page)).name).toBe('Workspace')
  await dialog.getByRole('button', { name: 'Open Disk project', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save and open', exact: true }).click()
  await expect.poll(() => readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  await expect.poll(async () => (await saved(page)).name).toBe('Disk project')
  await openSync(page)
  await dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true }).check()

  const external = { ...diskProject, name: 'Externally changed' }
  await writeFile(page, 'disk.playwood.json', JSON.stringify(external))
  await rename(page, 'Unsaved local changes')
  await openSync(page)
  await expect(dialog.getByRole('alert')).toContainText(/chang|conflict/i)
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).not.toBeChecked()
  expect(await readProject(page, 'disk.playwood.json')).toEqual(external)
  expect((await saved(page)).name).toBe('Unsaved local changes')
  await dialog.getByRole('button', { name: 'Duplicate project', exact: true }).click()
  await expect.poll(async () => (await readProject(page, 'unsaved-local-changes-copy.playwood.json'))?.name).toBe('Unsaved local changes copy')
  await dialog.getByRole('button', { name: 'Resync', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open Externally changed', exact: true }).click()
  await dialog.getByRole('button', { name: 'Open without saving', exact: true }).click()
  await expect.poll(async () => (await saved(page)).name).toBe('Externally changed')

  await page.evaluate(async folderName => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(folderName)
    await directory.removeEntry('disk.playwood.json')
  }, folderName)
  await rename(page, 'Edited after removal')
  await openSync(page)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(/miss|remov|delet|found/i)
  expect((await readFiles(page))['disk.playwood.json']).toBeUndefined()
  expect((await saved(page)).name).toBe('Edited after removal')
})

test('remembered folder reconnects after reload, handles denied permission, and can be forgotten without deleting files', async ({ page }) => {
  await prepare(page)
  const sync = page.getByRole('button', { name: 'Sync', exact: true })
  await expect(sync).not.toHaveAttribute('data-sync-status')
  await expect(sync.locator('.sync-status-badge')).toHaveCount(0)
  await chooseFolder(page)
  await closeSync(page)
  await expect(sync).toHaveAttribute('data-sync-status', 'connected')
  await expect(sync.locator('.sync-status-badge')).toBeVisible()
  await expect(sync).toHaveAttribute('title', /connected/i)
  await expect(sync).toHaveAttribute('aria-description', /Playwood projects/)
  await openSync(page)
  await syncDialog(page).getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(() => readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  await page.reload()
  await expect(sync).toHaveAttribute('data-sync-status', 'attention')
  await expect(sync.locator('.sync-status-badge')).toBeVisible()
  await expect(sync).toHaveAttribute('title', /reconnect|resync|access/i)
  await expect(sync).toHaveAttribute('aria-description', /Playwood projects/)
  await openSync(page)
  const dialog = syncDialog(page)
  await expect(dialog).toContainText(folderName)
  await expect(dialog.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled()
  await page.evaluate(() => sessionStorage.setItem('sync-test-permission', 'denied'))
  await dialog.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(/access|permission/i)
  await expect(dialog.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled()
  await closeSync(page)
  await expect(sync).toHaveAttribute('data-sync-status', 'attention')
  await expect(sync.locator('.sync-status-badge')).toBeVisible()
  await expect(sync).toHaveAttribute('aria-description', /access|permission|attention/i)
  await openSync(page)
  await page.evaluate(() => sessionStorage.setItem('sync-test-permission', 'granted'))
  await dialog.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Open Workspace', exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => sessionStorage.getItem('sync-test-picker-count'))).toBe('1')
  await closeSync(page)
  await expect(sync).toHaveAttribute('data-sync-status', 'connected')
  await expect(sync.locator('.sync-status-badge')).toBeVisible()
  await openSync(page)
  await dialog.getByRole('button', { name: 'Forget folder', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible()
  expect(await readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  await closeSync(page)
  await expect(sync).not.toHaveAttribute('data-sync-status')
  await expect(sync.locator('.sync-status-badge')).toHaveCount(0)
  await page.reload()
  await openSync(page)
  await expect(dialog.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Resync', exact: true })).toHaveCount(0)
})

test('an aborted autosave pauses without replacing disk content and a canceled picker preserves that state', async ({ page }) => {
  await prepare(page)
  await chooseFolder(page)
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(() => readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  await dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true }).check()
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable
    let fail = true
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      sessionStorage.setItem('sync-test-write-attempts', String(Number(sessionStorage.getItem('sync-test-write-attempts') || 0) + 1))
      if (fail) {
        fail = false
        throw new DOMException('Disk write was aborted.', 'AbortError')
      }
      return original.apply(this, args)
    }
  })
  await rename(page, 'Recoverable changes')
  await openSync(page)
  await expect(dialog.getByRole('alert')).toBeVisible()
  const error = await dialog.getByRole('alert').innerText()
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).not.toBeChecked()
  expect(await readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  expect(await page.evaluate(() => sessionStorage.getItem('sync-test-write-attempts'))).toBe('1')

  await page.evaluate(() => Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    value: async () => { throw new DOMException('Picker canceled.', 'AbortError') },
  }))
  await dialog.getByRole('button', { name: 'Change folder', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save project', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('alert')).toHaveText(error)
  await expect(dialog).toContainText(folderName)
  await expect(dialog).toContainText('workspace.playwood.json')
  expect((await saved(page)).name).toBe('Recoverable changes')

  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(async () => (await readProject(page, 'workspace.playwood.json'))?.name).toBe('Recoverable changes')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('sync-test-write-attempts'))).toBe('2')
  expect(Object.keys(await readFiles(page))).toEqual(['workspace.playwood.json'])
})

test('assemblies export and import through the folder and insert through the normal project workflow', async ({ page }) => {
  const original = createExampleProject('assembly-cube')
  const exported = createAssemblyFile(original, original.assemblies!.instances[0].id)
  const imported = { ...exported, definition: { ...exported.definition, name: 'Imported box' } }
  await prepare(page, original)
  await chooseFolder(page)
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Export assembly to folder', exact: true }).click()
  await expect.poll(async () => Object.keys(await readFiles(page))).toContain('cube-module.playwood-assembly.json')
  const file = JSON.parse((await readFiles(page))['cube-module.playwood-assembly.json'])
  expect(parseAssemblyFile(file).panels).toHaveLength(4)
  expect(file.definition.name).toBe('Cube module')
  expect(file.definition.parameters).toEqual(exported.definition.parameters)
  await dialog.getByRole('button', { name: 'Export assembly to folder', exact: true }).click()
  await expect.poll(async () => Object.keys(await readFiles(page))).toContain('cube-module-2.playwood-assembly.json')
  await dialog.getByLabel('Import assembly into folder file', { exact: true }).setInputFiles({ name: 'imported.playwood-assembly.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) })
  await expect(dialog.getByRole('button', { name: 'Insert Imported box', exact: true })).toBeVisible()
  expect((await saved(page)).panels).toHaveLength(4)
  await closeSync(page)
  const clear = page.getByRole('button', { name: 'Clear', exact: true })
  if (await clear.isVisible()) await clear.click()
  await openSync(page)
  await dialog.getByRole('button', { name: 'Insert Imported box', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(8)
  const inserted = await saved(page)
  expect(inserted.assemblies!.definitions).toHaveLength(2)
  await closeSync(page)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await saved(page)).panels.length).toBe(4)
})

test('new projects and undo across document changes release the disk binding', async ({ page }) => {
  await prepare(page)
  await chooseFolder(page)
  const dialog = syncDialog(page)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(() => readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  await dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true }).check()
  await closeSync(page)
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await page.getByRole('button', { name: 'Start new project', exact: true }).click()
  await expect.poll(async () => (await saved(page)).name).toBe('Untitled project')
  await openSync(page)
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(async () => (await readProject(page, 'untitled-project.playwood.json'))?.name).toBe('Untitled project')
  await closeSync(page)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await saved(page)).name).toBe('Workspace')
  await openSync(page)
  await expect(dialog.getByRole('checkbox', { name: 'Autosave to folder', exact: true })).toBeDisabled()
  await rename(page, 'Restored workspace')
  await openSync(page)
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click()
  await expect.poll(async () => (await readProject(page, 'restored-workspace.playwood.json'))?.name).toBe('Restored workspace')
  expect(await readProject(page, 'workspace.playwood.json')).toEqual(workspace)
  expect((await readProject(page, 'untitled-project.playwood.json'))!.name).toBe('Untitled project')
})

test('Sync stays accessible on narrow screens and unsupported browsers retain project export', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }))
  await page.goto('/')
  for (const name of ['New project', 'Sync', 'Export project']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport()
  }
  await openSync(page)
  await expect(syncDialog(page)).toContainText(/Chrome|Edge/)
  await expect(syncDialog(page).getByRole('button', { name: 'Choose folder', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await closeSync(page)
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file/ }).click()
  expect((await downloading).suggestedFilename()).toMatch(/\.playwood\.json$/)
})


test('library lists and searches synced projects and opens them through the protected sync flow', async ({ page }) => {
  await prepare(page)
  await writeFile(page, 'existing.json', JSON.stringify(diskProject))
  await chooseFolder(page)
  await closeSync(page)
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const section = page.getByRole('region', { name: 'Synced folder projects', exact: true })
  await expect(section).toContainText(folderName)
  const entry = section.getByRole('button', { name: 'Open synced project Disk project', exact: true })
  await expect(entry).toContainText('Folder sync · existing.json')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Open panel list', exact: true }).click()
  await expect(entry).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const search = page.getByRole('searchbox', { name: 'Search examples', exact: true })
  await search.fill('existing.json')
  await expect(entry).toBeVisible()
  await search.fill('no matching project')
  await expect(entry).toHaveCount(0)
  await search.fill('')
  await entry.click()
  await expect(syncDialog(page).getByRole('button', { name: 'Open without saving', exact: true })).toBeVisible()
  await syncDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await saved(page)).name).toBe('Workspace')
  await closeSync(page)
  await entry.click()
  await syncDialog(page).getByRole('button', { name: 'Open without saving', exact: true }).click()
  await expect.poll(async () => (await saved(page)).name).toBe('Disk project')
  await openSync(page)
  await expect(syncDialog(page)).toContainText('existing.json')
  await syncDialog(page).getByRole('button', { name: 'Forget folder', exact: true }).click()
  await closeSync(page)
  await expect(section).toHaveCount(0)
})

test('synced previews load independently, refresh after resync, and tolerate unreadable files', async ({ page }) => {
  await prepare(page)
  await writeFile(page, 'preview.json', JSON.stringify({ ...createExampleProject('cube'), name: 'Preview project' }))
  await chooseFolder(page)
  await closeSync(page)
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.getFile
    const gate = new Promise<void>(resolve => Object.defineProperty(window, 'releasePreviewRead', { configurable: true, value: resolve }))
    FileSystemFileHandle.prototype.getFile = async function () {
      if (this.name === 'preview.json') await gate
      return original.call(this)
    }
  })
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const entry = page.getByRole('button', { name: 'Open synced project Preview project', exact: true })
  await expect(entry.getByRole('status')).toHaveText('Loading synced project preview…')
  const starter = page.locator('[data-example-id="shelf"]')
  await starter.scrollIntoViewIfNeeded()
  await expect(starter.locator('svg polygon').first()).toBeAttached()
  await entry.scrollIntoViewIfNeeded()
  await expect(entry.getByRole('status')).toHaveText('Loading synced project preview…')
  await page.getByRole('searchbox', { name: 'Search examples', exact: true }).fill('Preview project')
  await expect(entry).toBeVisible()
  await page.evaluate(() => Reflect.get(window, 'releasePreviewRead')())
  await expect(entry.locator('svg polygon').first()).toBeAttached()
  expect((await saved(page)).name).toBe('Workspace')
  await writeFile(page, 'preview.json', JSON.stringify({ ...diskProject, name: 'Preview project' }))
  await openSync(page)
  await syncDialog(page).getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(syncDialog(page).getByRole('status')).toContainText('Folder resynced.')
  await closeSync(page)
  await expect(entry).toContainText('No panels to preview')
  await writeFile(page, 'preview.json', '{')
  await page.getByRole('button', { name: 'Assembly', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(entry.getByRole('status')).toContainText('Preview unavailable')
  await expect(page.locator('[data-example-id="cube"]')).toBeAttached()
  const builtIn = page.locator('[data-example-id="shelf"]')
  await builtIn.scrollIntoViewIfNeeded()
  await expect(builtIn.locator('svg polygon').first()).toBeAttached()
})
