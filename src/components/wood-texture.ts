import * as THREE from 'three'
import { createMaterialRaster, type NaturalMaterial } from './material-raster'
import { unpackMaterialRaster, type PackedMaterialRaster } from './material-raster-packing'
import { startMaterialPrewarm } from './material-prewarm'

export { sampleWood } from './material-raster'

const sourcesByMaterial = new Map<NaturalMaterial, { color: THREE.Source; surface: THREE.Source; tileWidth: number; tileHeight: number }>()
const preparedByMaterial = new Map<NaturalMaterial, PackedMaterialRaster>()

/** Speculative pixels stay packed until a panel first needs their shared sources. */
export function prewarmWoodTextures() {
  return startMaterialPrewarm({
    has: material => sourcesByMaterial.has(material) || preparedByMaterial.has(material),
    accept: (material, raster) => {
      // A synchronous render can win the race; never replace sources already in use.
      if (!sourcesByMaterial.has(material) && !preparedByMaterial.has(material)) preparedByMaterial.set(material, raster)
    },
  })
}

function textureSources(material: NaturalMaterial) {
  const cached = sourcesByMaterial.get(material)
  if (cached) return cached
  const prepared = preparedByMaterial.get(material)
  const raster = prepared ? unpackMaterialRaster(prepared) : createMaterialRaster(material)
  preparedByMaterial.delete(material)
  const { color, surface, width, height, tileWidth, tileHeight } = raster
  const sources = {
    color: new THREE.Source({ data: color, width, height }),
    surface: new THREE.Source({ data: surface, width, height }),
    tileWidth, tileHeight,
  }
  sourcesByMaterial.set(material, sources)
  return sources
}

/** Shared sources reuse GPU uploads; Three refcounts each panel's disposable wrappers. */
export function createWoodTextures(material: NaturalMaterial) {
  const sources = textureSources(material)
  const texture = (source: THREE.Source, colorSpace: THREE.ColorSpace) => {
    const map = new THREE.DataTexture()
    map.source = source
    map.colorSpace = colorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(1 / sources.tileWidth, 1 / sources.tileHeight)
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.anisotropy = 8
    map.needsUpdate = true
    return map
  }
  return { color: texture(sources.color, THREE.SRGBColorSpace), surface: texture(sources.surface, THREE.NoColorSpace) }
}
