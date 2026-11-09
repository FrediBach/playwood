import { expect, test, type Page } from './browser-fixture'
import { createPanel } from '../src/lib/model'
import type { VacuumPlan } from '../src/components/robot-vacuum-navigation'

interface VacuumState {
  x: number
  z: number
  heading: number
  phase: string
  elapsed: number
  plan: VacuumPlan
  dockCount: number
}

async function vacuumState(page: Page): Promise<VacuumState | null> {
  return page.locator('canvas').evaluate(async canvas => {
    // Playwright's controlled performance clock omits native resource entries.
    // Vite's entry re-exports the same shared R3F store with or without its query.
    const url = performance.getEntriesByType('resource').map(entry => entry.name).find(url => url.includes('/@react-three_fiber.js'))
      ?? '/node_modules/.vite/deps/@react-three_fiber.js'
    const { _roots } = await import(url)
    const scene = _roots.get(canvas)?.store.getState().scene
    const vacuum = scene?.getObjectByName('Dreame X50 Ultra Complete')
    if (!vacuum) return null
    let dockCount = 0
    scene.traverse((object: { name: string }) => { if (object.name === 'Dreame X50 Ultra Complete dock') dockCount++ })
    return { x: vacuum.position.x, z: vacuum.position.z, heading: vacuum.rotation.y, phase: vacuum.userData.phase,
      elapsed: vacuum.userData.elapsed, plan: vacuum.userData.plan, dockCount }
  })
}

async function exportedProject(page: Page) {
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: /Project file All panels/ }).click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  await page.getByRole('button', { name: 'Close dialog' }).click()
  return JSON.parse(Buffer.concat(chunks).toString())
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function expectClearOfFurniture(state: VacuumState) {
  // Check the actual moving robot, independently of the route's clearance helper.
  const radius = 0.175
  for (const obstacle of state.plan.obstacles.filter(item => item.id !== 'dock')) {
    const x = Math.max(obstacle.minX, Math.min(state.x, obstacle.maxX))
    const z = Math.max(obstacle.minZ, Math.min(state.z, obstacle.maxZ))
    expect(Math.hypot(state.x - x, state.z - z), obstacle.id).toBeGreaterThan(radius)
  }
  const { room } = state.plan
  expect(state.x).toBeGreaterThan(room.minX + radius)
  expect(state.x).toBeLessThan(room.maxX - radius)
  expect(state.z).toBeGreaterThan(room.minZ + radius)
  expect(state.z).toBeLessThan(room.maxZ - radius)
}

