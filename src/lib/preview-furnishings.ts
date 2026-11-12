import { Box3, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import type { Panel, Project, Vec3 } from './types'
import { getTrofastInsertObb } from './trofast'
import { createPreviewBooks, getPreviewBookBounds, PREVIEW_BOOK_BOUNDS, PREVIEW_BOOK_STACK_BOUNDS, type PreviewBookArrangement, type PreviewBookSupport } from './preview-books'
import { chooseFurnishingRole, nameRoleHint, type FurnishingRole, type RoleSource, type SurfaceFeatures } from './preview-furnishing-roles'
import { extraSegments, hashFraction, pickContent, seededRandom, shelfMix, variationHash, variationKey, type FurnishingDensity, type FurnishingTheme, type ResolvedTheme, type ShelfContent } from './preview-furnishing-variation'

export type FurnishingKind =
  | 'books' | 'table-lamp' | 'computer' | 'laptop' | 'plant' | 'vase' | 'mug' | 'notebook' | 'picture-frame'
  | 'basket' | 'storage-box' | 'records' | 'jars' | 'bowl' | 'textiles' | 'tray' | 'place-setting' | 'cutting-board'
  | 'speaker' | 'tv' | 'cushion' | 'bedding' | 'chair' | 'seated-person' | 'seated-person-chair'
export type SeatedPose = 'relaxed' | 'reading' | 'laptop'

/** Preview-only transforms, in metres. People and chairs originate at the top of their seat. */
export interface FurnishingPlacement {
  id: string
  panelId: string
  kind: FurnishingKind
  position: Vec3
  rotation: number
  seatHeight?: number
  bookArrangement?: PreviewBookArrangement
  bookSeed?: string
  bookSupport?: PreviewBookSupport
  /** Size of a parametric object (basket, storage box, TV, bedding), W × H × D. */
  size?: Vec3
  /** Stable style index for colours and shapes. */
  variant?: number
  /** Seated activity; omitted is the relaxed default. */
  pose?: SeatedPose
  /** The supporting finish is dark; decor uses lighter tones. */
  tone?: 'dark'
}

export interface FurnishingOptions {
  /** 0 is the stable default arrangement; any other value reshuffles it reproducibly. */
  seed?: number
  density?: FurnishingDensity
  theme?: FurnishingTheme
  /** Extra names per panel (assembly or group names) that can hint at purpose. */
  names?: Readonly<Record<string, string | undefined>>
}

export interface FurnishedSurface {
  panelId: string
  /** null when no role was confident enough, or the user chose to leave it empty. */
  role: FurnishingRole | null
  /** The automatic reading, before any user choice. */
  detected: FurnishingRole | null
  source: RoleSource
  furnished: boolean
  features: SurfaceFeatures
  /** Every board of a merged top; the first is panelId. */
  memberIds: string[]
}

export interface FurnishingPlan {
  placements: FurnishingPlacement[]
  /** Every analysed surface, in detection order. */
  surfaces: FurnishedSurface[]
  /** The style of the room as a whole, which also chooses its floor and rug. */
  theme: ResolvedTheme
}

export const MAX_PREVIEW_FURNISHINGS = 48
const MAX_SURFACES = 96
const MAX_PEOPLE = 2
const FLOOR_Y = -0.012
const UP = new Vector3(0, 1, 0)
const MM = 0.001
const CLEARANCE = 0.008
const DESK_SEAT_HEIGHT = 0.46

type FixedKind = Exclude<FurnishingKind, 'seated-person' | 'seated-person-chair' | 'chair'>
const footprints: Record<FixedKind, Vec3> = {
  books: PREVIEW_BOOK_BOUNDS,
  'table-lamp': [0.25, 0.42, 0.25],
  computer: [0.62, 0.48, 0.50],
  laptop: [0.34, 0.25, 0.27],
  plant: [0.21, 0.30, 0.21],
  vase: [0.18, 0.26, 0.18],
  mug: [0.12, 0.1, 0.09],
  notebook: [0.22, 0.03, 0.16],
  'picture-frame': [0.3, 0.38, 0.09],
  basket: [0.3, 0.22, 0.28],
  'storage-box': [0.3, 0.2, 0.3],
  records: [0.2, 0.32, 0.32],
  jars: [0.3, 0.21, 0.12],
  bowl: [0.26, 0.11, 0.26],
  textiles: [0.3, 0.12, 0.24],
  tray: [0.4, 0.14, 0.28],
  'place-setting': [0.4, 0.13, 0.3],
  'cutting-board': [0.42, 0.05, 0.28],
  speaker: [0.17, 0.28, 0.19],
  tv: [0.97, 0.62, 0.22],
  cushion: [0.44, 0.12, 0.38],
  bedding: [1.9, 0.26, 0.9],
}

/** Floor footprint of a placement, W × D in metres, for navigation clearance. */
export function furnishingFootprint(item: FurnishingPlacement): [number, number] {
  if (item.kind === 'chair' || item.kind === 'seated-person-chair') return [0.5, 0.47]
  if (item.kind === 'seated-person') return [0.5, 0.36]
  if (item.kind === 'books') return [0.48, 0.3]
  const size = item.size ?? footprints[item.kind]
  return [size[0], size[2]]
}

/** W × H × D of a placement standing on its base; people and chairs, which sit forward of the furniture, return null. */
export function furnishingSize(item: FurnishingPlacement): Vec3 | null {
  if (item.kind === 'chair' || item.kind === 'seated-person' || item.kind === 'seated-person-chair') return null
  if (item.size) return item.size
  if (item.kind === 'books') return item.bookArrangement === 'stacked' ? PREVIEW_BOOK_STACK_BOUNDS : PREVIEW_BOOK_BOUNDS
  return footprints[item.kind]
}

interface Obstacle { panel: Panel; obb: OBB; bounds: Box3; normal: Vector3 }
/** A level board, or several coplanar boards that read as one top. The first member is primary. */
interface Surface {
  obstacle: Obstacle; members: Obstacle[]; memberIds: ReadonlySet<string>; bounds: Box3
  center: Vector3; x: Vector3; z: Vector3; width: number; depth: number; rotation: number
}

function obstacle(panel: Panel): Obstacle {
  const quaternion = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const rotation = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion))
  const center = new Vector3(...panel.position).multiplyScalar(MM)
  const halfSize = new Vector3(panel.width, panel.height, panel.thickness).multiplyScalar(MM / 2)
  const bounds = new Box3()
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    bounds.expandByPoint(new Vector3(x, y, z).multiply(halfSize).applyQuaternion(quaternion).add(center))
  }
  return { panel, obb: new OBB(center, halfSize, rotation), bounds, normal: new Vector3(0, 0, 1).applyQuaternion(quaternion) }
}

const LEVEL_NORMAL_Y = 0.999999
// A bounding rectangle cannot safely furnish a cutout, perforated or tilted board.
const furnishableShape = (panel: Panel) => !panel.customOutline && !panel.trofastInserts?.length && panel.pattern === 'solid'

