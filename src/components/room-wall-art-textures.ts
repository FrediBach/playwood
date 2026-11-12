import * as THREE from 'three'
import { seededRandom } from '@/lib/preview-furnishing-variation'
import type { ArtSpec, ArtStyle } from '@/lib/room-wall-art'

/**
 * Generative prints for the realistic preview's wall art. Everything is drawn
 * once into a CPU-backed canvas: the print, an optional passe-partout with its
 * bevelled window and the frame's soft inner shadow. The paper's grain is a
 * separate, shared bump texture, so the prints stay flat and compress well in
 * the GLB export.
 */
/** Small prints get more pixels per metre so fine pen lines survive minification. */
const PX_PER_METRE = 1400
const MAX_SIDE = 1024
const MAT = '#f5f2eb'
const TAU = Math.PI * 2

interface Area { x: number; y: number; w: number; h: number; u: number }
type Draw = (ctx: CanvasRenderingContext2D, area: Area, spec: ArtSpec, random: () => number) => void

const between = (random: () => number, min: number, max: number) => min + random() * (max - min)
const choose = <T,>(random: () => number, options: readonly T[]) => options[Math.floor(random() * options.length)]

function shuffled<T>(random: () => number, values: readonly T[]) {
  const copy = [...values]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, TAU)
  ctx.fill()
}

/** Smooth value noise on a wrapping lattice, sampled in lattice units. */
function valueNoise(random: () => number, cells: number) {
  const values = Array.from({ length: cells * cells }, random)
  const at = (x: number, y: number) => values[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0)
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
    return top + (bottom - top) * ty
  }
}

/** The original minimal print: a sun, a filled arch and nested outlined arches. Seed 0 reproduces it exactly. */
const arches: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const classic = spec.seed === 0
  const [sun, arch, line] = classic ? spec.colors : [...shuffled(random, spec.colors.slice(0, 2)), spec.colors[2]]
  const flip = !classic && random() < 0.5
  const value = (fixed: number, min: number, max: number) => classic ? fixed : between(random, min, max)
  const sunX = value(309 / 512, 0.48, 0.72), sunY = value(228 / 640, 0.2, 0.4), sunR = value(117 / 512, 0.15, 0.25)
  const archX = value(82 / 512, 0.1, 0.24), archTop = value(202 / 640, 0.28, 0.42), archW = value(178 / 512, 0.3, 0.4)
  const lineX = value(172 / 512, archX + 0.12, archX + 0.22), lineTop = value(345 / 640, 0.46, 0.6), lineW = value(230 / 512, 0.38, 0.5)
  const lines = classic ? 7 : 4 + Math.floor(random() * 5)
  const left = (fraction: number, width: number) => x + (flip ? 1 - fraction - width : fraction) * w
  const bottom = y + h * (classic ? 549 / 640 : between(random, 0.84, 0.9))
  disc(ctx, x + (flip ? 1 - sunX : sunX) * w, y + sunY * h, sunR * u, sun)
  ctx.fillStyle = arch
  ctx.beginPath()
  ctx.roundRect(left(archX, archW), y + archTop * h, archW * w, bottom - y - archTop * h, [archW * w / 2, archW * w / 2, 0, 0])
  ctx.fill()
  ctx.strokeStyle = line
  ctx.lineWidth = 5 / 512 * u
  const stepX = 13 / 512, stepY = 12 / 640, stepW = 26 / 512
  for (let i = 0; i < lines; i++) {
    const width = Math.max(0.04, lineW - i * stepW * (7 / lines))
    const top = y + (lineTop - i * stepY * (7 / lines)) * h
    const radius = classic ? 80 / 512 * u : Math.min(width * w / 2, 0.16 * u)
    ctx.beginPath()
    ctx.roundRect(left(lineX + i * stepX * (7 / lines), width), top, width * w, classic ? 270 / 640 * h : y + h * 0.96 - top, [radius, radius, 0, 0])
    ctx.stroke()
  }
}

