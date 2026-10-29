import { expect as baseExpect, test, type Page } from '@playwright/test'

const expect = baseExpect.configure({ timeout: 20000 })
test.setTimeout(90000)

// Locate an exposed CAD surface using the rendered scene, then send a real pointer click.
async function clickConnector(page: Page, exclude: string[] = [], modifiers: ('Shift' | 'ControlOrMeta')[] = []) {
  const target = await page.locator('canvas').evaluate(async (canvas, excluded) => {
    const fiberUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const { Vector2, Vector3, Raycaster } = await import(fiberUrl.replace('@react-three_fiber.js', 'three.js'))
    const state = _roots.get(canvas).store.getState()
    state.scene.updateMatrixWorld(true)
    const pieces: any[] = []
    state.scene.traverse((object: any) => { if (object.userData.connectorId && !excluded.includes(object.userData.connectorId)) pieces.push(object) })
    const rect = canvas.getBoundingClientRect()
    for (const piece of pieces) for (const mesh of piece.children) {
      const positions = mesh.geometry?.getAttribute('position')
      if (!positions) continue
      for (let i = 0; i < positions.count; i += 9) {
        const position = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(state.camera)
        if (Math.abs(position.x) > .9 || Math.abs(position.y) > .9) continue
        const ray = new Raycaster()
        ray.setFromCamera(new Vector2(position.x, position.y), state.camera)
        const hit = ray.intersectObjects(state.scene.children, true).find((hit: any) => hit.object.isMesh)
        let owner = hit?.object
        while (owner && !owner.userData.connectorId) owner = owner.parent
        if (owner?.userData.connectorId !== piece.userData.connectorId) continue
        return { id: piece.userData.connectorId, x: (position.x + 1) * rect.width / 2, y: (1 - position.y) * rect.height / 2 }
      }
    }
    throw new Error('No exposed connector found')
  }, exclude)
  await page.locator('canvas').click({ position: { x: target.x, y: target.y }, modifiers })
  return target.id as string
}

async function renderedSelection(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const result: { id: string; type: string; selected: boolean; color: string }[] = []
    _roots.get(canvas)?.store.getState().scene.traverse((object: any) => {
      if (object.userData.connectorId) result.push({ id: object.userData.connectorId, type: object.userData.connectorType, selected: object.userData.selected, color: object.children[0].material.color.getHexString() })
    })
    return result
  })
}

test('preview selects individual connectors and supports bulk edits, removal, undo and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(12)
  const first = await clickConnector(page)
  await expect(page.getByText('SELECTED CONNECTOR', { exact: true })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Connector color', exact: true }).getByRole('button')).toHaveCount(6)
  await expect(page.locator('.connector-color-input')).toHaveCount(0)
  await expect.poll(async () => (await renderedSelection(page)).filter(c => c.selected).map(c => c.id)).toEqual([first])
  await page.getByRole('button', { name: 'Black connector color', exact: true }).click()
  await expect.poll(async () => (await renderedSelection(page)).filter(c => c.color === '000000').map(c => c.id)).toEqual([first])
  const second = await clickConnector(page, [first], ['Shift'])
  await expect(page.getByText('2 SELECTED CONNECTORS', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Blue connector color', exact: true }).click()
  await page.getByLabel('Connector type', { exact: true }).selectOption('105')
  await expect.poll(async () => (await renderedSelection(page)).filter(c => c.type === '105' && c.color === '0000ff').length).toBe(2)
  await page.getByRole('button', { name: 'Remove connectors', exact: true }).click()
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(10)
  await expect(page.locator('.panel-list-row')).toHaveCount(7)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(12)
  await expect.poll(async () => (await renderedSelection(page)).filter(c => [first, second].includes(c.id)).every(c => c.type === '105' && c.color === '0000ff')).toBe(true)
  await page.getByRole('button', { name: 'Redo (⌘/Ctrl Shift Z)', exact: true }).click()
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(10)
  await expect.poll(() => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('playwood-studio-project-v1')!).connectorOverrides ?? {}).filter((value: any) => value.removed).length)).toBe(2)
  await page.reload()
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(10)
  await clickConnector(page)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await renderedSelection(page)).filter(c => c.selected).length).toBe(0)
  await clickConnector(page)
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await renderedSelection(page)).length).toBe(9)
  expect(errors).toEqual([])
})
