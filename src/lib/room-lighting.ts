import { seededRandom, type ResolvedTheme } from './preview-furnishing-variation'
import { DEFAULT_ROOM_STYLE, type RoomStyleInput } from './room-floor-style'

/**
 * The realistic room's lighting, chosen from the room's style and the Auto
 * furnish seed like the floor and walls. Seed 0 in a living room is the default
 * daylight used whenever Auto furnish is off. Intensities are Three.js
 * physical units (directional/ambient in lux-like units, point lights in
 * candela); heights are metres from the floor.
 */
export type LightMood = 'daylight' | 'golden' | 'evening' | 'overcast' | 'bright' | 'sunny' | 'hazy'
/** Shown on the room card. */
export const LIGHT_MOOD_LABELS: Record<LightMood, string> = {
  daylight: 'The daylight room', golden: 'Golden hour', evening: 'Evening lamplight', overcast: 'Overcast day',
  bright: 'Bright midday', sunny: 'Sunny morning', hazy: 'Hazy morning light',
}
export type FloorLampBase = 'disc' | 'tripod' | 'block'
export type FloorLampShade = 'dome' | 'drum' | 'cone' | 'globe'
export type PendantKind = 'globe' | 'dome' | 'bell' | 'cone' | 'drum' | 'lantern' | 'bar'

export interface FloorLampStyle {
  base: FloorLampBase
  shade: FloorLampShade
  shadeColor: string
  /** Stem and base finish. */
  metal: string
  metalness: number
  /** Light colour; a coloured shade tints it. */
  glow: string
  /** Candela; 0 when the lamp is off. */
  intensity: number
}

export interface PendantStyle {
  kind: PendantKind
  /** Kitchen pendants can hang in a row over a counter. */
  count: number
  color: string
  cord: string
  metalness: number
  /** Shade radius, or half the length of a bar. */
  size: number
  glow: string
  /** Candela for the whole group; 0 when off. */
  intensity: number
}

