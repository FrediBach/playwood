import { seededRandom, type ResolvedTheme } from './preview-furnishing-variation'
import { DEFAULT_ROOM_STYLE, type RoomStyleInput } from './room-floor-style'

/**
 * The realistic room's walls and curtains, chosen from the room's style and
 * the Auto furnish seed like the floor. Seed 0 in a living room is the default
 * used whenever Auto furnish is off. Lengths are metres, heights from the floor.
 */
export type WallFinish = 'flat' | 'limewash' | 'plaster' | 'grasscloth'
export type LowerWallKind = 'none' | 'two-tone' | 'panelled' | 'beadboard' | 'tiles'
export type CurtainFabric = 'linen' | 'velvet' | 'stripe' | 'check'
export type CurtainRod = 'black' | 'brass' | 'oak' | 'track'

export interface LowerWall {
  kind: LowerWallKind
  color: string
  /** Top of the lower wall; 0 when there is none. */
  height: number
  /** Kids' two-tone walls can end in painted scallops. */
  edge: 'straight' | 'scallop'
  /** A dado rail or tile cap along the top. */
  rail: boolean
  /** Tiles only: tile size, laying pattern and grout. */
  tile?: { width: number; height: number; bond: 'running' | 'stack'; grout: string }
}

export interface CurtainStyle {
  fabric: CurtainFabric
  color: string
  /** Stripe or check colour. */
  accent: string
  /** Flat width of each panel. */
  width: number
  /** Folds per metre and their depth. */
  folds: number
  depth: number
  /** A sheer panel across the window behind the curtains. */
  sheer: boolean
  rod: CurtainRod
}

export interface WallStyle {
  key: string
  paint: string
  finish: WallFinish
  lower: LowerWall
  /** Skirting and rail colour, and skirting height. */
  trim: string
  skirting: number
  curtain: CurtainStyle
}

/** Scallops per metre on a scalloped two-tone wall. */
export const SCALLOPS_PER_METRE = 4

/** Top of the lower wall including any scallops, or 0 when there is none. */
export function lowerWallTop(lower: LowerWall) {
  return lower.kind === 'none' ? 0 : lower.height + (lower.edge === 'scallop' ? 0.5 / SCALLOPS_PER_METRE : 0)
}

type Weighted<T> = [T, number][]

function pick<T>(options: Weighted<T>, random: () => number): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  let threshold = random() * total
  for (const [value, weight] of options) {
    if (threshold < weight) return value
    threshold -= weight
  }
  return options.at(-1)![0]
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min)
const WHITE_TRIM = '#eeebe3'

interface ThemeWalls {
  paints: Weighted<string>
  finishes: Weighted<WallFinish>
  lowers: Weighted<LowerWallKind>
  /** Lower wall colours: paint for two-tone and panelling, glaze for tiles. */
  lowerColors: string[]
  tileColors: string[]
  fabrics: Weighted<CurtainFabric>
  /** Plain fabric colours, and pattern accents on a light ground. */
  fabricColors: string[]
  accents: string[]
  sheer: number
  rods: Weighted<CurtainRod>
}

const THEMES: Record<ResolvedTheme, ThemeWalls> = {
  living: {
    paints: [['#e5e1d7', 3], ['#dcd5c8', 2], ['#cfd1c3', 2], ['#e0cfc2', 1], ['#d6d8d3', 1]],
    finishes: [['flat', 3], ['limewash', 3], ['plaster', 2], ['grasscloth', 1]],
    lowers: [['none', 4], ['panelled', 2], ['two-tone', 1]],
    lowerColors: ['#b9ae9c', '#8e9784', '#a77f69', '#d9d3c6'],
    tileColors: [],
    fabrics: [['linen', 5], ['velvet', 2], ['stripe', 1]],
    fabricColors: ['#e7dfd1', '#d8ccb8', '#b4704f', '#8a8c6a', '#b9b5ad', '#6e5a48'],
    accents: ['#8f7a62', '#5f6a63', '#a4553d'],
    sheer: 0.45,
    rods: [['black', 3], ['brass', 2], ['oak', 2], ['track', 2]],
  },
  office: {
    paints: [['#dfe0dc', 3], ['#d2d4cf', 2], ['#7d8a7d', 1], ['#6d7b88', 1], ['#e2ddd3', 2]],
    finishes: [['flat', 3], ['plaster', 2], ['grasscloth', 2], ['limewash', 1]],
    lowers: [['none', 3], ['panelled', 2], ['beadboard', 1]],
    lowerColors: ['#59665b', '#56626e', '#9c968b', '#d8d6cf'],
    tileColors: [],
    fabrics: [['linen', 4], ['velvet', 1], ['stripe', 2]],
    fabricColors: ['#c9c6bf', '#8d918f', '#e2ddd3', '#5f6669', '#a59a88'],
    accents: ['#3f4a5a', '#5a5f5c', '#2f3b45'],
    sheer: 0.5,
    rods: [['black', 3], ['track', 3], ['brass', 1]],
  },
  kids: {
    paints: [['#ece6da', 3], ['#ead6cc', 2], ['#d4e2d6', 2], ['#efe3c0', 1], ['#d3dfe6', 2]],
    finishes: [['flat', 4], ['limewash', 1]],
    lowers: [['two-tone', 4], ['beadboard', 1], ['none', 1]],
    lowerColors: ['#e3ae98', '#9fc2b4', '#e6c46f', '#a3bcd3', '#c9a4b8'],
    tileColors: [],
    fabrics: [['check', 3], ['stripe', 2], ['linen', 2]],
    fabricColors: ['#efe9dd', '#f0e6d2', '#e6d9cf'],
    accents: ['#d98b7a', '#7fa8a3', '#e2b44f', '#6f93b8'],
    sheer: 0.2,
    rods: [['oak', 3], ['black', 1], ['track', 1]],
  },
  kitchen: {
    paints: [['#ece6da', 3], ['#e1dccf', 2], ['#cfd3c2', 2], ['#e8dcc8', 2]],
    finishes: [['flat', 3], ['limewash', 2], ['plaster', 2]],
    lowers: [['tiles', 4], ['beadboard', 1], ['none', 1]],
    lowerColors: ['#b8b29f', '#8f9a83', '#d7d2c4'],
    tileColors: ['#efece4', '#9fb39a', '#c4805e', '#4f6b5a', '#8ea5b6', '#e7dcc4'],
    fabrics: [['check', 3], ['stripe', 2], ['linen', 3]],
    fabricColors: ['#ece5d6', '#e4dccb', '#d8ccb8'],
    accents: ['#b8452f', '#3f5866', '#6e7a4c', '#c08a4d'],
    sheer: 0.3,
    rods: [['brass', 2], ['black', 2], ['oak', 2]],
  },
}