/** A horizon with a low sun and a few perspective lines across the ground. */
const horizon: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const [sun, ground, line] = [...shuffled(random, spec.colors.slice(0, 2)), spec.colors[2]]
  const level = y + h * between(random, 0.55, 0.7)
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, level - y)
  ctx.clip()
  disc(ctx, x + w * between(random, 0.3, 0.7), level - (random() < 0.5 ? 0 : h * between(random, 0.08, 0.16)), u * between(random, 0.18, 0.28), sun)
  ctx.restore()
  ctx.fillStyle = ground
  ctx.fillRect(x, level, w, y + h - level)
  ctx.strokeStyle = line
  ctx.lineWidth = u * 0.006
  const count = 3 + Math.floor(random() * 4)
  for (let i = 1; i <= count; i++) {
    const t = (i / (count + 1)) ** 1.6
    const ly = level + (y + h - level) * t
    ctx.beginPath()
    ctx.moveTo(x + w * 0.12, ly)
    ctx.lineTo(x + w * 0.88, ly)
    ctx.stroke()
  }
}

/** Stacked soft-edged fields of colour with a visible brush texture. */
const colourField: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const colors = shuffled(random, spec.colors)
  const ground = random() < 0.5 ? spec.paper : colors.pop()!
  ctx.fillStyle = ground
  ctx.fillRect(x, y, w, h)
  const count = 2 + Math.floor(random() * 2), margin = u * between(random, 0.07, 0.11), gap = h * 0.04
  const weights = Array.from({ length: count }, () => between(random, 0.6, 1.4))
  const total = weights.reduce((sum, value) => sum + value, 0), usable = h - margin * 2 - gap * (count - 1)
  let top = y + margin
  for (let i = 0; i < count; i++) {
    const height = usable * weights[i] / total
    ctx.filter = `blur(${Math.max(1, u * 0.006)}px)`
    ctx.globalAlpha = 0.93
    ctx.fillStyle = colors[i % colors.length]
    ctx.fillRect(x + margin, top, w - margin * 2, height)
    ctx.filter = 'none'
    // Dry brush: translucent horizontal drags of the ground and of white.
    for (let stroke = 0; stroke < 26; stroke++) {
      ctx.globalAlpha = between(random, 0.03, 0.08)
      ctx.fillStyle = random() < 0.5 ? '#ffffff' : ground
      ctx.fillRect(x + margin + random() * w * 0.1, top + random() * height, w - margin * 2 - random() * w * 0.2, u * between(random, 0.004, 0.02))
    }
    ctx.globalAlpha = 1
    top += height + gap
  }
}

/** A grid of tiles, each with one primary shape: quarter and half circles, discs, triangles, squares. */
const bauhausTiles: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const colors = [spec.paper, ...spec.colors]
  const margin = random() < 0.5 ? 0 : u * 0.07
  const cols = 2 + Math.floor(random() * 2) + (w > h * 1.2 ? 1 : 0)
  const size = (w - margin * 2) / cols
  const rows = Math.max(1, Math.floor((h - margin * 2) / size + 0.15))
  const top = y + (h - rows * size) / 2
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const tx = x + margin + col * size, ty = top + row * size
    const background = choose(random, colors)
    const foreground = choose(random, colors.filter(color => color !== background))
    ctx.fillStyle = background
    ctx.fillRect(tx, ty, size + 0.5, size + 0.5)
    ctx.save()
    ctx.beginPath()
    ctx.rect(tx, ty, size, size)
    ctx.clip()
    ctx.fillStyle = foreground
    const corner = Math.floor(random() * 4), cx = tx + (corner % 3 ? size : 0), cy = ty + (corner > 1 ? size : 0)
    switch (choose(random, ['quarter', 'quarter', 'half', 'circle', 'triangle', 'square', 'ring', 'empty'] as const)) {
      case 'quarter': ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, size, 0, TAU); ctx.fill(); break
      case 'half': {
        const side = Math.floor(random() * 4), mx = tx + size / 2 + [0, size / 2, 0, -size / 2][side], my = ty + size / 2 + [-size / 2, 0, size / 2, 0][side]
        disc(ctx, mx, my, size / 2, foreground)
        break
      }
      case 'circle': disc(ctx, tx + size / 2, ty + size / 2, size * 0.38, foreground); break
      case 'triangle': ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx + (corner % 3 ? 0 : size), cy); ctx.lineTo(cx, ty + (corner > 1 ? 0 : size)); ctx.fill(); break
      case 'square': ctx.fillRect(tx + size * 0.25, ty + size * 0.25, size * 0.5, size * 0.5); break
      case 'ring': ctx.strokeStyle = foreground; ctx.lineWidth = size * 0.12; ctx.beginPath(); ctx.arc(tx + size / 2, ty + size / 2, size * 0.3, 0, TAU); ctx.stroke(); break
      case 'empty': break
    }
    ctx.restore()
  }
}

