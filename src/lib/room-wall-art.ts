import { furnishingSize, type FurnishingPlacement } from './preview-furnishings'
import { seededRandom, type FurnishingDensity, type ResolvedTheme } from './preview-furnishing-variation'

/**
 * Framed art on the realistic preview's back wall, planned from the room's
 * style, the Auto furnish density and seed. Groups hang in strategic zones
 * (above the creation, over the lounge chair, on the free walls) and keep
 * clear of everything standing in front of the wall. Lengths are metres;
 * heights are measured from the floor.
 */
export type ArtStyle =
  | 'arches' | 'horizon' | 'colour-field'
  | 'bauhaus-tiles' | 'bauhaus-poster'
  | 'plotter-flow' | 'plotter-moire' | 'plotter-grid' | 'plotter-hatch' | 'plotter-harmonograph'
export type ArtFamily = 'minimal' | 'bauhaus' | 'plotter'
export type FrameKind = 'classic' | 'black' | 'white' | 'oak' | 'walnut' | 'canvas'
export type GroupLayout = 'single' | 'pair' | 'stack' | 'row' | 'grid' | 'salon'
export type WallZoneId = 'creation' | 'chair' | 'right' | 'left'

export interface ArtSpec {
  /** Stable identity of the drawing; a texture is rebuilt only when it changes. */
  key: string
  style: ArtStyle
  paper: string
  /** Pigments in order of prominence. Plotter prints use one or two inks. */
  colors: string[]
  /** Sub-seed for the drawing's own choices. 0 is the original arches print. */
  seed: number
  /** Passe-partout width as a fraction of the shorter side; 0 is none. */
  mat: number
}

export interface ArtFrame { kind: FrameKind; color: string; /** Face width. */ profile: number; depth: number }

export interface ArtPiece {
  id: string
  /** Centre of the outer frame, along the wall and above the floor. */
  x: number
  y: number
  width: number
  height: number
  frame: ArtFrame
  art: ArtSpec
}

export interface WallArtGroup { zone: WallZoneId; layout: GroupLayout; pieces: ArtPiece[] }
export interface WallArtPlan { key: string; groups: WallArtGroup[] }

/** Anything standing in front of the wall, as an interval along it and its top. */
export interface WallObstacle { minX: number; maxX: number; top: number }

export interface WallArtInput {
  seed: number
  theme: ResolvedTheme
  density: FurnishingDensity
  /** Usable wall between the side walls, and the ceiling height. */
  wall: { left: number; right: number; height: number }
  creation: { minX: number; maxX: number }
  chairX: number
  plantX: number
  obstacles: readonly WallObstacle[]
}

/** Gallery hanging height for the centre of a group. */
export const EYE_HEIGHT = 1.55
/** Space between furniture and the bottom of the art above it. */
export const FURNITURE_CLEARANCE = 0.2
export const CEILING_CLEARANCE = 0.22
/** Space kept between separate groups. */
export const GROUP_GAP = 0.3
/** Art is not hung higher than this above furniture; it would float near the ceiling. */
const MAX_BOTTOM = 2.05
const MIN_SCALE = 0.6

const FRAMES: Record<FrameKind, ArtFrame> = {
  classic: { kind: 'classic', color: '#66543f', profile: 0.022, depth: 0.045 },
  black: { kind: 'black', color: '#262624', profile: 0.018, depth: 0.03 },
  white: { kind: 'white', color: '#ece9e2', profile: 0.02, depth: 0.03 },
  oak: { kind: 'oak', color: '#b48a5e', profile: 0.024, depth: 0.035 },
  walnut: { kind: 'walnut', color: '#5e4330', profile: 0.022, depth: 0.035 },
  canvas: { kind: 'canvas', color: '#e9e4da', profile: 0, depth: 0.035 },
}

type Weighted<T> = [T, number][]

function pick<T>(options: Weighted<T>, random: () => number): T {
  const usable = options.filter(([, weight]) => weight > 0)
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0)
  let threshold = random() * total
  for (const [value, weight] of usable) {
    if (threshold < weight) return value
    threshold -= weight
  }
  return usable.at(-1)![0]
}

export const ART_FAMILY: Record<ArtStyle, ArtFamily> = {
  arches: 'minimal', horizon: 'minimal', 'colour-field': 'minimal',
  'bauhaus-tiles': 'bauhaus', 'bauhaus-poster': 'bauhaus',
  'plotter-flow': 'plotter', 'plotter-moire': 'plotter', 'plotter-grid': 'plotter', 'plotter-hatch': 'plotter', 'plotter-harmonograph': 'plotter',
}

