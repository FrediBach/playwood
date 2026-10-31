import { describe, expect, it } from 'vitest'
import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three'
import { createWoodTextures, sampleWood } from './wood-texture'

const materials = ['birch', 'oak', 'walnut', 'mdf'] as const
const channels = ['shade', 'height', 'roughness'] as const

describe.each(materials)('%s texture', material => {
  it('repeats its colour and surface detail in both directions, including negative UVs', () => {
    for (const [u, v] of [[0, 0], [0.17, 0.39], [0.73, 0.91], [-0.34, -0.82]]) {
      const expected = sampleWood(material, u, v)
      for (const [du, dv] of [[1, 0], [0, 1], [-2, 3]]) {
        const actual = sampleWood(material, u + du, v + dv)
        for (const channel of channels) expect(actual[channel]).toBeCloseTo(expected[channel], 9)
      }
    }
  })

  it('joins opposite edges without a break in the grain or surface slope', () => {
    const step = 1e-7
    for (const along of [0, 0.19, 0.47, 0.81, 1]) for (const axis of ['u', 'v']) {
      const at = (across: number) => axis === 'u'
        ? sampleWood(material, across, along)
        : sampleWood(material, along, across)
      const start = at(0), end = at(1), before = at(1 - step), after = at(step)
      for (const channel of channels) {
        expect(start[channel]).toBeCloseTo(end[channel], 10)
        const enteringSlope = (end[channel] - before[channel]) / step
        const leavingSlope = (after[channel] - start[channel]) / step
        expect(Math.abs(enteringSlope - leavingSlope)).toBeLessThan(0.05)
      }
    }
  })

  it('keeps raster tile boundaries within the surrounding grain variation', () => {
    const textures = createWoodTextures(material)
    for (const [map, channel] of [[textures.color, 0], [textures.surface, 0], [textures.surface, 1]] as const) {
      const { data, width, height } = map.image
      const pixel = (x: number, y: number) => data[(y * width + x) * 4 + channel]
      let seamX = 0, seamY = 0, interiorX = 0, interiorY = 0
      for (let y = 0; y < height; y++) {
        seamX += Math.abs(pixel(0, y) - pixel(width - 1, y))
        for (let x = 1; x < width; x++) interiorX += Math.abs(pixel(x, y) - pixel(x - 1, y))
      }
      for (let x = 0; x < width; x++) {
        seamY += Math.abs(pixel(x, 0) - pixel(x, height - 1))
        for (let y = 1; y < height; y++) interiorY += Math.abs(pixel(x, y) - pixel(x, y - 1))
      }
      // Adjacent samples should have comparable contrast at wrap boundaries.
      // A little variation is natural; a sharp tile edge is not.
      expect(seamX / height).toBeLessThan(interiorX / ((width - 1) * height) * 3 + 1)
      expect(seamY / width).toBeLessThan(interiorY / ((height - 1) * width) * 3 + 1)
    }
    textures.color.dispose(); textures.surface.dispose()
  })
})

describe('wood texture rendering', () => {
  it('shares upload sources across matching panels with independently disposable textures', () => {
    const first = createWoodTextures('oak')
    const second = createWoodTextures('oak')
    const different = createWoodTextures('birch')
    for (const channel of ['color', 'surface'] as const) {
      expect(first[channel]).not.toBe(second[channel])
      expect(first[channel].source).toBe(second[channel].source)
      expect(first[channel].source).not.toBe(different[channel].source)
      let secondDisposed = false
      second[channel].addEventListener('dispose', () => { secondDisposed = true })
      first[channel].dispose()
      expect(secondDisposed).toBe(false)
      expect(second[channel].image.data.length).toBeGreaterThan(0)
      second[channel].dispose()
      different[channel].dispose()
    }
  })

  it.each(['birch', 'oak', 'walnut'] as const)('keeps %s grain visible after preview-sized filtering', material => {
    const textures = createWoodTextures(material)
    const { data, width, height } = textures.color.image
    const averages: number[] = []
    const block = 16
    for (let y = 0; y < height; y += block) for (let x = 0; x < width; x += block) {
      let sum = 0
      for (let dy = 0; dy < block; dy++) for (let dx = 0; dx < block; dx++) sum += data[((y + dy) * width + x + dx) * 4]
      averages.push(sum / (block * block))
    }
    averages.sort((a, b) => a - b)
    // Broad grain must survive minification, rather than disappearing with
    // fine noise when the whole assembly is fitted into the viewport.
    expect(averages[Math.floor(averages.length * 0.95)] - averages[Math.floor(averages.length * 0.05)]).toBeGreaterThan(18)
    textures.color.dispose(); textures.surface.dispose()
  })

  it('uses matching physical scale and filters without gamma-correcting surface data', () => {
    const textures = createWoodTextures('oak')
    expect(textures.color.colorSpace).toBe(SRGBColorSpace)
    expect(textures.surface.colorSpace).toBe(NoColorSpace)
    for (const map of [textures.color, textures.surface]) {
      expect(map.wrapS).toBe(RepeatWrapping)
      expect(map.wrapT).toBe(RepeatWrapping)
      expect(map.repeat.x * 0.6).toBeCloseTo(1)
      expect(map.repeat.y * 1.2).toBeCloseTo(1)
      expect(map.magFilter).toBe(LinearFilter)
      expect(map.minFilter).toBe(LinearMipmapLinearFilter)
      expect(map.generateMipmaps).toBe(true)
      expect(map.anisotropy).toBeGreaterThan(1)
    }
    textures.color.dispose(); textures.surface.dispose()
  })
})
