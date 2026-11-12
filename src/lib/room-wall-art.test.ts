import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { getRoomLayout } from '../components/room-layout'
import type { FurnishingPlacement } from './preview-furnishings'
import type { FurnishingDensity, ResolvedTheme } from './preview-furnishing-variation'
import { ART_FAMILY, CEILING_CLEARANCE, DADO_CLEARANCE, FURNITURE_CLEARANCE, GROUP_GAP, planWallArt, wallObstacles, type WallArtPlan, type WallObstacle } from './room-wall-art'

function room(width: number, height: number, options: { seed?: number; theme?: ResolvedTheme; density?: FurnishingDensity; furnishings?: FurnishingPlacement[]; offsetX?: number; dado?: number } = {}) {
  const offset = options.offsetX ?? 0
  const bounds = new Box3(new Vector3(-width / 2 + offset, 0, -0.2), new Vector3(width / 2 + offset, height, 0.2))
  const layout = getRoomLayout(bounds)
  const obstacles = wallObstacles({ bounds, floorY: layout.floorY, chairX: layout.chairX, plantX: layout.plantX, furnishings: options.furnishings })
  const plan = planWallArt({
    seed: options.seed ?? 0, theme: options.theme ?? 'living', density: options.density ?? 'balanced',
    wall: { left: layout.leftX, right: layout.rightX, height: layout.height, dado: options.dado },
    creation: { minX: bounds.min.x, maxX: bounds.max.x }, chairX: layout.chairX, plantX: layout.plantX, obstacles,
  })
  return { plan, layout, obstacles }
}

const pieces = (plan: WallArtPlan) => plan.groups.flatMap(group => group.pieces)
const edges = (piece: ReturnType<typeof pieces>[number]) => ({ minX: piece.x - piece.width / 2, maxX: piece.x + piece.width / 2, minY: piece.y - piece.height / 2, maxY: piece.y + piece.height / 2 })

function expectClear(plan: WallArtPlan, obstacles: readonly WallObstacle[], layout: ReturnType<typeof getRoomLayout>) {
  for (const piece of pieces(plan)) {
    const rect = edges(piece)
    expect(rect.minX).toBeGreaterThanOrEqual(layout.leftX)
    expect(rect.maxX).toBeLessThanOrEqual(layout.rightX)
    expect(rect.maxY).toBeLessThanOrEqual(layout.height - CEILING_CLEARANCE + 1e-6)
    for (const item of obstacles) if (item.maxX > rect.minX && item.minX < rect.maxX) expect(rect.minY).toBeGreaterThanOrEqual(item.top + FURNITURE_CLEARANCE - 1e-6)
  }
  const all = pieces(plan).map(edges)
  all.forEach((a, i) => all.slice(i + 1).forEach(b => expect(a.minX < b.maxX - 1e-6 && a.maxX > b.minX + 1e-6 && a.minY < b.maxY - 1e-6 && a.maxY > b.minY + 1e-6).toBe(false)))
  const groups = plan.groups.map(group => group.pieces.map(edges)).map(rects => ({ minX: Math.min(...rects.map(r => r.minX)), maxX: Math.max(...rects.map(r => r.maxX)) }))
  groups.forEach((a, i) => groups.slice(i + 1).forEach(b => expect(a.maxX + GROUP_GAP <= b.minX + 1e-6 || b.maxX + GROUP_GAP <= a.minX + 1e-6).toBe(true)))
}

const seeds = Array.from({ length: 40 }, (_, index) => 1 + index * 7919)

