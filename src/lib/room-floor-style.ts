import { seededRandom, type FurnishingDensity, type ResolvedTheme } from './preview-furnishing-variation'

/**
 * The realistic preview's floor: a parquet pattern and a rug, chosen from the
 * room's style and the Auto furnish seed. Seed 0 in a living room is the
 * stable default used whenever Auto furnish is off. All lengths are metres.
 */
export type ParquetPattern = 'plank' | 'wide-plank' | 'herringbone' | 'basket'
export type RugPattern = 'border' | 'stripes' | 'kilim' | 'plain' | 'grid' | 'rings' | 'jute'

export interface WoodTone {
  id: string
  /** Mid tone, sRGB 0–255. */
  base: [number, number, number]
  /** How much individual boards differ from each other, 0–1. */
  spread: number
}

export interface ParquetStyle {
  pattern: ParquetPattern
  wood: WoodTone
  /** Board width and, for planks, the range of board lengths. */
  boardWidth: number
  boardLength: [number, number]
  /** Herringbone length/width ratio, basket slats per block. */
  ratio: number
  /** Board direction across the room, radians. Herringbone runs at 45°. */
  angle: number
  /** Lacquered floors are smoother than oiled ones. */
  roughness: number
}

export interface RugStyle {
  pattern: RugPattern
  shape: 'rect' | 'round'
  field: string
  accent: string
  detail: string
  /** Pile height, which is also the rug's thickness. */
  pile: number
  fringe: boolean
}

export interface RoomFloorStyle { key: string; parquet: ParquetStyle; rug: RugStyle }

export interface RoomStyleInput {
  seed: number
  theme: ResolvedTheme
  /** How much art hangs on the wall; the floor ignores it. */
  density?: FurnishingDensity
  /** Auto furnish is on, so the room adds its style's own piece of furniture. */
  furnished?: boolean
}
export const DEFAULT_ROOM_STYLE: RoomStyleInput = { seed: 0, theme: 'living', density: 'balanced' }

const WOODS: Record<string, WoodTone> = {
  oak: { id: 'oak', base: [176, 142, 103], spread: 0.55 },
  honey: { id: 'honey', base: [186, 136, 82], spread: 0.6 },
  ash: { id: 'ash', base: [204, 184, 152], spread: 0.4 },
  whitewash: { id: 'whitewash', base: [212, 199, 178], spread: 0.35 },
  smoked: { id: 'smoked', base: [124, 92, 64], spread: 0.65 },
  walnut: { id: 'walnut', base: [112, 78, 54], spread: 0.75 },
}

type Weighted<T> = [T, number][]
interface ThemeChoices {
  woods: Weighted<keyof typeof WOODS>
  patterns: Weighted<ParquetPattern>
  rugs: Weighted<RugPattern>
  /** Field, accent and detail colours. */
  palettes: [string, string, string][]
}

const THEMES: Record<ResolvedTheme, ThemeChoices> = {
  living: {
    woods: [['oak', 3], ['honey', 2], ['smoked', 2], ['walnut', 1], ['whitewash', 1]],
    patterns: [['plank', 3], ['herringbone', 3], ['wide-plank', 2], ['basket', 1]],
    rugs: [['border', 3], ['kilim', 2], ['stripes', 2], ['plain', 2]],
    palettes: [['#ded5c2', '#a99a80', '#efe9dc'], ['#c9b9a0', '#7d5a45', '#e8dcc6'], ['#b9b8ad', '#5f6a63', '#dcd9cf'], ['#d8c6ab', '#9c4f37', '#2f3a40'], ['#e3dccd', '#6f7c84', '#b18f6a']],
  },
  office: {
    woods: [['oak', 3], ['ash', 2], ['smoked', 2], ['walnut', 2]],
    patterns: [['plank', 3], ['wide-plank', 2], ['herringbone', 2]],
    rugs: [['plain', 3], ['grid', 2], ['border', 2], ['stripes', 1]],
    palettes: [['#9fa19c', '#6c706c', '#c5c6c0'], ['#a8a294', '#555a55', '#cfc9bb'], ['#7f8b8f', '#4f5a60', '#b3bcbd'], ['#c2b8a6', '#7b6f5f', '#e1d9c8']],
  },
  kids: {
    woods: [['ash', 3], ['whitewash', 2], ['oak', 2], ['honey', 1]],
    patterns: [['plank', 3], ['wide-plank', 2], ['basket', 1]],
    rugs: [['rings', 3], ['grid', 2], ['stripes', 2]],
    palettes: [['#e9dfc9', '#d98b5f', '#7fa8a3'], ['#e4e6dc', '#e2b44f', '#6f93b8'], ['#efe1d8', '#c97d86', '#8daf8a'], ['#dfe6e2', '#5e9a9a', '#f0c27a']],
  },
  kitchen: {
    woods: [['oak', 3], ['whitewash', 2], ['ash', 2], ['smoked', 1]],
    patterns: [['herringbone', 3], ['plank', 2], ['basket', 2]],
    rugs: [['jute', 3], ['stripes', 2], ['kilim', 1]],
    palettes: [['#c9ad80', '#8f7450', '#e1cfae'], ['#d8cdb8', '#3f5866', '#efe7d8'], ['#cdb38c', '#7a4a36', '#e9dcc4']],
  },
}

