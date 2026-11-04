import { describe, expect, it } from 'vitest'
import { createPanelMaterials } from './panel-materials'
import { createWoodTextures } from './wood-texture'

describe.each(['osb', 'nazena'] as const)('%s panel appearance', material => {
  it('textures faces and cut edges and fades relief with finish coverage', () => {
    const textures = createWoodTextures(material)
    const panel = { material, color: '#abcdef' }
    const natural = createPanelMaterials(panel, textures)
    const tinted = createPanelMaterials({ ...panel, finishCoverage: 0.5 }, textures)
    const solid = createPanelMaterials({ ...panel, finishCoverage: 1 }, textures)
    const ghost = createPanelMaterials(panel, textures, '#ff8800')
    for (const index of [0, 1]) {
      expect(natural[index].map).toBe(textures.color)
      expect(natural[index].bumpMap).toBe(textures.surface)
      expect(natural[index].roughnessMap).toBe(textures.surface)
      expect(natural[index].bumpScale).toBeGreaterThan(0)
      expect(tinted[index].bumpScale).toBeCloseTo(natural[index].bumpScale * 0.5)
      expect(solid[index].map).toBeNull()
      expect(solid[index].bumpMap).toBeNull()
      expect(solid[index].roughnessMap).toBeNull()
      expect(solid[index].color.getHexString()).toBe('abcdef')
      expect(ghost[index].map).toBeNull()
      expect(ghost[index].transparent).toBe(true)
      expect(ghost[index].depthWrite).toBe(false)
    }
    for (const entry of [...natural, ...tinted, ...solid, ...ghost]) entry.dispose()
    textures.color.dispose(); textures.surface.dispose()
  })
})

it('keeps selected finishes while making faces and edges translucent, with ghost precedence', () => {
  const textures = createWoodTextures('birch')
  const panel = { material: 'birch' as const, color: '#abcdef', finishCoverage: 0.4 }
  const normal = createPanelMaterials(panel, textures)
  const selected = createPanelMaterials(panel, textures, undefined, true)
  const ghost = createPanelMaterials(panel, textures, '#ff8800', true)
  for (const index of [0, 1]) {
    expect(selected[index].transparent).toBe(true)
    expect(selected[index].opacity).toBe(0.8)
    expect(selected[index].depthWrite).toBe(false)
    expect(selected[index].color.equals(normal[index].color)).toBe(true)
    expect(selected[index].map).toBe(normal[index].map)
    expect(selected[index].bumpScale).toBe(normal[index].bumpScale)
    expect(normal[index].opacity).toBe(1)
    expect(normal[index].transparent).toBe(false)
    expect(normal[index].depthWrite).toBe(true)
    expect(ghost[index].opacity).toBeLessThan(selected[index].opacity)
    expect(ghost[index].map).toBeNull()
  }
  for (const entry of [...normal, ...selected, ...ghost]) entry.dispose()
  textures.color.dispose(); textures.surface.dispose()
})