const STYLES: Record<ResolvedTheme, Weighted<ArtStyle>> = {
  living: [['arches', 3], ['horizon', 2], ['colour-field', 2], ['bauhaus-poster', 1], ['bauhaus-tiles', 1], ['plotter-flow', 1], ['plotter-moire', 1], ['plotter-grid', 1], ['plotter-hatch', 1], ['plotter-harmonograph', 1]],
  office: [['colour-field', 2], ['arches', 1], ['bauhaus-poster', 2], ['plotter-grid', 2], ['plotter-flow', 2], ['plotter-moire', 1], ['plotter-hatch', 2], ['plotter-harmonograph', 2]],
  kids: [['bauhaus-tiles', 3], ['horizon', 2], ['arches', 2], ['bauhaus-poster', 1], ['plotter-hatch', 1], ['plotter-harmonograph', 1]],
  kitchen: [['horizon', 2], ['arches', 2], ['bauhaus-tiles', 2], ['colour-field', 1], ['bauhaus-poster', 1], ['plotter-hatch', 1]],
}

type Palette = [paper: string, colors: string[]]
const EARTH: Palette[] = [
  ['#eee9df', ['#a86647', '#b6ac8e', '#494c42']],
  ['#efe8dc', ['#c08a4d', '#7d8b74', '#3e403a']],
  ['#ebe6dd', ['#b65f4a', '#d8b98a', '#2f3b45']],
  ['#f0ebe3', ['#8a9a8b', '#c9a27a', '#4a4540']],
  ['#ece7de', ['#6f7c84', '#d0a68b', '#3c3a36']],
]
const PALETTES: Record<ResolvedTheme, Record<Exclude<ArtFamily, 'plotter'>, Palette[]>> = {
  living: {
    minimal: EARTH,
    bauhaus: [['#ece4d2', ['#c2412d', '#e3b23c', '#2b4c7e', '#1f1f1d']], ['#efe9dc', ['#d0543c', '#2f5d8a', '#e8c15a', '#1f1f1d']], ['#e9e3d6', ['#1f1f1d', '#c2412d', '#cfc4ab', '#8a8578']]],
  },
  office: {
    minimal: [['#eceae5', ['#5f6b73', '#a7a196', '#2f3438']], ['#eeebe4', ['#c0583e', '#59656b', '#d6d0c4']], EARTH[4]],
    bauhaus: [['#e9e7e1', ['#1f1f1d', '#c2412d', '#9aa0a3', '#2b4c7e']], ['#ecebe6', ['#2f5d8a', '#1f1f1d', '#d9d5cb', '#c9a23f']]],
  },
  kids: {
    minimal: [['#f3ede2', ['#e07a5f', '#f2cc8f', '#3d405b']], ['#f1ece4', ['#6f93b8', '#f0c27a', '#e9967a']], ['#f2eee6', ['#81b29a', '#f2cc8f', '#e07a5f']]],
    bauhaus: [['#f3ede2', ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b']], ['#f1ece4', ['#6f93b8', '#f0c27a', '#e9967a', '#2f3e57']]],
  },
  kitchen: {
    minimal: [['#efe7d6', ['#c2683c', '#e0b04f', '#6e7a4c']], ['#f0e9dc', ['#b8452f', '#d9c39a', '#3d4a3a']], EARTH[1]],
    bauhaus: [['#efe7d6', ['#c2683c', '#e0b04f', '#6e7a4c', '#2b2a26']], ['#ece4d2', ['#c2412d', '#e3b23c', '#2b4c7e', '#1f1f1d']]],
  },
}
/** Pen plotter papers and inks; a second ink is an occasional accent. */
const PLOTTER_PAPERS = ['#f4f2ec', '#f1eee6', '#f5f3ef']
const PLOTTER_INKS: Weighted<string[]> = [[['#22252b'], 4], [['#2a3f8f'], 2], [['#22252b', '#c2412d'], 2], [['#5a3a2a'], 1], [['#2a3f8f', '#d08a2c'], 1]]

const FRAME_CHOICES: Record<ArtFamily, Weighted<FrameKind>> = {
  minimal: [['oak', 3], ['walnut', 2], ['black', 2], ['white', 1]],
  bauhaus: [['black', 3], ['white', 2], ['oak', 1]],
  plotter: [['black', 2], ['white', 2], ['oak', 2], ['walnut', 1]],
}

function artSpec(style: ArtStyle, theme: ResolvedTheme, random: () => number, palette: Palette | null, id: string): ArtSpec {
  const family = ART_FAMILY[style]
  const seed = 1 + Math.floor(random() * 0x7ffffffe)
  if (family === 'plotter') {
    const paper = PLOTTER_PAPERS[Math.floor(random() * PLOTTER_PAPERS.length)]
    return { key: `${id}:${style}:${seed}`, style, paper, colors: pick(PLOTTER_INKS, random), seed, mat: 0.12 + random() * 0.06 }
  }
  const [paper, colors] = palette ?? paletteFor(family, theme, random)
  // Bauhaus posters are often framed edge to edge; minimal prints usually have a mat.
  const mat = family === 'bauhaus' ? (random() < 0.3 ? 0.08 : 0) : style === 'colour-field' ? 0 : random() < 0.55 ? 0.1 + random() * 0.04 : 0
  return { key: `${id}:${style}:${seed}`, style, paper, colors, seed, mat }
}

function paletteFor(family: Exclude<ArtFamily, 'plotter'>, theme: ResolvedTheme, random: () => number) {
  const options = PALETTES[theme][family]
  return options[Math.floor(random() * options.length)]
}

function frameFor(spec: ArtSpec, random: () => number): ArtFrame {
  if (spec.style === 'colour-field' && random() < 0.6) return FRAMES.canvas
  return FRAMES[pick(FRAME_CHOICES[ART_FAMILY[spec.style]], random)]
}

/** Free walls hang their group towards the furniture, where the camera looks. */
interface Zone { id: WallZoneId; centre: number; minX: number; maxX: number; maxWidth: number; align: 'centre' | 'start' | 'end' }

/** Where a group could hang, most important first. */
function wallZones({ wall, creation, chairX, plantX }: WallArtInput, random: () => number, fixed: boolean): Zone[] {
  const margin = 0.3
  const creationWidth = creation.maxX - creation.minX
  const zones: Zone[] = [{
    id: 'creation', centre: (creation.minX + creation.maxX) / 2,
    minX: creation.minX - 0.3, maxX: creation.maxX + 0.3,
    // Art above furniture reads best at about two thirds of its width.
    maxWidth: Math.min(2.6, Math.max(0.6, creationWidth * 0.8)), align: 'centre',
  }, {
    // Over the lounge chair, keeping left of the floor lamp's shade.
    id: 'chair', centre: chairX - 0.1, minX: chairX - 0.6, maxX: chairX + 0.33, maxWidth: 0.9, align: 'centre',
  }]
  const rightStart = chairX + 1.2, rightEnd = wall.right - margin
  if (rightEnd - rightStart >= 0.5) zones.push({ id: 'right', centre: rightStart, minX: rightStart, maxX: rightEnd, maxWidth: Math.min(1.8, rightEnd - rightStart), align: 'start' })
  // The ficus stands well forward of the wall, so its leaves need a wider berth.
  const leftStart = wall.left + margin, leftEnd = plantX - 0.8
  if (leftEnd - leftStart >= 0.5) zones.push({ id: 'left', centre: leftEnd, minX: leftStart, maxX: leftEnd, maxWidth: Math.min(1.3, leftEnd - leftStart), align: 'end' })
  if (fixed) return zones
  // The creation keeps priority; the order of the others varies with the seed.
  const [first, ...rest] = zones
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [first, ...rest]
}

/** Piece rectangles relative to the group centre, before scaling. */
interface Slot { x: number; y: number; width: number; height: number }

function layoutSlots(layout: GroupLayout, zone: Zone, random: () => number): Slot[] {
  const choose = <T,>(options: T[]) => options[Math.floor(random() * options.length)]
  const grid = (cols: number, rows: number, [w, h]: [number, number], gap: number) => Array.from({ length: cols * rows }, (_, index) => ({
    x: ((index % cols) - (cols - 1) / 2) * (w + gap), y: ((rows - 1) / 2 - Math.floor(index / cols)) * (h + gap), width: w, height: h,
  }))
  switch (layout) {
    case 'single': {
      const sizes: [number, number][] = zone.id === 'creation' ? [[0.85, 1.05], [0.7, 0.9], [1.0, 0.7], [0.8, 0.8], [1.2, 0.8]]
        : zone.id === 'chair' ? [[0.6, 0.8], [0.7, 0.9], [0.5, 0.7]] : [[0.7, 1.0], [0.9, 0.7], [0.6, 0.8]]
      const [width, height] = choose(sizes)
      return [{ x: 0, y: 0, width, height }]
    }
    case 'pair': return grid(2, 1, choose([[0.5, 0.7], [0.45, 0.6], [0.5, 0.5]]), 0.08)
    case 'stack': return grid(1, 2, choose([[0.5, 0.4], [0.45, 0.35], [0.55, 0.42]]), 0.07)
    case 'row': return grid(3, 1, choose([[0.4, 0.5], [0.35, 0.45], [0.4, 0.4]]), 0.07)
    case 'grid': return zone.maxWidth >= 1.45 && random() < 0.4 ? grid(3, 2, [0.4, 0.4], 0.06) : grid(2, 2, choose([[0.4, 0.5], [0.35, 0.35], [0.42, 0.42]]), 0.06)
    case 'salon': {
      const side = random() < 0.5 ? 1 : -1, gap = 0.06
      const big = { width: 0.6, height: 0.8 }, small = [{ width: 0.36, height: 0.3 }, { width: 0.36, height: 0.44 }]
      const columnX = side * (big.width / 2 + gap + small[0].width / 2)
      const slots: Slot[] = [
        { x: 0, y: 0, ...big },
        { x: columnX, y: (small[1].height + gap) / 2, ...small[0] },
        { x: columnX, y: -(small[0].height + gap) / 2, ...small[1] },
      ]
      if (zone.maxWidth >= 1.6 && random() < 0.6) slots.push({ x: -side * (big.width / 2 + gap + 0.15), y: 0.12, width: 0.3, height: 0.3 })
      // Centre the cluster on its own extent.
      const min = Math.min(...slots.map(slot => slot.x - slot.width / 2)), max = Math.max(...slots.map(slot => slot.x + slot.width / 2))
      return slots.map(slot => ({ ...slot, x: slot.x - (min + max) / 2 }))
    }
  }
}

const LAYOUTS: Record<WallZoneId, Record<FurnishingDensity, Weighted<GroupLayout>>> = {
  creation: {
    minimal: [['single', 5], ['pair', 2], ['row', 1]],
    balanced: [['single', 3], ['pair', 2], ['row', 2], ['grid', 1], ['salon', 1]],
    'lived-in': [['single', 1], ['pair', 1], ['row', 2], ['grid', 2], ['salon', 3]],
  },
  chair: {
    minimal: [['single', 3], ['stack', 1]],
    balanced: [['single', 3], ['stack', 2]],
    'lived-in': [['single', 2], ['stack', 3]],
  },
  right: {
    minimal: [['single', 2], ['pair', 1]],
    balanced: [['single', 2], ['pair', 1], ['grid', 2], ['salon', 2]],
    'lived-in': [['grid', 3], ['salon', 3], ['row', 1], ['stack', 1]],
  },
  left: {
    minimal: [['single', 2], ['stack', 1]],
    balanced: [['single', 2], ['stack', 2], ['pair', 1]],
    'lived-in': [['stack', 2], ['grid', 2], ['pair', 1], ['salon', 1]],
  },
}

const GROUP_COUNT: Record<FurnishingDensity, number> = { minimal: 1, balanced: 2, 'lived-in': 3 }

interface Rect { minX: number; maxX: number; minY: number; maxY: number }

function extent(slots: readonly Slot[]) {
  return {
    minX: Math.min(...slots.map(slot => slot.x - slot.width / 2)), maxX: Math.max(...slots.map(slot => slot.x + slot.width / 2)),
    minY: Math.min(...slots.map(slot => slot.y - slot.height / 2)), maxY: Math.max(...slots.map(slot => slot.y + slot.height / 2)),
  }
}

/** Highest obstacle top under an interval of the wall, or null when the wall is clear down to the floor. */
export function obstacleTop(obstacles: readonly WallObstacle[], minX: number, maxX: number, margin = 0.03) {
  let top: number | null = null
  for (const item of obstacles) if (item.maxX > minX - margin && item.minX < maxX + margin) top = Math.max(top ?? 0, item.top)
  return top
}

/** Scales and places a group in its zone, or returns null when it cannot hang there. */
function fitGroup(slots: readonly Slot[], zone: Zone, input: WallArtInput, placed: readonly Rect[]) {
  const ceiling = input.wall.height - CEILING_CLEARANCE
  const own = extent(slots)
  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale -= 0.1) {
    const width = (own.maxX - own.minX) * scale, height = (own.maxY - own.minY) * scale
    if (width > zone.maxWidth + 1e-9 || width > zone.maxX - zone.minX + 1e-9) continue
    const preferred = zone.align === 'start' ? zone.minX : zone.align === 'end' ? zone.maxX - width : zone.centre - width / 2
    const minX = Math.min(Math.max(preferred, zone.minX), zone.maxX - width)
    const below = obstacleTop(input.obstacles, minX, minX + width)
    const bottom = below === null ? 0.6 : below + FURNITURE_CLEARANCE
    if (bottom > MAX_BOTTOM) return null
    const minY = Math.max(bottom, EYE_HEIGHT - height / 2)
    const rect = { minX, maxX: minX + width, minY, maxY: minY + height }
    if (rect.maxY > ceiling) continue
    if (placed.some(other => rect.minX < other.maxX + GROUP_GAP && rect.maxX > other.minX - GROUP_GAP)) return null
    return { rect, scale, offsetX: minX - own.minX * scale, offsetY: minY - own.minY * scale }
  }
  return null
}

const round = (value: number) => Math.round(value * 1e4) / 1e4

export function planWallArt(input: WallArtInput): WallArtPlan {
  const { seed, theme, density } = input
  const key = `${theme}:${density}:${seed}`
  const fixed = seed === 0
  const zones = wallZones(input, seededRandom(`wall-art:${key}:zones`), fixed)
  const groups: WallArtGroup[] = []
  const placed: Rect[] = []
  for (const zone of zones) {
    if (groups.length >= GROUP_COUNT[density]) break
    // Each group draws from its own stream, so one that cannot hang leaves the others unchanged.
    const random = seededRandom(`wall-art:${key}:${groups.length}`)
    const hero = fixed && theme === 'living' && groups.length === 0
    const layout = hero ? 'single' : pick(LAYOUTS[zone.id][density], random)
    const slots = hero ? [{ x: 0, y: 0, width: 0.85, height: 1.05 }] : layoutSlots(layout, zone, random)
    const fitted = fitGroup(slots, zone, input, placed)
    if (!fitted) continue
    const id = `${zone.id}-${groups.length}`
    const series = layout === 'pair' || layout === 'row' || layout === 'grid' || layout === 'stack'
    // A series shares style, palette and frame; a salon mixes styles within one palette.
    const groupStyle = pick(STYLES[theme], random)
    const groupFamily = ART_FAMILY[groupStyle]
    const palette = groupFamily === 'plotter' ? null : paletteFor(groupFamily, theme, random)
    let first: { frame: ArtFrame; mat: number } | null = null
    const pieces = slots.map((slot, index): ArtPiece => {
      const pieceId = `${id}-${index}`
      let art: ArtSpec, frame: ArtFrame
      if (hero) {
        // The default room keeps the original minimal arches print in its walnut frame.
        art = { key: `${pieceId}:arches:0`, style: 'arches', paper: EARTH[0][0], colors: EARTH[0][1], seed: 0, mat: 0 }
        frame = FRAMES.classic
      } else {
        const style = series || index === 0 ? groupStyle : pick(STYLES[theme], random)
        art = artSpec(style, theme, random, ART_FAMILY[style] === groupFamily ? palette : null, pieceId)
        frame = frameFor(art, random)
        if (first && series) {
          frame = first.frame
          art.mat = first.mat
        } else if (first && first.frame.kind !== 'canvas' && frame.kind !== 'canvas' && random() < 0.65) frame = first.frame
        first ??= { frame, mat: art.mat }
      }
      return {
        id: pieceId, art, frame,
        x: round(fitted.offsetX + slot.x * fitted.scale), y: round(fitted.offsetY + slot.y * fitted.scale),
        width: round(slot.width * fitted.scale), height: round(slot.height * fitted.scale),
      }
    })
    groups.push({ zone: zone.id, layout, pieces })
    placed.push(fitted.rect)
  }
  return { key, groups }
}

/**
 * Obstacles in front of the back wall: the creation's extent, the room's
 * reference furniture and every furnishing standing on the creation.
 * `bounds` and placements are world metres; tops are measured from `floorY`.
 */
export function wallObstacles({ bounds, floorY, chairX, plantX, furnishings = [] }: {
  bounds: { min: { x: number }; max: { x: number; y: number } }
  floorY: number; chairX: number; plantX: number
  furnishings?: readonly FurnishingPlacement[]
}): WallObstacle[] {
  const obstacles: WallObstacle[] = [
    { minX: bounds.min.x, maxX: bounds.max.x, top: bounds.max.y - floorY },
    { minX: chairX - 0.42, maxX: chairX + 0.42, top: 0.88 }, // lounge chair
    { minX: chairX + 0.37, maxX: chairX + 0.89, top: 1.66 }, // floor lamp
    { minX: chairX + 0.44, maxX: chairX + 0.92, top: 0.62 }, // side table
    { minX: plantX - 0.38, maxX: plantX + 0.38, top: 1.62 }, // ficus
  ]
  for (const item of furnishings) {
    const size = furnishingSize(item)
    if (!size) continue
    const half = Math.max(size[0], size[2]) / 2
    obstacles.push({ minX: item.position[0] - half, maxX: item.position[0] + half, top: item.position[1] - floorY + size[1] })
  }
  return obstacles
}