describe('room wall art', () => {
  it('keeps the original print above low furniture in the default room', () => {
    const { plan, obstacles, layout } = room(2, 0.8)
    expect(plan.groups.map(group => group.zone)).toEqual(['creation', 'chair'])
    const [hero] = plan.groups[0].pieces
    expect(hero).toMatchObject({ width: 0.85, height: 1.05, art: { style: 'arches', seed: 0, mat: 0 }, frame: { kind: 'classic' } })
    expect(hero.x).toBeCloseTo(0)
    expect(hero.y - hero.height / 2).toBeGreaterThanOrEqual(0.8 - layout.floorY + FURNITURE_CLEARANCE)
    expectClear(plan, obstacles, layout)
  })

  it.each([1.9, 2.4, 4])('moves the art beside %s m furniture instead of up to the ceiling', height => {
    const { plan, obstacles, layout } = room(3, height)
    expect(plan.groups.length).toBeGreaterThan(0)
    expect(plan.groups.some(group => group.zone === 'creation')).toBe(false)
    expectClear(plan, obstacles, layout)
  })

  it('clears furnishings standing on the creation', () => {
    const lamp: FurnishingPlacement = { id: 'lamp', panelId: 'top', kind: 'table-lamp', position: [0, 0.8, 0], rotation: 0 }
    const plain = room(2, 0.8).plan.groups[0].pieces[0]
    const { plan, obstacles, layout } = room(2, 0.8, { furnishings: [lamp] })
    const hero = plan.groups[0].pieces[0]
    expect(hero.y - hero.height / 2).toBeGreaterThanOrEqual(0.8 + 0.42 - layout.floorY + FURNITURE_CLEARANCE - 1e-6)
    expect(hero.y).toBeGreaterThan(plain.y)
    expectClear(plan, obstacles, layout)
  })

  it('hangs above a dado rail or painted lower wall', () => {
    for (const seed of seeds.slice(0, 15)) {
      const { plan, obstacles, layout } = room(1.6, 0.45, { seed, density: 'lived-in', dado: 1.2 })
      expect(plan.groups.length).toBeGreaterThan(0)
      for (const piece of pieces(plan)) expect(piece.y - piece.height / 2).toBeGreaterThanOrEqual(1.2 + DADO_CLEARANCE - 1e-6)
      expectClear(plan, obstacles, layout)
    }
  })

  it('hangs clear of furniture for every seed, style, density and size', () => {
    for (const theme of ['living', 'office', 'kids', 'kitchen'] as const) for (const density of ['minimal', 'balanced', 'lived-in'] as const) {
      for (const [index, seed] of seeds.slice(0, 10).entries()) {
        const { plan, obstacles, layout } = room([0.4, 1.2, 2.4, 3.6][index % 4], [0.45, 0.9, 1.5, 2.1][(index >> 1) % 4], { seed, theme, density, offsetX: index % 3 - 1 })
        expectClear(plan, obstacles, layout)
      }
    }
  })

  it('is reproducible for a seed and varies across seeds', () => {
    expect(room(2, 0.8, { seed: 42 }).plan).toEqual(room(2, 0.8, { seed: 42 }).plan)
    const plans = seeds.map(seed => room(2.4, 0.8, { seed, density: 'lived-in' }).plan)
    const styles = new Set(plans.flatMap(plan => pieces(plan).map(piece => piece.art.style)))
    expect(styles.size).toBeGreaterThanOrEqual(8)
    expect(new Set(plans.flatMap(plan => plan.groups.map(group => group.layout))).size).toBeGreaterThanOrEqual(5)
    expect(new Set(plans.flatMap(plan => pieces(plan).map(piece => piece.frame.kind))).size).toBeGreaterThanOrEqual(4)
  })

  it('hangs more art in lived-in rooms and lets series share their frame', () => {
    const count = (density: FurnishingDensity) => seeds.reduce((sum, seed) => sum + pieces(room(2, 0.8, { seed, density }).plan).length, 0)
    expect(count('minimal')).toBeLessThan(count('balanced'))
    expect(count('balanced')).toBeLessThan(count('lived-in'))
    for (const seed of seeds) for (const group of room(2.4, 0.8, { seed, density: 'lived-in' }).plan.groups) {
      if (!['pair', 'row', 'grid', 'stack'].includes(group.layout)) continue
      expect(new Set(group.pieces.map(piece => piece.frame.kind)).size).toBe(1)
      expect(new Set(group.pieces.map(piece => piece.art.style)).size).toBe(1)
    }
  })

  it('suits the room style', () => {
    for (const seed of seeds) {
      const kids = pieces(room(2, 0.8, { seed, theme: 'kids', density: 'lived-in' }).plan)
      expect(kids.every(piece => !['plotter-flow', 'plotter-grid', 'plotter-moire', 'colour-field'].includes(piece.art.style))).toBe(true)
      const office = pieces(room(2, 0.8, { seed, theme: 'office', density: 'lived-in' }).plan)
      expect(office.every(piece => !['horizon', 'bauhaus-tiles'].includes(piece.art.style))).toBe(true)
      for (const piece of office) if (ART_FAMILY[piece.art.style] === 'plotter') expect(piece.art.mat).toBeGreaterThan(0.1)
    }
  })
})
