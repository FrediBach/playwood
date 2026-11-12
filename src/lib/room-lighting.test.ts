import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOM_STYLE } from './room-floor-style'
import { mixColor, pendantLayout, roomLighting } from './room-lighting'

const seeds = Array.from({ length: 80 }, (_, index) => 1 + index * 7919)
const themes = ['living', 'office', 'kids', 'kitchen'] as const

describe('room lighting', () => {
  it('keeps clear daylight, the dome floor lamp and a globe pendant for seed 0 in a living room', () => {
    const lighting = roomLighting(DEFAULT_ROOM_STYLE)
    expect(lighting.mood).toBe('daylight')
    expect(lighting.sun).toMatchObject({ source: 'window', offset: 0 })
    expect(lighting.lamp).toMatchObject({ base: 'disc', shade: 'dome', shadeColor: '#ece4cf', intensity: 0.7 })
    expect(lighting.pendant).toMatchObject({ kind: 'globe', count: 1 })
    expect(lighting.haze.density).toBe(0)
  })

  it('is reproducible for a seed and generates varied lamps', () => {
    expect(roomLighting({ seed: 42, theme: 'kids' })).toEqual(roomLighting({ seed: 42, theme: 'kids' }))
    const living = seeds.map(seed => roomLighting({ seed, theme: 'living' }))
    expect(new Set(living.map(lighting => lighting.mood)).size).toBe(4)
    expect(new Set(living.map(lighting => lighting.lamp.shade)).size).toBe(4)
    expect(new Set(living.map(lighting => lighting.lamp.base)).size).toBe(3)
    expect(new Set(living.map(lighting => lighting.pendant.kind)).size).toBe(4)
  })

  it('suits the room type', () => {
    for (const seed of seeds) {
      const kitchen = roomLighting({ seed, theme: 'kitchen' })
      // Kitchen air is always hazy.
      expect(kitchen.haze.density).toBeGreaterThanOrEqual(0.035)
      expect(kitchen.pendant.count).toBeGreaterThanOrEqual(2)
      const office = roomLighting({ seed, theme: 'office' })
      expect(office.haze.density).toBeLessThan(0.01)
      expect(['bar', 'dome', 'cone']).toContain(office.pendant.kind)
      expect(['sunny', 'daylight', 'golden']).toContain(roomLighting({ seed, theme: 'kids' }).mood)
    }
    const living = seeds.map(seed => roomLighting({ seed, theme: 'living' }))
    // Moody evenings rely on the lamps, with a dark sky and ceiling.
    const evening = living.find(lighting => lighting.mood === 'evening')!
    expect(evening.sun.source).toBe('pendant')
    expect(evening.lamp.intensity).toBeGreaterThan(2)
    expect(evening.ceiling).toBeLessThan(0.1)
    expect(seeds.filter(seed => roomLighting({ seed, theme: 'office' }).mood === 'bright').length).toBeGreaterThan(seeds.length / 3)
    // Kids rooms bounce coloured light.
    const kidsSkies = new Set(seeds.map(seed => roomLighting({ seed, theme: 'kids' }).hemisphere.sky))
    expect(kidsSkies.size).toBeGreaterThanOrEqual(5)
  })

  it('keeps the sun aimed through the window opening', () => {
    for (const theme of themes) for (const seed of seeds) {
      const { sun } = roomLighting({ seed, theme })
      if (sun.source !== 'window') continue
      // The window spans 0.35–2.6 m high and ±1.2 m along the wall.
      expect(sun.aim).toBeGreaterThan(0.6)
      expect(sun.aim).toBeLessThan(2.45)
      expect(Math.abs(sun.offset)).toBeLessThanOrEqual(0.55)
    }
  })

  it('mixes colours', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixColor('#ff0000', '#0000ff', 0)).toBe('#ff0000')
  })
})

describe('pendant layout', () => {
  const counter = { minX: -0.9, maxX: 0.9, minZ: -0.3, maxZ: 0.3, top: 0.9 }
  const kitchen = roomLighting({ seed: seeds.find(seed => roomLighting({ seed, theme: 'kitchen' }).pendant.count === 3)!, theme: 'kitchen' })

  it('hangs kitchen pendants in a row over a counter', () => {
    const layout = pendantLayout(kitchen.pendant, 'kitchen', counter, 3.15)
    expect(layout.overCreation).toBe(true)
    expect(layout.positions).toHaveLength(3)
    expect(layout.positions.every(({ x, z }) => x > counter.minX && x < counter.maxX && z === 0)).toBe(true)
    expect(layout.bottom).toBeCloseTo(1.65)
  })

  it('hangs one pendant in front of tall furniture, above head height and below the ceiling', () => {
    const shelf = { minX: -0.6, maxX: 0.6, minZ: -0.2, maxZ: 0.2, top: 2.2 }
    const layout = pendantLayout(kitchen.pendant, 'kitchen', shelf, 3.3)
    expect(layout.overCreation).toBe(false)
    expect(layout.positions).toEqual([{ x: -1.5, z: 1.1 }])
    expect(layout.bottom).toBeGreaterThanOrEqual(2.05)
    expect(layout.bottom + layout.shadeHeight).toBeLessThanOrEqual(3.3 - 0.15)
    for (const seed of seeds) {
      const { pendant } = roomLighting({ seed, theme: 'living' })
      const living = pendantLayout(pendant, 'living', counter, 3.15)
      expect(living.positions).toHaveLength(1)
      expect(living.bottom).toBeGreaterThanOrEqual(2.05)
    }
  })
})
