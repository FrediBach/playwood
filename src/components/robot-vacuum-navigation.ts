import { Box3, Euler, Vector3 } from 'three'
import type { FurnishingPlacement } from '@/lib/preview-furnishings'
import { getTrofastInsertObb } from '@/lib/trofast'
import type { Panel } from '@/lib/types'
import { getRoomLayout } from './room-layout'

export interface VacuumPoint { x: number; z: number }
export interface VacuumObstacle { minX: number; maxX: number; minZ: number; maxZ: number; id: string }
export interface VacuumRoom { minX: number; maxX: number; minZ: number; maxZ: number }
export interface VacuumPlan {
  dock: VacuumPoint
  start: VacuumPoint
  /** First and last points are the clear egress position; repeat from index 1. */
  waypoints: VacuumPoint[]
  obstacles: VacuumObstacle[]
  room: VacuumRoom
  floorY: number
}

export const VACUUM_RADIUS = 0.175
// A small allowance also keeps the side brush and nearby joint hardware clear.
export const VACUUM_CLEARANCE = 0.215
const VACUUM_HEIGHT = 0.111
const DOCK_WIDTH = 0.34
const DOCK_DEPTH = 0.457
const DOCK_HEIGHT = 0.59
const MAX_GRID_AXIS = 128
const MM = 0.001

function rectangle(id: string, x: number, z: number, width: number, depth: number, rotation = 0): VacuumObstacle {
  const halfX = (Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * depth) / 2
  const halfZ = (Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * depth) / 2
  return { id, minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ }
}

function footprint(id: string, bounds: Box3): VacuumObstacle {
  return { id, minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z, maxZ: bounds.max.z }
}

/** Continuous segment/expanded-box test, including walls thinner than a grid cell. */
export function isVacuumSegmentClear(from: VacuumPoint, to: VacuumPoint, obstacles: VacuumObstacle[], room: VacuumRoom, radius = VACUUM_CLEARANCE): boolean {
  if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return false
  if ([from, to].some(point => point.x < room.minX + radius || point.x > room.maxX - radius
    || point.z < room.minZ + radius || point.z > room.maxZ - radius)) return false
  return !obstacles.some(obstacle => {
    let enter = 0, leave = 1
    for (const [start, end, min, max] of [
      [from.x, to.x, obstacle.minX - radius, obstacle.maxX + radius],
      [from.z, to.z, obstacle.minZ - radius, obstacle.maxZ + radius],
    ]) {
      const delta = end - start
      if (Math.abs(delta) < 1e-12) {
        if (start < min || start > max) return false
      } else {
        const a = (min - start) / delta, b = (max - start) / delta
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
        if (enter > leave) return false
      }
    }
    return true
  })
}

function projectBoxes(panels: Panel[]): { id: string; bounds: Box3 }[] {
  return panels.filter(panel => panel.visible !== false).flatMap(panel => {
    const euler = new Euler(...panel.rotation)
    const position = new Vector3(...panel.position)
    const bounds = new Box3()
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      bounds.expandByPoint(new Vector3(x * panel.width / 2, y * panel.height / 2, z * panel.thickness / 2)
        .applyEuler(euler).add(position).multiplyScalar(MM))
    }
    const boxes = [{ id: `panel:${panel.id}`, bounds }]
    for (const insert of panel.trofastInserts ?? []) {
      const obb = getTrofastInsertObb(panel, insert)
      if (!obb) continue
      const insertBounds = new Box3()
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        insertBounds.expandByPoint(new Vector3(x, y, z).multiply(obb.halfSize).applyMatrix3(obb.rotation).add(obb.center).multiplyScalar(MM))
      }
      boxes.push({ id: `insert:${panel.id}:${insert.id}`, bounds: insertBounds })
    }
    return boxes
  })
}

function furnishingObstacles(furnishings: FurnishingPlacement[], ceiling: number): VacuumObstacle[] {
  return furnishings.flatMap(item => {
    const [x, y, z] = item.position
    if (item.kind === 'seated-person' || item.kind === 'seated-person-chair') {
      const footX = x + Math.sin(item.rotation) * 0.385
      const footZ = z + Math.cos(item.rotation) * 0.385
      const feet = rectangle(`furnishing:${item.id}:feet`, footX, footZ, 0.43, 0.29, item.rotation)
      return item.kind === 'seated-person-chair'
        ? [feet, rectangle(`furnishing:${item.id}:chair`, x, z, 0.5, 0.47, item.rotation)] : [feet]
    }
    if (y > ceiling) return []
    const size = item.kind === 'computer' ? [0.62, 0.5] : item.kind === 'books' ? [0.48, 0.3]
      : item.kind === 'table-lamp' ? [0.25, 0.25] : item.kind === 'plant' ? [0.21, 0.21] : [0.18, 0.18]
    return [rectangle(`furnishing:${item.id}`, x, z, size[0], size[1], item.rotation)]
  })
}

