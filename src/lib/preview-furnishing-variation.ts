/**
 * Seeded, deterministic variation for preview furnishings.
 *
 * Seed 0 is the stable default arrangement: every hash then equals the
 * historical per-panel hash, so guides, tests and screenshots stay unchanged.
 * Any other seed ("Shuffle") is mixed into every key, giving a fresh but
 * reproducible arrangement for the same geometry.
 */

export type FurnishingDensity = 'minimal' | 'balanced' | 'lived-in'
export type FurnishingTheme = 'auto' | 'living' | 'office' | 'kids' | 'kitchen'

export const FURNISHING_DENSITIES: readonly { id: FurnishingDensity; label: string }[] = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'lived-in', label: 'Lived-in' },
]

export const FURNISHING_THEMES: readonly { id: FurnishingTheme; label: string }[] = [
  { id: 'auto', label: 'Auto style' },
  { id: 'living', label: 'Living room' },
  { id: 'office', label: 'Office' },
  { id: 'kids', label: 'Kids' },
  { id: 'kitchen', label: 'Kitchen' },
]

/** FNV-1a, matching the original per-panel book variation. */
export function hashText(text: string) {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return hash >>> 0
}

export function variationKey(key: string, seed = 0) {
  return seed ? `${key}~${seed}` : key
}

export function variationHash(key: string, seed = 0) {
  return hashText(variationKey(key, seed))
}

/** Small, fast PRNG (mulberry32 variant) seeded from text. */
export function seededRandom(seed: string) {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  return () => {
    state += 0x6d2b79f5
    let value = Math.imul(state ^ state >>> 15, 1 | state)
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

/**
 * A fraction in [0, 1) whose first decimal digit is `hash % 10`.
 * Content thresholds at multiples of 0.1 therefore match the original
 * `hash % 10` buckets exactly, while finer thresholds remain possible.
 */
export function hashFraction(hash: number) {
  return (hash % 10) / 10 + ((hash >>> 12) % 10) / 100 + ((hash >>> 20) % 10) / 1000
}

export type ShelfContent = 'empty' | 'decor' | 'books' | 'basket' | 'storage-box' | 'records' | 'jars' | 'bowl' | 'frame' | 'textiles'
export type ResolvedTheme = Exclude<FurnishingTheme, 'auto'>

/** Cumulative content mixes, in order; the living/balanced mix is the original 20/30/50 split. */
const SHELF_MIXES: Record<ResolvedTheme, Record<FurnishingDensity, [ShelfContent, number][]>> = {
  living: {
    minimal: [['empty', 0.45], ['decor', 0.25], ['books', 0.2], ['frame', 0.1]],
    balanced: [['empty', 0.2], ['decor', 0.3], ['books', 0.5]],
    'lived-in': [['empty', 0.05], ['decor', 0.2], ['frame', 0.05], ['textiles', 0.05], ['books', 0.65]],
  },
  office: {
    minimal: [['empty', 0.4], ['storage-box', 0.2], ['books', 0.3], ['decor', 0.1]],
    balanced: [['empty', 0.15], ['decor', 0.15], ['storage-box', 0.2], ['books', 0.5]],
    'lived-in': [['empty', 0.05], ['decor', 0.1], ['storage-box', 0.25], ['books', 0.6]],
  },
  kids: {
    minimal: [['empty', 0.4], ['basket', 0.3], ['books', 0.2], ['decor', 0.1]],
    balanced: [['empty', 0.15], ['basket', 0.3], ['storage-box', 0.15], ['books', 0.3], ['decor', 0.1]],
    'lived-in': [['empty', 0.05], ['basket', 0.35], ['storage-box', 0.15], ['textiles', 0.1], ['books', 0.35]],
  },
  kitchen: {
    minimal: [['empty', 0.45], ['jars', 0.25], ['bowl', 0.15], ['decor', 0.15]],
    balanced: [['empty', 0.2], ['jars', 0.3], ['bowl', 0.15], ['books', 0.2], ['decor', 0.15]],
    'lived-in': [['empty', 0.05], ['jars', 0.35], ['bowl', 0.2], ['books', 0.25], ['decor', 0.15]],
  },
}

export function shelfMix(theme: ResolvedTheme, density: FurnishingDensity) {
  return SHELF_MIXES[theme][density]
}

export function pickContent(mix: readonly [ShelfContent, number][], fraction: number, exclude: ReadonlySet<ShelfContent> = new Set()) {
  const options = mix.filter(([content]) => !exclude.has(content))
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  if (!options.length || total <= 0) return mix[0][0]
  let threshold = fraction * total
  for (const [content, weight] of options) {
    if (threshold < weight - 1e-9) return content
    threshold -= weight
  }
  return options.at(-1)![0]
}

/** Additional furnishings per long shelf, after its primary group. */
export function extraSegments(density: FurnishingDensity, width: number) {
  if (density === 'minimal') return 0
  if (density === 'balanced') return width >= 0.62 ? 1 : 0
  return width >= 0.9 ? 2 : width >= 0.55 ? 1 : 0
}