const DEFAULT_WALL: Omit<WallStyle, 'key'> = {
  paint: '#e5e1d7', finish: 'flat', trim: '#eee9df', skirting: 0.11,
  lower: { kind: 'none', color: '#e5e1d7', height: 0, edge: 'straight', rail: false },
  curtain: { fabric: 'linen', color: '#e7dfd1', accent: '#e7dfd1', width: 0.58, folds: 10.3, depth: 0.035, sheer: false, rod: 'black' },
}

function lowerWall(kind: LowerWallKind, theme: ThemeWalls, random: () => number): LowerWall {
  const color = theme.lowerColors[Math.floor(random() * theme.lowerColors.length)]
  switch (kind) {
    case 'none': return { ...DEFAULT_WALL.lower }
    case 'two-tone': return { kind, color, height: between(random, 0.9, 1.25), edge: random() < 0.45 ? 'scallop' : 'straight', rail: false }
    case 'panelled': return { kind, color: random() < 0.4 ? WHITE_TRIM : color, height: between(random, 0.85, 1.0), edge: 'straight', rail: true }
    case 'beadboard': return { kind, color: random() < 0.5 ? WHITE_TRIM : color, height: between(random, 1.0, 1.2), edge: 'straight', rail: true }
    case 'tiles': {
      const square = random() < 0.4
      const tile = square ? { width: 0.1, height: 0.1, bond: 'stack' as const } : { width: 0.15, height: 0.075, bond: 'running' as const }
      // Whole rows only, so the top course is never cut.
      const rows = Math.round(between(random, 1.05, 1.3) / tile.height)
      return { kind, color: theme.tileColors[Math.floor(random() * theme.tileColors.length)], height: rows * tile.height, edge: 'straight', rail: true, tile: { ...tile, grout: random() < 0.7 ? '#d9d5cc' : '#9b968c' } }
    }
  }
}

export function roomWallStyle({ seed, theme }: RoomStyleInput = DEFAULT_ROOM_STYLE): WallStyle {
  const key = `${theme}:${seed}`
  if (seed === 0 && theme === 'living') return { key, ...DEFAULT_WALL, lower: { ...DEFAULT_WALL.lower }, curtain: { ...DEFAULT_WALL.curtain } }
  const random = seededRandom(`room-wall:${key}`)
  const choices = THEMES[theme]
  const paint = pick(choices.paints, random)
  const finish = pick(choices.finishes, random)
  const lower = lowerWall(pick(choices.lowers, random), choices, random)
  // Panelling and beadboard are painted as one with their rail; otherwise trim is white or the wall colour.
  const trim = lower.kind === 'panelled' || lower.kind === 'beadboard' ? lower.color : random() < 0.6 ? WHITE_TRIM : paint
  const fabric = pick(choices.fabrics, random)
  const patterned = fabric === 'stripe' || fabric === 'check'
  const color = choices.fabricColors[Math.floor(random() * choices.fabricColors.length)]
  const accent = choices.accents[Math.floor(random() * choices.accents.length)]
  const curtain: CurtainStyle = {
    fabric, color, accent: patterned ? accent : color,
    width: between(random, 0.5, 0.78),
    // Heavy velvet hangs in fewer, deeper folds than linen.
    folds: fabric === 'velvet' ? between(random, 5.5, 7) : between(random, 7.5, 11),
    depth: fabric === 'velvet' ? between(random, 0.045, 0.06) : between(random, 0.028, 0.042),
    sheer: random() < choices.sheer,
    rod: pick(choices.rods, random),
  }
  return { key, paint, finish, lower, trim, skirting: lower.kind === 'panelled' ? between(random, 0.14, 0.18) : between(random, 0.08, 0.13), curtain }
}
