import { expect, test } from './browser-fixture'
import { createPanel } from '../src/lib/model'

const key = 'playwood-studio-project-v1'
test('list visibility cycles through noninteractive wireframe, saves, and undoes', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'visibility.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Visibility', panels: [createPanel({ id: 'board', name: 'Test board', position: [0, 400, 0] })], connections: [] })) })
  const scene = () => page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const state = _roots.get(canvas).store.getState()
    let solid = 0, wire = 0, hits = 0
    state.scene.traverse((object: any) => {
      if (object.userData.panelId === 'board') solid++
      if (object.name === 'Wireframe board') {
        wire++
        const intersections: any[] = []
        object.raycast(state.raycaster, intersections)
        hits += intersections.length
      }
    })
    return { solid, wire, hits }
  })
  await expect.poll(scene).toEqual({ solid: 1, wire: 0, hits: 0 })
  await page.getByRole('button', { name: 'Show wireframe of Test board', exact: true }).click()
  await expect.poll(scene).toEqual({ solid: 0, wire: 1, hits: 0 })
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).panels[0], key)).toMatchObject({ visible: false, wireframe: true })
  await page.reload()
  await expect.poll(scene).toEqual({ solid: 0, wire: 1, hits: 0 })
  await page.getByRole('button', { name: 'Hide Test board', exact: true }).click()
  await expect.poll(scene).toEqual({ solid: 0, wire: 0, hits: 0 })
  await page.getByRole('button', { name: /Undo/ }).click()
  await expect.poll(scene).toEqual({ solid: 0, wire: 1, hits: 0 })
  await page.getByRole('button', { name: 'Hide Test board', exact: true }).click()
  await page.getByRole('button', { name: 'Show Test board', exact: true }).click()
  await expect.poll(scene).toEqual({ solid: 1, wire: 0, hits: 0 })
})

test('object wireframes retain edges without a pickable surface', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import project file').setInputFiles({ name: 'objects.playwood.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Objects', panels: [], connections: [], constructionObjects: { roots: ['box'], nodes: [{ id: 'box', name: 'Box', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] }] } })) })
  await page.getByRole('tab', { name: 'Objects', exact: true }).click()
  const surface = () => page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const object = _roots.get(canvas).store.getState().scene.getObjectByName('Object box')
    return object ? { visible: object.material.visible, pickable: !!object.userData.objectId, edges: object.children.length } : null
  })
  await expect.poll(surface).toMatchObject({ visible: true, pickable: true })
  await page.getByRole('button', { name: 'Show wireframe of object Box', exact: true }).click()
  await expect.poll(surface).toMatchObject({ visible: false, pickable: false, edges: 1 })
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).constructionObjects.nodes[0], key)).toMatchObject({ visible: false, wireframe: true })
  await page.getByRole('button', { name: 'Hide object Box', exact: true }).click()
  await expect.poll(surface).toBeNull()
  await page.getByRole('button', { name: 'Show object Box', exact: true }).click()
  await expect.poll(surface).toMatchObject({ visible: true, pickable: true })
})
