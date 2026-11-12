import * as THREE from 'three'
import { seededRandom } from '@/lib/preview-furnishing-variation'
import { SCALLOPS_PER_METRE, type CurtainStyle, type LowerWall, type WallFinish } from '@/lib/room-wall-style'

/**
 * Canvas textures for the realistic room's walls and curtains: seamless paint
 * finishes, lower-wall panelling, beadboard and tiles, and woven fabrics.
 * Canvases are CPU-backed, like the floor's, so drawing stays fast in software
 * rendering. Each texture has a matching bump map.
 */
const TAU = Math.PI * 2

function canvas(width: number, height: number) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  return { element, ctx: element.getContext('2d', { willReadFrequently: true })! }
}

function texture(element: HTMLCanvasElement, color: boolean, wrapT = THREE.RepeatWrapping as THREE.Wrapping) {
  const result = new THREE.CanvasTexture(element)
  if (color) result.colorSpace = THREE.SRGBColorSpace
  result.wrapS = THREE.RepeatWrapping
  result.wrapT = wrapT
  result.anisotropy = 8
  return result
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min)

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [value >> 16 & 255, value >> 8 & 255, value & 255]
}

/** A colour lighter (positive) or darker (negative) by a fraction. */
function shade(hex: string, amount: number) {
  const [r, g, b] = rgb(hex).map(channel => Math.round(Math.min(255, Math.max(0, amount > 0 ? channel + (255 - channel) * amount : channel * (1 + amount)))))
  return `rgb(${r}, ${g}, ${b})`
}

/** Smooth value noise on a lattice that wraps after `cells`, sampled in [0, 1). */
function wrappingNoise(random: () => number, cells: number) {
  const values = Array.from({ length: cells * cells }, random)
  const at = (x: number, y: number) => values[((y % cells) + cells) % cells * cells + ((x % cells) + cells) % cells]
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (u: number, v: number) => {
    const x = u * cells, y = v * cells, x0 = Math.floor(x), y0 = Math.floor(y), tx = smooth(x - x0), ty = smooth(y - y0)
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx
    return top + (bottom - top) * ty
  }
}

/**
 * Multiplies the canvas by seamless multi-octave noise plus per-pixel grain.
 * Octaves are [cells across, strength]; transparent pixels stay untouched.
 */
function mottle(ctx: CanvasRenderingContext2D, width: number, height: number, random: () => number, octaves: [number, number][], grain: number) {
  const layers = octaves.map(([cells, strength]) => [wrappingNoise(random, cells), strength] as const)
  const image = ctx.getImageData(0, 0, width, height), data = image.data
  let state = Math.floor(random() * 0x7fffffff) | 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4
    if (data[index + 3] === 0) continue
    let factor = 1
    for (const [noise, strength] of layers) factor += (noise(x / width, y / height) - 0.5) * 2 * strength
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    factor += ((state >>> 0) / 4294967296 - 0.5) * grain
    data[index] *= factor; data[index + 1] *= factor; data[index + 2] *= factor
  }
  ctx.putImageData(image, 0, 0)
}

/**
 * Draws a mark at its wrapped positions, so one crossing an edge continues on
 * the opposite side. Only copies within `reach` of the tile are drawn.
 */
function wrapped(width: number, height: number, draw: (dx: number, dy: number) => void, x = width / 2, y = height / 2, reach = Infinity) {
  for (const dx of [-width, 0, width]) {
    if (dx && (x + dx < -reach || x + dx > width + reach)) continue
    for (const dy of [-height, 0, height]) {
      if (dy && (y + dy < -reach || y + dy > height + reach)) continue
      draw(dx, dy)
    }
  }
}

/** Mid-grey bump canvas with seamless fine noise. */
function bumpCanvas(width: number, height: number, random: () => number, grain: number, octaves: [number, number][] = []) {
  const bump = canvas(width, height)
  bump.ctx.fillStyle = '#808080'
  bump.ctx.fillRect(0, 0, width, height)
  mottle(bump.ctx, width, height, random, octaves, grain)
  return bump
}