test('vacuum preserves its wait and cleaning progress across furnishing toggles, pauses in hidden tabs, and stays outside project data', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/')
  const original = await exportedProject(page)
  expect(await vacuumState(page)).toBeNull()
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'))

  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.clock.runFor(100)
  await expect.poll(() => vacuumState(page)).not.toBeNull()
  const docked = (await vacuumState(page))!
  expect(docked.phase).toBe('docked')
  expect(docked.dockCount).toBe(1)
  expect(distance(docked, docked.plan.start)).toBeLessThan(0.001)
  await page.clock.fastForward(8900)
  const waiting = (await vacuumState(page))!
  expect(waiting.phase).toBe('docked')
  expect(distance(waiting, docked)).toBeLessThan(0.001)
  // At nine seconds, neither furnishing toggle may restart the departure delay.
  const furnish = page.getByRole('checkbox', { name: 'Auto furnish', exact: true })
  await furnish.check()
  await expect(furnish).toBeChecked()
  expect((await vacuumState(page))?.phase).toBe('docked')
  await furnish.uncheck()
  await expect(furnish).not.toBeChecked()
  expect(distance((await vacuumState(page))!, docked)).toBeLessThan(0.001)
  await page.screenshot({ path: '/tmp/playwood-vacuum-docked.png' })

  // Hidden time must not consume the remaining one second at the dock.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(30000)
  expect((await vacuumState(page))?.phase).toBe('docked')
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(1000)
  await expect.poll(async () => (await vacuumState(page))?.phase, { timeout: 6000 }).toBe('cleaning')
  await page.clock.resume()
  await expect.poll(async () => distance((await vacuumState(page))!, docked), { timeout: 6000 }).toBeGreaterThan(0.12)
  const moving = (await vacuumState(page))!
  expect(moving.elapsed).toBeGreaterThanOrEqual(10)
  for (let sample = 0; sample < 8; sample++) {
    await page.waitForTimeout(250)
    expectClearOfFurniture((await vacuumState(page))!)
  }
  const later = (await vacuumState(page))!
  expect(distance(later, moving)).toBeGreaterThan(0.03)
  expect(distance(later, moving)).toBeLessThan(0.6)

  for (const enabled of [true, false]) {
    const beforeToggle = (await vacuumState(page))!
    await furnish.setChecked(enabled)
    const afterToggle = (await vacuumState(page))!
    expect(afterToggle.phase).toBe('cleaning')
    expect(afterToggle.elapsed).toBeGreaterThanOrEqual(beforeToggle.elapsed)
    expect(distance(afterToggle, beforeToggle)).toBeLessThan(0.15)
    expect(distance(afterToggle, docked)).toBeGreaterThan(0.2)
    expectClearOfFurniture(afterToggle)
    await expect.poll(async () => distance((await vacuumState(page))!, afterToggle), { timeout: 5000 }).toBeGreaterThan(0.02)
  }
  await page.screenshot({ path: '/tmp/playwood-vacuum-cleaning.png' })

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const paused = (await vacuumState(page))!
  await page.waitForTimeout(1500)
  expect(distance((await vacuumState(page))!, paused)).toBeLessThan(0.001)
  await page.evaluate(() => {
    delete (document as unknown as { hidden?: boolean }).hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(async () => distance((await vacuumState(page))!, paused), { timeout: 5000 }).toBeGreaterThan(0.02)
  expect(await exportedProject(page)).toEqual(original)

  await page.getByRole('button', { name: 'Studio', exact: true }).click()
  await expect.poll(() => vacuumState(page)).toBeNull()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect.poll(async () => (await vacuumState(page))?.phase).toBe('docked')
  const restarted = (await vacuumState(page))!
  expect(distance(restarted, restarted.plan.start)).toBeLessThan(0.001)
  expect(restarted.elapsed).toBeLessThan(1)
  expect(errors).toEqual([])
})

test('room edits rebuild vacuum clearance from visible resolved geometry', async ({ page }) => {
  await page.goto('/')
  const leg = createPanel({ id: 'vacuum-leg', name: 'Grounded side', width: 700, height: 800, position: [400, 400, 0], rotation: [0, Math.PI / 4, 0] })
  const top = createPanel({ id: 'vacuum-top', name: 'Raised top', width: 1200, height: 700, position: [0, 809, 0], rotation: [-Math.PI / 2, 0, 0] })
  const hidden = createPanel({ id: 'vacuum-hidden', name: 'Hidden side', width: 700, height: 800, position: [-400, 400, 0], visible: false })
  await page.getByRole('button', { name: 'Export project', exact: true }).click()
  await page.getByLabel('Import project file').setInputFiles({
    name: 'vacuum-clearance.playwood.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Vacuum clearance', panels: [leg, top, hidden], connections: [] })),
  })
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await expect.poll(() => vacuumState(page)).not.toBeNull()
  const initial = (await vacuumState(page))!
  const side = initial.plan.obstacles.find(item => item.id === 'panel:vacuum-leg')!
  expect(side).toBeDefined()
  const halfExtent = (700 + leg.thickness) * Math.SQRT1_2 / 2000
  expect(side.minX).toBeCloseTo(0.4 - halfExtent)
  expect(side.maxZ).toBeCloseTo(halfExtent)
  expect(initial.plan.obstacles.some(item => item.id === 'panel:vacuum-top')).toBe(false)
  expect(initial.plan.obstacles.some(item => item.id === 'panel:vacuum-hidden')).toBe(false)

  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await page.getByLabel('Left / right · X').fill('300')
  await page.getByRole('dialog').getByRole('button', { name: 'Move creation', exact: true }).click()
  await expect.poll(async () => (await vacuumState(page))?.plan.obstacles.find(item => item.id === 'panel:vacuum-leg')?.minX).toBeCloseTo(side.minX + 0.3)
  const moved = (await vacuumState(page))!
  expect(moved.phase).toBe('docked')
  expect(distance(moved, moved.plan.start)).toBeLessThan(0.001)
  expectClearOfFurniture(moved)
  await page.getByRole('button', { name: 'Undo (⌘/Ctrl Z)', exact: true }).click()
  await expect.poll(async () => (await vacuumState(page))?.plan.obstacles.find(item => item.id === 'panel:vacuum-leg')?.minX).toBeCloseTo(side.minX)
})

