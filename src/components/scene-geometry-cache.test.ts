import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferAttribute, BufferGeometry, ExtrudeGeometry } from 'three'
import { createPanel } from '@/lib/model'
import type { Panel } from '@/lib/types'

beforeEach(() => vi.resetModules())
afterEach(() => vi.restoreAllMocks())

async function cache() {
  const shapes = await import('@/lib/panel-cut-geometry')
  const build = vi.spyOn(shapes, 'makePanelShape')
  const { makePanelGeometry } = await import('./scene-geometry')
  return { makePanelGeometry, build }
}

const patternedPanel = (patch: Partial<Panel> = {}) => createPanel({
  width: 240, height: 240, thickness: 18, pattern: 'pegboard', holeSize: 12, holeSpacing: 48, ...patch,
})
const insertPanel = () => createPanel({ width: 800, height: 600, trofastInserts: [
  { id: 'box', itemId: 'plastic-shallow', colorId: 'white', x: 400, y: 300, face: 1 },
] })

function expectEqualGeometry(actual: BufferGeometry, expected: BufferGeometry) {
  expect(Object.keys(actual.attributes)).toEqual(Object.keys(expected.attributes))
  for (const name of Object.keys(expected.attributes)) {
    const a = actual.getAttribute(name) as BufferAttribute, b = expected.getAttribute(name) as BufferAttribute
    expect(a.itemSize).toBe(b.itemSize)
    expect(a.normalized).toBe(b.normalized)
    expect(a.array.constructor).toBe(b.array.constructor)
    expect(a.array.buffer).not.toBe(b.array.buffer)
    expect(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength)
      .equals(Buffer.from(b.array.buffer, b.array.byteOffset, b.array.byteLength))).toBe(true)
  }
  expect(actual.groups).toEqual(expected.groups)
  expect(actual.groups).not.toBe(expected.groups)
  expect(actual.drawRange).toEqual(expected.drawRange)
  expect(actual.index).toBe(expected.index)
}

