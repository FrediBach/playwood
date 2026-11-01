import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPanel, createStarterProject, resolvePanels } from './model'
import { createPreviewBooks, getPreviewBookBounds, type PreviewBookSupport } from './preview-books'
import { detectPreviewFurnishings, MAX_PREVIEW_FURNISHINGS, type FurnishingPlacement } from './preview-furnishings'
import type { Panel, Vec3 } from './types'

const UP = new Vector3(0, 1, 0)
const WIDTH = 380, DEPTH = 420, HEIGHT = 300, PITCH_X = WIDTH + 35, PITCH_Y = HEIGHT + 35

/** Stable IDs make the variation observable without depending on generated UUIDs. */
function shelvingGrid() {
  const panels: Panel[] = []
  for (let row = 0; row <= 6; row++) for (let column = 0; column < 5; column++) {
    panels.push(createPanel({ id: `grid-shelf-${column}-${row}`, name: 'Board', width: WIDTH, height: DEPTH,
      position: [(column - 2) * PITCH_X, 9 + row * PITCH_Y, 0], rotation: [-Math.PI / 2, 0, 0] }))
  }
  for (let row = 0; row < 6; row++) for (let column = 0; column <= 5; column++) {
    panels.push(createPanel({ id: `grid-upright-${column}-${row}`, name: 'Board', width: DEPTH, height: HEIGHT,
      position: [(column - 2.5) * PITCH_X, 9 + (row + 0.5) * PITCH_Y, 0], rotation: [0, Math.PI / 2, 0] }))
  }
  return panels
}

/** The wall's inside face can sit on, within, or just beyond the shelf edge. */
function supportedCompartment(id: string, wallGap = 0) {
  const wallCenter = WIDTH / 2 + wallGap + 9
  return [
    createPanel({ id, name: 'Board', width: WIDTH, height: DEPTH, position: [0, 9, 0], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: `${id}:roof`, name: 'Board', width: WIDTH, height: DEPTH, position: [0, 369, 0], rotation: [-Math.PI / 2, 0, 0] }),
    ...[-1, 1].map(sign => createPanel({ id: `${id}:wall:${sign}`, name: 'Board', width: DEPTH, height: 342,
      position: [sign * wallCenter, 189, 0], rotation: [0, Math.PI / 2, 0] })),
  ]
}

function standing(placement: FurnishingPlacement) {
  return placement.kind === 'books' && placement.bookArrangement !== 'stacked'
}

function occupiedRow(wallGap = 0, support?: PreviewBookSupport) {
  for (let seed = 0; seed < 160; seed++) {
    const id = `supported-row-${seed}`
    const panels = supportedCompartment(id, wallGap)
    const placement = detectPreviewFurnishings(panels).find(item => item.panelId === id && standing(item)
      && (!support || item.bookSupport === support))
    if (placement) return { panels, placement }
  }
  throw new Error(`No supported book row found for gap ${wallGap} and side ${support ?? 'either'}`)
}

function rowGeometry(placement: FurnishingPlacement) {
  const books = createPreviewBooks(placement.bookSeed ?? placement.id, placement.bookArrangement, placement.bookSupport)
  return { books, bounds: getPreviewBookBounds(books) }
}

