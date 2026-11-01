import { Box3, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import type { Panel, Vec3 } from './types'
import { getTrofastInsertObb } from './trofast'
import { createPreviewBooks, getPreviewBookBounds, PREVIEW_BOOK_BOUNDS, PREVIEW_BOOK_STACK_BOUNDS, type PreviewBookArrangement, type PreviewBookSupport } from './preview-books'

export type FurnishingKind = 'books' | 'table-lamp' | 'computer' | 'plant' | 'vase' | 'seated-person' | 'seated-person-chair'
/** Preview-only transforms, in metres. People originate at the top of their seat. */
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
}

export const MAX_PREVIEW_FURNISHINGS = 32
const MAX_PEOPLE = 2
const FLOOR_Y = -0.012
const UP = new Vector3(0, 1, 0)
const MM = 0.001
const CLEARANCE = 0.008
const footprints: Record<Exclude<FurnishingKind, 'seated-person' | 'seated-person-chair'>, Vec3> = {
  books: PREVIEW_BOOK_BOUNDS,
  'table-lamp': [0.25, 0.42, 0.25],
  computer: [0.62, 0.48, 0.50],
  plant: [0.21, 0.30, 0.21],
  vase: [0.18, 0.26, 0.18],
}

interface Obstacle { panel: Panel; obb: OBB; bounds: Box3; normal: Vector3 }
interface Surface { obstacle: Obstacle; center: Vector3; x: Vector3; z: Vector3; width: number; depth: number; rotation: number }

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

