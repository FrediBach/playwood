import * as THREE from 'three'
import { seededRandom } from '@/lib/preview-furnishing-variation'
import type { ParquetStyle, RugStyle } from '@/lib/room-floor-style'

/**
 * Procedural parquet and rug textures for the realistic preview. Each texture
 * is drawn once per style (and rug size) and owned by RoomEnvironment, which
 * disposes it. Parquet tiles repeat seamlessly; rugs are drawn whole so their
 * borders keep true proportions.
 */

type Rgb = [number, number, number]
interface Board { x: number; y: number; length: number; width: number; vertical: boolean }
interface ParquetLayout { size: number; metres: number; boards: Board[] }

const PARQUET_PX = 2048

/**
 * Software-backed canvases: thousands of small paths rasterise faster on the
 * CPU than through a deferred GPU canvas, and rugs read their pixels back.
 */
function canvas(width: number, height = width) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return [element, element.getContext('2d', { willReadFrequently: true })!] as const
}

function texture(element: HTMLCanvasElement, color: boolean) {
  const result = new THREE.CanvasTexture(element)
  result.wrapS = result.wrapT = THREE.RepeatWrapping
  if (color) result.colorSpace = THREE.SRGBColorSpace
  result.anisotropy = 8
  return result
}

const rgb = ([r, g, b]: Rgb, alpha = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha})`
const shade = ([r, g, b]: Rgb, factor: number, warm = 0): Rgb =>
  [Math.min(255, r * factor + warm), Math.min(255, g * factor), Math.min(255, b * factor - warm * 0.6)]

/** Board rectangles in pixels for one seamless tile. */
function parquetLayout(style: ParquetStyle, random: () => number): ParquetLayout {
  const boards: Board[] = []
  if (style.pattern === 'plank' || style.pattern === 'wide-plank') {
    const rows = Math.max(4, Math.round((style.pattern === 'plank' ? 2.4 : 3.2) / style.boardWidth))
    const metres = rows * style.boardWidth
    const scale = PARQUET_PX / metres, width = PARQUET_PX / rows
    const [shortest, longest] = style.boardLength.map(value => Math.min(value, metres * 0.9) * scale)
    for (let row = 0; row < rows; row++) {
      const lengths: number[] = []
      let total = 0
      while (total < PARQUET_PX) {
        const length = shortest + random() * (longest - shortest)
        lengths.push(length)
        total += length
      }
      lengths[lengths.length - 1] -= total - PARQUET_PX
      // A short remainder joins its neighbour instead of becoming a sliver.
      if (lengths.length > 1 && lengths.at(-1)! < shortest * 0.45) lengths[lengths.length - 2] += lengths.pop()!
      let x = random() * PARQUET_PX
      for (const length of lengths) {
        boards.push({ x, y: row * width, length, width, vertical: false })
        x += length
      }
    }
    return { size: PARQUET_PX, metres, boards }
  }
  if (style.pattern === 'herringbone') {
    // Axis-aligned herringbone with length = ratio × width repeats every 2 × length;
    // the floor turns it by 45°. Lattice: (w, w) and (L, -L).
    const k = style.ratio, periods = Math.max(1, Math.round(2 / (2 * k * style.boardWidth)))
    const width = Math.floor(PARQUET_PX / (periods * 2 * k)), length = k * width, size = periods * 2 * length
    for (let a = 0; a < size / width; a++) {
      for (let b = -Math.ceil(size / (2 * length)); b <= Math.ceil(size / (2 * length)); b++) {
        const x = a * width + b * length, y = a * width - b * length
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        boards.push({ x, y, length, width, vertical: false })
        boards.push({ x: x + length, y: y + width - length, length, width, vertical: true })
      }
    }
    return { size, metres: size / width * style.boardWidth, boards }
  }
  // Basket weave: square blocks of parallel slats, alternating direction.
  const slats = style.ratio, blocks = Math.max(2, 2 * Math.round(2 / (2 * slats * style.boardWidth)))
  const width = Math.floor(PARQUET_PX / (blocks * slats)), block = width * slats, size = blocks * block
  for (let row = 0; row < blocks; row++) for (let column = 0; column < blocks; column++) {
    const vertical = (row + column) % 2 === 1
    for (let slat = 0; slat < slats; slat++) boards.push(vertical
      ? { x: column * block + slat * width, y: row * block, length: block, width, vertical }
      : { x: column * block, y: row * block + slat * width, length: block, width, vertical })
  }
  return { size, metres: size / width * style.boardWidth, boards }
}

interface BoardLook { tone: Rgb; level: number; cathedral: boolean; knots: number; seed: number }

function drawBoard(color: CanvasRenderingContext2D, bump: CanvasRenderingContext2D, board: Board, look: BoardLook, scale: number, wood: string) {
  const { length, width } = board
  const random = seededRandom(`board:${look.seed}`)
  for (const ctx of [color, bump]) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(board.x, board.y, board.vertical ? width : length, board.vertical ? length : width)
    ctx.clip()
    // Local frame: the board's length along +x, its width along +y.
    if (board.vertical) { ctx.translate(board.x + width, board.y); ctx.rotate(Math.PI / 2) } else ctx.translate(board.x, board.y)
  }

  color.fillStyle = rgb(look.tone)
  color.fillRect(0, 0, length, width)
  bump.fillStyle = `rgb(${look.level},${look.level},${look.level})`
  bump.fillRect(0, 0, length, width)
  // Boards are a little lighter or darker towards one end, like sawn timber.
  const along = color.createLinearGradient(0, 0, length, 0)
  along.addColorStop(0, rgb(shade(look.tone, 0.94), 0.5))
  along.addColorStop(0.3 + random() * 0.4, rgb(shade(look.tone, 1.05), 0.25))
  along.addColorStop(1, rgb(shade(look.tone, 0.96 + random() * 0.08), 0.5))
  color.fillStyle = along
  color.fillRect(0, 0, length, width)

  // Grain: fine lines along the board, bending into flames on flat-sawn boards.
  const spacing = Math.max(1.4, scale * (0.0016 + random() * 0.0016))
  const centre = length * (0.25 + random() * 0.5), flame = length * (0.18 + random() * 0.22), middle = width * (0.3 + random() * 0.4)
  const dark = rgb(shade(look.tone, 0.62, 4), 1)
  const light = rgb(shade(look.tone, 1.18), 1)
  const step = Math.max(6, length / 90)
  for (let line = 0, y0 = random() * spacing; y0 < width; line++, y0 += spacing * (0.6 + random() * 0.9)) {
    const strong = random() < 0.22
    const amplitude = random() * width * 0.04, frequency = (1 + random() * 2.5) * Math.PI * 2 / length, phase = random() * 6.3
    const path = new Path2D()
    for (let x = -step; x <= length + step; x += step) {
      const pinch = look.cathedral ? Math.exp(-(((x - centre) / flame) ** 2)) * (y0 - middle) * 0.75 : 0
      const y = y0 + Math.sin(x * frequency + phase) * amplitude - pinch
      if (x === -step) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    color.strokeStyle = line % 4 === 3 ? light : dark
    color.globalAlpha = line % 4 === 3 ? 0.08 : strong ? 0.2 : 0.06 + random() * 0.07
    color.lineWidth = strong ? 1.1 + random() * 0.8 : 0.5 + random() * 0.6
    color.stroke(path)
    if (strong) {
      // Open pores of the strongest grain lines catch a little light.
      bump.strokeStyle = 'rgba(0,0,0,0.08)'
      bump.lineWidth = color.lineWidth
      bump.stroke(path)
    }
  }
  color.globalAlpha = 1
  // Oak and ash show short, silvery ray flecks.
  if (wood === 'oak' || wood === 'ash' || wood === 'whitewash' || wood === 'honey') {
    color.fillStyle = rgb(shade(look.tone, 1.16), 0.16)
    for (let fleck = 0; fleck < length * width / 900; fleck++) {
      color.fillRect(random() * length, random() * width, 2 + random() * 6, 0.6 + random() * 0.6)
    }
  }
  for (let knot = 0; knot < look.knots; knot++) {
    const x = length * (0.1 + random() * 0.8), y = width * (0.2 + random() * 0.6), radius = scale * (0.003 + random() * 0.005)
    const gradient = color.createRadialGradient(x, y, 0, x, y, radius * 2.2)
    gradient.addColorStop(0, rgb(shade(look.tone, 0.42), 0.85))
    gradient.addColorStop(0.45, rgb(shade(look.tone, 0.62), 0.45))
    gradient.addColorStop(1, rgb(look.tone, 0))
    color.fillStyle = gradient
    color.beginPath()
    color.ellipse(x, y, radius * 2.6, radius * 1.3, 0, 0, Math.PI * 2)
    color.fill()
  }
  // Micro bevels: a dark joint and a catch light on each edge.
  color.fillStyle = 'rgba(48,30,16,0.5)'
  color.fillRect(0, 0, length, 0.9); color.fillRect(0, width - 0.9, length, 0.9)
  color.fillRect(0, 0, 0.9, width); color.fillRect(length - 0.9, 0, 0.9, width)
  color.fillStyle = 'rgba(255,240,215,0.16)'
  color.fillRect(1, 0.9, length - 2, 1.1)
  color.fillStyle = 'rgba(40,24,12,0.12)'
  color.fillRect(1, width - 2.2, length - 2, 1.3)
  bump.fillStyle = 'rgb(40,40,40)'
  bump.fillRect(0, 0, length, 1.2); bump.fillRect(0, width - 1.2, length, 1.2)
  bump.fillRect(0, 0, 1.2, width); bump.fillRect(length - 1.2, 0, 1.2, width)
  color.restore()
  bump.restore()
}

export interface ParquetTextures { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; metres: number }

export function parquetTextures(style: ParquetStyle, key: string): ParquetTextures {
  const random = seededRandom(`parquet:${key}`)
  const layout = parquetLayout(style, random)
  const [colorCanvas, color] = canvas(layout.size)
  const [bumpCanvas, bump] = canvas(layout.size)
  const scale = layout.size / layout.metres
  const knotty = style.wood.id === 'oak' || style.wood.id === 'walnut' || style.wood.id === 'smoked' ? 0.35 : 0.15
  for (const board of layout.boards) {
    // Most boards stay close to the mid tone; a few stand out, as in a real floor.
    const outlier = random() < 0.12 ? (random() - 0.5) * 0.3 : 0
    const factor = 1 + (random() - 0.5) * style.wood.spread * 0.22 + outlier * style.wood.spread
    const look: BoardLook = {
      tone: shade(style.wood.base, factor, (random() - 0.5) * 8),
      level: Math.round(196 + (random() - 0.5) * 18),
      cathedral: random() < 0.45,
      knots: random() < knotty ? 1 + (random() < 0.3 ? 1 : 0) : 0,
      seed: Math.floor(random() * 1e9),
    }
    const w = board.vertical ? board.width : board.length, h = board.vertical ? board.length : board.width
    // Boards crossing the tile edge are drawn again on the opposite side.
    for (const dx of [-layout.size, 0, layout.size]) for (const dy of [-layout.size, 0, layout.size]) {
      const x = board.x + dx, y = board.y + dy
      if (x >= layout.size || y >= layout.size || x + w <= 0 || y + h <= 0) continue
      drawBoard(color, bump, { ...board, x, y }, look, scale, style.wood.id)
    }
  }
  return { map: texture(colorCanvas, true), bump: texture(bumpCanvas, false), metres: layout.metres }
}

/* Rugs */

function hex(value: string): Rgb {
  const number = parseInt(value.slice(1), 16)
  return [number >> 16 & 255, number >> 8 & 255, number & 255]
}

function drawRugPattern(ctx: CanvasRenderingContext2D, style: RugStyle, width: number, height: number, scale: number, random: () => number) {
  const m = (metres: number) => metres * scale
  ctx.fillStyle = style.field
  ctx.fillRect(0, 0, width, height)
  const frame = (inset: number, band: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = m(band)
    ctx.strokeRect(m(inset) + m(band) / 2, m(inset) + m(band) / 2, width - 2 * m(inset) - m(band), height - 2 * m(inset) - m(band))
  }
  switch (style.pattern) {
    case 'border':
      frame(0, 0.035, style.detail)
      frame(0.12, 0.05, style.accent)
      frame(0.2, 0.012, style.accent)
      break
    case 'grid': {
      const cell = 0.3 + random() * 0.15
      ctx.fillStyle = style.accent
      ctx.globalAlpha = 0.55
      for (let x = (width % m(cell)) / 2; x < width; x += m(cell)) ctx.fillRect(x - m(0.006), 0, m(0.012), height)
      for (let y = (height % m(cell)) / 2; y < height; y += m(cell)) ctx.fillRect(0, y - m(0.006), width, m(0.012))
      ctx.globalAlpha = 1
      frame(0, 0.06, style.accent)
      break
    }
    case 'stripes': {
      // Woven bands across the rug, mirrored about its middle.
      const bands: [number, string][] = []
      let used = 0
      while (used < 0.5) {
        const band = 0.02 + random() * 0.1, gap = 0.04 + random() * 0.16
        bands.push([used + gap, random() < 0.6 ? style.accent : style.detail])
        used += gap + band
        bands.push([used, ''])
      }
      for (let i = 0; i < bands.length; i += 2) {
        const [start, color] = bands[i], end = bands[i + 1][0]
        ctx.fillStyle = color
        for (const mirror of [false, true]) {
          const from = (mirror ? 1 - end : start) * width, to = (mirror ? 1 - start : end) * width
          ctx.fillRect(from, 0, Math.max(1, to - from), height)
        }
      }
      break
    }
    case 'kilim': {
      // Stepped lozenges on a 2 cm weave grid, inside a stepped border.
      const cell = m(0.02), columns = Math.ceil(width / cell), rows = Math.ceil(height / cell)
      const count = Math.max(2, Math.round(width / m(0.75))), radius = Math.min(height * 0.32, width / count * 0.42) / cell
      for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
        const x = column * cell, y = row * cell
        const edge = Math.min(column, row, columns - 1 - column, rows - 1 - row)
        if (edge < 3 || (edge < 5 && (column + row) % 4 < 2)) { ctx.fillStyle = edge < 3 ? style.accent : style.detail; ctx.fillRect(x, y, cell + 0.5, cell + 0.5); continue }
        const local = ((column + 0.5) * cell / (width / count)) % 1, centreY = rows / 2
        const distance = Math.abs(local - 0.5) * (width / count) / cell + Math.abs(row + 0.5 - centreY)
        if (distance < radius) {
          ctx.fillStyle = distance < radius * 0.45 ? style.accent : distance < radius * 0.7 ? style.detail : style.accent
          ctx.fillRect(x, y, cell + 0.5, cell + 0.5)
        }
      }
      break
    }
    case 'rings': {
      const colors = [style.accent, style.field, style.detail, style.field]
      const radius = width / 2
      for (let ring = 0, r = radius * 0.97; r > 0; ring++, r -= m(0.06 + (ring % 3) * 0.05)) {
        ctx.fillStyle = colors[ring % colors.length]
        ctx.beginPath(); ctx.arc(radius, radius, r, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'jute':
      frame(0, 0.045, style.accent)
      break
    default:
      break
  }
}

/** Mottling, fibres and weave, applied to the colour map; the bump map gets the same structure. */
function applyFibres(color: CanvasRenderingContext2D, bump: CanvasRenderingContext2D, style: RugStyle, width: number, height: number, scale: number, random: () => number) {
  const image = color.getImageData(0, 0, width, height), pixels = image.data
  const relief = bump.createImageData(width, height), heights = relief.data
  const cell = Math.max(4, scale * 0.14), gridW = Math.ceil(width / cell) + 2, gridH = Math.ceil(height / cell) + 2
  const lattice = Array.from({ length: gridW * gridH }, () => random() - 0.5)
  // Abrash: hand-dyed yarn batches show as faint bands across the rug.
  const bands = Array.from({ length: Math.ceil(height / Math.max(2, scale * 0.025)) + 1 }, () => random() - 0.5)
  const bandHeight = Math.max(2, scale * 0.025)
  const woven = style.pattern === 'jute' || style.pattern === 'kilim' || style.pattern === 'stripes'
  const weave = Math.max(2, Math.round(scale * (style.pattern === 'jute' ? 0.009 : 0.004)))
  const mottle = style.pattern === 'plain' ? 0.11 : style.pattern === 'jute' ? 0.09 : 0.07
  const abrash = woven ? 0.035 : 0.05
  const fibre = woven ? 0.07 : 0.12
  const edge = scale * 0.012
  // Per-pixel fibre noise uses a cheap xorshift stream seeded from the rug.
  let state = Math.floor(random() * 0xffffffff) | 1
  const noise = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return (state >>> 0) / 4294967296 - 0.5
  }
  for (let y = 0; y < height; y++) {
    const gy = y / cell, iy = Math.floor(gy), fy = gy - iy
    const band = y / bandHeight, ib = Math.floor(band), streak = bands[ib] + (bands[ib + 1] - bands[ib]) * (band - ib)
    for (let x = 0; x < width; x++) {
      const gx = x / cell, ix = Math.floor(gx), fx = gx - ix
      const a = lattice[iy * gridW + ix], b = lattice[iy * gridW + ix + 1], c = lattice[(iy + 1) * gridW + ix], d = lattice[(iy + 1) * gridW + ix + 1]
      const low = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
      let structure = noise()
      if (woven) {
        const u = x % weave / weave, v = y % weave / weave, over = (Math.floor(x / weave) + Math.floor(y / weave)) % 2 === 0
        structure = structure * 0.6 + (over ? Math.sin(u * Math.PI) : Math.sin(v * Math.PI)) * 0.55 - 0.3
      }
      const border = style.shape === 'rect' ? Math.min(x, y, width - 1 - x, height - 1 - y) : Infinity
      const factor = 1 + low * mottle * 2 + streak * abrash * 2 + structure * fibre - (border < edge ? 0.07 * (1 - border / edge) : 0)
      const index = (y * width + x) * 4
      pixels[index] = Math.min(255, pixels[index] * factor)
      pixels[index + 1] = Math.min(255, pixels[index + 1] * factor)
      pixels[index + 2] = Math.min(255, pixels[index + 2] * factor)
      const level = 150 + structure * 140 + low * 30
      heights[index] = heights[index + 1] = heights[index + 2] = level
      heights[index + 3] = 255
    }
  }
  color.putImageData(image, 0, 0)
  bump.putImageData(relief, 0, 0)
}

export interface RugTextures { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; fringe: THREE.CanvasTexture | null }

export function rugTextures(style: RugStyle, key: string, [width, depth]: [number, number]): RugTextures {
  const random = seededRandom(`rug:${key}:${width}:${depth}`)
  const pixelsWide = 1024, pixelsDeep = Math.max(256, Math.round(pixelsWide * depth / width))
  const scale = pixelsWide / width
  const [colorCanvas, color] = canvas(pixelsWide, pixelsDeep)
  const [bumpCanvas, bump] = canvas(pixelsWide, pixelsDeep)
  // Pile and weave soften the edges between colours, so the pattern is drawn sharp, then blurred in.
  const [patternCanvas, pattern] = canvas(pixelsWide, pixelsDeep)
  drawRugPattern(pattern, style, pixelsWide, pixelsDeep, scale, random)
  color.filter = `blur(${Math.max(0.6, scale * (style.pattern === 'kilim' || style.pattern === 'jute' ? 0.0015 : 0.003)).toFixed(2)}px)`
  color.drawImage(patternCanvas, 0, 0)
  color.filter = 'none'
  applyFibres(color, bump, style, pixelsWide, pixelsDeep, scale, random)
  const map = texture(colorCanvas, true), relief = texture(bumpCanvas, false)
  map.wrapS = map.wrapT = relief.wrapS = relief.wrapT = THREE.ClampToEdgeWrapping
  return { map, bump: relief, fringe: style.fringe ? fringeTexture(style) : null }
}

/** Knotted warp ends, drawn with strands along +u and transparent gaps. */
function fringeTexture(style: RugStyle) {
  const [element, ctx] = canvas(64, 512)
  const random = seededRandom(`fringe:${style.field}:${style.detail}`)
  const yarn = shade(hex(style.detail), 1.04)
  for (let y = 1; y < 512; y += 4) {
    const reach = 46 + random() * 16, wobble = (random() - 0.5) * 2.5
    ctx.strokeStyle = rgb(shade(yarn, 0.88 + random() * 0.2))
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.quadraticCurveTo(reach / 2, y + wobble, reach, y + wobble * 1.6)
    ctx.stroke()
  }
  // A knot every few strands where the warp is tied off.
  ctx.fillStyle = rgb(shade(yarn, 0.8))
  for (let y = 2; y < 512; y += 16) ctx.fillRect(4, y, 6, 10)
  const result = new THREE.CanvasTexture(element)
  result.colorSpace = THREE.SRGBColorSpace
  return result
}
