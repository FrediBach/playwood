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
