/**
 * Purpose recognition for preview furnishings.
 *
 * Geometry is first reduced to a few measurable surface features (heights in
 * metres above the room floor, measured in the surface's chosen front frame),
 * then every role receives a smooth score instead of a pass/fail threshold.
 * The best role above a minimum confidence wins. Names add a bounded hint and
 * explicit user choices override the result.
 */

export type FurnishingRole =
  | 'shelf' | 'display' | 'desk' | 'standing-desk' | 'dining-table' | 'coffee-table'
  | 'side-table' | 'counter' | 'sideboard' | 'lowboard' | 'bench' | 'bed'
export type FurnishingRoleChoice = FurnishingRole | 'empty'

export const FURNISHING_ROLES: readonly FurnishingRole[] = [
  'shelf', 'display', 'desk', 'standing-desk', 'dining-table', 'coffee-table',
  'side-table', 'counter', 'sideboard', 'lowboard', 'bench', 'bed',
]

export const FURNISHING_ROLE_LABELS: Record<FurnishingRoleChoice, { label: string; one: string; plural: string }> = {
  shelf: { label: 'Shelf', one: 'shelf', plural: 'shelves' },
  display: { label: 'Display top', one: 'display top', plural: 'display tops' },
  desk: { label: 'Desk', one: 'desk', plural: 'desks' },
  'standing-desk': { label: 'Standing desk', one: 'standing desk', plural: 'standing desks' },
  'dining-table': { label: 'Dining table', one: 'dining table', plural: 'dining tables' },
  'coffee-table': { label: 'Coffee table', one: 'coffee table', plural: 'coffee tables' },
  'side-table': { label: 'Side table', one: 'side table', plural: 'side tables' },
  counter: { label: 'Counter', one: 'counter', plural: 'counters' },
  sideboard: { label: 'Sideboard', one: 'sideboard', plural: 'sideboards' },
  lowboard: { label: 'TV lowboard', one: 'TV lowboard', plural: 'TV lowboards' },
  bench: { label: 'Bench', one: 'bench', plural: 'benches' },
  bed: { label: 'Bed', one: 'bed', plural: 'beds' },
  empty: { label: 'Leave empty', one: 'empty surface', plural: 'empty surfaces' },
}

export interface SurfaceFeatures {
  /** Top of the surface above the room floor. */
  height: number
  /** Long and short spans in the chosen front frame. */
  width: number
  depth: number
  /** Clear height to the next horizontal board above its footprint; Infinity when open. */
  headroom: number
  /** Headroom over the front working zone only, where a person works. */
  workHeadroom: number
  /** Knee space under the front or back edge. */
  legroomFront: boolean
  legroomBack: boolean
  /** A horizontal board lower in the same footprint, or no knee space: storage below. */
  enclosedBelow: boolean
  /** Uprights that bound the surface's ends, as in a compartment. */
  sideWalls: number
  /** Two or more uprights carry the surface down to the floor. */
  supported: boolean
  /** The detailed bench test, including grounded ends and seat clearance. */
  benchSeat: boolean
  /** Number of candidate surfaces in the same physical object. */
  objectSurfaces: number
  /** The object holds TROFAST-style inserts. */
  objectHasInserts: boolean
}

export const MIN_ROLE_SCORE = 0.3
const NAME_HINT_BONUS = 0.35
const NAME_HINT_MINIMUM = 0.15

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
/** 0 at or below `from`, 1 at or above `to`. */
export const ramp = (value: number, from: number, to: number) => clamp01((value - from) / (to - from))
/** A trapezoid: rises from a to b, holds to c, falls to zero at d. */
export const band = (value: number, a: number, b: number, c: number, d: number) => Math.min(ramp(value, a, b), 1 - ramp(value, c, d))

