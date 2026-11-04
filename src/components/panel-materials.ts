import * as THREE from 'three'
import type { Panel } from '@/lib/types'
import type { createWoodTextures } from './wood-texture'

type PanelFinish = Pick<Panel, 'color' | 'material' | 'finishCoverage'>
const SOLID_ROUGHNESS = 0.76

/** Finish covers colour variation, pores, and exposed plywood layers together. */
export function createPanelMaterials(panel: PanelFinish, textures: ReturnType<typeof createWoodTextures> | null, ghostColor?: string, selected = false) {
  const grain = ghostColor || panel.material === 'painted' ? 0 : 1 - (panel.finishCoverage ?? 0)
  const maps = grain > 0 ? textures : null
  const composite = panel.material === 'osb' || panel.material === 'nazena'
  const bumpScale = panel.material === 'mdf' ? 0.00008 : panel.material === 'osb' ? 0.00065 : panel.material === 'nazena' ? 0.00045 : 0.0003
  const face = new THREE.MeshStandardMaterial({
    color: ghostColor ?? panel.color, map: maps?.color ?? null,
    bumpMap: maps?.surface ?? null, bumpScale: bumpScale * grain,
    roughnessMap: maps?.surface ?? null, roughness: maps ? 1 : SOLID_ROUGHNESS,
    metalness: 0, transparent: !!ghostColor || selected, opacity: ghostColor ? 0.38 : selected ? 0.8 : 1, depthWrite: !ghostColor && !selected,
  })
  if (maps) {
    face.onBeforeCompile = shader => {
      shader.uniforms.woodGrainStrength = { value: grain }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float woodGrainStrength;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuse, diffuseColor.rgb, woodGrainStrength);')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(${SOLID_ROUGHNESS}, roughnessFactor, woodGrainStrength);`)
    }
    face.customProgramCacheKey = () => 'playwood-finish-coverage'
  }
  const edge = new THREE.MeshStandardMaterial({
    color: ghostColor ?? panel.color, roughness: THREE.MathUtils.lerp(SOLID_ROUGHNESS, 0.9, grain),
    transparent: !!ghostColor || selected, opacity: ghostColor ? 0.32 : selected ? 0.8 : 1, depthWrite: !ghostColor && !selected,
  })
  if (composite && maps) {
    edge.map = maps.color
    edge.bumpMap = maps.surface
    edge.bumpScale = bumpScale * grain * 0.65
    edge.roughnessMap = maps.surface
    edge.roughness = 1
    edge.onBeforeCompile = face.onBeforeCompile
    edge.customProgramCacheKey = face.customProgramCacheKey
  }
  if (panel.material === 'birch' && grain > 0) {
    edge.onBeforeCompile = shader => {
      shader.uniforms.woodGrainStrength = { value: grain }
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float plywoodZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nplywoodZ = position.z;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float plywoodZ;\nuniform float woodGrainStrength;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat ply = smoothstep(0.37, 0.43, fract(plywoodZ * 700.0));\ndiffuseColor.rgb *= mix(1.0, mix(0.75, 1.02, ply), woodGrainStrength);')
    }
    edge.customProgramCacheKey = () => 'playwood-plywood-edges-finish'
  }
  return [face, edge]
}