/** A diagonal poster: a large disc, overprinted bars, thin rules and blocks that read as type. */
const bauhausPoster: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const [first, second, third, dark = '#1f1f1d'] = spec.colors
  disc(ctx, x + w * between(random, 0.35, 0.65), y + h * between(random, 0.28, 0.42), u * between(random, 0.26, 0.36), first)
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.translate(x + w / 2, y + h * 0.55)
  ctx.rotate((random() < 0.5 ? -1 : 1) * between(random, 0.25, 0.6))
  const bars: [string, number, number][] = [[dark, between(random, 0.7, 0.95), between(random, 0.05, 0.08)], [second, between(random, 0.4, 0.65), between(random, 0.08, 0.13)], [third, between(random, 0.25, 0.5), between(random, 0.02, 0.035)]]
  let offset = -h * 0.08
  for (const [color, length, thickness] of bars) {
    ctx.fillStyle = color
    ctx.fillRect(-w * length / 2 + (random() - 0.5) * w * 0.2, offset, w * length, h * thickness)
    offset += h * (thickness + between(random, 0.02, 0.06))
  }
  ctx.restore()
  ctx.fillStyle = dark
  const left = x + w * (random() < 0.5 ? 0.1 : 0.48), base = y + h * 0.78
  ctx.fillRect(left, base, w * between(random, 0.3, 0.42), h * 0.045)
  const lines = 3 + Math.floor(random() * 4)
  for (let i = 0; i < lines; i++) ctx.fillRect(left, base + h * (0.07 + i * 0.024), w * between(random, 0.12, 0.38), h * 0.009)
  ctx.fillRect(x + w * between(random, 0.06, 0.12), y + h * 0.06, Math.max(1, u * 0.004), h * 0.88)
}

/** Pen lines stay at least this many pixels apart, so small prints do not fill in. */
const MIN_SPACING = 4.5