/** A resolved board Auto furnish can read as a surface: level, solid and rectangular. Size and height are checked later. */
export function furnishingSurfaceCandidate(panel: Panel) {
  return furnishableShape(panel) && Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)).y) >= LEVEL_NORMAL_Y
}

function surface(item: Obstacle): Surface | null {
  const { panel, normal } = item
  if (!furnishableShape(panel) || Math.abs(normal.y) < LEVEL_NORMAL_Y) return null
  const quaternion = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const x = (panel.width >= panel.height ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).applyQuaternion(quaternion)
  x.y = 0
  x.normalize()
  // Prefer the edge facing the room, independently of the board's face direction.
  if (x.x < -0.000001 || (Math.abs(x.x) <= 0.000001 && x.z > 0)) x.negate()
  const z = new Vector3().crossVectors(x, UP)
  return {
    obstacle: item, members: [item], memberIds: new Set([panel.id]), bounds: item.bounds,
    center: new Vector3(item.obb.center.x, item.bounds.max.y, item.obb.center.z), x, z,
    width: Math.max(panel.width, panel.height) * MM, depth: Math.min(panel.width, panel.height) * MM,
    rotation: Math.atan2(-x.z, x.x),
  }
}

function worldPosition(target: Surface, x: number, y: number, z: number) {
  return target.center.clone().addScaledVector(target.x, x).addScaledVector(UP, y).addScaledVector(target.z, z)
}

function boundsInSurface(item: Obstacle, target: Surface) {
  const bounds = new Box3()
  const rotation = item.obb.rotation
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const point = new Vector3(x, y, z).multiply(item.obb.halfSize).applyMatrix3(rotation).add(item.obb.center).sub(target.center)
    bounds.expandByPoint(new Vector3(point.dot(target.x), point.y, point.dot(target.z)))
  }
  return bounds
}

function turned(base: Surface, turn: number): Surface {
  const angle = turn * Math.PI / 2
  return { ...base, x: base.x.clone().applyAxisAngle(UP, angle), z: base.z.clone().applyAxisAngle(UP, angle),
    width: turn % 2 ? base.depth : base.width, depth: turn % 2 ? base.width : base.depth, rotation: base.rotation + angle }
}

/** Side walls identify a shelf's opening even when its depth exceeds its width. */
function faceOpening(base: Surface, obstacles: Obstacle[]): Surface {
  const nearby = obstacles.filter(item => !base.memberIds.has(item.panel.id) && Math.abs(item.normal.y) < 0.05
    && item.bounds.max.y > base.center.y - 0.06 && item.bounds.min.y < base.center.y + 0.35
    && item.bounds.min.x < base.bounds.max.x + 0.085 && item.bounds.max.x > base.bounds.min.x - 0.085
    && item.bounds.min.z < base.bounds.max.z + 0.085 && item.bounds.max.z > base.bounds.min.z - 0.085)
  let best = base, bestScore = -Infinity
  for (let turn = 0; turn < 4; turn++) {
    const candidate = turned(base, turn)
    let front = 0, back = 0, left = 0, right = 0
    for (const item of nearby) {
      const bounds = boundsInSurface(item, candidate)
      // Below-shelf sides still orient the books on the very top of a bookcase.
      const height = Math.min(0.3, Math.max(0, bounds.max.y)) / 0.3
        + Math.min(0.3, Math.max(0, -bounds.min.y)) / 0.3 * 0.4
      const coverageX = Math.max(0, Math.min(bounds.max.x, candidate.width / 2) - Math.max(bounds.min.x, -candidate.width / 2)) / candidate.width
      const coverageZ = Math.max(0, Math.min(bounds.max.z, candidate.depth / 2) - Math.max(bounds.min.z, -candidate.depth / 2)) / candidate.depth
      const atEdge = (min: number, max: number, edge: number) => min < edge + 0.085 && max > edge - 0.085
      if (Math.abs(item.normal.dot(candidate.z)) > 0.95) {
        if (atEdge(bounds.min.z, bounds.max.z, candidate.depth / 2)) front += coverageX * height
        if (atEdge(bounds.min.z, bounds.max.z, -candidate.depth / 2)) back += coverageX * height
      }
      if (Math.abs(item.normal.dot(candidate.x)) > 0.95) {
        if (atEdge(bounds.min.x, bounds.max.x, -candidate.width / 2)) left += coverageZ * height
        if (atEdge(bounds.min.x, bounds.max.x, candidate.width / 2)) right += coverageZ * height
      }
    }
    // A clear face opposite a backing panel outweighs the room-facing fallback.
    // Long, unbounded boards retain their useful span; near-square cubbies do not
    // inherit an arbitrary front just because one panel dimension is longer.
    const score = (Math.min(2, back) - Math.min(2, front)) * 5 + Math.min(left, right, 2) * 1.5
      + Math.min(left + right, 2) * 0.25 + (candidate.width >= candidate.depth * 1.8 ? 0.75 : 0)
      + candidate.z.z * 0.35 + candidate.z.x * 0.01
    if (score > bestScore + 1e-8) { best = candidate; bestScore = score }
  }
  return best
}

/** Benches use their long span, independently of the opening of adjacent shelving. */
function benchSurface(base: Surface): Surface {
  const panel = base.obstacle.panel
  const intrinsicX = (panel.width >= panel.height ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
    .applyEuler(new Euler(...panel.rotation))
  // Keep the panel's axis direction so rotating a build also rotates its occupant.
  return intrinsicX.dot(base.x) >= 0 ? base : turned(base, 2)
}

/**
 * Shelving can carry a surface through several panels. Follow only downward
 * contacts, allowing normal connector gaps, and never use the surface itself.
 */
function groundedTest(obstacles: Obstacle[], excluded: ReadonlySet<string>) {
  const grounded = new Map<string, boolean>()
  const reachesFloor = (item: Obstacle, steps = 0): boolean => {
    if (item.bounds.min.y < 0.12) return true
    if (steps >= 12) return false
    const cacheKey = `${steps}:${item.panel.id}`
    const cached = grounded.get(cacheKey)
    if (cached !== undefined) return cached
    const nearby = item.obb.clone()
    nearby.halfSize.addScalar(0.04)
    const supported = obstacles.some(lower => lower !== item && !excluded.has(lower.panel.id)
      && lower.bounds.min.y < item.bounds.min.y - 0.005 && lower.bounds.max.y >= item.bounds.min.y - 0.04
      && nearby.intersectsOBB(lower.obb, 1e-8) && reachesFloor(lower, steps + 1))
    grounded.set(cacheKey, supported)
    return supported
  }
  return reachesFloor
}

function supportedBench(target: Surface, obstacles: Obstacle[], reachesFloor: (item: Obstacle) => boolean) {
  const { width, depth, center } = target
  const height = center.y - FLOOR_Y
  if (height < 0.32 || height > 0.56 || width < 0.75 || depth < 0.30 || depth > 0.58 || width / depth < 1.8) return false
  let left = false, right = false
  const endZone = Math.min(0.20, width * 0.25)
  for (const item of obstacles) {
    if (target.memberIds.has(item.panel.id) || Math.abs(item.normal.y) > 0.05) continue
    const bounds = boundsInSurface(item, target)
    if (bounds.max.y < -0.085 || bounds.min.y > -0.05
      || bounds.min.z > depth / 2 + 0.06 || bounds.max.z < -depth / 2 - 0.06) continue
    const atLeft = bounds.min.x < -width / 2 + endZone && bounds.max.x > -width / 2 - 0.08
    const atRight = bounds.max.x > width / 2 - endZone && bounds.min.x < width / 2 + 0.08
    if ((!atLeft && !atRight) || !reachesFloor(item)) continue
    left ||= atLeft
    right ||= atRight
    if (left && right) return true
  }
  return false
}

function envelope(position: Vector3, rotation: number, offset: Vec3, size: Vec3) {
  const quaternion = new Quaternion().setFromAxisAngle(UP, rotation)
  return new OBB(new Vector3(...offset).applyQuaternion(quaternion).add(position), new Vector3(...size).multiplyScalar(0.5),
    new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion)))
}

