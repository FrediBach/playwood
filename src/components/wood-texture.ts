import * as THREE from 'three'
import type { Material } from '@/lib/types'

type WoodMaterial = Exclude<Material, 'painted'>
const TAU = Math.PI * 2
const WIDTH = 512
const HEIGHT = 1024
// Geometry UVs are in metres. A larger board reveals more grain instead of stretching it.
const TILE_WIDTH = 0.6
const TILE_HEIGHT = 1.2
const profiles = {
  birch: { seed: 13, rings: 38, contrast: 0.19, pores: 0.035, roughness: 0.79 },
  oak: { seed: 37, rings: 30, contrast: 0.31, pores: 0.14, roughness: 0.83 },
  walnut: { seed: 73, rings: 26, contrast: 0.34, pores: 0.08, roughness: 0.73 },
  mdf: { seed: 97, rings: 0, contrast: 0.045, pores: 0, roughness: 0.91 },
} satisfies Record<WoodMaterial, { seed: number; rings: number; contrast: number; pores: number; roughness: number }>

const wrap = (n: number, period: number) => ((n % period) + period) % period
const smooth = (n: number) => n * n * n * (n * (n * 6 - 15) + 10)
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (n: number) => Math.max(0, Math.min(1, n))

function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

// Wrapped lattice noise and periodic growth rings make every layer periodic
// in BOTH axes, including its slope. RepeatWrapping alone cannot remove a seam.
function noise(u: number, v: number, columns: number, rows: number, seed: number) {
  const x = wrap(u, 1) * columns, y = wrap(v, 1) * rows
  const ix = Math.floor(x), iy = Math.floor(y)
  const sx = smooth(x - ix), sy = smooth(y - iy)
  const at = (dx: number, dy: number) => hash((ix + dx) % columns, (iy + dy) % rows, seed)
  return mix(mix(at(0, 0), at(1, 0), sx), mix(at(0, 1), at(1, 1), sx), sy) * 2 - 1
}

/** Periodic colour, height and roughness, sampled independently of the raster resolution. */
export function sampleWood(material: WoodMaterial, u: number, v: number) {
  const profile = profiles[material]
  const { seed } = profile
  const fleck = noise(u, v, 256, 512, seed + 9)
  if (material === 'mdf') {
    const shade = clamp(0.94 + fleck * profile.contrast + noise(u, v, 120, 240, seed) * 0.018)
    return { shade, height: 0.5 + fleck * 0.12, roughness: profile.roughness + fleck * 0.025 }
  }
  const broad = noise(u, v, 5, 3, seed)
  const bend = noise(u, v, 4, 3, seed + 1) * 0.035 + Math.sin(v * TAU) * 0.012
  const across = u + bend
  const figure = noise(across, v, 7, 2, seed + 2)
  // A cut through curved growth rings produces the long, nested arches of veneer.
  // Sine-squared distances preserve those arches across the tile boundaries.
  const trunk = Math.sin(across * TAU + figure * 0.12)
  const depth = 0.35 + noise(u, v, 2, 3, seed + 6) * 0.13
  const phase = Math.sqrt(trunk * trunk + depth * depth) * profile.rings
    + noise(across, v, 35, 8, seed + 3) * 0.18
  const ring = Math.pow(0.5 + 0.5 * Math.sin(phase * TAU), 9)
  const earlywood = Math.sin(phase * TAU - 0.7) * 0.5 + 0.5
  const fibers = noise(across, v, 220, 12, seed + 4) * 0.65 + noise(across, v, 100, 25, seed + 7) * 0.35
  const pores = Math.pow(clamp((noise(across, v, 280, 100, seed + 5) - 0.3) * 1.5), 3)
  const shade = clamp(0.92 + broad * 0.07 + figure * 0.035 + fibers * 0.06 + fleck * 0.018
    - profile.contrast * (ring * (0.4 + fibers * 0.25) + earlywood * 0.25) - pores * profile.pores)
  return {
    shade,
    height: clamp(0.55 + fibers * 0.12 + fleck * 0.025 - ring * 0.12 - pores * 0.3),
    roughness: clamp(profile.roughness + ring * 0.07 + pores * 0.12 - broad * 0.035),
  }
}

const sourcesByMaterial = new Map<WoodMaterial, { color: THREE.Source; surface: THREE.Source }>()

function textureSources(material: WoodMaterial) {
  const cached = sourcesByMaterial.get(material)
  if (cached) return cached
  const color = new Uint8Array(WIDTH * HEIGHT * 4)
  const surface = new Uint8Array(color.length)
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const { shade, height, roughness } = sampleWood(material, x / WIDTH, y / HEIGHT)
    const i = (y * WIDTH + x) * 4
    color[i] = color[i + 1] = color[i + 2] = Math.round(shade * 255)
    color[i + 3] = 255
    // Bump reads red; roughness reads green. Keep this data out of sRGB conversion.
    surface[i] = Math.round(height * 255)
    surface[i + 1] = Math.round(roughness * 255)
    surface[i + 2] = 0
    surface[i + 3] = 255
  }
  const sources = {
    color: new THREE.Source({ data: color, width: WIDTH, height: HEIGHT }),
    surface: new THREE.Source({ data: surface, width: WIDTH, height: HEIGHT }),
  }
  sourcesByMaterial.set(material, sources)
  return sources
}

/** Shared sources reuse GPU uploads; Three refcounts each panel's disposable wrappers. */
export function createWoodTextures(material: WoodMaterial) {
  const sources = textureSources(material)
  const texture = (source: THREE.Source, colorSpace: THREE.ColorSpace) => {
    const map = new THREE.DataTexture()
    map.source = source
    map.colorSpace = colorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(1 / TILE_WIDTH, 1 / TILE_HEIGHT)
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.anisotropy = 8
    map.needsUpdate = true
    return map
  }
  return { color: texture(sources.color, THREE.SRGBColorSpace), surface: texture(sources.surface, THREE.NoColorSpace) }
}
