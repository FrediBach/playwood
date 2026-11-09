export type CompositeMaterial = 'osb' | 'nazena'
const SIZE = 1024
const TAU = Math.PI * 2
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const wrap = (n: number) => ((n % SIZE) + SIZE) % SIZE
const mix = (a: number, b: number, t: number) => a + (b - a) * t

function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function noiseSampler(cells: number, seed: number) {
  // Hash the small periodic lattice once, rather than four times per fragment pixel.
  const lattice = new Float64Array(cells * cells)
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) lattice[y * cells + x] = hash(x, y, seed)
  return (x: number, y: number) => {
    const u = wrap(x) / SIZE * cells, v = wrap(y) / SIZE * cells
    const ix = Math.floor(u), iy = Math.floor(v)
    const sx = (u - ix) ** 2 * (3 - 2 * (u - ix)), sy = (v - iy) ** 2 * (3 - 2 * (v - iy))
    const nextX = (ix + 1) % cells, nextY = (iy + 1) % cells
    return mix(mix(lattice[iy * cells + ix], lattice[iy * cells + nextX], sx),
      mix(lattice[nextY * cells + ix], lattice[nextY * cells + nextX], sx), sy) * 2 - 1
  }
}

/** Rasterize fragments across tile boundaries, so even the relief wraps without seams. */
export function createCompositeRaster(material: CompositeMaterial) {
  const textile = material === 'nazena'
  const color = new Uint8Array(SIZE * SIZE * 4), surface = new Uint8Array(color.length)
  const seed = textile ? 211 : 157
  const coarseNoise = noiseSampler(55, seed), fineNoise = noiseSampler(170, seed + 1), grainNoise = noiseSampler(32, seed)
  let sequence = 0
  const random = () => hash(sequence++, 0, seed)
  const write = (x: number, y: number, shade: number, relief: number, roughness: number, alpha = 1, warmth = 0) => {
    const i = (wrap(y) * SIZE + wrap(x)) * 4
    for (let channel = 0; channel < 3; channel++) {
      const tint = channel === 0 ? 1 : channel === 1 ? 1 - warmth * 0.035 : 1 - warmth * 0.12
      color[i + channel] = Math.round(mix(color[i + channel], clamp(shade * tint) * 255, alpha))
    }
    color[i + 3] = 255
    surface[i] = Math.round(mix(surface[i], clamp(relief) * 255, alpha))
    surface[i + 1] = Math.round(mix(surface[i + 1], clamp(roughness) * 255, alpha))
    surface[i + 3] = 255
  }

  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const fine = hash(x, y, seed) - 0.5
    const clumps = coarseNoise(x, y) * 0.09 + fineNoise(x, y) * 0.08
    const shade = (textile ? 0.73 : 0.68) + clumps + fine * (textile ? 0.15 : 0.1)
    write(x, y, shade, 0.4 + clumps + fine * 0.2, textile ? 0.96 : 0.88)
  }

  // OSB flakes are long, irregular slivers with their own longitudinal grain.
  // Nazena has short, randomly oriented fibres pressed into a mottled felt-like body.
  const count = textile ? 58000 : 1650
  const tileMeters = textile ? 0.45 : 0.6
  for (let fragment = 0; fragment < count; fragment++) {
    const cx = random() * SIZE, cy = random() * SIZE, angle = random() * TAU
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const length = (textile ? 0.0015 + random() ** 2 * 0.011 : 0.018 + random() * 0.08) / tileMeters * SIZE
    const width = (textile ? 0.00016 + random() * 0.00055 : 0.006 + random() ** 1.2 * 0.03) / tileMeters * SIZE
    const tone = random()
    const shade = textile ? 0.44 + tone * 0.54 : tone < 0.13 ? 0.55 + tone * 0.85 : 0.72 + tone * 0.27
    const relief = textile ? 0.45 + random() * 0.28 : 0.4 + random() * 0.32
    const warmth = textile ? -random() * 0.3 : random() + (tone < 0.13 ? 1.6 : 0)
    const bend = (random() - 0.5) * (textile ? 2 : 0.25)
    const taperStart = 0.35 + random() * 0.6, taperEnd = 0.35 + random() * 0.6
    const grainPhase = random() * TAU
    const reachX = Math.abs(cos) * length / 2 + Math.abs(sin) * width * (1 + Math.abs(bend)) + 1
    const reachY = Math.abs(sin) * length / 2 + Math.abs(cos) * width * (1 + Math.abs(bend)) + 1
    for (let y = Math.floor(cy - reachY); y <= cy + reachY; y++) for (let x = Math.floor(cx - reachX); x <= cx + reachX; x++) {
      const dx = x - cx, dy = y - cy
      const along = (dx * cos + dy * sin) / (length / 2)
      if (Math.abs(along) >= 1) continue
      const across = -dx * sin + dy * cos - bend * width * (1 - along * along)
      const taper = along < 0 ? mix(taperStart, 1, along + 1) : mix(1, taperEnd, along)
      const halfWidth = width / 2 * (textile ? Math.sqrt(1 - along * along) : taper)
      const torn = textile ? 0 : Math.sin(along * 51 + grainPhase) * 0.55 + Math.sin(along * 113 + grainPhase) * 0.3
      const edge = halfWidth - Math.abs(across) + torn
      if (edge < -0.5) continue
      const alpha = clamp(edge + 0.5) * clamp((1 - Math.abs(along)) * length / 2)
      const fleck = hash(wrap(x), wrap(y), fragment) - 0.5
      const grain = textile ? fleck * 0.1 : Math.sin(across * 3.4 + Math.sin(along * 5 + grainPhase) * 0.6 + grainPhase) * 0.025
        + grainNoise((across + grainPhase) * 12, along * 50 + fragment * 10) * 0.065
        + Math.sin(across * 0.43 + Math.sin(along * 3 + grainPhase) * 0.3 + grainPhase) * 0.012 + fleck * 0.055
      // Slight torn edges and longitudinal pores, without painted black outlines.
      const rim = textile ? 0 : Math.max(0, 1 - edge / 1.2) * 0.055
      write(x, y, shade + grain - rim, relief + grain * (textile ? 1.4 : 0.7) - rim, (textile ? 0.95 : 0.84) + grain * 0.2, alpha, warmth)
    }
  }
  return {
    color, surface, width: SIZE, height: SIZE,
    tileWidth: tileMeters,
    tileHeight: tileMeters,
  }
}