function turnAndMove(panels: Panel[], yaw: number, shift: Vec3) {
  const quaternion = new Quaternion().setFromAxisAngle(UP, yaw)
  return panels.map(panel => {
    const rotation = new Euler().setFromQuaternion(quaternion.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
    return { ...panel, position: new Vector3(...panel.position).applyQuaternion(quaternion).add(new Vector3(...shift)).toArray() as Vec3,
      rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
  })
}

describe('shelf styling in realistic preview', () => {
  it('mixes books, decorative objects and empty compartments deterministically in a five by six bookcase', () => {
    const panels = shelvingGrid(), saved = structuredClone(panels)
    const placements = detectPreviewFurnishings(panels)
    // Inspect the first four rows, before the rendering budget can create emptiness.
    const lowerIds = panels.filter(panel => /^grid-shelf-\d-[0-3]$/.test(panel.id)).map(panel => panel.id)
    const lower = placements.filter(item => lowerIds.includes(item.panelId))
    const usedIds = new Set(lower.map(item => item.panelId))
    expect(lower.some(item => item.kind === 'books')).toBe(true)
    expect(lower.some(item => item.kind === 'vase')).toBe(true)
    expect(lower.some(item => item.kind === 'plant')).toBe(true)
    expect(usedIds.size).toBeLessThan(lowerIds.length)
    expect(usedIds.size).toBeGreaterThan(0)
    expect(placements.length).toBeLessThanOrEqual(MAX_PREVIEW_FURNISHINGS)
    expect(detectPreviewFurnishings([...panels].reverse())).toEqual(placements)
    expect(detectPreviewFurnishings(structuredClone(panels))).toEqual(placements)
    expect(panels).toEqual(saved)
  })

  it('keeps books off exposed cabinet tops and uses only flat stacks on wallless boards', () => {
    const panels = shelvingGrid()
    const topIds = panels.filter(panel => /^grid-shelf-\d-6$/.test(panel.id)).map(panel => panel.id)
    expect(detectPreviewFurnishings(panels).filter(item => topIds.includes(item.panelId) && item.kind === 'books')).toEqual([])
    let flatStacks = 0
    for (let seed = 0; seed < 24; seed++) {
      const board = createPanel({ id: `unbounded-${seed}`, width: 700, height: 380, position: [0, 1400, 0], rotation: [-Math.PI / 2, 0, 0] })
      for (const item of detectPreviewFurnishings([board])) if (item.kind === 'books') {
        expect(item.bookArrangement).toBe('stacked')
        expect(item.bookSupport).toBeUndefined()
        flatStacks++
      }
    }
    expect(flatStacks).toBeGreaterThan(0)
  })

  it.each(['left', 'right'] as const)('anchors the upright end of a book row to its %s wall without overhanging', support => {
    const { placement } = occupiedRow(-10, support)
    const { books, bounds } = rowGeometry(placement)
    const end = books.at(-1)!
    expect(end.rotation[2]).toBeCloseTo(0, 10)
    expect(placement.bookSupport).toBe(support)
    const wallFace = (WIDTH / 2 - 10) / 1000 * (support === 'left' ? -1 : 1)
    const endX = placement.position[0] + (support === 'left' ? bounds.min[0] : bounds.max[0])
    expect(Math.abs(endX - wallFace)).toBeLessThanOrEqual(0.0031)
    expect(placement.position[0] + bounds.min[0]).toBeGreaterThanOrEqual(-WIDTH / 2000)
    expect(placement.position[0] + bounds.max[0]).toBeLessThanOrEqual(WIDTH / 2000)
    expect(placement.position[2] + bounds.min[2]).toBeGreaterThanOrEqual(-DEPTH / 2000)
    expect(placement.position[2] + bounds.max[2]).toBeLessThanOrEqual(DEPTH / 2000)
    expect(Math.cos(placement.rotation)).toBeCloseTo(1, 8)
  })

  it('reserves the shelf edge when connector clearance puts the side wall beyond it', () => {
    const { placement } = occupiedRow(26)
    const { bounds } = rowGeometry(placement)
    const left = placement.position[0] + bounds.min[0], right = placement.position[0] + bounds.max[0]
    expect(left).toBeGreaterThanOrEqual(-WIDTH / 2000)
    expect(right).toBeLessThanOrEqual(WIDTH / 2000)
    const supportedEdge = placement.bookSupport === 'left' ? left : right
    expect(Math.abs(supportedEdge)).toBeCloseTo(WIDTH / 2000 - 0.002, 6)
  })

  it('falls back from standing rows when side walls are too distant or hidden', () => {
    const { panels, placement } = occupiedRow()
    const id = placement.panelId
    const hidden = panels.map(panel => panel.id.includes(':wall:') ? { ...panel, visible: false } : panel)
    expect(detectPreviewFurnishings(hidden).filter(item => item.panelId === id && standing(item))).toEqual([])
    for (let seed = 0; seed < 24; seed++) {
      const far = supportedCompartment(`far-walls-${seed}`, 45)
      expect(detectPreviewFurnishings(far).filter(standing)).toEqual([])
    }
  })

  it('keeps the selected side and shelf contact through yaw and translation', () => {
    const { panels, placement } = occupiedRow(-10)
    const yaw = 0.63, shift: Vec3 = [1200, 0, 1800]
    const moved = detectPreviewFurnishings(turnAndMove(panels, yaw, shift)).find(item => item.panelId === placement.panelId && standing(item))
    expect(moved).toBeDefined()
    expect(moved!.bookSupport).toBe(placement.bookSupport)
    expect(moved!.bookSeed).toBe(placement.bookSeed)
    expect(moved!.bookArrangement).toBe(placement.bookArrangement)
    const expected = new Vector3(...placement.position).applyAxisAngle(UP, yaw).add(new Vector3(...shift).multiplyScalar(0.001))
    moved!.position.forEach((value, axis) => expect(value).toBeCloseTo(expected.getComponent(axis), 8))
    const expectedFacing = new Vector3(0, 0, 1).applyAxisAngle(UP, yaw)
    expect(new Vector3(0, 0, 1).applyAxisAngle(UP, moved!.rotation).dot(expectedFacing)).toBeCloseTo(1, 8)
  })

  it('preserves the established computer, lamp and seated person on the starter desk', () => {
    const placements = detectPreviewFurnishings(resolvePanels(createStarterProject('desk')))
    expect(placements.map(item => item.kind)).toEqual(['computer', 'table-lamp', 'seated-person-chair'])
  })
})
