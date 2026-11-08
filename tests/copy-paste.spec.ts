import { test, expect, type Locator, type Page } from '@playwright/test'
import { attachPanel, createPanel, parseProject } from '../src/lib/model'
import { gridProject } from '../src/lib/example-geometry'
import { createAssembly } from '../src/lib/assemblies'
import { createExampleProject } from '../src/lib/example-library'
import type { Project } from '../src/lib/types'

async function load(page: Page, project: Project) {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'paste.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
}
async function attachAt(page: Page, location: Locator) {
  await location.click()
  const chooser = page.getByRole('region', { name: 'Attachment placement' })
  await chooser.getByRole('button', { name: /^Preview arrangement/ }).first().click()
  await chooser.getByRole('button', { name: /^Attach (copy|panel|assembly)$/ }).click()
}

async function saved(page: Page, panelCount: number): Promise<Project> {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).panels.length)).toBe(panelCount)
  await expect(page.getByText('Saved on this device', { exact: true })).toBeAttached()
  return page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!))
}

test('copy from the list, choose a preview attachment, cancel, repeat and undo', async ({ page }) => {
  const panels = [createPanel({ name: 'Source', width: 250, height: 250, position: [-900, 600, 0], color: '#123456' }), createPanel({ name: 'Target', position: [0, 600, 0] })]
  await load(page, { version: 1, name: 'Clipboard test', panels, connections: [] })
  await page.locator('.panel-list-select').first().click()
  await page.keyboard.press('Control+c')
  await expect(page.getByText('Panel copied. Select a target and press Ctrl/Cmd+V.')).toBeVisible()
  await page.locator('.panel-list-select').nth(1).click()
  await page.keyboard.press('Control+v')
  const handles = page.getByRole('button', { name: /^Choose location / })
  await expect(handles.first()).toBeVisible()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await handles.first().hover()
  await page.keyboard.press('Escape')
  await expect(handles).toHaveCount(0)
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await page.keyboard.press('Meta+v')
  await attachAt(page, handles.first())
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  const pasted = await saved(page, 3)
  expect(pasted.panels[2]).toMatchObject({ name: 'Source copy', color: '#123456', width: 250 })
  expect(pasted.connections[0].parentId).toBe(panels[1].id)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(page.locator('.panel-list-row')).toHaveCount(2)
  await page.locator('.panel-list-select').nth(1).click()
  await page.keyboard.press('Control+v')
  await attachAt(page, handles.first())
  await expect(page.locator('.panel-list-row')).toHaveCount(3)
  // Text fields retain normal clipboard behavior.
  await page.getByLabel('Panel name', { exact: true }).fill('Typing here')
  await page.keyboard.press('Control+v')
  await expect(handles).toHaveCount(0)
})

test('pastes a copied assembly through corner handles and cancels stale previews on undo', async ({ page }) => {
  const cube = createExampleProject('cube')
  const project = createAssembly(cube, cube.panels.map(panel => panel.id), 'Box')
  await load(page, project)
  await page.locator('canvas').click({ position: { x: 5, y: 5 } })
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.keyboard.press('Meta+c')
  await page.keyboard.press('Meta+v')
  const handles = page.getByRole('button', { name: /^Choose location / })
  await expect(handles.first()).toBeVisible()
  await attachAt(page, handles.first())
  expect((await saved(page, 8)).assemblies!.instances).toHaveLength(2)
  await page.keyboard.press('Control+v')
  await expect(handles.first()).toBeVisible()
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  await expect(handles).toHaveCount(0)
  expect((await saved(page, 4)).assemblies!.instances).toHaveLength(1)
})

for (const selection of ['panel', 'multiple panels', 'assembly'] as const) {
  test(`library insertion waits for preview placement on ${selection}`, async ({ page }) => {
    const project: Project = selection === 'assembly' ? createExampleProject('assembly-cube') : {
      version: 1, name: 'Library attachment', connections: [], panels: [
        createPanel({ name: 'Target one', position: [-800, 700, 0] }),
        createPanel({ name: 'Target two', position: [800, 700, 0] }),
      ],
    }
    await load(page, project)
    if (selection === 'multiple panels') await page.getByRole('button', { name: 'Select all', exact: true }).click()
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByRole('button', { name: 'Assemblies', exact: true }).click()
    const card = page.getByRole('button', { name: selection === 'assembly' ? 'Insert Cube module instance' : 'Cube module', exact: true })
    await card.click()
    const handles = page.getByRole('button', { name: /^Choose location / })
    await expect(handles.first()).toBeVisible()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await handles.first().hover()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await page.getByRole('button', { name: 'Cancel placement', exact: true }).click()
    await expect(handles).toHaveCount(0)
    await card.click()
    await expect(handles.first()).toBeVisible()
    await attachAt(page, handles.first())
    const next = await saved(page, project.panels.length + 4)
    expect(next.assemblies!.instances).toHaveLength(selection === 'assembly' ? 2 : 1)
    if (selection === 'assembly') {
      expect(next.assemblies!.definitions).toHaveLength(1)
      expect(next.assemblies!.links).toHaveLength(1)
    }
    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    expect(await saved(page, next.panels.length)).toEqual(next)
  })
}