function chairEnvelopes(position: Vector3, rotation: number, seatHeight: number) {
  return [
    envelope(position, rotation, [0, -0.028, 0], [0.48, 0.056, 0.44]),
    envelope(position, rotation, [0, 0.22, -0.20], [0.48, 0.50, 0.06]),
    envelope(position, rotation, [0, -seatHeight / 2, 0], [0.46, seatHeight - 0.015, 0.42]),
  ]
}

function personEnvelopes(position: Vector3, rotation: number, seatHeight: number, chair: boolean) {
  const boxes = [
    envelope(position, rotation, [0, 0.462, 0], [0.50, 0.92, 0.36]),
    envelope(position, rotation, [0, 0.097, 0.16], [0.48, 0.19, 0.44]),
    envelope(position, rotation, [0, 0.24, 0.195], [0.50, 0.22, 0.29]),
    envelope(position, rotation, [0, (-seatHeight + 0.06) / 2, 0.385], [0.43, seatHeight + 0.06, 0.29]),
  ]
  if (chair) boxes.push(...chairEnvelopes(position, rotation, seatHeight))
  return boxes
}

function benchSeats(target: Surface) {
  const seatY = target.center.y + 0.002, seatHeight = seatY - FLOOR_Y
  const limit = target.width / 2 - 0.26
  const preferred = target.width > 1.15 ? -target.width * 0.17 : 0
  const positions = [...new Set([preferred, 0, -limit, limit, -limit / 2, limit / 2])]
  return [1, -1].flatMap(side => positions.map(x => {
    const position = worldPosition(target, x, 0.002, side * (target.depth / 2 - 0.12))
    const rotation = target.rotation + (side < 0 ? Math.PI : 0)
    return { x, position, rotation, seatHeight, boxes: personEnvelopes(position, rotation, seatHeight, false) }
  }))
}

/** Rectangle of a member in a frame's local XZ coordinates. */
function localRect(item: Obstacle, frame: Surface) {
  const bounds = boundsInSurface(item, frame)
  return { minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z }
}

/**
 * Adjacent level boards at the same height read as one top: cube grids form a
 * counter, two worktops form one desk. An upright rising through the seam keeps
 * shelf compartments separate, and the union must remain nearly rectangular.
 */
function mergeCoplanar(surfaces: Surface[], obstacles: Obstacle[], objectOf: Map<string, number>): Surface[] {
  const parent = surfaces.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index] }
    return index
  }
  const aligned = (a: Surface, b: Surface) => Math.abs(a.x.dot(b.x)) > 0.9999 || Math.abs(a.x.dot(b.z)) > 0.9999
  for (let i = 0; i < surfaces.length; i++) for (let j = i + 1; j < surfaces.length; j++) {
    const a = surfaces[i], b = surfaces[j]
    if (Math.abs(a.center.y - b.center.y) > 0.004 || !aligned(a, b)
      || objectOf.get(a.obstacle.panel.id) !== objectOf.get(b.obstacle.panel.id)) continue
    const ra = localRect(a.obstacle, a), rb = localRect(b.obstacle, a)
    const gapX = Math.max(ra.minX - rb.maxX, rb.minX - ra.maxX), gapZ = Math.max(ra.minZ - rb.maxZ, rb.minZ - ra.maxZ)
    if (gapX > 0.06 || gapZ > 0.06 || (gapX > 0 && gapZ > 0)) continue
    // The seam between them, just above the surface.
    const alongX = gapX >= gapZ
    const seamMin = alongX ? Math.min(ra.maxX, rb.maxX) : Math.min(ra.maxZ, rb.maxZ)
    const seamMax = alongX ? Math.max(ra.minX, rb.minX) : Math.max(ra.minZ, rb.minZ)
    const crossMin = alongX ? Math.max(ra.minZ, rb.minZ) : Math.max(ra.minX, rb.minX)
    const crossMax = alongX ? Math.min(ra.maxZ, rb.maxZ) : Math.min(ra.maxX, rb.maxX)
    if (crossMax - crossMin < 0.1) continue
    const seamCenter = (seamMin + seamMax) / 2, seamSize = Math.max(0.01, Math.abs(seamMax - seamMin))
    const crossCenter = (crossMin + crossMax) / 2, crossSize = crossMax - crossMin - 0.04
    const seam = envelope(a.center, a.rotation, alongX ? [seamCenter, 0.09, crossCenter] : [crossCenter, 0.09, seamCenter],
      alongX ? [seamSize, 0.14, crossSize] : [crossSize, 0.14, seamSize])
    if (!freeOf(obstacles, seam, new Set([a.obstacle.panel.id, b.obstacle.panel.id]))) continue
    parent[find(j)] = find(i)
  }
  const groups = new Map<number, Surface[]>()
  surfaces.forEach((item, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), item]))
  const result: Surface[] = []
  for (const group of groups.values()) {
    if (group.length === 1) { result.push(group[0]); continue }
    const primary = group[0]
    const rects = group.map(item => localRect(item.obstacle, primary))
    const minX = Math.min(...rects.map(r => r.minX)), maxX = Math.max(...rects.map(r => r.maxX))
    const minZ = Math.min(...rects.map(r => r.minZ)), maxZ = Math.max(...rects.map(r => r.maxZ))
    const area = rects.reduce((sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ), 0)
    // L-shapes and sparse clusters keep their individual boards.
    if (area < (maxX - minX) * (maxZ - minZ) * 0.8) { result.push(...group); continue }
    const center = worldPosition(primary, (minX + maxX) / 2, 0, (minZ + maxZ) / 2)
    const long = maxX - minX >= maxZ - minZ
    const x = (long ? primary.x : primary.z).clone()
    if (x.x < -0.000001 || (Math.abs(x.x) <= 0.000001 && x.z > 0)) x.negate()
    const bounds = new Box3()
    for (const item of group) bounds.union(item.obstacle.bounds)
    result.push({
      obstacle: primary.obstacle, members: group.map(item => item.obstacle), memberIds: new Set(group.map(item => item.obstacle.panel.id)), bounds,
      center, x, z: new Vector3().crossVectors(x, UP), width: long ? maxX - minX : maxZ - minZ, depth: long ? maxZ - minZ : maxX - minX,
      rotation: Math.atan2(-x.z, x.x),
    })
  }
  return result
}

