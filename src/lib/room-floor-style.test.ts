import { describe, expect, it } from 'vitest'
import { furnitureArchetypes } from './fixtures/furniture-archetypes'
import { planPreviewFurnishings } from './preview-furnishings'
import { DEFAULT_ROOM_STYLE, roomFloorStyle, roomStyleFor, rugSize } from './room-floor-style'

const seeds = Array.from({ length: 60 }, (_, index) => 1 + index * 7919)

describe('room floor style', () => {
  it('keeps the default room for seed 0 in a living room', () => {
    const style = roomFloorStyle(DEFAULT_ROOM_STYLE)
    expect(style.parquet).toMatchObject({ pattern: 'plank', angle: 0 })
    expect(style.parquet.wood.id).toBe('oak')
    expect(style.rug).toMatchObject({ pattern: 'border', shape: 'rect', fringe: false })
  })

  it('is reproducible for a seed and varies across seeds', () => {
    expect(roomFloorStyle({ seed: 42, theme: 'living' })).toEqual(roomFloorStyle({ seed: 42, theme: 'living' }))
    const styles = seeds.map(seed => roomFloorStyle({ seed, theme: 'living' }))
    expect(new Set(styles.map(style => style.parquet.pattern)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(styles.map(style => style.parquet.wood.id)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(styles.map(style => style.rug.pattern)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(styles.map(style => style.rug.field)).size).toBeGreaterThanOrEqual(4)
  })

  it('chooses floors and rugs that suit the room style', () => {
    for (const seed of seeds) {
      expect(['rings', 'grid', 'stripes']).toContain(roomFloorStyle({ seed, theme: 'kids' }).rug.pattern)
      expect(['jute', 'stripes', 'kilim']).toContain(roomFloorStyle({ seed, theme: 'kitchen' }).rug.pattern)
      const office = roomFloorStyle({ seed, theme: 'office' })
      expect(office.parquet.pattern).not.toBe('basket')
      expect(['oak', 'ash', 'smoked', 'walnut']).toContain(office.parquet.wood.id)
    }
    const herringbone = seeds.map(seed => roomFloorStyle({ seed, theme: 'kitchen' }).parquet).find(parquet => parquet.pattern === 'herringbone')!
    expect(herringbone.angle).toBeCloseTo(Math.PI / 4)
  })

  it('uses the default room when Auto furnish is off', () => {
    expect(roomStyleFor({ enabled: false, seed: 99 }, 'kids')).toEqual(DEFAULT_ROOM_STYLE)
    expect(roomStyleFor({ enabled: true, seed: 99 }, 'kids')).toEqual({ seed: 99, theme: 'kids', density: 'balanced', furnished: true })
    expect(roomStyleFor({ enabled: true, seed: 0 }, undefined)).toEqual({ ...DEFAULT_ROOM_STYLE, furnished: true })
  })

  it('sizes rugs in whole decimetres around the design', () => {
    const rect = roomFloorStyle(DEFAULT_ROOM_STYLE).rug
    expect(rugSize(rect, 1.234, 0.4)).toEqual([2.6, 1.8])
    expect(rugSize(rect, 0.2, 0.2)).toEqual([2.5, 1.8])
    const round = { ...rect, shape: 'round' as const }
    const [width, depth] = rugSize(round, 1.6, 0.5)
    expect(width).toBe(depth)
    expect(width).toBeGreaterThanOrEqual(2.2)
  })

  it('derives the room style from the recognised furniture', () => {
    const counter = furnitureArchetypes().find(item => item.id === 'counter')!.panels
    const desk = furnitureArchetypes().find(item => item.id === 'desk')!.panels
    expect(planPreviewFurnishings(counter).theme).toBe('kitchen')
    expect(planPreviewFurnishings(desk).theme).toBe('office')
    expect(planPreviewFurnishings(desk, { theme: 'kids' }).theme).toBe('kids')
    expect(planPreviewFurnishings([]).theme).toBe('living')
  })
})
