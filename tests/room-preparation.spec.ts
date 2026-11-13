import { expect, test } from './browser-fixture'

test('preparing paints before room generation and stays through the first room frame', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(30000)
  await page.locator('canvas').evaluate(async canvas => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { gl, scene } = _roots.get(canvas).store.getState()
    const events: { kind: string; overlay: boolean; room?: boolean; animated?: boolean; fits?: boolean }[] = []
    Object.assign(window, { preparationEvents: events })
    const render = gl.render.bind(gl)
    gl.render = (...args: unknown[]) => {
      const room = !!scene.getObjectByName('Modern home')
      render(...args)
      if (room && !events.some(event => event.kind === 'room-frame')) {
        events.push({ kind: 'room-frame', overlay: !!document.querySelector('.room-preparing') })
      }
    }
    let previous: Element | null = null
    new MutationObserver(() => {
      const overlay = document.querySelector('.room-preparing')
      if (!overlay || previous === overlay) return
      previous = overlay
      const bounds = overlay.getBoundingClientRect()
      events.push({ kind: 'shown', overlay: true,
        animated: !overlay.closest('[aria-busy="true"]') && getComputedStyle(overlay.querySelector('svg')!).animationName !== 'none',
        fits: bounds.x >= 0 && bounds.y >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight })
      requestAnimationFrame(() => events.push({ kind: 'paint-opportunity', overlay: !!document.querySelector('.room-preparing'), room: !!scene.getObjectByName('Modern home') }))
    }).observe(document.body, { childList: true, subtree: true })
  })
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel('Room scale reference')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('Preparing realistic preview…', { exact: true })).toBeHidden()
  await expect(page.getByLabel(/^Realistic furniture preview/)).not.toHaveAttribute('aria-busy', 'true')
  const events = await page.evaluate(() => (window as unknown as { preparationEvents: unknown[] }).preparationEvents)
  expect(events).toContainEqual({ kind: 'shown', overlay: true, animated: true, fits: true })
  expect(events).toContainEqual({ kind: 'paint-opportunity', overlay: true, room: false })
  expect(events).toContainEqual({ kind: 'room-frame', overlay: true })

  // The session's Auto furnish setting also takes the preparing path on reentry.
  await page.getByRole('checkbox', { name: 'Auto furnish', exact: true }).check()
  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('dialog', { name: 'Inspector', exact: true }).getByRole('button', { name: 'Collapse inspector', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel('Room scale reference')).toBeVisible({ timeout: 30000 })
  const repeated = await page.evaluate(() => (window as unknown as { preparationEvents: unknown[] }).preparationEvents)
  expect(repeated).toContainEqual({ kind: 'shown', overlay: true, animated: false, fits: true })
  await expect(page.getByRole('checkbox', { name: 'Auto furnish', exact: true })).toBeChecked()
  await expect(page.getByText('Preparing realistic preview…', { exact: true })).toBeHidden()
  expect(errors).toEqual([])
})

test('Studio and Escape cancel preparation without reopening the room', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL().length), { timeout: 15000 }).toBeGreaterThan(30000)
  for (const cancel of ['Studio', 'Escape']) {
    await page.getByRole('button', { name: 'Realistic preview', exact: true }).evaluate((button, cancel) => {
      // Cancel after the pending UI commits, before the deferred room work begins.
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.room-preparing')) return
        observer.disconnect()
        requestAnimationFrame(() => {
          if (cancel === 'Escape') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          else (Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Studio') as HTMLButtonElement).click()
        })
      })
      observer.observe(document.body, { subtree: true, childList: true })
      ;(button as HTMLButtonElement).click()
    }, cancel)
    await expect(page.getByRole('button', { name: 'Studio', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(page.getByText('Preparing realistic preview…', { exact: true })).toBeHidden()
    await expect(page.getByLabel(/^Realistic furniture preview/)).toHaveCount(0)
  }
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect(page.getByLabel('Room scale reference')).toBeVisible({ timeout: 30000 })
})