function appendPoint(points: VacuumPoint[], point: VacuumPoint) {
  const last = points.at(-1), previous = points.at(-2)
  if (last && Math.hypot(last.x - point.x, last.z - point.z) < 1e-8) return
  // Remove straight intermediate cells, but preserve every reversal and corner.
  if (last && previous) {
    const ax = last.x - previous.x, az = last.z - previous.z
    const bx = point.x - last.x, bz = point.z - last.z
    if (Math.abs(ax * bz - az * bx) < 1e-10 && ax * bx + az * bz > 0) points.pop()
  }
  points.push(point)
}

/**
 * Reconnects an existing pose after preview furnishings change, without moving
 * the robot. The first target is a visible projection onto the new closed sweep;
 * the final target is that same projection, so movement can still loop at 1.
 * If a new object occupies this pose, wait for another change instead of jumping
 * through the object or returning to the station.
 */
export function rejoinVacuumRoute(plan: VacuumPlan, position: VacuumPoint, allowDockExit = false): VacuumPoint[] | null {
  const escape = plan.waypoints[0]
  if (!escape || plan.waypoints.length < 2) return null
  // The robot may still be on its ramp when furnishings change. Only the known
  // straight exit lane may intersect the dock; never ignore it for room joins.
  if (allowDockExit && Math.abs(position.x - plan.start.x) < 1e-7
    && position.z >= plan.start.z - 1e-7 && position.z <= escape.z + 1e-7
    && isVacuumSegmentClear(position, escape, plan.obstacles.filter(item => item.id !== 'dock'), plan.room)) {
    return plan.waypoints.slice()
  }
  if (!isVacuumSegmentClear(position, position, plan.obstacles, plan.room)) return null

  let nearest: { point: VacuumPoint; segment: number; distance: number } | null = null
  for (let index = 0; index < plan.waypoints.length - 1; index++) {
    const a = plan.waypoints[index], b = plan.waypoints[index + 1]
    const dx = b.x - a.x, dz = b.z - a.z
    const lengthSquared = dx * dx + dz * dz
    if (lengthSquared < 1e-16) continue
    const amount = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / lengthSquared))
    const point = { x: a.x + dx * amount, z: a.z + dz * amount }
    const distance = (point.x - position.x) ** 2 + (point.z - position.z) ** 2
    if (nearest && distance >= nearest.distance) continue
    if (isVacuumSegmentClear(position, point, plan.obstacles, plan.room)) nearest = { point, segment: index, distance }
  }
  if (!nearest) return null
  const route = [nearest.point]
  // Exclude the original duplicate end point before rotating the sweep. Every
  // original segment is retained, split only at the selected join projection.
  for (const point of [...plan.waypoints.slice(nearest.segment + 1, -1), ...plan.waypoints.slice(0, nearest.segment + 1)]) {
    appendPoint(route, point)
  }
  appendPoint(route, nearest.point)
  return route
}

/**
 * Preview-only coverage of the dock's connected floor area. The grid has at most
 * 128 × 128 cells and traversal is linear; floor plans cannot make route finding
 * exponential. Conservative rectangles intentionally exclude narrow passages.
 */