export interface WallTextures { map: THREE.CanvasTexture; bump: THREE.CanvasTexture; /** Tile size, metres. */ tile: [number, number] }

/** A seamless tile of painted, limewashed or plastered wall, or grasscloth wallpaper. */
export function paintTextures(color: string, finish: WallFinish, key: string): WallTextures {
  const random = seededRandom(`wall-paint:${key}`)
  const metres = finish === 'limewash' ? 2 : finish === 'plaster' ? 1.5 : finish === 'grasscloth' ? 0.91 : 1
  const size = finish === 'limewash' || finish === 'plaster' ? 768 : 512
  const { element, ctx } = canvas(size, size)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, size, size)
  let bump: ReturnType<typeof canvas>
  switch (finish) {
    case 'flat':
      mottle(ctx, size, size, random, [[4, 0.012], [16, 0.006]], 0.012)
      // Roller stipple, the orange-peel texture of emulsion paint.
      bump = bumpCanvas(size, size, random, 0.5)
      break
    case 'limewash': {
      mottle(ctx, size, size, random, [[3, 0.05], [8, 0.035], [24, 0.015]], 0.012)
      bump = bumpCanvas(size, size, random, 0.15)
      // Criss-cross brush strokes, lighter and darker, as limewash dries unevenly.
      for (let stroke = 0; stroke < 320; stroke++) {
        const x = random() * size, y = random() * size, length = between(random, 45, 165), angle = (random() < 0.5 ? 1 : -1) * between(random, 0.5, 1.1)
        const bend = between(random, -30, 30), widthPx = between(random, 10, 34), light = random() < 0.55
        ctx.strokeStyle = light ? shade(color, 0.35) : shade(color, -0.12)
        ctx.globalAlpha = between(random, 0.02, 0.05)
        ctx.lineWidth = widthPx
        ctx.lineCap = 'round'
        bump.ctx.strokeStyle = light ? '#8a8a8a' : '#777777'
        bump.ctx.globalAlpha = 0.25
        bump.ctx.lineWidth = widthPx * 0.4
        wrapped(size, size, (dx, dy) => {
          const ex = x + dx + Math.cos(angle) * length, ey = y + dy + Math.sin(angle) * length
          for (const target of [ctx, bump.ctx]) {
            target.beginPath()
            target.moveTo(x + dx, y + dy)
            target.quadraticCurveTo((x + dx + ex) / 2 + bend, (y + dy + ey) / 2 - bend, ex, ey)
            target.stroke()
          }
        }, x, y, length + 40)
      }
      ctx.globalAlpha = bump.ctx.globalAlpha = 1
      break
    }
    case 'plaster': {
      mottle(ctx, size, size, random, [[4, 0.03], [12, 0.018]], 0.008)
      bump = bumpCanvas(size, size, random, 0.1)
      // Overlapping trowel swipes with a burnished edge.
      for (let swipe = 0; swipe < 170; swipe++) {
        const x = random() * size, y = random() * size, rx = between(random, 40, 130), ry = between(random, 12, 40), angle = random() * Math.PI
        const light = random() < 0.5
        wrapped(size, size, (dx, dy) => {
          ctx.globalAlpha = between(random, 0.03, 0.06)
          ctx.fillStyle = light ? shade(color, 0.25) : shade(color, -0.08)
          ctx.beginPath()
          ctx.ellipse(x + dx, y + dy, rx, ry, angle, 0, TAU)
          ctx.fill()
          ctx.globalAlpha = 0.1
          ctx.strokeStyle = shade(color, 0.4)
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.ellipse(x + dx, y + dy, rx, ry, angle, -0.4, 1.4)
          ctx.stroke()
          bump.ctx.globalAlpha = 0.35
          bump.ctx.strokeStyle = '#9a9a9a'
          bump.ctx.lineWidth = 2
          bump.ctx.beginPath()
          bump.ctx.ellipse(x + dx, y + dy, rx, ry, angle, -0.4, 1.4)
          bump.ctx.stroke()
        }, x, y, rx)
      }
      ctx.globalAlpha = bump.ctx.globalAlpha = 1
      break
    }
    case 'grasscloth': {
      bump = bumpCanvas(size, size, random, 0.1)
      // Horizontal fibres of varying tone and thickness, one paper-backed strip per tile.
      for (let y = 0; y < size; y += between(random, 1, 3)) {
        const thickness = between(random, 1, 3.2)
        let x = 0
        while (x < size) {
          const length = between(random, 30, 260), tone = between(random, -0.12, 0.12)
          ctx.globalAlpha = between(random, 0.35, 0.75)
          ctx.fillStyle = shade(color, tone)
          ctx.fillRect(x, y, Math.min(length, size - x), thickness)
          bump.ctx.globalAlpha = 0.6
          bump.ctx.fillStyle = tone > 0 ? '#a0a0a0' : '#666666'
          bump.ctx.fillRect(x, y, Math.min(length, size - x), thickness * 0.6)
          x += length
        }
      }
      ctx.globalAlpha = 1
      // The seam between strips, slightly shaded.
      ctx.fillStyle = 'rgba(40, 32, 24, 0.22)'
      ctx.fillRect(0, 0, 2, size)
      bump.ctx.globalAlpha = 1
      bump.ctx.fillStyle = '#404040'
      bump.ctx.fillRect(0, 0, 2, size)
      mottle(ctx, size, size, random, [[3, 0.03]], 0)
      break
    }
  }
  return { map: texture(element, true), bump: texture(bump.element, false), tile: [metres, metres] }
}

