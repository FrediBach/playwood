import { test, expect, type Page } from './browser-fixture'
import { createPanel } from '../src/lib/model'
import { openInspectorSection } from './inspector-helpers'

async function renderedMaterials(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))
    if (!url) return []
    const { _roots } = await import(url)
    const result: { id: string; type: string; material: string; metalness: number; textured: boolean; reflected: boolean; ghost: boolean }[] = []
    _roots.get(canvas)?.store.getState().scene.traverse((object: any) => {
      if (!object.userData.connectorType) return
      const mesh = object.children[0], material = mesh.material
      result.push({ id: object.userData.connectorId, type: object.userData.connectorType, material: object.userData.connectorMaterial,
        metalness: material.metalness, textured: !!material.map && !!material.bumpMap && !!material.roughnessMap && !!mesh.geometry.getAttribute('uv'),
        reflected: !!material.envMap, ghost: material.transparent })
    })
    return result
  })
}

test('metal hardware renders, persists, filters and returns to plastic when its type changes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await expect.poll(async () => (await renderedMaterials(page)).length).toBe(12)
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.locator('.connector-list-select').first().click()
  await page.getByRole('button', { name: 'Blue connector color', exact: true }).click()
  await page.getByRole('button', { name: 'Metal connector material', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Connector color', exact: true })).toHaveCount(0)
  const metals = async () => (await renderedMaterials(page)).filter(piece => piece.material === 'metal')
  await expect.poll(async () => (await metals()).length).toBe(1)
  expect((await metals())[0]).toMatchObject({ type: '90', metalness: .94, textured: true, reflected: true, ghost: false })
  await expect(page.locator('.connector-list-name').first()).toContainText('Metal')
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await metals()).length).toBe(0)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(async () => (await metals()).length).toBe(1)
  await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).connectorOverrides).filter((value: any) => value.material === 'metal').length)).toBe(1)
  await page.reload()
  await expect.poll(async () => (await metals()).length).toBe(1)
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect.poll(async () => (await metals())[0]?.reflected).toBe(true)
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.getByRole('tab', { name: 'Connectors', exact: true }).click()
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Metal connector material', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Filter connectors', exact: true }).click()
  await page.getByRole('dialog', { name: 'Filter connectors' }).getByLabel('Metal', { exact: true }).check()
  await page.getByRole('button', { name: 'Close filters', exact: true }).click()
  await expect(page.locator('.connector-list-row')).toHaveCount(1)
  await page.locator('.connector-list-select').first().click()
  await expect(page.getByRole('button', { name: 'Metal connector material', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.getByRole('button', { name: 'Plastic connector material', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Blue connector color', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Metal connector material', exact: true }).click()
  await page.screenshot({ path: 'test-results/connector-metal-inspector.png' })
  // Clear the selection and frame the actual metal body for visual material QA.
  await page.locator('canvas').press('Escape')
  await page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const state = _roots.get(canvas).store.getState()
    state.scene.updateMatrixWorld(true)
    let piece: any
    state.scene.traverse((object: any) => { if (object.userData.connectorMaterial === 'metal') piece = object })
    const target = piece.getWorldPosition(piece.position.clone())
    state.controls.target.copy(target)
    state.camera.position.copy(target).add(target.clone().set(.16, .11, .2))
    state.camera.lookAt(target)
    state.camera.updateProjectionMatrix()
    state.controls.update()
    state.invalidate()
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/connector-metal-closeup.png' })
  await page.locator('.connector-list-select').first().click()
  await page.getByRole('group', { name: 'Connector type', exact: true }).getByRole('button', { name: 'Cross connector', exact: true }).click()
  await expect.poll(async () => (await metals()).length).toBe(0)
  await expect(page.getByRole('button', { name: 'Plastic connector material', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Metal connector material', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('attachment previews and saves the metal material, with other angles limited to plastic', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'metal-corner.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 1, name: 'Metal corner', panels: [createPanel({ name: 'Side', width: 240, height: 240, position: [0, 200, 0] })], connections: [],
  })) })
  await page.getByRole('button', { name: 'Attach a panel', exact: true }).click()
  await openInspectorSection(page, 'Connector finish')
  await page.getByRole('button', { name: 'Metal connector material', exact: true }).click()
  await expect.poll(async () => (await renderedMaterials(page)).filter(piece => piece.material === 'metal' && piece.ghost && piece.reflected).length).toBe(2)
  await page.getByRole('button', { name: '105° connector', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Metal connector material', exact: true })).toBeDisabled()
  await expect.poll(async () => (await renderedMaterials(page)).every(piece => piece.material === 'plastic')).toBe(true)
  await page.getByRole('button', { name: '90° connector', exact: true }).click()
  await page.getByRole('button', { name: 'Metal connector material', exact: true }).click()
  await page.getByRole('button', { name: 'Attach panel', exact: true }).click()
  await expect.poll(async () => (await renderedMaterials(page)).filter(piece => piece.material === 'metal' && !piece.ghost).length).toBe(2)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('playwood-studio-project-v1')!)?.connections[0]?.material)).toBe('metal')
  await page.reload()
  await expect.poll(async () => (await renderedMaterials(page)).filter(piece => piece.material === 'metal').length).toBe(2)
})
