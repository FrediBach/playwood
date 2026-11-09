import { expect, test } from './browser-fixture'
import { createPanel } from '../src/lib/model'

test('floor panels occlude meter marks while exposed floor marks remain visible', async ({ page }) => {
  const panel = createPanel({ width: 800, height: 800, thickness: 18, position: [0, 9, 0], rotation: [-Math.PI / 2, 0, 0] })
  await page.addInitScript(panel => {
    localStorage.setItem('playwood-studio-project-v1', JSON.stringify({ version: 1, name: 'Floor label occlusion', panels: [panel], connections: [] }))
  }, panel)
  await page.goto('/')
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length)).toBeGreaterThan(10000)
  await page.keyboard.press('Escape')
  for (const view of ['perspective', 'top']) {
    await page.getByRole('combobox', { name: 'Camera view' }).selectOption(view)
    const result = await page.locator('canvas').evaluate(async canvas => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
      const { _roots } = await import(url)
      const { scene, camera, gl } = _roots.get(canvas).store.getState()
      const label = scene.getObjectByName('ground-grid-label-0 m')
      const render = () => {
        gl.render(scene, camera)
        return (canvas as HTMLCanvasElement).toDataURL()
      }
      label.visible = true
      const covered = render()
      label.visible = false
      const withoutLabel = render()
      const panels: any[] = []
      scene.traverse((object: any) => {
        if (object.userData.panelId && object.visible) { panels.push(object); object.visible = false }
      })
      const exposedWithoutLabel = render()
      label.visible = true
      const exposed = render()
      panels.forEach(object => { object.visible = true })
      render()
      return { coveredMatches: covered === withoutLabel, exposedDiffers: exposed !== exposedWithoutLabel }
    })
    expect(result).toEqual({ coveredMatches: true, exposedDiffers: true })
  }
  await page.screenshot({ path: 'test-results/ground-grid-occlusion.png' })
})