export interface LowerTextures extends WallTextures {
  /** Height of the plane carrying the texture, including scallops above the lower wall. */
  planeHeight: number
  /** Scalloped edges are cut out with alpha. */
  cutout: boolean
}

/** The lower wall, drawn in full height and repeating along the wall. */
export function lowerWallTextures(lower: LowerWall, skirting: number, key: string): LowerTextures {
  const random = seededRandom(`wall-lower:${key}`)
  const scallop = lower.kind === 'two-tone' && lower.edge === 'scallop' ? 0.5 / SCALLOPS_PER_METRE : 0
  const planeHeight = lower.height + scallop
  const tileWidth = lower.kind === 'panelled' ? 0.75 : lower.kind === 'beadboard' ? 0.6 : lower.kind === 'tiles' ? lower.tile!.width * 4 : 1
  const perMetre = lower.kind === 'tiles' ? 640 : 420
  const width = Math.round(tileWidth * perMetre), height = Math.round(planeHeight * perMetre)
  const px = (metres: number) => metres * perMetre
  const { element, ctx } = canvas(width, height)
  const bump = canvas(width, height)
  bump.ctx.fillStyle = '#808080'
  bump.ctx.fillRect(0, 0, width, height)
  const color = lower.color
  switch (lower.kind) {
    case 'none':
    case 'two-tone': {
      ctx.fillStyle = color
      ctx.fillRect(0, px(scallop), width, height)
      if (scallop) {
        // Semicircles above the painted line; everything else in that band is cut away.
        const pitch = width / Math.round(tileWidth * SCALLOPS_PER_METRE), radius = px(scallop)
        for (let x = pitch / 2; x < width; x += pitch) { ctx.beginPath(); ctx.arc(x, radius, radius, Math.PI, TAU); ctx.fill() }
      }
      mottle(ctx, width, height, random, [[3, 0.012], [12, 0.006]], 0.012)
      mottle(bump.ctx, width, height, random, [], 0.5)
      break
    }
    case 'panelled': {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, width, height)
      mottle(ctx, width, height, random, [[3, 0.01]], 0.01)
      // A raised moulding frames each bay; light falls from above.
      const left = px(0.075), right = width - px(0.075), top = px(0.1), bottom = height - px(skirting + 0.07), profile = px(0.022)
      const frame = (target: CanvasRenderingContext2D, light: string, dark: string, mid: string) => {
        target.lineWidth = profile
        target.strokeStyle = mid
        target.strokeRect(left, top, right - left, bottom - top)
        target.lineWidth = profile * 0.3
        target.strokeStyle = light
        target.beginPath(); target.moveTo(left - profile / 2, bottom + profile / 2); target.lineTo(left - profile / 2, top - profile / 2); target.lineTo(right + profile / 2, top - profile / 2); target.stroke()
        target.beginPath(); target.moveTo(left + profile / 2, bottom - profile / 2); target.lineTo(right - profile / 2, bottom - profile / 2); target.lineTo(right - profile / 2, top + profile / 2); target.stroke()
        target.strokeStyle = dark
        target.beginPath(); target.moveTo(left + profile / 2, bottom - profile / 2); target.lineTo(left + profile / 2, top + profile / 2); target.lineTo(right - profile / 2, top + profile / 2); target.stroke()
        target.beginPath(); target.moveTo(left - profile / 2, bottom + profile / 2); target.lineTo(right + profile / 2, bottom + profile / 2); target.lineTo(right + profile / 2, top - profile / 2); target.stroke()
      }
      frame(ctx, shade(color, 0.3), shade(color, -0.22), shade(color, 0.06))
      bump.ctx.filter = 'blur(1.5px)'
      frame(bump.ctx, '#c8c8c8', '#a0a0a0', '#d8d8d8')
      bump.ctx.filter = 'none'
      break
    }
    case 'beadboard': {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, width, height)
      mottle(ctx, width, height, random, [[3, 0.01]], 0.01)
      const boards = Math.round(tileWidth / 0.1), pitch = width / boards
      for (let board = 0; board < boards; board++) {
        const x = board * pitch
        ctx.fillStyle = shade(color, -0.3)
        ctx.fillRect(x, 0, 2, height)
        // The bead beside each groove catches the light.
        ctx.fillStyle = shade(color, 0.25)
        ctx.fillRect(x + 2, 0, 2, height)
        ctx.fillStyle = shade(color, -0.1)
        ctx.fillRect(x + 5, 0, 1, height)
        bump.ctx.fillStyle = '#202020'
        bump.ctx.fillRect(x, 0, 2, height)
        bump.ctx.fillStyle = '#b0b0b0'
        bump.ctx.fillRect(x + 2, 0, 3, height)
      }
      break
    }
    case 'tiles': {
      const tile = lower.tile!, tileW = px(tile.width), tileH = px(tile.height), grout = Math.max(2, px(0.0025))
      ctx.fillStyle = tile.grout
      ctx.fillRect(0, 0, width, height)
      bump.ctx.fillStyle = '#303030'
      bump.ctx.fillRect(0, 0, width, height)
      const zellige = tile.bond === 'stack'
      const rows = Math.round(height / tileH)
      for (let row = 0; row < rows; row++) {
        // Rows count up from the floor, so the top course is whole.
        const y = height - (row + 1) * tileH
        const offset = tile.bond === 'running' && row % 2 ? tileW / 2 : 0
        for (let x = -offset; x < width; x += tileW) {
          const tone = between(random, zellige ? -0.07 : -0.04, zellige ? 0.05 : 0.04)
          wrapped(width, 0, dx => {
            const left = x + dx + grout / 2, top = y + grout / 2, w = tileW - grout, h = tileH - grout
            if (left > width || left + w < 0) return
            ctx.fillStyle = shade(lower.color, tone)
            ctx.beginPath(); ctx.roundRect(left, top, w, h, grout); ctx.fill()
            // Glaze pools towards the edges and catches a soft highlight.
            const gloss = ctx.createRadialGradient(left + w * 0.35, top + h * 0.3, 0, left + w / 2, top + h / 2, Math.max(w, h) * 0.75)
            gloss.addColorStop(0, `rgba(255, 255, 255, ${zellige ? 0.16 : 0.1})`)
            gloss.addColorStop(1, 'rgba(0, 0, 0, 0.06)')
            ctx.fillStyle = gloss
            ctx.fill()
            bump.ctx.fillStyle = '#9a9a9a'
            bump.ctx.beginPath(); bump.ctx.roundRect(left, top, w, h, grout * 1.5); bump.ctx.fill()
          })
        }
      }
      if (zellige) mottle(bump.ctx, width, height, random, [[6, 0.15]], 0.05)
      bump.ctx.filter = 'blur(1px)'
      bump.ctx.drawImage(bump.element, 0, 0)
      bump.ctx.filter = 'none'
      break
    }
  }
  return {
    map: texture(element, true, THREE.ClampToEdgeWrapping), bump: texture(bump.element, false, THREE.ClampToEdgeWrapping),
    tile: [tileWidth, planeHeight], planeHeight, cutout: scallop > 0,
  }
}