function pen(ctx: CanvasRenderingContext2D, color: string, u: number) {
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.82
  ctx.lineWidth = Math.max(1, u * 0.0016)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/** Streamlines through a smooth noise field, optionally inside a circle. */
const plotterFlow: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const noise = valueNoise(random, 6), frequency = between(random, 2.2, 3.6), turn = between(random, 1, 1.8), base = random() * TAU
  const round = random() < 0.5, cx = x + w / 2, cy = y + h / 2, radius = u * 0.4
  const inside = (px: number, py: number) => round ? Math.hypot(px - cx, py - cy) < radius : px > x + u * 0.08 && px < x + w - u * 0.08 && py > y + u * 0.08 && py < y + h - u * 0.08
  const step = u * 0.006
  // Fewer lines on small prints keep the field open.
  const count = Math.round(Math.min(260, u * 0.45) * w * h / (u * u))
  for (let line = 0; line < count; line++) {
    pen(ctx, spec.colors[spec.colors.length > 1 && line % 6 === 0 ? 1 : 0], u)
    let px = x + random() * w, py = y + random() * h
    if (!inside(px, py)) continue
    ctx.beginPath()
    ctx.moveTo(px, py)
    for (let s = 0; s < 70; s++) {
      const angle = base + noise((px - x) / u * frequency, (py - y) / u * frequency) * TAU * turn
      px += Math.cos(angle) * step
      py += Math.sin(angle) * step
      if (!inside(px, py)) break
      ctx.lineTo(px, py)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/** Two offset sets of concentric circles, or a turning stack of squares. */
const plotterMoire: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const cx = x + w / 2, cy = y + h / 2
  if (random() < 0.6) {
    const spacing = Math.max(MIN_SPACING, u * between(random, 0.011, 0.016)), shift = u * between(random, 0.04, 0.1), angle = random() * TAU
    for (const [index, sign] of [[0, -1], [1, 1]] as const) {
      pen(ctx, spec.colors[Math.min(index, spec.colors.length - 1)], u)
      const ox = cx + Math.cos(angle) * shift * sign / 2, oy = cy + Math.sin(angle) * shift * sign / 2
      for (let r = spacing; r < u * 0.4; r += spacing) { ctx.beginPath(); ctx.arc(ox, oy, r, 0, TAU); ctx.stroke() }
    }
  } else {
    const count = Math.min(34 + Math.floor(random() * 20), Math.floor(u * 0.39 / MIN_SPACING)), turn = between(random, 0.02, 0.05) * (random() < 0.5 ? -1 : 1)
    pen(ctx, spec.colors[0], u)
    for (let i = 0; i < count; i++) {
      const size = u * 0.78 * (1 - i / count)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(i * turn)
      ctx.strokeRect(-size / 2, -size / 2, size, size)
      ctx.restore()
    }
  }
  ctx.globalAlpha = 1
}

/** Rows of squares that fall into growing disorder. */
const plotterGrid: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const margin = u * 0.1, cols = 6 + Math.floor(random() * 4), cell = (w - margin * 2) / cols
  const rows = Math.max(2, Math.floor((h - margin * 2) / cell)), top = y + (h - rows * cell) / 2
  const fromTop = random() < 0.7, strength = between(random, 0.8, 1.4)
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const disorder = ((fromTop ? row : rows - 1 - row) / (rows - 1)) ** 1.4 * strength
    pen(ctx, spec.colors[spec.colors.length > 1 && random() < 0.12 ? 1 : 0], u)
    ctx.save()
    ctx.translate(x + margin + (col + 0.5) * cell + (random() - 0.5) * disorder * cell * 0.5, top + (row + 0.5) * cell + (random() - 0.5) * disorder * cell * 0.5)
    ctx.rotate((random() - 0.5) * disorder * 1.3)
    ctx.strokeRect(-cell * 0.42, -cell * 0.42, cell * 0.84, cell * 0.84)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/** Overlapping primary forms, each filled with parallel hatching at its own angle. */
const plotterHatch: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const shapes = 3 + Math.floor(random() * 2)
  for (let i = 0; i < shapes; i++) {
    const size = u * between(random, 0.22, 0.4), cx = x + w * between(random, 0.28, 0.72), cy = y + h * between(random, 0.25, 0.75)
    const kind = choose(random, ['circle', 'square', 'triangle'] as const)
    const path = new Path2D()
    if (kind === 'circle') path.arc(cx, cy, size / 2, 0, TAU)
    else if (kind === 'square') path.rect(cx - size / 2, cy - size / 2, size, size)
    else { path.moveTo(cx, cy - size * 0.55); path.lineTo(cx + size * 0.55, cy + size * 0.4); path.lineTo(cx - size * 0.55, cy + size * 0.4); path.closePath() }
    pen(ctx, spec.colors[i % spec.colors.length], u)
    ctx.stroke(path)
    ctx.save()
    ctx.clip(path)
    ctx.translate(cx, cy)
    ctx.rotate(random() * Math.PI)
    const spacing = Math.max(MIN_SPACING, u * between(random, 0.008, 0.016))
    for (let offset = -size; offset <= size; offset += spacing) { ctx.beginPath(); ctx.moveTo(-size, offset); ctx.lineTo(size, offset); ctx.stroke() }
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

/** A decaying two-pendulum harmonograph trace. */
const plotterHarmonograph: Draw = (ctx, { x, y, w, h, u }, spec, random) => {
  const frequencies = Array.from({ length: 4 }, () => choose(random, [2, 3, 3, 4]) + (random() - 0.5) * 0.02)
  const phases = Array.from({ length: 4 }, () => random() * TAU)
  const damping = Array.from({ length: 4 }, () => between(random, 0.0015, 0.004))
  const amplitude = u * 0.21, cx = x + w / 2, cy = y + h / 2
  const point = (t: number) => [
    cx + amplitude * (Math.sin(frequencies[0] * t + phases[0]) * Math.exp(-damping[0] * t) + Math.sin(frequencies[1] * t + phases[1]) * Math.exp(-damping[1] * t)),
    cy + amplitude * (Math.sin(frequencies[2] * t + phases[2]) * Math.exp(-damping[2] * t) + Math.sin(frequencies[3] * t + phases[3]) * Math.exp(-damping[3] * t)),
  ]
  pen(ctx, spec.colors[0], u)
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.7
  // Stop before the decaying swings crowd into a solid core.
  const end = Math.min(700, 1.6 / Math.max(...damping) * Math.min(1, u / 500))
  ctx.beginPath()
  ctx.moveTo(...point(0) as [number, number])
  for (let t = 0.04; t < end; t += 0.04) ctx.lineTo(...point(t) as [number, number])
  ctx.stroke()
  ctx.globalAlpha = 1
}

const DRAW: Record<ArtStyle, Draw> = {
  arches, horizon, 'colour-field': colourField,
  'bauhaus-tiles': bauhausTiles, 'bauhaus-poster': bauhausPoster,
  'plotter-flow': plotterFlow, 'plotter-moire': plotterMoire, 'plotter-grid': plotterGrid, 'plotter-hatch': plotterHatch, 'plotter-harmonograph': plotterHarmonograph,
}

/** Physical size of one tile of the paper grain. */
export const GRAIN_TILE_METRES = 0.12
let paperGrain: THREE.CanvasTexture | null = null

/**
 * Relief of uncoated paper: fine noise with a few longer fibres, tiling.
 * Shared for the application's lifetime; pieces use clones with their own repeat.
 */
export function paperGrainTexture() {
  if (paperGrain) return paperGrain
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const image = ctx.createImageData(size, size), data = image.data
  let state = 0x9e3779b9
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 }
  for (let i = 0; i < data.length; i += 4) {
    const value = 128 + (next() - 0.5) * 70
    data[i] = data[i + 1] = data[i + 2] = value
    data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  ctx.globalAlpha = 0.18
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 0.8
  for (let fibre = 0; fibre < 90; fibre++) {
    const x = next() * size, y = next() * size, angle = next() * TAU, length = 6 + next() * 18
    // Draw each fibre at its wrapped positions too, so the tile stays seamless.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      ctx.beginPath()
      ctx.moveTo(x + dx, y + dy)
      ctx.quadraticCurveTo(x + dx + Math.cos(angle + 0.6) * length / 2, y + dy + Math.sin(angle + 0.6) * length / 2, x + dx + Math.cos(angle) * length, y + dy + Math.sin(angle) * length)
      ctx.stroke()
    }
  }
  paperGrain = new THREE.CanvasTexture(canvas)
  paperGrain.wrapS = paperGrain.wrapT = THREE.RepeatWrapping
  return paperGrain
}

function edgeShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, depth: number, strength: number) {
  // Light falls from above, so the top edge casts the deepest shadow and the bottom almost none.
  const shade = (x0: number, y0: number, x1: number, y1: number, weight: number) => {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
    gradient.addColorStop(0, `rgba(38, 30, 22, ${strength * weight})`)
    gradient.addColorStop(1, 'rgba(38, 30, 22, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) || w, Math.abs(y1 - y0) || h)
  }
  shade(x, y, x, y + depth * 1.6, 1)
  shade(x, y + h, x, y + h - depth * 0.5, 0.35)
  shade(x, y, x + depth, y, 0.6)
  shade(x + w, y, x + w - depth, y, 0.6)
}

/** Texture for the visible print area inside a frame, `width` × `height` metres. */
export function artTexture(spec: ArtSpec, width: number, height: number, framed: boolean) {
  const scale = Math.min(PX_PER_METRE, MAX_SIDE / Math.max(width, height))
  const pixelsX = Math.max(64, Math.round(width * scale)), pixelsY = Math.max(64, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = pixelsX
  canvas.height = pixelsY
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const random = seededRandom(`art:${spec.key}`)
  const short = Math.min(pixelsX, pixelsY), mat = Math.round(spec.mat * short)
  const area = { x: mat, y: mat, w: pixelsX - mat * 2, h: pixelsY - mat * 2, u: Math.min(pixelsX, pixelsY) - mat * 2 }
  ctx.fillStyle = MAT
  ctx.fillRect(0, 0, pixelsX, pixelsY)
  ctx.save()
  ctx.beginPath()
  ctx.rect(area.x, area.y, area.w, area.h)
  ctx.clip()
  ctx.fillStyle = spec.paper
  ctx.fillRect(area.x, area.y, area.w, area.h)
  DRAW[spec.style](ctx, area, spec, random)
  ctx.restore()
  if (mat) {
    // The mat's bevelled window shows its white core and shades the print below.
    edgeShadow(ctx, area.x, area.y, area.w, area.h, short * 0.012, 0.16)
    const bevel = Math.max(2, short * 0.005)
    ctx.strokeStyle = '#fcfbf7'
    ctx.lineWidth = bevel
    ctx.strokeRect(area.x - bevel / 2, area.y - bevel / 2, area.w + bevel, area.h + bevel)
  }
  if (framed) edgeShadow(ctx, 0, 0, pixelsX, pixelsY, short * 0.02, 0.24)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
