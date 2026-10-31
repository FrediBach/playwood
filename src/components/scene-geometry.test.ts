import { describe, expect, it } from 'vitest'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { makePanelGeometry } from './scene-geometry'
import type { OutlinePoint, Panel, Pattern } from '@/lib/types'

function rayHits(pattern: Pattern, x: number, y: number, back = false) {
  const geometry = makePanelGeometry(createPanel({ width: 240, height: 240, thickness: 18, holeSize: 12, holeSpacing: 48, pattern }))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  const ray = new Raycaster(new Vector3(x / 1000, y / 1000, back ? -1 : 1), new Vector3(0, 0, back ? 1 : -1))
  const hit = ray.intersectObject(mesh).length > 0
  geometry.dispose(); material.dispose()
  return hit
}

describe('rendered panel openings', () => {
  it('keeps a solid panel opaque at the hole grid position', () => {
    expect(rayHits('solid', 24, 24)).toBe(true)
  })
  it('cuts a pegboard opening through both faces', () => {
    expect(rayHits('pegboard', 24, 24)).toBe(false)
    expect(rayHits('pegboard', 24, 24, true)).toBe(false)
    expect(rayHits('pegboard', 24, 35)).toBe(true)
  })
  it('cuts elongated slots while keeping material between them', () => {
    expect(rayHits('slots', 24, 24)).toBe(false)
    expect(rayHits('slots', 24, 35)).toBe(false)
    expect(rayHits('slots', 24, 35, true)).toBe(false)
    expect(rayHits('slots', 24, 44)).toBe(true)
  })
  it('uses rounded slot ends instead of rectangular cutouts', () => {
    expect(rayHits('slots', 24, 40)).toBe(false)
    expect(rayHits('slots', 29.7, 40)).toBe(true)
  })
})

describe('custom panel geometry', () => {
  const triangle: OutlinePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]
  const notched: OutlinePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.4, y: 1 }, { x: 0, y: 1 }]
  function expectHits(panel: Panel, probes: [number, number, boolean][]) {
    const geometry = makePanelGeometry(panel)
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    for (const back of [false, true]) for (const [x, y, expected] of probes) {
      const ray = new Raycaster(new Vector3((x - panel.width / 2) / 1000, (panel.height / 2 - y) / 1000, back ? -1 : 1), new Vector3(0, 0, back ? 1 : -1))
      expect(ray.intersectObject(mesh).length > 0, `probe ${x}, ${y}, back=${back}`).toBe(expected)
    }
    expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    geometry.dispose(); material.dispose()
  }
  it('uses the custom contour on both faces and scales when dimensions change', () => {
    const panel = createPanel({ width: 200, height: 100, customOutline: triangle })
    expectHits(panel, [[40, 40, true], [150, 40, false], [190, 90, false]])
    expectHits({ ...panel, width: 400, height: 200 }, [[80, 80, true], [150, 40, true], [380, 180, false]])
    expectHits({ ...panel, customOutline: [...triangle].reverse() }, [[40, 40, true], [150, 40, false]])
  })
  it('rounds both convex corners and concave notches', () => {
    const panel = createPanel({ width: 200, height: 200, cornerRadius: 20, customOutline: notched })
    expectHits(panel, [[1, 1, false], [15, 15, true], [83, 83, true], [90, 90, false], [150, 150, false]])
    expectHits({ ...panel, cornerRadius: 0 }, [[1, 1, true], [83, 83, false]])
    expectHits({ ...panel, customOutline: [...notched].reverse() }, [[1, 1, false], [83, 83, true], [90, 90, false]])
  })
  it.each(['pegboard', 'slots'] as Pattern[])('keeps %s openings completely within concave cutouts', pattern => {
    const customOutline = notched.map(p => ({ x: p.x === 0.4 ? 100 / 240 : p.x, y: p.y === 0.4 ? 100 / 240 : p.y }))
    const panel = createPanel({ width: 240, height: 240, holeSize: 12, holeSpacing: 48, pattern, customOutline })
    // The opening at (96,96) would breach the notch, so it must be omitted.
    expectHits(panel, [[48, 48, false], [96, 96, true], [102, 102, false], [144, 144, false]])
    expectHits({ ...panel, cornerRadius: 18 }, [[1, 1, false], [48, 48, false], [144, 144, false]])
  })
})

describe('rounded panel outlines', () => {
  it.each(['solid', 'pegboard', 'slots'] as Pattern[])('cuts away corners on both faces of %s panels', pattern => {
    const geometry = makePanelGeometry(createPanel({ width: 240, height: 240, cornerRadius: 80, pattern }))
    const material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    for (const back of [false, true]) {
      const hits = (x: number, y: number) => new Raycaster(new Vector3(x / 1000, y / 1000, back ? -1 : 1), new Vector3(0, 0, back ? 1 : -1)).intersectObject(mesh).length > 0
      expect(hits(115, 115)).toBe(false)
      expect(hits(0, 115)).toBe(true)
      expect(hits(95, 95)).toBe(true)
    }
    geometry.dispose(); material.dispose()
  })
})

describe('panel texture scale', () => {
  const shapes: Partial<Panel>[] = [
    { pattern: 'solid' },
    { pattern: 'solid', cornerRadius: 80 },
    { pattern: 'solid', customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
    { pattern: 'pegboard' },
    { pattern: 'slots' },
  ]

  it.each(shapes)('keeps grain at the same physical scale on both faces of $pattern panels', shape => {
    const material = new MeshBasicMaterial({ side: DoubleSide })
    for (const [width, height] of [[240, 480], [1200, 2400], [2400, 480]]) {
      const geometry = makePanelGeometry(createPanel({ width, height, holeSize: 12, holeSpacing: 48, ...shape }))
      const mesh = new Mesh(geometry, material)
      for (const back of [false, true]) {
        const uvAt = (x: number, y: number) => new Raycaster(
          new Vector3(x, y, back ? -1 : 1), new Vector3(0, 0, back ? 1 : -1),
        ).intersectObject(mesh)[0]?.uv
        const start = uvAt(-0.06, 0.02)
        const end = uvAt(-0.03, 0.025)
        expect(start).toBeDefined()
        expect(end).toBeDefined()
        // A 30 × 5 mm move across the face always covers the same texture
        // distance, regardless of board size, aspect ratio, or tessellation.
        expect(end!.x - start!.x).toBeCloseTo(0.03, 6)
        expect(end!.y - start!.y).toBeCloseTo(0.005, 6)
      }
      geometry.dispose()
    }
    material.dispose()
  })
})