/** Sweep-and-prune union of touching panels into physical objects. */
function groupObjects(obstacles: Obstacle[]) {
  const parent = obstacles.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index] }
    return index
  }
  const gap = 0.02
  const order = obstacles.map((_, index) => index).sort((a, b) => obstacles[a].bounds.min.x - obstacles[b].bounds.min.x)
  for (let i = 0; i < order.length; i++) {
    const a = obstacles[order[i]]
    const grown = a.obb.clone()
    grown.halfSize.addScalar(gap)
    for (let j = i + 1; j < order.length; j++) {
      const b = obstacles[order[j]]
      if (b.bounds.min.x > a.bounds.max.x + gap * 2) break
      if (b.bounds.min.y > a.bounds.max.y + gap * 2 || b.bounds.max.y < a.bounds.min.y - gap * 2
        || b.bounds.min.z > a.bounds.max.z + gap * 2 || b.bounds.max.z < a.bounds.min.z - gap * 2) continue
      if (grown.intersectsOBB(b.obb, 1e-8)) parent[find(order[i])] = find(order[j])
    }
  }
  return new Map(obstacles.map((item, index) => [item.panel.id, find(index)]))
}

function luminance(color: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return 1
  const value = Number.parseInt(match[1], 16)
  return (0.2126 * (value >> 16 & 255) + 0.7152 * (value >> 8 & 255) + 0.0722 * (value & 255)) / 255
}

function isDarkFinish(panel: Panel) {
  if ((panel.finishCoverage ?? 0) >= 0.5 || panel.material === 'painted') return luminance(panel.color) < 0.35
  return panel.material === 'walnut'
}

interface Analysis {
  base: Surface
  /** The orientation used for furnishings other than seats. */
  front: Surface
  seat: Surface
  seats: ReturnType<typeof benchSeats>
  benchFeasible: boolean
  features: SurfaceFeatures
  objectId: number
  above: boolean
  below: boolean
  sideWallCount: number
}

function freeOf(obstacles: Obstacle[], box: OBB, excluded: ReadonlySet<string>) {
  return !obstacles.some(item => !excluded.has(item.panel.id) && box.intersectsOBB(item.obb, 1e-8))
}

function overlapsFootprint(bounds: Box3, width: number, depth: number) {
  return bounds.min.x < width / 2 - 0.08 && bounds.max.x > -width / 2 + 0.08
    && bounds.min.z < depth / 2 - 0.05 && bounds.max.z > -depth / 2 + 0.05
}

/** Knee space under one long edge, sampled at the centre and both quarters. */
function hasLegroom(target: Surface, side: 1 | -1, obstacles: Obstacle[]) {
  const kneeBottom = FLOOR_Y + 0.12, kneeTop = target.center.y - 0.06
  // Knees use the front of the underside; a central spine or rail may remain behind them.
  const span = Math.min(0.5, target.width - 0.16), reach = Math.min(0.24, target.depth * 0.4)
  if (kneeTop - kneeBottom < 0.3 || span < 0.3) return false
  const y = (kneeBottom + kneeTop) / 2 - target.center.y
  const z = side * (target.depth / 2 - reach / 2 - 0.02)
  return [0, -target.width / 4, target.width / 4].some(x => Math.abs(x) + span / 2 <= target.width / 2
    && freeOf(obstacles, envelope(target.center, target.rotation, [x, y, z], [span, kneeTop - kneeBottom, reach]), target.memberIds))
}

function analyse(base: Surface, obstacles: Obstacle[], objectId: number, objectSurfaces: number, objectHasInserts: boolean): Analysis {
  const reachesFloor = groundedTest(obstacles, base.memberIds)
  const seat = benchSurface(base)
  const benchFeasible = supportedBench(seat, obstacles, reachesFloor)
  const seats = benchFeasible ? benchSeats(seat).filter(candidate => candidate.boxes.every(box =>
    !obstacles.some(item => box.intersectsOBB(item.obb, 1e-8)))) : []
  let front = faceOpening(base, obstacles)
  const legroomFront = hasLegroom(front, 1, obstacles), legroomBack = hasLegroom(front, -1, obstacles)
  // Tables face their knee space, wherever the shelf-style opening test pointed.
  if (!legroomFront && legroomBack) front = turned(front, 2)
  const { width, depth } = front
  const relatives = obstacles.filter(item => !base.memberIds.has(item.panel.id)).map(item => ({ item, bounds: boundsInSurface(item, front) }))
  let headroom = Infinity, workHeadroom = Infinity, below = false
  for (const { item, bounds } of relatives) {
    if (Math.abs(item.normal.y) <= 0.999999 || !overlapsFootprint(bounds, width, depth)) continue
    if (bounds.min.y > 0.01) {
      headroom = Math.min(headroom, bounds.min.y)
      // A monitor riser at the back leaves the front working zone open.
      if (bounds.max.z > depth / 2 - 0.4) workHeadroom = Math.min(workHeadroom, bounds.min.y)
    }
    if (bounds.max.y < -0.01 && bounds.max.y > -1.2) below = true
  }
  const height = front.center.y - FLOOR_Y
  const supportDepth = Math.min(0.25, height - 0.1)
  const supports = relatives.filter(({ item, bounds }) => Math.abs(item.normal.y) < 0.05
    && bounds.max.y > -0.085 && bounds.min.y < -Math.min(supportDepth, 0.15)
    && (item.bounds.min.y < 0.12 ? bounds.min.y < -supportDepth : true)
    && bounds.min.x < width / 2 + 0.08 && bounds.max.x > -width / 2 - 0.08
    && bounds.min.z < depth / 2 + 0.08 && bounds.max.z > -depth / 2 - 0.08
    && reachesFloor(item))
  const sideWallCount = relatives.filter(({ item, bounds }) => Math.abs(item.normal.dot(front.x)) > 0.95
    && bounds.min.y < 0.04 && bounds.max.y > 0.16 && bounds.min.z < -0.08 && bounds.max.z > 0.08
    && (bounds.max.x < -0.03 && bounds.max.x >= -width / 2 - 0.03
      || bounds.min.x > 0.03 && bounds.min.x <= width / 2 + 0.03)).length
  const features: SurfaceFeatures = {
    height, width, depth, headroom, workHeadroom, legroomFront: legroomFront || legroomBack, legroomBack: legroomFront && legroomBack,
    // Seats are too low for knee space; only a board beneath means storage there.
    enclosedBelow: below || (height >= 0.55 && !(legroomFront || legroomBack)), sideWalls: sideWallCount, supported: supports.length >= 2,
    benchSeat: seats.length > 0, objectSurfaces, objectHasInserts,
  }
  return { base, front, seat, seats, benchFeasible, features, objectId, above: headroom < 1, below, sideWallCount }
}