function pick<T>(options: Weighted<T>, fraction: number): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  let threshold = fraction * total
  for (const [value, weight] of options) {
    if (threshold < weight) return value
    threshold -= weight
  }
  return options.at(-1)![0]
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min)

function parquetFor(pattern: ParquetPattern, wood: WoodTone, random: () => number): ParquetStyle {
  const lacquered = random() < 0.35
  const finish = { roughness: lacquered ? 0.52 : between(random, 0.64, 0.76) }
  // Boards run along the room's width or depth; herringbone always runs diagonally.
  const angle = pattern === 'herringbone' ? Math.PI / 4 : random() < 0.7 ? 0 : Math.PI / 2
  switch (pattern) {
    case 'wide-plank': return { pattern, wood, boardWidth: between(random, 0.24, 0.3), boardLength: [1.6, 2.6], ratio: 0, angle, ...finish }
    case 'herringbone': return { pattern, wood, boardWidth: between(random, 0.07, 0.1), boardLength: [0, 0], ratio: 5 + Math.floor(random() * 3), angle, ...finish }
    case 'basket': return { pattern, wood, boardWidth: between(random, 0.06, 0.075), boardLength: [0, 0], ratio: 4 + Math.floor(random() * 2), angle, ...finish }
    default: return { pattern, wood, boardWidth: between(random, 0.16, 0.2), boardLength: [0.6, 1.6], ratio: 0, angle, ...finish }
  }
}

export function roomFloorStyle({ seed, theme }: RoomStyleInput = DEFAULT_ROOM_STYLE): RoomFloorStyle {
  const key = `${theme}:${seed}`
  if (seed === 0 && theme === 'living') {
    // The default room: natural oak planks with a soft, bordered wool rug.
    return {
      key,
      parquet: { pattern: 'plank', wood: WOODS.oak, boardWidth: 0.19, boardLength: [0.7, 1.6], ratio: 0, angle: 0, roughness: 0.7 },
      rug: { pattern: 'border', shape: 'rect', field: '#ded5c2', accent: '#a99a80', detail: '#efe9dc', pile: 0.008, fringe: false },
    }
  }
  const random = seededRandom(`room-floor:${key}`)
  const choices = THEMES[theme]
  const wood = WOODS[pick(choices.woods, random())]
  const parquet = parquetFor(pick(choices.patterns, random()), wood, random)
  const pattern = pick(choices.rugs, random())
  const [field, accent, detail] = choices.palettes[Math.floor(random() * choices.palettes.length)]
  const flat = pattern === 'kilim' || pattern === 'stripes' || pattern === 'jute'
  const rug: RugStyle = {
    pattern, field, accent, detail,
    shape: pattern === 'rings' ? 'round' : 'rect',
    pile: flat ? 0.005 : pattern === 'plain' ? 0.009 : 0.007,
    fringe: (pattern === 'kilim' || pattern === 'stripes') && random() < 0.75,
  }
  return { key, parquet, rug }
}

/** Real rugs come in whole decimetres; snapping also limits texture rebuilds while editing. */
export function rugSize(style: RugStyle, extentX: number, extentZ: number): [number, number] {
  const snap = (value: number) => Math.ceil(value * 10 - 1e-6) / 10
  const width = Math.max(2.5, extentX + 1.3), depth = Math.max(1.8, extentZ + 1.3)
  if (style.shape === 'round') {
    const diameter = snap(Math.min(Math.max(width, depth), Math.max(2.2, (width + depth) / 2)))
    return [diameter, diameter]
  }
  return [snap(width), snap(depth)]
}

/** Auto furnish chooses the room's floor and wall art; without it the default room stays. */
export function roomStyleFor(furnishing: { enabled: boolean; seed: number; density?: FurnishingDensity }, theme: ResolvedTheme | undefined): RoomStyleInput {
  return furnishing.enabled ? { seed: furnishing.seed, theme: theme ?? 'living', density: furnishing.density ?? 'balanced', furnished: true } : DEFAULT_ROOM_STYLE
}