export function createVacuumPlan(bounds: Box3, panels: Panel[], furnishings: FurnishingPlacement[] = []): VacuumPlan | null {
  const layout = getRoomLayout(bounds)
  const { floorY, leftX, rightX, backZ, depth, chairX, chairZ } = layout
  if (![floorY, leftX, rightX, backZ, depth].every(Number.isFinite)) return null
  const room = { minX: leftX, maxX: rightX, minZ: backZ, maxZ: backZ + depth }
  const size = bounds.getSize(new Vector3())
  const builtIn = [
    rectangle('room:chair', chairX, chairZ, 0.84, 0.82, -0.2),
    rectangle('room:lamp', chairX + 0.63, chairZ - 0.34, 0.38, 0.38),
    rectangle('room:table', chairX + 0.68, chairZ + 0.42, 0.47, 0.47),
    rectangle('room:plant', -size.x / 2 - 0.7, -size.z / 2 + 0.12, 0.41, 0.41),
    ...[-1, 1].map(side => rectangle(`room:curtain:${side}`, leftX + 0.14, backZ + 2.1 + side * 1.32, 0.08, 0.58)),
  ]
  const boxes = projectBoxes(panels)
  const obstacles = [...builtIn,
    ...boxes.filter(item => item.bounds.min.y <= floorY + VACUUM_HEIGHT + 0.025 && item.bounds.max.y >= floorY)
      .map(item => footprint(item.id, item.bounds)),
    ...furnishingObstacles(furnishings, floorY + VACUUM_HEIGHT + 0.025),
  ]
  const dockObstacles = [...builtIn,
    ...boxes.filter(item => item.bounds.min.y <= floorY + DOCK_HEIGHT + 0.02 && item.bounds.max.y >= floorY)
      .map(item => footprint(item.id, item.bounds)),
    ...furnishingObstacles(furnishings, floorY + DOCK_HEIGHT + 0.02),
  ]
  const dockZ = backZ + DOCK_DEPTH / 2 + 0.045
  const preferredX = -size.x / 2 - 1.45
  const candidates = [preferredX, ...Array.from({ length: 33 }, (_, index) =>
    leftX + 0.45 + (rightX - leftX - 0.9) * index / 32).sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX))]
  const dock = candidates.map(x => ({ x, z: dockZ })).find(point => {
    const station = rectangle('dock', point.x, point.z + 0.06, DOCK_WIDTH + 0.03, DOCK_DEPTH + 0.15)
    if (station.minX < leftX + 0.025 || station.maxX > rightX - 0.025) return false
    if (dockObstacles.some(item => item.minX <= station.maxX && item.maxX >= station.minX
      && item.minZ <= station.maxZ && item.maxZ >= station.minZ)) return false
    return isVacuumSegmentClear({ x: point.x, z: point.z + 0.15 }, { x: point.x, z: point.z + 0.75 }, obstacles, room)
  })
  if (!dock) return null
  const start = { x: dock.x, z: dock.z + 0.15 }
  const escape = { x: dock.x, z: dock.z + 0.75 }
  obstacles.push(rectangle('dock', dock.x, dock.z + 0.06, DOCK_WIDTH, DOCK_DEPTH + 0.12))

  const minX = leftX + VACUUM_CLEARANCE + 0.015, maxX = rightX - VACUUM_CLEARANCE - 0.015
  const minZ = backZ + VACUUM_CLEARANCE + 0.015, maxZ = backZ + depth - VACUUM_CLEARANCE - 0.015
  const columns = Math.min(MAX_GRID_AXIS, Math.max(2, Math.floor((maxX - minX) / 0.28) + 1))
  const rows = Math.min(MAX_GRID_AXIS, Math.max(2, Math.floor((maxZ - minZ) / 0.28) + 1))
  const points = Array.from({ length: columns * rows }, (_, index) => ({
    x: minX + (index % columns) * (maxX - minX) / (columns - 1),
    z: minZ + Math.floor(index / columns) * (maxZ - minZ) / (rows - 1),
  }))
  const free = points.map(point => isVacuumSegmentClear(point, point, obstacles, room))
  const nearest = points.map((point, index) => ({ index, distance: Math.hypot(point.x - escape.x, point.z - escape.z) }))
    .filter(item => free[item.index]).sort((a, b) => a.distance - b.distance)
    .find(item => isVacuumSegmentClear(escape, points[item.index], obstacles, room))
  if (!nearest) return null
  const neighbors = (index: number) => {
    const column = index % columns, row = Math.floor(index / columns)
    const horizontal = row % 2 ? -1 : 1
    const next = [column + horizontal >= 0 && column + horizontal < columns ? index + horizontal : -1,
      row + 1 < rows ? index + columns : -1, row > 0 ? index - columns : -1,
      column - horizontal >= 0 && column - horizontal < columns ? index - horizontal : -1]
    return next.filter(other => other >= 0 && free[other]
      && isVacuumSegmentClear(points[index], points[other], obstacles, room))
  }
  const visited = new Uint8Array(points.length)
  const stack = [nearest.index]
  const waypoints = [escape, points[nearest.index]]
  visited[nearest.index] = 1
  while (stack.length) {
    const current = stack.at(-1)!
    const next = neighbors(current).find(index => !visited[index])
    if (next !== undefined) {
      visited[next] = 1
      stack.push(next)
      appendPoint(waypoints, points[next])
    } else {
      stack.pop()
      if (stack.length) appendPoint(waypoints, points[stack.at(-1)!])
    }
  }
  appendPoint(waypoints, escape)
  return { dock, start, waypoints, obstacles, room, floorY }
}