function resolveTheme(requested: FurnishingTheme, roles: (FurnishingRole | null)[], inserts: boolean): ResolvedTheme {
  if (requested !== 'auto') return requested
  if (inserts) return 'kids'
  if (roles.includes('counter')) return 'kitchen'
  if (roles.includes('desk') || roles.includes('standing-desk')) return 'office'
  return 'living'
}

/**
 * Recognises what each level surface is for and decorates it accordingly.
 * Call only while the user has enabled furnishings. No project data is modified.
 * Candidate and object budgets keep clearance work bounded even on large builds.
 */
export function planPreviewFurnishings(panels: Panel[], options: FurnishingOptions = {}): FurnishingPlan {
  const seed = options.seed ?? 0, density = options.density ?? 'balanced'
  const shuffled = seed !== 0
  const obstacles = panels.filter(panel => panel.visible && [...panel.position, ...panel.rotation, panel.width, panel.height, panel.thickness].every(Number.isFinite)
    && panel.width > 0 && panel.height > 0 && panel.thickness > 0).map(obstacle)
  const objectOf = groupObjects(obstacles)
  const panelById = new Map(obstacles.map(item => [item.panel.id, item.panel]))
  const order = (a: Surface, b: Surface) => a.center.y - b.center.y || a.center.x - b.center.x || a.center.z - b.center.z || a.obstacle.panel.id.localeCompare(b.obstacle.panel.id)
  // Small boards may still combine into a usable top, so merge before the size filter.
  const levels = obstacles.map(surface).filter((item): item is Surface => !!item && item.width >= 0.15 && item.depth >= 0.1
    && item.center.y >= FLOOR_Y + 0.002 && item.center.y <= 2.15).sort(order)
  const surfaces = mergeCoplanar(levels.slice(0, MAX_SURFACES * 2), obstacles, objectOf)
    .filter(item => item.width >= 0.30 && item.width <= 3 && item.depth >= 0.22 && item.depth <= 2.3)
    .sort(order)
  const objectSurfaceCount = new Map<number, number>()
  for (const item of surfaces) {
    const id = objectOf.get(item.obstacle.panel.id)!
    objectSurfaceCount.set(id, (objectSurfaceCount.get(id) ?? 0) + 1)
  }
  const objectInserts = new Set(obstacles.filter(item => item.panel.trofastInserts?.length).map(item => objectOf.get(item.panel.id)!))

  // Pass 1: features and roles.
  const analysed = surfaces.slice(0, MAX_SURFACES).map(base => {
    const objectId = objectOf.get(base.obstacle.panel.id)!
    const analysis = analyse(base, obstacles, objectId, objectSurfaceCount.get(objectId) ?? 1, objectInserts.has(objectId))
    const panel = base.obstacle.panel
    // A purpose saved on any board of a merged top applies to the whole top.
    const choice = [...base.memberIds].map(id => panelById.get(id)?.furnishingRole).find(Boolean)
    const detected = chooseFurnishingRole(analysis.features, nameRoleHint(panel.name, options.names?.[panel.id]))
    const role: FurnishingRole | null = choice === 'empty' ? null : choice ?? detected.role
    const source: RoleSource = choice ? 'choice' : detected.source
    return { ...analysis, role, detected: detected.role, source }
  })

  // Pass 2: object themes and neighbour-aware shelf contents.
  const objectRoles = new Map<number, (FurnishingRole | null)[]>()
  for (const item of analysed) objectRoles.set(item.objectId, [...(objectRoles.get(item.objectId) ?? []), item.role])
  const themeOf = (objectId: number) => resolveTheme(options.theme ?? 'auto', objectRoles.get(objectId) ?? [], objectInserts.has(objectId))
  const contents = new Map<string, ShelfContent>()
  const planned: (typeof analysed)[number][] = []
  for (const item of analysed) {
    if (item.role !== 'shelf') continue
    const id = item.base.obstacle.panel.id
    const mix = shelfMix(themeOf(item.objectId), density)
    let content = pickContent(mix, hashFraction(variationHash(`${id}:contents`, seed)))
    const neighbours = planned.filter(other => other.objectId === item.objectId)
    const horizontal = (other: typeof item) => Math.hypot(other.base.center.x - item.base.center.x, other.base.center.z - item.base.center.z)
    const left = neighbours.filter(other => Math.abs(other.base.center.y - item.base.center.y) < 0.03
      && horizontal(other) < (other.base.width + item.base.width) / 2 + 0.1).sort((a, b) => horizontal(a) - horizontal(b))[0]
    const lower = neighbours.filter(other => other.base.center.y < item.base.center.y - 0.03 && horizontal(other) < 0.1)
      .sort((a, b) => b.base.center.y - a.base.center.y)[0]
    const leftContent = left && contents.get(left.base.obstacle.panel.id)
    const lowerContent = lower && contents.get(lower.base.obstacle.panel.id)
    // Rows of books read naturally; repeated decor or gaps in a row do not.
    if (content !== 'books' ? content === leftContent || content === lowerContent : content === leftContent && content === lowerContent) {
      content = pickContent(mix, hashFraction(variationHash(`${id}:contents:alt`, seed)), new Set([content]))
    }
    contents.set(id, content)
    planned.push(item)
  }

  // Pass 3: placement, in height order.
  const result: FurnishingPlacement[] = []
  const surfacesOut: FurnishedSurface[] = []
  const occupied: OBB[] = panels.filter(panel => panel.visible).flatMap(panel => (panel.trofastInserts ?? []).flatMap(insert => {
    const box = getTrofastInsertObb(panel, insert)
    if (!box) return []
    box.center.multiplyScalar(MM); box.halfSize.multiplyScalar(MM)
    return [box]
  }))
  let people = 0
  const full = () => result.length >= MAX_PREVIEW_FURNISHINGS
  const clear = (boxes: OBB[], support?: ReadonlySet<string>) => boxes.every(box =>
    !obstacles.some(item => !support?.has(item.panel.id) && box.intersectsOBB(item.obb, 1e-8))
    && !occupied.some(other => box.intersectsOBB(other, 1e-8)))

  for (const item of analysed) {
    if (full() || !item.role) {
      surfacesOut.push({ panelId: item.base.obstacle.panel.id, role: item.role, detected: item.detected, source: item.source, furnished: false,
        features: item.features, memberIds: [...item.base.memberIds] })
      continue
    }
    const role = item.role
    const target = role === 'bench' ? item.seat : role === 'bed' && item.front.width < item.front.depth ? turned(item.front, 1) : item.front
    const { width, depth, center, rotation } = target
    const panel = target.obstacle.panel
    const panelId = panel.id
    const before = result.length
    const tone = isDarkFinish(panel) ? 'dark' as const : undefined
    const theme = themeOf(item.objectId)
    const random = seededRandom(variationKey(`${panelId}:${role}`, seed))
    const variation = variationHash(panelId, seed)
    const variantOf = (id: string) => variationHash(`${id}:variant`, seed) % 997
    const headroom = item.features.headroom

    const arrangement: PreviewBookArrangement = (item.above || center.y < 1.1) && variation % 5 < 2 ? 'stacked' : variation % 2 ? 'leaning' : 'upright'
    const bookSeed = variationKey(`${panelId}:books`, seed)
    const insideSurface = (minX: number, maxX: number, minZ: number, maxZ: number, margin: number) => {
      const edgeX = Math.max(Math.abs(minX), Math.abs(maxX)), edgeZ = Math.max(Math.abs(minZ), Math.abs(maxZ))
      if (edgeX > width / 2 - margin || edgeZ > depth / 2 - margin) return false
      const radius = target.members.length > 1 ? 0 : Math.min((panel.cornerRadius ?? 0) * MM, width / 2, depth / 2)
      const cornerX = Math.max(0, edgeX - (width / 2 - radius)), cornerZ = Math.max(0, edgeZ - (depth / 2 - radius))
      return radius <= 0 || Math.hypot(cornerX, cornerZ) <= Math.max(0, radius - Math.min(margin, 0.012))
    }
    const push = (placement: Omit<FurnishingPlacement, 'panelId' | 'variant' | 'tone'>, boxes: OBB[], styled = true) => {
      result.push({ ...placement, panelId, ...(styled ? { variant: variantOf(placement.id) } : {}), ...(tone && styled ? { tone } : {}) })
      occupied.push(...boxes)
    }
    const addObject = (kind: FixedKind, x: number, z: number, settings: { arrangement?: PreviewBookArrangement; size?: Vec3; yaw?: number; facing?: number } = {}) => {
      if (full()) return false
      const bookArrangement = settings.arrangement ?? arrangement
      const size = settings.size ?? (kind === 'books' && bookArrangement === 'stacked' ? PREVIEW_BOOK_STACK_BOUNDS : footprints[kind])
      const facing = rotation + (settings.facing ?? 0) + (settings.yaw ?? 0)
      // Rotated footprints are checked through their axis-aligned extent on the surface.
      const turn = settings.facing ?? 0, spin = Math.abs(Math.sin(turn + (settings.yaw ?? 0))), keep = Math.abs(Math.cos(turn + (settings.yaw ?? 0)))
      const extentX = (size[0] * keep + size[2] * spin) / 2, extentZ = (size[0] * spin + size[2] * keep) / 2
      if (!insideSurface(x - extentX, x + extentX, z - extentZ, z + extentZ, 0.025)) return false
      const position = worldPosition(target, x, 0.002, z)
      const box = envelope(position, facing, [0, size[1] / 2, 0], [size[0] + CLEARANCE, size[1] + CLEARANCE, size[2] + CLEARANCE])
      if (!clear([box], target.memberIds)) return false
      const id = `${panelId}:${kind}:${x.toFixed(4)}:${z.toFixed(4)}`
      push({ id, kind, position: position.toArray() as Vec3, rotation: facing,
        ...(kind === 'books' ? { bookArrangement, bookSeed } : {}), ...(settings.size ? { size: settings.size } : {}) }, [box], kind !== 'books')
      return true
    }
    const sideWalls = item.sideWallCount ? obstacles.filter(other => !target.memberIds.has(other.panel.id)).map(other => ({ item: other, bounds: boundsInSurface(other, target) }))
      .filter(({ item: other, bounds }) => Math.abs(other.normal.dot(target.x)) > 0.95
        && bounds.min.y < 0.04 && bounds.max.y > 0.16 && bounds.min.z < -0.08 && bounds.max.z > 0.08
        && (bounds.max.x < -0.03 && bounds.max.x >= -width / 2 - 0.03
          || bounds.min.x > 0.03 && bounds.min.x <= width / 2 + 0.03)) : []
    let anchoredSide: PreviewBookSupport | undefined
    const addStandingBooks = () => {
      if (arrangement === 'stacked') return false
      const preferred: PreviewBookSupport = variation % 2 ? 'left' : 'right'
      for (const side of [preferred, preferred === 'left' ? 'right' : 'left'] as const) {
        const bounds = getPreviewBookBounds(createPreviewBooks(bookSeed, arrangement, side))
        const z = depth / 2 - 0.035 - bounds.max[2]
        const walls = sideWalls.filter(wall => wall.bounds.max.y >= bounds.max[1] - 0.025
          && wall.bounds.min.z <= z + bounds.min[2] && wall.bounds.max.z >= z + bounds.max[2]
          && (side === 'left' ? wall.bounds.max.x < -0.03 && wall.bounds.max.x >= -width / 2 - 0.03
            : wall.bounds.min.x > 0.03 && wall.bounds.min.x <= width / 2 + 0.03))
          .sort((a, b) => side === 'left' ? a.bounds.max.x - b.bounds.max.x : b.bounds.min.x - a.bounds.min.x)
        for (const wall of walls) {
          // Anchor the upright end to the wall. Connector gaps can put the wall
          // slightly beyond the board: stop at the board edge rather than overhang.
          const x = side === 'left'
            ? Math.max(wall.bounds.max.x + 0.003, -width / 2 + 0.002) - bounds.min[0]
            : Math.min(wall.bounds.min.x - 0.003, width / 2 - 0.002) - bounds.max[0]
          if (!insideSurface(x + bounds.min[0], x + bounds.max[0], z + bounds.min[2], z + bounds.max[2], 0.0019)) continue
          const position = worldPosition(target, x, 0.002, z)
          const size = bounds.max.map((max, axis) => max - bounds.min[axis] + 0.002) as Vec3
          const offset = bounds.max.map((max, axis) => (max + bounds.min[axis]) / 2) as Vec3
          const box = envelope(position, rotation, offset, size)
          if (!clear([box], target.memberIds)) continue
          push({ id: `${panelId}:books:${side}`, kind: 'books', position: position.toArray() as Vec3,
            rotation, bookArrangement: arrangement, bookSeed, bookSupport: side }, [box], false)
          anchoredSide = side
          return true
        }
      }
      return false
    }
    const primaryBookX = width > 0.65 ? -width * (0.12 + (variation % 9) * 0.012) : 0
    const addBooks = (x = primaryBookX) => addStandingBooks() || addObject('books', x, 0, { arrangement: 'stacked' })
    const decorKind = (variation >>> 8) % 2 ? 'plant' as const : 'vase' as const
    const addDecoration = (x = width > 0.70 ? ((variation % 9) - 4) * width * 0.025 : 0, z = 0) =>
      addObject(decorKind, x, z) || addObject(decorKind === 'plant' ? 'vase' : 'plant', x, z)
    const jitter = () => shuffled ? (random() - 0.5) * 0.16 : 0
    /** A boxed insert sized to the compartment, with breathing room above. */
    const insertSize = (kind: 'basket' | 'storage-box', span: number): Vec3 | null => {
      const w = Math.min(0.36, span - 0.06), d = Math.min(0.36, depth - 0.07)
      const h = Math.min(kind === 'basket' ? 0.24 : 0.26, (Number.isFinite(headroom) ? headroom : 0.4) - 0.04)
      return w >= 0.18 && d >= 0.18 && h >= 0.12 ? [w, h, d] : null
    }
    const addInserts = (kind: 'basket' | 'storage-box') => {
      if (width >= 0.75) {
        const size = insertSize(kind, width / 2)
        if (size) {
          const placed = [-1, 1].filter(side => addObject(kind, side * width / 4, 0, { size })).length
          if (placed) return true
        }
      }
      const size = insertSize(kind, width)
      return !!size && addObject(kind, 0, 0, { size })
    }
    /** A seat at a table edge, optionally occupied. Side +1 is the front. */
    const addTableSeat = (x: number, side: 1 | -1, occupied: boolean, idSuffix = '') => {
      if (full() || (occupied && people >= MAX_PEOPLE)) return false
      const seatY = FLOOR_Y + DESK_SEAT_HEIGHT
      const position = worldPosition(target, x, seatY - center.y, side * (depth / 2 + 0.35))
      const facing = rotation + (side > 0 ? Math.PI : 0)
      const boxes = occupied ? personEnvelopes(position, facing, DESK_SEAT_HEIGHT, true) : chairEnvelopes(position, facing, DESK_SEAT_HEIGHT)
      if (!clear(boxes)) return false
      const kind = occupied ? 'seated-person-chair' as const : 'chair' as const
      const id = `${panelId}:${kind}${idSuffix}`
      push({ id, kind, position: position.toArray() as Vec3, rotation: facing, seatHeight: DESK_SEAT_HEIGHT }, boxes)
      if (occupied) people++
      return true
    }

    switch (role) {
      case 'bench': {
        const seats = item.seats.length ? item.seats : benchSeats(target).filter(candidate => candidate.boxes.every(box =>
          !obstacles.some(other => box.intersectsOBB(other.obb, 1e-8))))
        const freeSeat = people < MAX_PEOPLE && !full() ? seats.find(candidate => clear(candidate.boxes)) : undefined
        if (freeSeat) {
          const id = `${panelId}:seated-person`
          const poses: SeatedPose[] = ['relaxed', 'reading', 'laptop']
          const pose = density === 'minimal' ? 'relaxed' : poses[variationHash(`${id}:pose`, seed) % 3]
          push({ id, kind: 'seated-person', position: freeSeat.position.toArray() as Vec3,
            rotation: freeSeat.rotation, seatHeight: freeSeat.seatHeight, ...(pose === 'relaxed' ? {} : { pose }) }, freeSeat.boxes)
          people++
        }
        if (width > 1.2) addObject('books', width / 2 - 0.19, -0.015, { arrangement: 'stacked' })
        if (!freeSeat) addObject('vase', -width / 2 + 0.16, 0)
        if (density === 'lived-in') {
          const away = freeSeat ? (freeSeat.x <= 0 ? 1 : -1) : 1
          addObject('cushion', away * (width / 2 - 0.25), 0, { yaw: jitter() })
        }
        break
      }
      case 'desk': {
        // Seed 0 keeps the established composition; a shuffle mirrors it or swaps in a laptop.
        const mirror = shuffled && random() < 0.5 ? -1 : 1
        const laptop = shuffled && random() < 0.35
        // A riser or shelf behind the work zone can leave room for a laptop only.
        const useLaptop = laptop || !addObject('computer', mirror * 0.07, 0.01)
        const machine = useLaptop ? addObject('laptop', mirror * 0.04, 0.04) : true
        addObject('table-lamp', mirror * (-width / 2 + 0.17), -depth / 2 + 0.17)
        if (width > 1.4 && density !== 'minimal') addObject('plant', mirror * (width / 2 - 0.17), -depth / 2 + 0.17)
        if (density === 'lived-in') {
          addObject('mug', mirror * (useLaptop ? 0.3 : 0.45), depth / 2 - 0.1)
          addObject('notebook', mirror * -(useLaptop ? 0.3 : 0.42), depth / 2 - 0.13, { yaw: 0.12 + jitter() })
        }
        if (machine) addTableSeat(mirror * (useLaptop ? 0.04 : 0.07), 1, true)
        break
      }
      case 'standing-desk': {
        addObject('laptop', 0, 0.02)
        addObject('table-lamp', -width / 2 + 0.17, -depth / 2 + 0.17)
        if (width > 1.2 && density !== 'minimal') addObject('plant', width / 2 - 0.17, -depth / 2 + 0.17)
        if (density === 'lived-in') addObject('mug', 0.32, depth / 2 - 0.1)
        break
      }
      case 'dining-table': {
        addObject(variation % 2 ? 'bowl' : 'vase', 0, 0) || addObject('plant', 0, 0)
        const count = Math.max(1, Math.min(4, Math.floor(width / 0.6)))
        const xs = Array.from({ length: count }, (_, index) => ((index + 0.5) / count - 0.5) * width)
        const sides: (1 | -1)[] = density === 'minimal' ? [1] : [1, -1]
        let diners = density === 'minimal' ? 0 : density === 'balanced' ? 1 : 2
        for (const side of sides) for (const x of xs) {
          if (full()) break
          const z = side * (depth / 2 - 0.18)
          if (!addObject('place-setting', x, z, { facing: side > 0 ? 0 : Math.PI })) continue
          const seated = diners > 0 && addTableSeat(x, side, true, `:${x.toFixed(3)}:${side}`)
          if (seated) diners--
          else addTableSeat(x, side, false, `:${x.toFixed(3)}:${side}`)
        }
        break
      }
      case 'coffee-table': {
        addObject('tray', -width * 0.16, 0, { yaw: jitter() })
        if (density !== 'minimal') addObject('books', width * 0.2, -0.02, { arrangement: 'stacked' })
        if (density === 'lived-in') addObject(variation % 2 ? 'plant' : 'bowl', width * 0.2, depth / 2 - 0.15) || addObject('mug', width * 0.02, depth / 2 - 0.08)
        break
      }
      case 'side-table': {
        const lamp = addObject('table-lamp', 0, -Math.min(0.04, depth / 2 - 0.15))
        if (!lamp) addObject('plant', 0, 0)
        if (density !== 'minimal') addObject('books', 0, depth / 2 - 0.14, { arrangement: 'stacked' })
        if (density === 'lived-in') addObject('mug', width / 2 - 0.09, depth / 2 - 0.08)
        break
      }
      case 'counter': {
        addObject('cutting-board', -width * 0.15, 0.04, { yaw: jitter() })
        addObject('jars', width * 0.22, -depth / 2 + 0.1)
        if (density !== 'minimal') addObject('bowl', width * 0.25, depth / 2 - 0.16)
        if (density === 'lived-in') addObject('plant', -width / 2 + 0.15, -depth / 2 + 0.14)
        break
      }
      case 'sideboard': {
        const side = shuffled && random() < 0.5 ? -1 : 1
        addObject('table-lamp', side * (-width / 2 + 0.17), -0.01)
        addDecoration(side * (width / 2 - 0.15))
        if (density !== 'minimal') addObject('picture-frame', side * width * 0.08, -depth / 2 + 0.07, { yaw: jitter() * 0.5 })
        if (density === 'lived-in') addObject('books', side * -width * 0.12, 0.03, { arrangement: 'stacked' })
        break
      }
      case 'lowboard': {
        // Leave room for decor or speakers at both ends of the screen.
        const tv: Vec3 = width >= 1.75 ? [1.23, 0.77, 0.26] : width >= 1.35 ? [0.97, 0.62, 0.22] : [0.73, 0.48, 0.18]
        const placedTv = headroom > tv[1] + 0.03 && addObject('tv', 0, -depth / 2 + tv[2] / 2 + 0.03, { size: tv })
        const edge = width / 2 - 0.12, front = Math.max(0, depth / 2 - 0.13)
        if (!placedTv) addBooks(-width * 0.2)
        if (density !== 'minimal') addDecoration(edge, front)
        if (density === 'lived-in' || (!placedTv && density === 'balanced')) addObject('speaker', -edge, front)
        break
      }
      case 'bed': {
        // Pillows go to the end with a headboard, otherwise the left end.
        const walls = obstacles.filter(other => !target.memberIds.has(other.panel.id) && Math.abs(other.normal.dot(target.x)) > 0.95)
          .map(other => boundsInSurface(other, target)).filter(bounds => bounds.max.y > 0.15 && bounds.min.z < 0 && bounds.max.z > 0)
        const headAtRight = walls.some(bounds => bounds.min.x > width / 2 - 0.1) && !walls.some(bounds => bounds.max.x < -width / 2 + 0.1)
        const size: Vec3 = [width - 0.06, 0.26, depth - 0.06]
        if (size[0] > 1.6 && size[2] > 0.7) addObject('bedding', 0, 0, { size, facing: headAtRight ? Math.PI : 0 })
        break
      }
      case 'display': {
        const chance = density === 'minimal' ? 2 : density === 'balanced' ? 3 : 6
        if (variationHash(`${panelId}:contents`, seed) % 10 < chance) {
          const statement = (shuffled || density === 'lived-in') && width >= 0.6
          if (statement && addObject('picture-frame', -width * 0.15, -depth / 2 + 0.07, { yaw: jitter() * 0.5 })) addDecoration(width * 0.2)
          else addDecoration()
        }
        break
      }
      case 'shelf': {
        const content = contents.get(panelId) ?? 'empty'
        const fallback = () => addDecoration()
        let primaryBooks = false
        switch (content) {
          case 'empty': break
          case 'decor': fallback(); break
          case 'books': primaryBooks = addBooks() || (fallback(), false); break
          case 'basket': case 'storage-box': if (!addInserts(content)) addBooks() || fallback(); break
          case 'records': if (!addObject('records', anchoredSide === 'left' ? width / 2 - 0.13 : -width / 2 + 0.13, 0)) addBooks() || fallback(); break
          case 'jars': addObject('jars', 0, -depth / 2 + 0.09) || fallback(); break
          case 'bowl': addObject('bowl', 0, 0) || fallback(); break
          case 'frame': addObject('picture-frame', 0, -depth / 2 + 0.07, { yaw: jitter() * 0.5 }) || fallback(); break
          case 'textiles': addObject('textiles', 0, 0, { yaw: jitter() * 0.3 }) || fallback(); break
        }
        if (primaryBooks) {
          // Long shelves continue the row with a further group at the far end.
          const extras = extraSegments(density, width)
          const far = anchoredSide === 'left' ? 1 : anchoredSide === 'right' ? -1 : 1
          const options: (() => boolean)[] = [
            () => addDecoration(far * (width / 2 - 0.14)),
            () => addObject('books', far * (width / 2 - 0.16), 0, { arrangement: 'stacked' }),
            () => addObject('picture-frame', far * (width / 2 - 0.19), -depth / 2 + 0.07),
          ]
          const start = variationHash(`${panelId}:segments`, seed) % options.length
          let added = 0
          for (let index = 0; index < options.length && added < extras; index++) if (options[(start + index) % options.length]()) added++
          // A second extra fills the middle of very long shelves.
          if (added && extras > 1) addObject(theme === 'kitchen' ? 'jars' : 'vase', far * width * 0.1, -0.02)
        }
        break
      }
    }
    surfacesOut.push({ panelId, role, detected: item.detected, source: item.source, furnished: result.length > before,
      features: item.features, memberIds: [...item.base.memberIds] })
  }
  const roomTheme = resolveTheme(options.theme ?? 'auto', analysed.map(item => item.role), objectInserts.size > 0)
  return { placements: result, surfaces: surfacesOut, theme: roomTheme }
}

export function detectPreviewFurnishings(panels: Panel[], options: FurnishingOptions = {}): FurnishingPlacement[] {
  return planPreviewFurnishings(panels, options).placements
}

/** Assembly and list-group names often say what a build is for. */
export function furnishingNameHints(project: Pick<Project, 'assemblies' | 'listGroups'>): Record<string, string> {
  const names = new Map<string, string[]>()
  const add = (id: string, name: string | undefined) => {
    if (!name?.trim()) return
    const list = names.get(id) ?? []
    if (!list.includes(name)) names.set(id, [...list, name])
  }
  const definitions = new Map((project.assemblies?.definitions ?? []).map(definition => [definition.id, definition.name]))
  for (const instance of project.assemblies?.instances ?? []) for (const id of Object.values(instance.panelIds)) {
    add(id, instance.name)
    add(id, definitions.get(instance.definitionId))
  }
  for (const group of project.listGroups ?? []) if (group.kind === 'panels') for (const id of group.itemIds) add(id, group.name)
  return Object.fromEntries([...names].map(([id, list]) => [id, list.join(' · ')]))
}
