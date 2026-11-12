import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOM_STYLE } from './room-floor-style'
import { lowerWallTop, roomWallStyle, SCALLOPS_PER_METRE } from './room-wall-style'

const seeds = Array.from({ length: 80 }, (_, index) => 1 + index * 7919)

describe('room wall style', () => {
  it('keeps the default plain wall and linen curtains for seed 0 in a living room', () => {
    const style = roomWallStyle(DEFAULT_ROOM_STYLE)
    expect(style).toMatchObject({ paint: '#e5e1d7', finish: 'flat', trim: '#eee9df', skirting: 0.11, lower: { kind: 'none', height: 0 } })
    expect(style.curtain).toMatchObject({ fabric: 'linen', color: '#e7dfd1', sheer: false })
    expect(lowerWallTop(style.lower)).toBe(0)
  })

  it('is reproducible for a seed and varies across seeds', () => {
    expect(roomWallStyle({ seed: 42, theme: 'office' })).toEqual(roomWallStyle({ seed: 42, theme: 'office' }))
    const styles = seeds.map(seed => roomWallStyle({ seed, theme: 'living' }))
    expect(new Set(styles.map(style => style.paint)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(styles.map(style => style.finish)).size).toBe(4)
    expect(new Set(styles.map(style => style.lower.kind)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(styles.map(style => style.curtain.fabric)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(styles.map(style => style.curtain.rod)).size).toBe(4)
    expect(styles.some(style => style.curtain.sheer)).toBe(true)
  })

  it('suits the room style', () => {
    for (const seed of seeds) {
      const kitchen = roomWallStyle({ seed, theme: 'kitchen' })
      expect(['tiles', 'beadboard', 'none']).toContain(kitchen.lower.kind)
      if (kitchen.lower.kind === 'tiles') {
        // Tiles end on a whole course.
        const rows = kitchen.lower.height / kitchen.lower.tile!.height
        expect(rows).toBeCloseTo(Math.round(rows))
      }
      const kids = roomWallStyle({ seed, theme: 'kids' })
      expect(['two-tone', 'beadboard', 'none']).toContain(kids.lower.kind)
      expect(kids.curtain.fabric).not.toBe('velvet')
      expect(roomWallStyle({ seed, theme: 'office' }).curtain.fabric).not.toBe('check')
    }
    expect(seeds.some(seed => roomWallStyle({ seed, theme: 'kids' }).lower.edge === 'scallop')).toBe(true)
  })

  it('reports the lower wall top including scallops', () => {
    const scalloped = seeds.map(seed => roomWallStyle({ seed, theme: 'kids' }).lower).find(lower => lower.edge === 'scallop')!
    expect(lowerWallTop(scalloped)).toBeCloseTo(scalloped.height + 0.5 / SCALLOPS_PER_METRE)
    for (const seed of seeds) {
      const { lower, curtain } = roomWallStyle({ seed, theme: 'living' })
      if (lower.kind !== 'none') expect(lower.height).toBeGreaterThanOrEqual(0.85)
      expect(curtain.width).toBeGreaterThanOrEqual(0.5)
      expect(curtain.folds * curtain.depth).toBeLessThan(0.5)
    }
  })
})