for (const selection of ['panel', 'multiple panels', 'assembly', 'none'] as const) {
  test(`new panel uses preview placement with ${selection} selected`, async ({ page }) => {
    const project: Project = selection === 'assembly' ? createExampleProject('assembly-cube') : {
      version: 1, name: 'New panel attachment', connections: [], panels: [
        createPanel({ name: 'Target one', position: [-800, 700, 0] }),
        createPanel({ name: 'Target two', position: [800, 700, 0] }),
      ],
    }
    await load(page, project)
    if (selection === 'multiple panels' || selection === 'none') await page.getByRole('button', { name: 'Select all', exact: true }).click()
    if (selection === 'none') await page.getByRole('button', { name: 'Clear', exact: true }).click()
    const openForm = async () => {
      await page.getByRole('button', { name: 'Add a panel', exact: false }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Panel name', exact: true }).fill('Custom shelf')
      await dialog.getByRole('button', { name: selection === 'none' ? 'Add to workspace' : 'Choose attachment point', exact: true }).click()
    }
    await openForm()
    const handles = page.getByRole('button', { name: /^Choose location / })
    if (selection !== 'none') {
      await expect(handles.first()).toBeVisible()
      expect(await saved(page, project.panels.length)).toEqual(project)
      await handles.first().hover()
      expect(await saved(page, project.panels.length)).toEqual(project)
      await page.keyboard.press('Escape')
      await expect(handles).toHaveCount(0)
      await openForm()
      await attachAt(page, handles.first())
    } else await expect(handles).toHaveCount(0)
    const next = await saved(page, project.panels.length + 1)
    expect(next.panels.at(-1)!.name).toBe('Custom shelf')
    expect(next.connections.length).toBe(project.connections.length + (selection === 'none' ? 0 : 1))
    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    expect(await saved(page, project.panels.length)).toEqual(project)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    expect(await saved(page, next.panels.length)).toEqual(next)
  })
}


for (const kind of ['panels', 'connectors', 'mixed'] as const) {
  test(`copies multiple ${kind}, previews the whole group, cancels, pastes, undoes and reloads`, async ({ page }) => {
    const parent = createPanel({ name: 'Source base', width: 250, height: 250, position: [-1000, 800, 0] })
    const target = createPanel({ name: 'Destination', width: 500, height: 500, position: [1000, 800, 0] })
    const project = attachPanel({ version: 1, name: 'Selection copy', panels: [parent, target], connections: [] }, parent.id,
      createPanel({ name: 'Source side', width: 250, height: 250 }), { side: 'left', type: '90', flip: false, count: 2, color: '#123456', offset: 0, inset: 0 })
    await load(page, project)
    if (kind === 'panels') {
      await page.locator('.panel-list-select').nth(0).click()
      await page.locator('.panel-list-select').nth(2).click({ modifiers: ['Shift'] })
    } else {
      if (kind === 'mixed') await page.locator('.panel-list-select').nth(2).click()
      await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
      await page.locator('.connector-list-select').nth(0).click({ modifiers: kind === 'mixed' ? ['Shift'] : [] })
      await page.locator('.connector-list-select').nth(1).click({ modifiers: ['Shift'] })
    }
    await page.keyboard.press('Control+c')
    await expect(page.getByText('Selection copied. Select a target and press Ctrl/Cmd+V.')).toBeVisible()
    await page.getByRole('tab', { name: 'Panels', exact: true }).click()
    await page.locator('.panel-list-select').filter({ hasText: /^Destination$/ }).click()
    await page.keyboard.press('Control+v')
    const handles = page.getByRole('button', { name: /^Choose location / })
    await expect(handles.first()).toBeVisible()
    await handles.first().hover()
    expect(await saved(page, 3)).toEqual(project)
    await page.keyboard.press('Escape')
    await expect(handles).toHaveCount(0)
    await page.keyboard.press('Meta+v')
    await attachAt(page, handles.first())
    const next = await saved(page, 5)
    expect(next.connections).toHaveLength(3)
    expect(next.panels.slice(0, 3)).toEqual(project.panels)
    expect(parseProject(next)).toEqual(next)
    await expect(page.locator('.panel-list-row.selected')).toHaveCount(2)
    await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
    expect(await saved(page, 3)).toEqual(project)
    await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
    expect(await saved(page, 5)).toEqual(next)
    await page.reload()
    expect(await saved(page, 5)).toEqual(next)
  })
}


test('stacks a copied compartment using a shared shelf, with cancel, undo and reload', async ({ page }) => {
  const project = gridProject('Stack', [350], [300, 300], { depth: 250 })
  await load(page, project)
  for (const [index, name] of ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'].entries()) {
    await page.locator('.panel-list-select').filter({ hasText: name }).click({ modifiers: index ? ['Shift'] : [] })
  }
  await page.keyboard.press('Control+c')
  await page.locator('.panel-list-select').filter({ hasText: 'Shelf 1.3' }).click()
  await page.keyboard.press('Control+v')
  const handle = page.getByRole('button', { name: /Choose location .*shared surface/ }).first()
  await expect(handle).toBeVisible()
  await handle.hover()
  expect(await saved(page, 7)).toEqual(project)
  await page.keyboard.press('Escape')
  await expect(handle).toHaveCount(0)
  await page.keyboard.press('Control+v')
  await attachAt(page, handle)
  const next = await saved(page, 10)
  expect(next.connections.filter(connection => connection.type === 't')).toHaveLength(8)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)' }).click()
  expect(await saved(page, 7)).toEqual(project)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)' }).click()
  expect(await saved(page, 10)).toEqual(next)
  await page.reload()
  expect(await saved(page, 10)).toEqual(next)
})