test('arrow keys drive and turn the vacuum, then resume cleaning after ten idle seconds without moving panels', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/')
  const original = await exportedProject(page)
  await expect(page.getByLabel('Panel name')).toBeVisible()
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'))
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.clock.runFor(100)
  const docked = (await vacuumState(page))!
  expect(docked.phase).toBe('docked')
  await page.locator('canvas').focus()

  // Manual control can leave the dock before the automatic departure delay.
  await page.keyboard.down('ArrowUp')
  await page.clock.runFor(2000)
  const forward = (await vacuumState(page))!
  expect(forward.phase).toBe('manual')
  expect(forward.z - docked.z).toBeGreaterThan(0.03)
  expectClearOfFurniture(forward)
  // Holding or repeating a key cannot allow the idle timer to resume cleaning.
  await page.keyboard.down('ArrowUp')
  await page.clock.fastForward(11000)
  expect((await vacuumState(page))?.phase).toBe('manual')
  await page.keyboard.up('ArrowUp')

  const beforeTurn = (await vacuumState(page))!
  await page.keyboard.down('ArrowLeft')
  await page.clock.runFor(400)
  await page.keyboard.up('ArrowLeft')
  const turned = (await vacuumState(page))!
  expect(Math.abs(turned.heading - beforeTurn.heading)).toBeGreaterThan(0.1)
  expect(distance(turned, beforeTurn)).toBeLessThan(0.001)
  await page.keyboard.down('ArrowDown')
  await page.clock.runFor(300)
  await page.keyboard.up('ArrowDown')
  const reversed = (await vacuumState(page))!
  expect((reversed.x - turned.x) * Math.sin(turned.heading) + (reversed.z - turned.z) * Math.cos(turned.heading)).toBeLessThan(-0.005)
  expectClearOfFurniture(reversed)

  const furnish = page.getByRole('checkbox', { name: 'Auto furnish', exact: true })
  await furnish.check()
  const furnished = (await vacuumState(page))!
  expect(furnished.phase).toBe('manual')
  expect(distance(furnished, reversed)).toBeLessThan(0.001)
  expect(furnished.heading).toBeCloseTo(reversed.heading)
  await furnish.uncheck()
  await page.clock.fastForward(9000)
  const idle = (await vacuumState(page))!
  expect(idle.phase).toBe('manual')
  expect(distance(idle, reversed)).toBeLessThan(0.001)
  await page.clock.fastForward(1000)
  const resumed = (await vacuumState(page))!
  expect(resumed.phase).toBe('cleaning')
  expect(distance(resumed, reversed)).toBeLessThan(0.02)

  // A new press near the end of the idle period starts a fresh ten seconds.
  await page.locator('canvas').focus()
  await page.keyboard.press('ArrowRight')
  await page.clock.fastForward(9000)
  await page.keyboard.press('ArrowRight')
  await page.clock.fastForward(1000)
  expect((await vacuumState(page))?.phase).toBe('manual')
  await page.clock.fastForward(9000)
  expect((await vacuumState(page))?.phase).toBe('cleaning')
  expect(await exportedProject(page)).toEqual(original)
  expect(errors).toEqual([])
})

test('vacuum driving respects fields and modifiers and releases held keys on blur', async ({ page }) => {
  test.setTimeout(60000)
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.goto('/')
  const original = await exportedProject(page)
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'))
  await page.getByRole('button', { name: 'Realistic preview', exact: true }).click()
  await page.clock.runFor(100)
  const docked = (await vacuumState(page))!
  const canvas = page.locator('canvas')
  await canvas.focus()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Alt+ArrowRight')
  expect((await vacuumState(page))?.phase).toBe('docked')
  expect(distance((await vacuumState(page))!, docked)).toBeLessThan(0.001)

  await page.getByRole('button', { name: 'Export project', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  expect((await vacuumState(page))?.phase).toBe('docked')

  await page.getByRole('button', { name: 'Move creation', exact: true }).click()
  await page.getByLabel('Left / right · X').focus()
  await page.keyboard.press('ArrowUp')
  expect((await vacuumState(page))?.phase).toBe('docked')
  // A modal also owns input when an event is dispatched directly to the canvas.
  await canvas.dispatchEvent('keydown', { key: 'ArrowUp', bubbles: true })
  await canvas.dispatchEvent('keyup', { key: 'ArrowUp', bubbles: true })
  expect((await vacuumState(page))?.phase).toBe('docked')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await canvas.focus()
  await page.keyboard.down('ArrowUp')
  await page.clock.runFor(700)
  expect((await vacuumState(page))?.phase).toBe('manual')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.keyboard.up('ArrowUp')
  const blurred = (await vacuumState(page))!
  await page.clock.fastForward(9000)
  const paused = (await vacuumState(page))!
  expect(paused.phase).toBe('manual')
  expect(distance(paused, blurred)).toBeLessThan(0.001)
  expect(paused.heading).toBeCloseTo(blurred.heading)
  await page.clock.fastForward(1000)
  expect((await vacuumState(page))?.phase).toBe('cleaning')
  expect(await exportedProject(page)).toEqual(original)
})