export function scoreFurnishingRoles(f: SurfaceFeatures): Record<FurnishingRole, number> {
  const { height: h, width: w, depth: d } = f
  const open = ramp(f.headroom, 0.35, 0.6)
  const cubby = 1 - ramp(f.headroom, 0.45, 0.75)
  const supported = f.supported ? 1 : 0
  const legroom = f.legroomFront || f.legroomBack
  const bothSides = f.legroomFront && f.legroomBack
  const storageBelow = f.enclosedBelow ? 1 : 0.3
  // Shelving context only matters for enclosed boards; an exposed top stays a top.
  const compartment = Math.max(cubby, f.sideWalls > 0 ? 1 : 0, f.objectSurfaces >= 3 ? 1 - open : 0)
  // End boards can turn the front frame, so sleeping size ignores orientation.
  const long = Math.max(w, d), short = Math.min(w, d)
  const bedSized = long >= 1.8 && short >= 0.8
  return {
    shelf: band(d, 0.14, 0.2, 0.55, 0.68) * (0.6 + 0.4 * compartment) * (bedSized ? 0 : 1),
    // Exposed tops of shelving get sparse decor rather than unsupported books.
    display: band(d, 0.14, 0.2, 0.6, 0.72) * open * (f.sideWalls ? 0 : 1)
      * (f.enclosedBelow && f.objectSurfaces >= 2 ? 0.75 : 0),
    desk: band(h, 0.6, 0.66, 0.84, 0.94) * ramp(w, 0.75, 0.9) * ramp(d, 0.45, 0.55) * supported
      * (legroom ? 1 : 0) * ramp(f.workHeadroom, 0.4, 0.55) * (bothSides && d > 0.8 ? 0.8 : 1),
    'standing-desk': band(h, 0.92, 0.98, 1.15, 1.25) * ramp(w, 0.7, 0.85) * ramp(d, 0.45, 0.55) * supported * open
      * (legroom ? 1 : 0.5),
    'dining-table': band(h, 0.66, 0.71, 0.79, 0.84) * ramp(w, 0.7, 0.85) * ramp(d, 0.68, 0.8) * supported * open
      * (bothSides ? 1 : 0),
    'coffee-table': band(h, 0.26, 0.32, 0.5, 0.56) * ramp(w, 0.45, 0.6) * ramp(d, 0.38, 0.48) * open
      * (f.supported ? 1 : 0.5) * (bedSized ? 0 : 1) * (f.benchSeat ? ramp(d, 0.5, 0.6) : 1),
    'side-table': band(h, 0.4, 0.47, 0.7, 0.78) * (1 - ramp(Math.max(w, d), 0.62, 0.8)) * ramp(Math.min(w, d), 0.26, 0.32)
      * open * (f.supported ? 1 : 0.6) * (f.objectSurfaces >= 3 ? 0.6 : 1),
    counter: band(h, 0.82, 0.86, 0.96, 1.02) * ramp(w, 0.6, 0.8) * ramp(d, 0.45, 0.55) * supported * open
      * (f.enclosedBelow ? 1 : 0.6) * (f.legroomFront ? 0.55 : 1),
    sideboard: band(h, 0.62, 0.7, 1, 1.1) * ramp(w, 0.8, 1) * band(d, 0.28, 0.32, 0.58, 0.66) * open * supported * storageBelow,
    lowboard: band(h, 0.28, 0.36, 0.6, 0.68) * ramp(w, 0.95, 1.2) * band(d, 0.28, 0.32, 0.55, 0.62) * open * supported
      // Long, closed low units read as media storage; shorter ones stay seats.
      * storageBelow * (f.benchSeat && !(w >= 1.4 && f.enclosedBelow) ? 0.8 : 1),
    // A verified seat with clear sitting space. Long storage units prefer lowboard.
    bench: f.benchSeat ? 0.9 : 0,
    bed: band(h, 0.12, 0.22, 0.65, 0.8) * ramp(long, 1.8, 1.95) * ramp(short, 0.8, 0.9) * (1 - ramp(short, 2.1, 2.3))
      * ramp(f.headroom, 0.45, 0.7) * (f.supported || h < 0.3 ? 1 : 0.5),
  }
}

/** Distinctive names, in English, German and French. Generic words like "top" or "shelf" are ignored. */
const NAME_HINTS: [RegExp, FurnishingRole][] = [
  [/stand(ing)?[- ]?desk|steh(pult|tisch)/i, 'standing-desk'],
  [/desk|schreibtisch|arbeitstisch|work ?(table|station)|bureau|pult/i, 'desk'],
  [/dining|esstisch|table à manger|küchentisch/i, 'dining-table'],
  [/coffee|couchtisch|salontisch|table basse/i, 'coffee-table'],
  [/night ?stand|bedside|side ?table|nachttisch|beistelltisch|chevet|end ?table/i, 'side-table'],
  [/counter|kitchen|küche|theke|arbeitsplatte|work ?bench|werkbank|plan de travail/i, 'counter'],
  [/sideboard|kommode|dresser|console|konsole|buffet|anrichte/i, 'sideboard'],
  [/\btv\b|lowboard|media|fernseh|hifi|hi-fi/i, 'lowboard'],
  [/bench|bank|seat|sitz|hocker|stool|banc/i, 'bench'],
  [/\bbed\b|\bbett|\blit\b|daybed/i, 'bed'],
]

export function nameRoleHint(...names: (string | undefined)[]): FurnishingRole | undefined {
  for (const name of names) {
    if (!name) continue
    for (const [pattern, role] of NAME_HINTS) if (pattern.test(name)) return role
  }
  return undefined
}

export type RoleSource = 'geometry' | 'name' | 'choice'

export function chooseFurnishingRole(features: SurfaceFeatures, hint?: FurnishingRole):
  { role: FurnishingRole | null; score: number; source: RoleSource } {
  const scores = scoreFurnishingRoles(features)
  let best: FurnishingRole | null = null, bestScore = 0, source: RoleSource = 'geometry'
  for (const role of FURNISHING_ROLES) {
    const geometric = scores[role]
    // A name supports a plausible reading but cannot make an impossible one.
    const hinted = role === hint && geometric >= NAME_HINT_MINIMUM
    const score = geometric + (hinted ? NAME_HINT_BONUS : 0)
    if (score > bestScore + 1e-9) { best = role; bestScore = score; source = hinted ? 'name' : 'geometry' }
  }
  return bestScore >= MIN_ROLE_SCORE ? { role: best, score: bestScore, source } : { role: null, score: bestScore, source: 'geometry' }
}

/** "2 shelves · 1 desk", ordered by count, then by the role order. */
export function summarizeFurnishedRoles(roles: readonly FurnishingRole[]) {
  const counts = new Map<FurnishingRole, number>()
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || FURNISHING_ROLES.indexOf(a[0]) - FURNISHING_ROLES.indexOf(b[0]))
    .map(([role, count]) => `${count} ${FURNISHING_ROLE_LABELS[role][count === 1 ? 'one' : 'plural']}`)
    .join(' · ')
}
