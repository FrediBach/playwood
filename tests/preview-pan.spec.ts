import { test, expect, type Page } from '@playwright/test'

async function cameraState(page: Page) {
  return page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { camera, controls } = _roots.get(canvas).store.getState()
    return { target: controls.target.toArray() as number[], direction: camera.position.clone().sub(controls.target).normalize().toArray() as number[], zoom: camera.zoom }
  })
}

for (const mode of ['Studio', 'Realistic preview', 'Front']) {
  test(`pan a zoomed ${mode} view without rotating or editing the assembly`, async ({ page }) => {
    await page.goto('/')
    if (mode === 'Realistic preview') await page.getByRole('button', { name: mode, exact: true }).click()
    if (mode === 'Front') await page.getByRole('combobox', { name: 'Camera view' }).selectOption('front')
    await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(10000)
    const project = await page.evaluate(() => localStorage.getItem('playwood-studio-project-v1'))
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    const pan = page.getByRole('button', { name: 'Pan view', exact: true })
    await pan.click()
    await expect(pan).toHaveAttribute('aria-pressed', 'true')
    const before = await cameraState(page)
    const box = (await page.locator('canvas').boundingBox())!
    const drag = async (button: 'left' | 'right') => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down({ button })
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 12 })
      await page.mouse.up({ button })
    }
    await drag('left')
    await expect.poll(async () => (await cameraState(page)).target).not.toEqual(before.target)
    const after = await cameraState(page)
    after.direction.forEach((value, i) => expect(value).toBeCloseTo(before.direction[i], 5))
    expect(after.zoom).toBe(before.zoom)
    await pan.click()
    await expect(pan).toHaveAttribute('aria-pressed', 'false')
    await drag('right')
    await expect.poll(async () => (await cameraState(page)).target).not.toEqual(after.target)
    await page.getByRole('button', { name: mode === 'Realistic preview' ? 'Reset room view (F)' : 'Fit assembly (F)', exact: true }).click()
    await expect.poll(async () => (await cameraState(page)).target.map(value => Math.round(value * 1000))).toEqual(before.target.map(value => Math.round(value * 1000)))
    expect(await page.evaluate(() => localStorage.getItem('playwood-studio-project-v1'))).toBe(project)
  })
}