function surface(item: Obstacle): Surface | null {
  const { panel, normal } = item
  // A bounding rectangle cannot safely furnish a cutout, perforated or tilted board.
  if (panel.customOutline || panel.trofastInserts?.length || panel.pattern !== 'solid' || Math.abs(normal.y) < 0.999999) return null
  const quaternion = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const x = (panel.width >= panel.height ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).applyQuaternion(quaternion)
  x.y = 0
  x.normalize()
  // Prefer the edge facing the room, independently of the board's face direction.
  if (x.x < -0.000001 || (Math.abs(x.x) <= 0.000001 && x.z > 0)) x.negate()
  const z = new Vector3().crossVectors(x, UP)
  return {
    obstacle: item, center: new Vector3(item.obb.center.x, item.bounds.max.y, item.obb.center.z), x, z,
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

/** Side walls identify a shelf's opening even when its depth exceeds its width. */
function faceOpening(base: Surface, obstacles: Obstacle[]): Surface {
  const nearby = obstacles.filter(item => item !== base.obstacle && Math.abs(item.normal.y) < 0.05
    && item.bounds.max.y > base.center.y - 0.06 && item.bounds.min.y < base.center.y + 0.35
    && item.bounds.min.x < base.obstacle.bounds.max.x + 0.085 && item.bounds.max.x > base.obstacle.bounds.min.x - 0.085
    && item.bounds.min.z < base.obstacle.bounds.max.z + 0.085 && item.bounds.max.z > base.obstacle.bounds.min.z - 0.085)
  let best = base, bestScore = -Infinity
  for (let turn = 0; turn < 4; turn++) {
    const angle = turn * Math.PI / 2
    const candidate: Surface = { ...base, x: base.x.clone().applyAxisAngle(UP, angle), z: base.z.clone().applyAxisAngle(UP, angle),
      width: turn % 2 ? base.depth : base.width, depth: turn % 2 ? base.width : base.depth, rotation: base.rotation + angle }
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

function bookVariation(id: string) {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return hash >>> 0
}

/** Benches use their long span, independently of the opening of adjacent shelving. */
function benchSurface(base: Surface): Surface {
  const panel = base.obstacle.panel
  const intrinsicX = (panel.width >= panel.height ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0))
    .applyEuler(new Euler(...panel.rotation))
  // Keep the panel's axis direction so rotating a build also rotates its occupant.
  return intrinsicX.dot(base.x) >= 0 ? base : { ...base, x: base.x.clone().negate(), z: base.z.clone().negate(), rotation: base.rotation + Math.PI }
}

function supportedBench(target: Surface, obstacles: Obstacle[]) {
  const { width, depth, center } = target
  const height = center.y - FLOOR_Y
  if (height < 0.32 || height > 0.56 || width < 0.75 || depth < 0.30 || depth > 0.58 || width / depth < 1.8) return false

  // Shelving can carry one end through several panels. Follow only downward
  // contacts, allowing normal connector gaps, and never use the seat as its own support.
  const grounded = new Map<string, boolean>()
  const reachesFloor = (item: Obstacle, steps = 0): boolean => {
    if (item.bounds.min.y < 0.12) return true
    if (steps >= 12) return false
    const cacheKey = `${steps}:${item.panel.id}`
    const cached = grounded.get(cacheKey)
    if (cached !== undefined) return cached
    const nearby = item.obb.clone()
    nearby.halfSize.addScalar(0.04)
    const supported = obstacles.some(lower => lower !== item && lower !== target.obstacle
      && lower.bounds.min.y < item.bounds.min.y - 0.005 && lower.bounds.max.y >= item.bounds.min.y - 0.04
      && nearby.intersectsOBB(lower.obb, 1e-8) && reachesFloor(lower, steps + 1))
    grounded.set(cacheKey, supported)
    return supported
  }
  let left = false, right = false
  const endZone = Math.min(0.20, width * 0.25)
  for (const item of obstacles) {
    if (item === target.obstacle || Math.abs(item.normal.y) > 0.05) continue
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

function personEnvelopes(position: Vector3, rotation: number, seatHeight: number, chair: boolean) {
  const boxes = [
    envelope(position, rotation, [0, 0.462, 0], [0.50, 0.92, 0.36]),
    envelope(position, rotation, [0, 0.097, 0.16], [0.48, 0.19, 0.44]),
    envelope(position, rotation, [0, 0.24, 0.195], [0.50, 0.22, 0.29]),
    envelope(position, rotation, [0, (-seatHeight + 0.06) / 2, 0.385], [0.43, seatHeight + 0.06, 0.29]),
  ]
  if (chair) boxes.push(
    envelope(position, rotation, [0, -0.028, 0], [0.48, 0.056, 0.44]),
    envelope(position, rotation, [0, 0.22, -0.20], [0.48, 0.50, 0.06]),
    envelope(position, rotation, [0, -seatHeight / 2, 0], [0.46, seatHeight - 0.015, 0.42]),
  )
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
    return { position, rotation, seatHeight, boxes: personEnvelopes(position, rotation, seatHeight, false) }
  }))
}

/**
 * Conservative, deterministic decoration of recognisable horizontal surfaces.
 * Call only while the user has enabled furnishings. No project data is modified.
 * Candidate and object budgets keep clearance work bounded even on large builds.
 */
export function detectPreviewFurnishings(panels: Panel[]): FurnishingPlacement[] {
  const obstacles = panels.filter(panel => panel.visible && [...panel.position, ...panel.rotation, panel.width, panel.height, panel.thickness].every(Number.isFinite)
    && panel.width > 0 && panel.height > 0 && panel.thickness > 0).map(obstacle)
  const surfaces = obstacles.map(surface).filter((item): item is Surface => !!item)
    .filter(item => item.width >= 0.30 && item.width <= 3 && item.depth >= 0.22 && item.depth <= 1.05 && item.center.y >= FLOOR_Y + 0.002 && item.center.y <= 2.15)
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x || a.center.z - b.center.z || a.obstacle.panel.id.localeCompare(b.obstacle.panel.id))
  const result: FurnishingPlacement[] = []
  const occupied: OBB[] = panels.filter(panel => panel.visible).flatMap(panel => (panel.trofastInserts ?? []).flatMap(insert => {
    const box = getTrofastInsertObb(panel, insert)
    if (!box) return []
    box.center.multiplyScalar(MM); box.halfSize.multiplyScalar(MM)
    return [box]
  }))
  let people = 0

  const clear = (boxes: OBB[], supportId?: string) => boxes.every(box =>
    !obstacles.some(item => item.panel.id !== supportId && box.intersectsOBB(item.obb, 1e-8))
    && !occupied.some(other => box.intersectsOBB(other, 1e-8)))

  for (const base of surfaces.slice(0, 96)) {
    if (result.length >= MAX_PREVIEW_FURNISHINGS) break
    const seat = benchSurface(base)
    const seats = supportedBench(seat, obstacles) ? benchSeats(seat).filter(candidate => candidate.boxes.every(box =>
      !obstacles.some(item => box.intersectsOBB(item.obb, 1e-8)))) : []
    const bench = seats.length > 0
    const target = bench ? seat : faceOpening(base, obstacles)
    const { width, depth, center, rotation } = target
    const panelId = target.obstacle.panel.id
    const relatives = obstacles.filter(item => item.panel.id !== panelId).map(item => ({ item, bounds: boundsInSurface(item, target) }))
    const overlap = (bounds: Box3) => bounds.min.x < width / 2 - 0.08 && bounds.max.x > -width / 2 + 0.08
      && bounds.min.z < depth / 2 - 0.05 && bounds.max.z > -depth / 2 + 0.05
    const above = relatives.some(({ item, bounds }) => Math.abs(item.normal.y) > 0.999999 && bounds.min.y > 0.01 && bounds.min.y < 1 && overlap(bounds))
    const below = relatives.some(({ item, bounds }) => Math.abs(item.normal.y) > 0.999999 && bounds.max.y < -0.01 && bounds.max.y > -1.2 && overlap(bounds))
    const supports = relatives.filter(({ item, bounds }) => Math.abs(item.normal.y) < 0.05 && item.bounds.min.y < 0.12
      && bounds.max.y > -0.085 && bounds.min.y < -0.25
      && bounds.min.x < width / 2 + 0.08 && bounds.max.x > -width / 2 - 0.08
      && bounds.min.z < depth / 2 + 0.08 && bounds.max.z > -depth / 2 - 0.08)
    const supported = supports.length >= 2
    const desk = supported && !above && center.y >= 0.64 && center.y <= 0.86 && width >= 0.90 && depth >= 0.55

    const variation = bookVariation(panelId)
    const arrangement: PreviewBookArrangement = (above || center.y < 1.1) && variation % 5 < 2 ? 'stacked' : variation % 2 ? 'leaning' : 'upright'
    const bookSeed = `${panelId}:books`
    const insideSurface = (minX: number, maxX: number, minZ: number, maxZ: number, margin: number) => {
      const edgeX = Math.max(Math.abs(minX), Math.abs(maxX)), edgeZ = Math.max(Math.abs(minZ), Math.abs(maxZ))
      if (edgeX > width / 2 - margin || edgeZ > depth / 2 - margin) return false
      const radius = Math.min((target.obstacle.panel.cornerRadius ?? 0) * MM, width / 2, depth / 2)
      const cornerX = Math.max(0, edgeX - (width / 2 - radius)), cornerZ = Math.max(0, edgeZ - (depth / 2 - radius))
      return radius <= 0 || Math.hypot(cornerX, cornerZ) <= Math.max(0, radius - Math.min(margin, 0.012))
    }
    const addObject = (kind: keyof typeof footprints, x: number, z: number, bookArrangement = arrangement) => {
      if (result.length >= MAX_PREVIEW_FURNISHINGS) return false
      const size = kind === 'books' && bookArrangement === 'stacked' ? PREVIEW_BOOK_STACK_BOUNDS : footprints[kind]
      if (!insideSurface(x - size[0] / 2, x + size[0] / 2, z - size[2] / 2, z + size[2] / 2, 0.025)) return false
      const position = worldPosition(target, x, 0.002, z)
      const box = envelope(position, rotation, [0, size[1] / 2, 0], [size[0] + CLEARANCE, size[1] + CLEARANCE, size[2] + CLEARANCE])
      if (!clear([box], panelId)) return false
      result.push({ id: `${panelId}:${kind}:${x.toFixed(4)}:${z.toFixed(4)}`, panelId, kind, position: position.toArray() as Vec3, rotation,
        ...(kind === 'books' ? { bookArrangement, bookSeed } : {}) })
      occupied.push(box)
      return true
    }
    const sideWalls = relatives.filter(({ item, bounds }) => Math.abs(item.normal.dot(target.x)) > 0.95
      && bounds.min.y < 0.04 && bounds.max.y > 0.16 && bounds.min.z < -0.08 && bounds.max.z > 0.08
      && (bounds.max.x < -0.03 && bounds.max.x >= -width / 2 - 0.03
        || bounds.min.x > 0.03 && bounds.min.x <= width / 2 + 0.03))
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
          if (!clear([box], panelId)) continue
          result.push({ id: `${panelId}:books:${side}`, panelId, kind: 'books', position: position.toArray() as Vec3,
            rotation, bookArrangement: arrangement, bookSeed, bookSupport: side })
          occupied.push(box)
          return true
        }
      }
      return false
    }
    const addBooks = (x: number) => addStandingBooks() || addObject('books', x, 0, 'stacked')
    const addDecoration = () => {
      const x = width > 0.70 ? ((variation % 9) - 4) * width * 0.025 : 0
      const kind = (variation >>> 8) % 2 ? 'plant' : 'vase'
      return addObject(kind, x, 0) || addObject(kind === 'plant' ? 'vase' : 'plant', x, 0)
    }
    const addDeskOccupant = (x: number) => {
      if (people >= MAX_PEOPLE || result.length >= MAX_PREVIEW_FURNISHINGS) return false
      const seatHeight = 0.46, seatY = FLOOR_Y + seatHeight
      const position = worldPosition(target, x, seatY - center.y, depth / 2 + 0.35)
      const facing = rotation + Math.PI
      const boxes = personEnvelopes(position, facing, seatHeight, true)
      if (!clear(boxes)) return false
      const kind = 'seated-person-chair'
      result.push({ id: `${panelId}:${kind}`, panelId, kind, position: position.toArray() as Vec3, rotation: facing, seatHeight })
      occupied.push(...boxes)
      people++
      return true
    }

    if (bench) {
      const freeSeat = people < MAX_PEOPLE ? seats.find(candidate => clear(candidate.boxes)) : undefined
      if (freeSeat) {
        result.push({ id: `${panelId}:seated-person`, panelId, kind: 'seated-person', position: freeSeat.position.toArray() as Vec3,
          rotation: freeSeat.rotation, seatHeight: freeSeat.seatHeight })
        occupied.push(...freeSeat.boxes)
        people++
      }
      if (width > 1.2) addObject('books', width / 2 - 0.19, -0.015, 'stacked')
      if (!freeSeat) addObject('vase', -width / 2 + 0.16, 0)
    } else if (desk) {
      const computer = addObject('computer', 0.07, 0.01)
      addObject('table-lamp', -width / 2 + 0.17, -depth / 2 + 0.17)
      if (width > 1.4) addObject('plant', width / 2 - 0.17, -depth / 2 + 0.17)
      if (computer) addDeskOccupant(0.07)
    } else if (depth <= 0.55) {
      const contents = bookVariation(`${panelId}:contents`) % 10
      if (!above && below && !sideWalls.length) {
        // A bookcase's exposed cap gets occasional decor, not unsupported books.
        if (contents < 3) addDecoration()
      } else if (contents >= 2 && contents < 5) {
        addDecoration()
      } else if (contents >= 5) {
        const x = width > 0.65 ? -width * (0.12 + (variation % 9) * 0.012) : 0
        if (!addBooks(x)) addDecoration()
      }
      // Other compartments intentionally stay empty, independent of render limits.
    }
  }
  return result
}