describe('cached panel geometry', () => {
  it.each([
    ['pegboard', () => patternedPanel()],
    ['slots', () => patternedPanel({ pattern: 'slots' })],
    ['custom outline', () => createPanel({ customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })],
    ['insert cutout', insertPanel],
  ] as const)('preserves exact buffers, UVs, and material groups for %s', async (_, panelFactory) => {
    const { makePanelGeometry, build } = await cache()
    const panel = panelFactory()
    const original = makePanelGeometry(panel), cached = makePanelGeometry(structuredClone(panel))
    expect(build).toHaveBeenCalledTimes(1)
    expectEqualGeometry(cached, original)
    expect(cached).not.toHaveProperty('parameters')
    original.dispose(); cached.dispose()
  })

  it('isolates transforms, group edits, user data, and disposal from later copies', async () => {
    const { makePanelGeometry, build } = await cache()
    const panel = patternedPanel()
    const original = makePanelGeometry(panel), firstCopy = makePanelGeometry(panel)
    const x = firstCopy.getAttribute('position').getX(0)
    const group = { ...firstCopy.groups[0] }
    const disposed = vi.fn()
    firstCopy.addEventListener('dispose', disposed)
    original.translate(3, 2, 1)
    original.groups[0].materialIndex = 9
    original.userData.changed = true
    original.dispose()
    expect(disposed).not.toHaveBeenCalled()
    expect(firstCopy.getAttribute('position').getX(0)).toBe(x)
    expect(firstCopy.groups[0]).toEqual(group)
    expect(firstCopy.userData).toEqual({})

    const secondCopy = makePanelGeometry(panel)
    expectEqualGeometry(secondCopy, firstCopy)
    firstCopy.translate(-4, -5, -6)
    firstCopy.groups[0].materialIndex = 7
    firstCopy.userData.changed = true
    firstCopy.dispose()
    expect(secondCopy.getAttribute('position').getX(0)).toBe(x)
    expect(secondCopy.groups[0]).toEqual(group)
    expect(secondCopy.userData).toEqual({})
    const thirdCopy = makePanelGeometry(panel)
    expectEqualGeometry(thirdCopy, secondCopy)
    expect(build).toHaveBeenCalledTimes(1)
    secondCopy.dispose(); thirdCopy.dispose()
  })

  it.each([
    { width: 240.0001 }, { height: 240.0001 }, { thickness: 18.0001 },
    { pattern: 'slots' as const }, { holeSize: 13 }, { holeSpacing: 49 }, { cornerRadius: 18 },
  ])('rebuilds after geometry input changes: %j', async patch => {
    const { makePanelGeometry, build } = await cache()
    const panel = patternedPanel()
    makePanelGeometry(panel).dispose()
    makePanelGeometry({ ...panel, ...patch }).dispose()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('reuses identical outline coordinates and ignores appearance and transform edits', async () => {
    const { makePanelGeometry, build } = await cache()
    const panel = patternedPanel({ customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })
    makePanelGeometry(panel).dispose()
    const edited: Panel = { ...structuredClone(panel), id: 'copy', name: 'Renamed', material: 'oak', color: '#123456',
      finishCoverage: 0.5, position: [100, 200, 300], rotation: [0, 1, 0], visible: false, cornerRadius: undefined }
    makePanelGeometry(edited).dispose()
    expect(build).toHaveBeenCalledTimes(1)
    makePanelGeometry({ ...panel, customOutline: [{ x: 0, y: 0 }, { x: 0.9, y: 0 }, { x: 0, y: 1 }] }).dispose()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('ignores insert identity, color, and face while normalizing omitted quarter turns', async () => {
    const { makePanelGeometry, build } = await cache()
    const panel = insertPanel()
    makePanelGeometry(panel).dispose()
    makePanelGeometry({ ...panel, holeSize: 30, holeSpacing: 90, trofastInserts: panel.trofastInserts!.map(insert => ({
      ...insert, id: 'copy', colorId: 'red', face: -1, quarterTurn: false,
    })) }).dispose()
    expect(build).toHaveBeenCalledTimes(1)
  })

  it.each([{ itemId: 'plastic-small' }, { x: 410 }, { y: 310 }, { quarterTurn: true }])('rebuilds after insert cutout edits: %j', async patch => {
    const { makePanelGeometry, build } = await cache()
    const panel = insertPanel()
    makePanelGeometry(panel).dispose()
    makePanelGeometry({ ...panel, trofastInserts: panel.trofastInserts!.map(insert => ({ ...insert, ...patch })) }).dispose()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('keeps cheap solid rectangles outside the cache', async () => {
    const { makePanelGeometry, build } = await cache()
    const panel = createPanel()
    makePanelGeometry(panel).dispose(); makePanelGeometry(panel).dispose()
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('retains at most sixteen shapes and refreshes recency when a shape is reused', async () => {
    const { makePanelGeometry, build } = await cache()
    const panels = Array.from({ length: 17 }, (_, index) => patternedPanel({ width: 240 + index }))
    for (const panel of panels.slice(0, 16)) makePanelGeometry(panel).dispose()
    makePanelGeometry(panels[0]).dispose()
    makePanelGeometry(panels[16]).dispose()
    makePanelGeometry(panels[0]).dispose()
    expect(build).toHaveBeenCalledTimes(17)
    makePanelGeometry(panels[1]).dispose()
    expect(build).toHaveBeenCalledTimes(18)
  })
})

/** Exercise memory limits without making the test depend on costly triangulation. */
function addGeometryBytes(bytes: number) {
  const padding = new Uint8Array(bytes)
  const translate = BufferGeometry.prototype.translate
  vi.spyOn(ExtrudeGeometry.prototype, 'translate').mockImplementation(function (this: ExtrudeGeometry, x, y, z) {
    translate.call(this, x, y, z)
    this.setAttribute('budget-test', new BufferAttribute(padding, 1))
    return this
  })
}

it('evicts by the attribute byte budget before the entry limit', async () => {
  const { makePanelGeometry, build } = await cache()
  addGeometryBytes(12 * 1024 * 1024)
  const panels = [240, 241, 242].map(width => patternedPanel({ width }))
  makePanelGeometry(panels[0]).dispose(); makePanelGeometry(panels[1]).dispose()
  makePanelGeometry(panels[0]).dispose()
  makePanelGeometry(panels[2]).dispose()
  makePanelGeometry(panels[0]).dispose()
  expect(build).toHaveBeenCalledTimes(3)
  makePanelGeometry(panels[1]).dispose()
  expect(build).toHaveBeenCalledTimes(4)
})

it('does not retain a single geometry larger than the byte budget', async () => {
  const { makePanelGeometry, build } = await cache()
  addGeometryBytes(32 * 1024 * 1024)
  const panel = patternedPanel()
  makePanelGeometry(panel).dispose(); makePanelGeometry(panel).dispose()
  expect(build).toHaveBeenCalledTimes(2)
})