for (const width of [1440, 390]) test(`paste separates location and arrangement at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 950 })
  const project = gridProject('Stack', [350], [300, 300], { depth: 250 })
  // Select on desktop before narrowing; the placement controls must then remain reachable.
  await page.setViewportSize({ width: 1440, height: 950 })
  await load(page, project)
  for (const [index, name] of ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'].entries()) {
    await page.locator('.panel-list-select').filter({ hasText: name }).click({ modifiers: index ? ['Shift'] : [] })
  }
  await page.keyboard.press('Control+c')
  await page.locator('.panel-list-select').filter({ hasText: 'Shelf 1.3' }).click()
  await page.keyboard.press('Control+v')
  await page.setViewportSize({ width, height: 950 })
  const chooser = page.getByRole('region', { name: 'Attachment placement' })
  const locations = page.getByRole('button', { name: /^Choose location / })
  await expect(chooser.getByRole('heading', { name: 'Where should it attach?' })).toBeVisible()
  await expect(locations.first()).toBeAttached()
  expect(await locations.count()).toBeLessThanOrEqual(5)
  expect(await locations.count()).toBeGreaterThan(0)
  const shared = chooser.getByRole('button', { name: /shared surface/ })
  await shared.focus()
  await page.screenshot({ path: `/tmp/playwood-paste-where-${width}.png` })
  await shared.press('Enter')
  await expect(chooser.getByRole('heading', { name: 'How should it attach?' })).toBeFocused()
  await expect(chooser.getByRole('button', { name: 'Attach copy', exact: true })).toBeDisabled()
  await chooser.getByRole('button', { name: /^Preview arrangement/ }).first().focus()
  expect(await saved(page, 7)).toEqual(project)
  await page.screenshot({ path: `/tmp/playwood-paste-how-${width}.png` })
  const box = await chooser.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  await chooser.getByRole('button', { name: 'Back to attachment locations' }).click()
  await expect(chooser.getByRole('heading', { name: 'Where should it attach?' })).toBeFocused()
  await shared.click()
  await chooser.getByRole('button', { name: /^Preview arrangement/ }).first().click()
  await chooser.getByRole('button', { name: 'Attach copy', exact: true }).click()
  const next = await saved(page, 10)
  expect(next.connections.filter(connection => connection.type === 't')).toHaveLength(8)
})


test('large destination selections page locations without flooding the scene', async ({ page }) => {
  const project: Project = { version: 1, name: 'Many destinations', connections: [], panels: [-1500, 0, 1500].map((x, index) => createPanel({ name: `Target ${index + 1}`, position: [x, 700, 0] })) }
  await load(page, project)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.getByRole('button', { name: 'Add a panel', exact: false }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Choose attachment point', exact: true }).click()
  const chooser = page.getByRole('region', { name: 'Attachment placement' })
  await expect(chooser.getByRole('button', { name: 'Next locations' })).toBeEnabled()
  await expect(page.locator('.assembly-attach-handle.is-location')).toHaveCount(8)
  await chooser.getByRole('button', { name: 'Next locations' }).click()
  await expect(page.locator('.assembly-attach-handle.is-location')).toHaveCount(4)
  await expect(chooser.getByRole('button', { name: 'Next locations' })).toBeDisabled()
  await chooser.locator('.paste-locations button').first().click()
  await expect(page.locator('.assembly-attach-handle.is-location')).toHaveCount(1)
  await chooser.getByRole('button', { name: 'Back to attachment locations' }).click()
  await expect(page.locator('.assembly-attach-handle.is-location')).toHaveCount(4)
  await page.keyboard.press('Escape')
  await expect(chooser).toHaveCount(0)
  expect(await saved(page, 3)).toEqual(project)
})