export interface RoomLighting {
  key: string
  mood: LightMood
  /** Renderer tone-mapping exposure. */
  exposure: number
  ambient: { color: string; intensity: number }
  hemisphere: { sky: string; ground: string; intensity: number }
  /**
   * The shadow-casting key light. Daylight shines in through the window, aimed
   * through a point at `aim` metres up and `offset` metres along the window
   * from its centre; after dark it is the pendant's downlight instead.
   */
  sun: { source: 'window' | 'pendant'; color: string; intensity: number; aim: number; offset: number }
  /** The window pane's sky colour and the soft area light it spreads. */
  window: { sky: string; color: string; intensity: number }
  /** A shadowless bounce from the room's open side. */
  fill: { color: string; intensity: number }
  /** Ceiling self-illumination, standing in for bounced light. */
  ceiling: number
  /** Airborne haze: exponential fog density and the strength of visible sunbeams. */
  haze: { color: string; density: number; shafts: number }
  lamp: FloorLampStyle
  pendant: PendantStyle
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
const choose = <T>(items: readonly T[], random: () => number) => items[Math.floor(random() * items.length)]

/** Mixes two #rrggbb colours. */
export function mixColor(a: string, b: string, amount: number) {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
  return `#${[0, 1, 2].map(index => Math.round(channel(a, index) * (1 - amount) + channel(b, index) * amount).toString(16).padStart(2, '0')).join('')}`
}

interface MoodBase {
  exposure: number
  ambient: [string, number]
  hemisphere: [string, string, number]
  sun: { source: 'window' | 'pendant'; color: string; intensity: number; aim: [number, number] }
  window: [string, string, number]
  fill: [string, number]
  ceiling: number
  haze: [string, number, number]
  /** Floor lamp and pendant candela. */
  lamp: number
  pendant: number
  /** Warm incandescent or neutral LED lamps. */
  bulb: string
}

const MOODS: Record<LightMood, MoodBase> = {
  // Clear afternoon light from a high sun, as the room has always been lit.
  daylight: {
    exposure: 1, ambient: ['#fff5e4', 0.28], hemisphere: ['#edf3ff', '#b69c7a', 0.95],
    sun: { source: 'window', color: '#fff1d8', intensity: 3, aim: [1.95, 2.25] },
    window: ['#d9e5e8', '#f4f7ff', 3.2], fill: ['#fff7e9', 0.5], ceiling: 0.6,
    haze: ['#f3efe6', 0, 0.12], lamp: 0.7, pendant: 0.5, bulb: '#ffdcb2',
  },
  // Low, orange late-afternoon sun with long beams and a cool shadow fill.
  golden: {
    exposure: 1, ambient: ['#ffe2c2', 0.16], hemisphere: ['#ffd7ae', '#80634a', 0.5],
    sun: { source: 'window', color: '#ffad62', intensity: 4.2, aim: [1.05, 1.45] },
    window: ['#f6c78c', '#ffcb92', 1.6], fill: ['#9fb2d6', 0.16], ceiling: 0.24,
    haze: ['#e9c9a0', 0.012, 0.4], lamp: 1.3, pendant: 0.9, bulb: '#ffc88a',
  },
  // After sunset: a dark blue window, the lamps carry the room.
  evening: {
    exposure: 1.08, ambient: ['#3c4568', 0.07], hemisphere: ['#36416a', '#3b2a1e', 0.28],
    sun: { source: 'pendant', color: '#ffc584', intensity: 1.35, aim: [0, 0] },
    window: ['#25304b', '#4d5e8c', 0.75], fill: ['#ffb070', 0.08], ceiling: 0.05,
    haze: ['#2c2a30', 0.006, 0], lamp: 2.8, pendant: 2.6, bulb: '#ffbf7a',
  },
  // A grey, rainy day: soft cool light, weak shadows, lamps on for comfort.
  overcast: {
    exposure: 1.06, ambient: ['#e6ebef', 0.34], hemisphere: ['#dce4ea', '#958c80', 0.85],
    sun: { source: 'window', color: '#dfe6ed', intensity: 1.1, aim: [1.8, 2.2] },
    window: ['#bfc8ce', '#e4edf5', 3.3], fill: ['#e7ecf0', 0.38], ceiling: 0.42,
    haze: ['#d7dbdc', 0, 0], lamp: 1.5, pendant: 1.1, bulb: '#ffd6a6',
  },
  // High, neutral midday light and bright surfaces for working.
  bright: {
    exposure: 1.1, ambient: ['#f4f8ff', 0.42], hemisphere: ['#f1f6ff', '#c2b9a9', 1.15],
    sun: { source: 'window', color: '#fff8ee', intensity: 3.1, aim: [2.1, 2.35] },
    window: ['#e4f0fb', '#f7fbff', 4.4], fill: ['#f5f8ff', 0.6], ceiling: 0.85,
    haze: ['#f4f6f8', 0, 0.06], lamp: 0, pendant: 1.6, bulb: '#fff4e4',
  },
  // A clear, cheerful morning for a kids room; colour comes from tinted bounce.
  sunny: {
    exposure: 1.08, ambient: ['#fff7ea', 0.32], hemisphere: ['#e8f3ff', '#c4a886', 1],
    sun: { source: 'window', color: '#fff0d0', intensity: 3.3, aim: [1.65, 2.05] },
    window: ['#cfe6f7', '#f3f9ff', 3.4], fill: ['#fff4e6', 0.45], ceiling: 0.68,
    haze: ['#f6f1e8', 0, 0.18], lamp: 0.6, pendant: 0.7, bulb: '#ffe3bd',
  },
  // Thick, warm kitchen air: steam and dust catch the morning beams.
  hazy: {
    exposure: 1, ambient: ['#fff0dc', 0.22], hemisphere: ['#f2e5d0', '#9c7c5c', 0.7],
    sun: { source: 'window', color: '#ffdfa8', intensity: 3.5, aim: [1.35, 1.8] },
    window: ['#f4e2c2', '#fff0d6', 2.2], fill: ['#ffe8cc', 0.24], ceiling: 0.36,
    haze: ['#ecdcc2', 0.055, 0.6], lamp: 0.8, pendant: 1.3, bulb: '#ffd29a',
  },
}

interface ThemeLights {
  moods: Weighted<LightMood>
  lampBases: Weighted<FloorLampBase>
  lampShades: Weighted<FloorLampShade>
  shadeColors: string[]
  metals: [string, number][]
  pendants: Weighted<PendantKind>
  pendantColors: string[]
  /** Kids rooms tint the bounce light with these. */
  tints?: string[]
}

const BLACK: [string, number] = ['#2b2b29', 0.45]
const BRASS: [string, number] = ['#b08d57', 0.85]
const OAK: [string, number] = ['#8c6a48', 0]
const STEEL: [string, number] = ['#9ba1a4', 0.8]
const WHITE: [string, number] = ['#eeebe3', 0.1]

const THEMES: Record<ResolvedTheme, ThemeLights> = {
  living: {
    moods: [['golden', 3], ['evening', 3], ['overcast', 2], ['daylight', 2]],
    lampBases: [['disc', 3], ['tripod', 3], ['block', 1]],
    lampShades: [['dome', 2], ['drum', 3], ['cone', 2], ['globe', 1]],
    shadeColors: ['#ece4cf', '#d8c9ad', '#c9a07a', '#f1ede4', '#5c6b5e', '#a65f45'],
    metals: [['#43473e', 0.25], BRASS, BLACK, OAK],
    pendants: [['globe', 3], ['drum', 2], ['dome', 2], ['bell', 1]],
    pendantColors: ['#f2ede3', '#d9c7a8', '#3b3d38', '#b08d57', '#6b7a64'],
  },
  office: {
    moods: [['bright', 5], ['overcast', 2], ['daylight', 2], ['evening', 1]],
    lampBases: [['disc', 3], ['block', 2], ['tripod', 1]],
    lampShades: [['drum', 2], ['cone', 2], ['dome', 2]],
    shadeColors: ['#f1f0ec', '#2f3236', '#d9d9d4', '#6b7a86'],
    metals: [BLACK, STEEL, WHITE],
    pendants: [['bar', 4], ['dome', 2], ['cone', 2]],
    pendantColors: ['#2b2d2f', '#e9e9e5', '#5d6a72', '#9ba1a4'],
  },
  kids: {
    moods: [['sunny', 5], ['daylight', 2], ['golden', 1]],
    lampBases: [['disc', 2], ['tripod', 3]],
    lampShades: [['globe', 2], ['dome', 3], ['cone', 2]],
    shadeColors: ['#f2b8a8', '#a9d6c9', '#f3d27a', '#a8c4e5', '#d7b3d1'],
    metals: [WHITE, OAK, ['#e0a86b', 0.1]],
    pendants: [['lantern', 4], ['globe', 1], ['dome', 2]],
    pendantColors: ['#f2b8a8', '#a9d6c9', '#f3d27a', '#a8c4e5', '#d7b3d1', '#f4efe6'],
    tints: ['#ffb7c5', '#9fe3d1', '#ffe08a', '#a9cbff', '#d8b4ff'],
  },
  kitchen: {
    moods: [['hazy', 5], ['golden', 2], ['evening', 1]],
    lampBases: [['disc', 3], ['tripod', 1]],
    lampShades: [['dome', 3], ['drum', 1], ['cone', 2]],
    shadeColors: ['#efe8d8', '#3f5866', '#b8452f', '#e7dcc4'],
    metals: [BRASS, BLACK, OAK],
    pendants: [['dome', 3], ['bell', 3], ['globe', 2]],
    pendantColors: ['#3f5866', '#2b2b29', '#b08d57', '#efece4', '#6e7a4c', '#b8452f'],
  },
}

const DEFAULT_LAMP: FloorLampStyle = { base: 'disc', shade: 'dome', shadeColor: '#ece4cf', metal: '#43473e', metalness: 0.25, glow: '#ffdcb2', intensity: 0.7 }
const DEFAULT_PENDANT: PendantStyle = { kind: 'globe', count: 1, color: '#f2ede3', cord: '#2b2b29', metalness: 0, size: 0.16, glow: '#ffdcb2', intensity: 0.5 }

/** Light passing a coloured shade takes some of its colour. */
const shadeGlow = (bulb: string, shade: string, translucent: boolean) => translucent ? mixColor(bulb, shade, 0.35) : bulb

const PENDANT_SIZES: Record<PendantKind, [number, number]> = {
  globe: [0.13, 0.2], dome: [0.15, 0.24], bell: [0.12, 0.18], cone: [0.12, 0.17], drum: [0.2, 0.28], lantern: [0.16, 0.25], bar: [0.45, 0.6],
}

export function roomLighting({ seed, theme }: RoomStyleInput = DEFAULT_ROOM_STYLE): RoomLighting {
  const key = `${theme}:${seed}`
  const choices = THEMES[theme]
  if (seed === 0 && theme === 'living') return fromMood(key, 'daylight', { lamp: { ...DEFAULT_LAMP }, pendant: { ...DEFAULT_PENDANT } })
  const random = seededRandom(`room-light:${key}`)
  const mood = pick(choices.moods, random)
  const base = MOODS[mood]
  const shade = pick(choices.lampShades, random)
  const shadeColor = choose(choices.shadeColors, random)
  const [metal, metalness] = choose(choices.metals, random)
  const lamp: FloorLampStyle = {
    base: pick(choices.lampBases, random), shade, shadeColor, metal, metalness,
    glow: shadeGlow(base.bulb, shadeColor, shade !== 'globe'), intensity: base.lamp * between(random, 0.85, 1.15),
  }
  const kind = pick(choices.pendants, random)
  const pendantColor = choose(choices.pendantColors, random)
  const [cord] = choose([BLACK, WHITE, BRASS], random)
  const [minSize, maxSize] = PENDANT_SIZES[kind]
  const pendant: PendantStyle = {
    kind, color: pendantColor, cord,
    count: theme === 'kitchen' && kind !== 'bar' ? (random() < 0.6 ? 3 : 2) : 1,
    metalness: kind === 'dome' || kind === 'bell' || kind === 'cone' ? between(random, 0.2, 0.7) : 0,
    size: between(random, minSize, maxSize),
    glow: shadeGlow(base.bulb, pendantColor, kind === 'lantern' || kind === 'drum'),
    intensity: base.pendant * between(random, 0.85, 1.15),
  }
  const lighting = fromMood(key, mood, { lamp, pendant }, random)
  if (theme === 'kids' && choices.tints) {
    // Coloured walls and toys bounce colour back; tint sky and floor bounce differently.
    const sky = choose(choices.tints, random), ground = choose(choices.tints.filter(tint => tint !== sky), random)
    lighting.hemisphere = { sky: mixColor(lighting.hemisphere.sky, sky, 0.6), ground: mixColor(lighting.hemisphere.ground, ground, 0.7), intensity: lighting.hemisphere.intensity * 1.15 }
    lighting.fill = { color: mixColor(lighting.fill.color, ground, 0.75), intensity: lighting.fill.intensity + 0.35 }
    // Sun through coloured curtains and toys warms the window glow too.
    lighting.window = { ...lighting.window, color: mixColor(lighting.window.color, sky, 0.3) }
    lighting.ambient = { ...lighting.ambient, color: mixColor(lighting.ambient.color, sky, 0.2) }
  }
  if (theme === 'kitchen') {
    // Cooking keeps the kitchen air thick whatever the time of day.
    lighting.haze = { ...lighting.haze, density: Math.max(lighting.haze.density, between(random, 0.035, 0.065)), shafts: Math.min(0.8, lighting.haze.shafts * 1.4) }
  }
  return lighting
}

function fromMood(key: string, mood: LightMood, fixtures: Pick<RoomLighting, 'lamp' | 'pendant'>, random?: () => number): RoomLighting {
  const base = MOODS[mood]
  const vary = (value: number, spread = 0.1) => random ? value * between(random, 1 - spread, 1 + spread) : value
  const [aimMin, aimMax] = base.sun.aim
  return {
    key, mood,
    exposure: vary(base.exposure, 0.03),
    ambient: { color: base.ambient[0], intensity: vary(base.ambient[1]) },
    hemisphere: { sky: base.hemisphere[0], ground: base.hemisphere[1], intensity: vary(base.hemisphere[2]) },
    sun: {
      source: base.sun.source, color: base.sun.color, intensity: vary(base.sun.intensity),
      aim: random ? between(random, aimMin, aimMax) : (aimMin + aimMax) / 2,
      offset: random ? between(random, -0.55, 0.55) : 0,
    },
    window: { sky: base.window[0], color: base.window[1], intensity: vary(base.window[2]) },
    fill: { color: base.fill[0], intensity: vary(base.fill[1]) },
    ceiling: base.ceiling,
    haze: { color: base.haze[0], density: base.haze[1], shafts: base.haze[2] },
    ...fixtures,
  }
}

/** Where the floor lamp's shade sits; its top stays at the 165 cm scale reference. */
export const FLOOR_LAMP_HEIGHT = 1.65

/** Height of the floor lamp's bulb, inside or just under its shade. */
export const floorLampBulbHeight = (shade: FloorLampShade) => FLOOR_LAMP_HEIGHT - (shade === 'globe' ? 0.17 : 0.28)

/**
 * After dark, the shadow-casting key light sits at whichever lamp lights the
 * creation most (inverse-square illuminance); by day it is always the window.
 * Distances are metres from each bulb to the creation.
 */
export function keyLightSource(lighting: Pick<RoomLighting, 'sun' | 'lamp' | 'pendant'>, distance: { lamp: number; pendant: number }): 'window' | 'lamp' | 'pendant' {
  if (lighting.sun.source === 'window') return 'window'
  const lux = (intensity: number, metres: number) => intensity / Math.max(0.25, metres) ** 2
  return lux(lighting.lamp.intensity, distance.lamp) > lux(lighting.pendant.intensity, distance.pendant) ? 'lamp' : 'pendant'
}

/**
 * Pendant placement in room coordinates (metres). Kitchen and office pendants
 * hang over a low creation as task lights; otherwise one hangs in front of it,
 * towards the window and above head height, so it stays out of the default
 * view of the creation. Bottoms keep clear of the creation and ceiling.
 */
export function pendantLayout(pendant: PendantStyle, theme: ResolvedTheme, creation: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }, ceiling: number) {
  const width = creation.maxX - creation.minX
  const overCreation = (theme === 'kitchen' || theme === 'office') && creation.top <= 1.3 && width >= 0.5
  const shadeHeight = pendant.kind === 'bar' ? 0.05 : pendant.size * (pendant.kind === 'drum' ? 0.9 : 1.6)
  const wanted = overCreation ? Math.max(creation.top + 0.75, 1.55) : Math.max(2.05, creation.top + 0.35)
  // Keep at least 15 cm of cord.
  const bottom = Math.min(wanted, ceiling - shadeHeight - 0.15)
  const x = overCreation ? (creation.minX + creation.maxX) / 2 : creation.minX - 0.9
  const z = overCreation ? (creation.minZ + creation.maxZ) / 2 : creation.maxZ + 0.9
  const count = overCreation ? Math.max(1, Math.min(pendant.count, Math.floor(width / 0.55))) : 1
  const spacing = count > 1 ? Math.min(0.9, width / count) : 0
  const positions = Array.from({ length: count }, (_, index) => ({ x: x + (index - (count - 1) / 2) * spacing, z }))
  const barLength = pendant.kind === 'bar' ? Math.min(pendant.size * 2, Math.max(0.6, width * 0.8)) : 0
  return { positions, bottom, shadeHeight, barLength, overCreation }
}