/** Woven curtain fabric, or a sheer voile when `sheer`. Tile size is in metres. */
export function fabricTextures(style: CurtainStyle, key: string, sheer = false): WallTextures {
  const random = seededRandom(`curtain:${key}:${sheer ? 'sheer' : 'main'}`)
  const fabric = sheer ? 'linen' : style.fabric
  const metres = fabric === 'check' ? 0.12 : fabric === 'stripe' ? 0.24 : 0.3
  const size = fabric === 'check' ? 192 : 384
  const ground = sheer ? '#f4f2ec' : style.color
  const { element, ctx } = canvas(size, size)
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, size, size)
  if (fabric === 'stripe') {
    // A wide band with two pinstripes, repeating across the panel.
    ctx.fillStyle = style.accent
    ctx.fillRect(size * 0.12, 0, size * 0.22, size)
    ctx.fillRect(size * 0.48, 0, size * 0.025, size)
    ctx.fillRect(size * 0.58, 0, size * 0.025, size)
  } else if (fabric === 'check') {
    // Gingham: translucent warp and weft bands darken where they cross.
    ctx.globalAlpha = 0.5
    ctx.fillStyle = style.accent
    ctx.fillRect(0, 0, size / 2, size)
    ctx.fillRect(0, 0, size, size / 2)
    ctx.globalAlpha = 1
  }
  const bump = bumpCanvas(size, size, random, 0.2)
  if (fabric !== 'velvet') {
    // Plain weave: alternating warp and weft threads, with occasional thicker slubs.
    const image = ctx.getImageData(0, 0, size, size), data = image.data
    const bumpImage = bump.ctx.getImageData(0, 0, size, size), relief = bumpImage.data
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4, over = (x + y) % 2 === 0
      const factor = over ? 1.035 : 0.965
      data[index] *= factor; data[index + 1] *= factor; data[index + 2] *= factor
      relief[index] = relief[index + 1] = relief[index + 2] = relief[index] + (over ? 30 : -30)
    }
    ctx.putImageData(image, 0, 0)
    bump.ctx.putImageData(bumpImage, 0, 0)
    for (let slub = 0; slub < (sheer ? 60 : 140); slub++) {
      const x = random() * size, y = Math.floor(random() * size), length = between(random, 8, 40), light = random() < 0.5
      ctx.globalAlpha = between(random, 0.12, 0.25)
      ctx.fillStyle = light ? shade(ground, 0.3) : shade(ground, -0.18)
      bump.ctx.globalAlpha = 0.5
      bump.ctx.fillStyle = '#c0c0c0'
      wrapped(size, size, (dx, dy) => {
        ctx.fillRect(x + dx, y + dy, length, between(random, 1, 2))
        bump.ctx.fillRect(x + dx, y + dy, length, 1.5)
      }, x, y, length)
    }
    ctx.globalAlpha = bump.ctx.globalAlpha = 1
    mottle(ctx, size, size, random, [[3, 0.025]], 0.02)
  } else {
    // Crushed velvet: soft patches where the pile lies in different directions.
    mottle(ctx, size, size, random, [[3, 0.06], [9, 0.035]], 0.015)
  }
  return { map: texture(element, true), bump: texture(bump.element, false), tile: [metres, metres] }
}
