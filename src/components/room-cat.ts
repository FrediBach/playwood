import type { Box3 } from 'three'
import { isVacuumSegmentClear, type VacuumObstacle, type VacuumPlan, type VacuumPoint, type VacuumRoom } from './robot-vacuum-navigation'
import { getRoomLayout, type RoomRug } from './room-layout'

/**
 * Preview-only room cat, in meters and seconds. It faces local +Z like the
 * vacuum. Nothing here touches project state; the scene owns one transient
 * `CatState` per vacuum session.
 */

/** A curled cat occupies about this radius on the floor. */
export const CAT_REST_CLEARANCE = 0.2
/** A walking cat is narrow; paths keep this far from obstacle footprints. */
export const CAT_PATH_CLEARANCE = 0.11
/** Centre distance at which an approaching vacuum wakes a resting cat. */
export const CAT_WAKE_DISTANCE = 0.85
/** Within this distance a resting cat flicks its ears and peeks. */
export const CAT_NOTICE_DISTANCE = 1.8
/** Disturbances after which the cat gives up the floor for the lounge chair. */
export const CAT_SOFA_AFTER = 3
/** Rest spots stay at least this far from the vacuum when chosen. */
const MIN_VACUUM_SPACE = 1.3
const VACUUM_BLOCK = 0.2
const WAKE_TIME = 1.05
export const CAT_SETTLE_TIME = 2.9
const CROUCH_TIME = 0.95
const LEAP_TIME = 0.55
const LEAP_HEIGHT = 0.16
const WALK_SPEED = 0.42
const TROT_SPEED = 0.78
const TURN_SPEED = 6
/** Distance covered by one full gait cycle. */
export const CAT_STRIDE = 0.3
const MAX_GRID_NODES = 1800
const SEAT_HEIGHT = 0.43
/** Floor spots face this way so the curled face looks toward the default camera. */
const REST_HEADING = -0.3
/** Resting heading on the cushion, relative to the chair. */
const SEAT_HEADING = -0.1

export interface CatSpot extends VacuumPoint { heading: number }
export interface CatSofa {
  /** Floor point in front of the chair where the cat crouches before leaping. */
  approach: VacuumPoint
  /** Centre of the seat cushion and its height above the room floor. */
  seat: VacuumPoint
  seatY: number
  heading: number
}
export interface CatSetting {
  home: CatSpot
  sofa: CatSofa | null
  obstacles: VacuumObstacle[]
  room: VacuumRoom
  /** Floor region near the creation, so a chosen spot normally stays in view. */
  area: VacuumRoom
  rug: RoomRug
  creation: VacuumPoint
}

export type CatPhase = 'sleeping' | 'waking' | 'walking' | 'settling' | 'crouching' | 'leaping' | 'perched'
export interface CatState extends CatSpot {
  phase: CatPhase
  /** Seconds in the current phase. */
  time: number
  /** Height of the paws above the room floor. */
  y: number
  path: VacuumPoint[]
  waypoint: number
  target: CatSpot | null
  toSofa: boolean
  displaced: number
  onSofa: boolean
  speed: number
  /** Gait phase in radians, advanced by distance travelled. */
  gait: number
  settleFrom: number
  settleTo: number
  jumpFrom: VacuumPoint
  visited: VacuumPoint[]
  /** Set when no escape exists; the cat ignores the vacuum until it leaves. */
  unbothered: boolean
}

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
const distance = (a: VacuumPoint, b: VacuumPoint) => Math.hypot(a.x - b.x, a.z - b.z)

function vacuumBlock(vacuum: VacuumPoint): VacuumObstacle {
  return { id: 'vacuum', minX: vacuum.x - VACUUM_BLOCK, maxX: vacuum.x + VACUUM_BLOCK, minZ: vacuum.z - VACUUM_BLOCK, maxZ: vacuum.z + VACUUM_BLOCK }
}

export function isCatRestClear(setting: Pick<CatSetting, 'obstacles' | 'room'>, point: VacuumPoint) {
  return isVacuumSegmentClear(point, point, setting.obstacles, setting.room, CAT_REST_CLEARANCE)
}

function onRug(rug: RoomRug, point: VacuumPoint) {
  if (rug.round) return Math.hypot(point.x - rug.x, point.z - rug.z) < rug.width / 2 - 0.15
  return Math.abs(point.x - rug.x) < rug.width / 2 - 0.15 && Math.abs(point.z - rug.z) < rug.depth / 2 - 0.15
}

/** The rug's front-right corner as seen from the default room camera. */
function rugCorner(rug: RoomRug): VacuumPoint {
  if (rug.round) {
    const reach = Math.max(0, rug.width / 2 - 0.4) * Math.SQRT1_2
    return { x: rug.x + reach, z: rug.z + reach }
  }
  return { x: rug.x + rug.width / 2 - 0.38, z: rug.z + rug.depth / 2 - 0.34 }
}

function nearestRestSpot(setting: Pick<CatSetting, 'obstacles' | 'room'>, desired: VacuumPoint): VacuumPoint | null {
  if (isCatRestClear(setting, desired)) return desired
  let best: VacuumPoint | null = null, bestDistance = Infinity
  for (let dx = -1.2; dx <= 1.2001; dx += 0.05) for (let dz = -1.2; dz <= 1.2001; dz += 0.05) {
    const point = { x: desired.x + dx, z: desired.z + dz }
    const away = Math.hypot(dx, dz)
    if (away < bestDistance && isCatRestClear(setting, point)) { best = point; bestDistance = away }
  }
  return best
}

/**
 * The lounge chair stands at the room's chair position, turned −0.2 rad. The
 * cat crouches on the floor in front of it and leaps onto the cushion.
 */
function chairSofa(setting: Pick<CatSetting, 'obstacles' | 'room'>, chair: VacuumPoint, rotation: number): CatSofa | null {
  const local = (x: number, z: number) => ({
    x: chair.x + x * Math.cos(rotation) + z * Math.sin(rotation),
    z: chair.z - x * Math.sin(rotation) + z * Math.cos(rotation),
  })
  // Forward of the scatter cushion, which sits on the right of the seat.
  const seat = local(-0.05, 0.12)
  for (const reach of [0.72, 0.82, 0.95]) for (const side of [0, -0.12, 0.12]) {
    const approach = local(side, reach)
    if (isVacuumSegmentClear(approach, approach, setting.obstacles, setting.room, CAT_PATH_CLEARANCE)) {
      return { approach, seat, seatY: SEAT_HEIGHT, heading: rotation + SEAT_HEADING }
    }
  }
  return null
}

/** Chooses the cat's starting place and the lounge chair it can retreat to. */
export function createCatSetting(plan: VacuumPlan, bounds: Box3, rug: RoomRug): CatSetting | null {
  const layout = getRoomLayout(bounds)
  const base = { obstacles: plan.petObstacles, room: plan.room }
  const creation = { x: (bounds.min.x + bounds.max.x) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
  const rugFront = rug.z + (rug.round ? rug.width : rug.depth) / 2
  const area = {
    minX: Math.max(plan.room.minX, bounds.min.x - 1.2), maxX: Math.min(plan.room.maxX, layout.chairX + 0.75),
    // In front of the creation, where the default room camera looks.
    minZ: Math.max(plan.room.minZ, bounds.max.z - 0.05), maxZ: Math.min(plan.room.maxZ, rugFront + 1.1),
  }
  const corner = nearestRestSpot(base, rugCorner(rug))
  if (!corner) return null
  return {
    ...base, area, rug, creation,
    home: { ...corner, heading: REST_HEADING },
    sofa: chairSofa(base, { x: layout.chairX, z: layout.chairZ }, -0.2),
  }
}

export function createCat(setting: CatSetting): CatState {
  const { home } = setting
  return {
    ...home, phase: 'sleeping', time: 0, y: 0, path: [], waypoint: 0, target: null, toSofa: false,
    displaced: 0, onSofa: false, speed: 0, gait: 0, settleFrom: home.heading, settleTo: home.heading,
    jumpFrom: { x: home.x, z: home.z }, visited: [{ x: home.x, z: home.z }], unbothered: false,
  }
}

interface CatGrid { points: VacuumPoint[]; columns: number; rows: number }

function catGrid(setting: CatSetting): CatGrid {
  // Walk slightly beyond the resting area so routes can round furniture.
  const minX = Math.max(setting.room.minX + CAT_PATH_CLEARANCE, setting.area.minX - 0.6)
  const maxX = Math.min(setting.room.maxX - CAT_PATH_CLEARANCE, setting.area.maxX + 0.6)
  const minZ = Math.max(setting.room.minZ + CAT_PATH_CLEARANCE, setting.area.minZ - 0.6)
  const maxZ = Math.min(setting.room.maxZ - CAT_PATH_CLEARANCE, setting.area.maxZ + 0.6)
  const step = Math.max(0.15, Math.sqrt((maxX - minX) * (maxZ - minZ) / MAX_GRID_NODES))
  const columns = Math.max(2, Math.floor((maxX - minX) / step) + 1)
  const rows = Math.max(2, Math.floor((maxZ - minZ) / step) + 1)
  const points = Array.from({ length: columns * rows }, (_, index) => ({ x: minX + (index % columns) * step, z: minZ + Math.floor(index / columns) * step }))
  return { points, columns, rows }
}

/** Dijkstra over an 8-connected floor grid; the grid is capped, so this stays small. */
function floorDistances(setting: CatSetting, from: VacuumPoint, obstacles: VacuumObstacle[]) {
  const grid = catGrid(setting)
  const { points, columns } = grid
  const clear = (a: VacuumPoint, b: VacuumPoint) => isVacuumSegmentClear(a, b, obstacles, setting.room, CAT_PATH_CLEARANCE)
  const free = points.map(point => clear(point, point))
  const cost = new Float64Array(points.length).fill(Infinity)
  const parent = new Int32Array(points.length).fill(-1)
  const done = new Uint8Array(points.length)
  const step = points.length > 1 ? Math.abs(points[1].x - points[0].x) : 0.15
  points.forEach((point, index) => {
    const reach = distance(point, from)
    if (free[index] && reach < step * 2.2 && clear(from, point)) cost[index] = reach
  })
  if (!cost.some(Number.isFinite)) {
    // A cat whose spot was just covered steps out to the nearest open floor.
    let nearest = -1
    points.forEach((point, index) => {
      if (free[index] && distance(point, from) < 0.8 && (nearest < 0 || distance(point, from) < distance(points[nearest], from))) nearest = index
    })
    if (nearest >= 0) cost[nearest] = distance(points[nearest], from)
  }
  for (;;) {
    let current = -1
    for (let index = 0; index < points.length; index++) if (!done[index] && cost[index] < (current < 0 ? Infinity : cost[current])) current = index
    if (current < 0) break
    done[current] = 1
    const column = current % columns, row = Math.floor(current / columns)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue
      const c = column + dx, r = row + dz
      if (c < 0 || c >= columns || r < 0 || r >= grid.rows) continue
      const next = r * columns + c
      if (done[next] || !free[next]) continue
      const total = cost[current] + Math.hypot(dx, dz) * step
      if (total < cost[next] && clear(points[current], points[next])) { cost[next] = total; parent[next] = current }
    }
  }
  return { points, cost, parent }
}

/** Keeps only the bends needed, checking every shortcut against the obstacles. */
function shortcut(path: VacuumPoint[], setting: CatSetting, obstacles: VacuumObstacle[]): VacuumPoint[] {
  const result = [path[0]]
  let anchor = 0
  while (anchor < path.length - 1) {
    let next = path.length - 1
    while (next > anchor + 1 && !isVacuumSegmentClear(path[anchor], path[next], obstacles, setting.room, CAT_PATH_CLEARANCE)) next--
    result.push(path[next])
    anchor = next
  }
  return result
}

function route(setting: CatSetting, from: VacuumPoint, vacuum: VacuumPoint | null, choose: (point: VacuumPoint, cost: number) => number | null): { path: VacuumPoint[]; goal: VacuumPoint } | null {
  const block = vacuum && vacuumBlock(vacuum)
  // Never let the vacuum's own footprint trap a cat that is already beside it.
  const obstacles = block && isVacuumSegmentClear(from, from, [block], setting.room, CAT_PATH_CLEARANCE) ? [...setting.obstacles, block] : setting.obstacles
  const { points, cost, parent } = floorDistances(setting, from, obstacles)
  let best = -1, bestScore = -Infinity, bestGoal: VacuumPoint | null = null
  points.forEach((point, index) => {
    if (!Number.isFinite(cost[index])) return
    const chosen = choose(point, cost[index])
    if (chosen === null || chosen <= bestScore) return
    best = index; bestScore = chosen; bestGoal = point
  })
  if (best < 0 || !bestGoal) return null
  const chain: VacuumPoint[] = []
  for (let index = best; index >= 0; index = parent[index]) chain.unshift(points[index])
  return { path: shortcut([from, ...chain], setting, obstacles), goal: bestGoal }
}

/** Picks a calm floor spot away from the vacuum, preferring the rug and the creation. */
export function planCatEscape(cat: CatState, setting: CatSetting, vacuum: VacuumPoint | null): { path: VacuumPoint[]; target: CatSpot } | null {
  const { area } = setting
  const found = route(setting, cat, vacuum, (point, walk) => {
    if (point.x < area.minX || point.x > area.maxX || point.z < area.minZ || point.z > area.maxZ) return null
    const space = vacuum ? distance(point, vacuum) : 3
    if (space < MIN_VACUUM_SPACE || walk < 0.7 || !isCatRestClear(setting, point)) return null
    const crowded = cat.visited.some(spot => distance(spot, point) < 0.75)
    return 1.6 * Math.min(space, 2.6) - 0.7 * Math.abs(walk - 1.8) - 0.3 * distance(point, setting.creation)
      + (onRug(setting.rug, point) ? 0.6 : 0) - (crowded ? 2 : 0)
  })
  return found && { path: found.path, target: { ...found.goal, heading: REST_HEADING } }
}

/** Shortest clear walk to a fixed floor point, such as the front of the chair. */
export function planCatWalk(cat: CatState, setting: CatSetting, vacuum: VacuumPoint | null, goal: VacuumPoint): VacuumPoint[] | null {
  const reachable = (point: VacuumPoint) => isVacuumSegmentClear(point, goal, setting.obstacles, setting.room, CAT_PATH_CLEARANCE)
  if (reachable(cat)) return [{ x: cat.x, z: cat.z }, goal]
  const found = route(setting, cat, vacuum, (point, walk) =>
    distance(point, goal) < 0.35 && reachable(point) ? -walk - distance(point, goal) : null)
  return found && [...found.path, goal]
}

function startWalk(cat: CatState, setting: CatSetting, vacuum: VacuumPoint | null) {
  const sofaPath = cat.displaced >= CAT_SOFA_AFTER && setting.sofa ? planCatWalk(cat, setting, vacuum, setting.sofa.approach) : null
  if (sofaPath) {
    Object.assign(cat, { phase: 'walking', time: 0, path: sofaPath, waypoint: 1, toSofa: true, target: null })
    return
  }
  const escape = planCatEscape(cat, setting, vacuum)
  if (escape) {
    Object.assign(cat, { phase: 'walking', time: 0, path: escape.path, waypoint: 1, toSofa: false, target: escape.target })
    return
  }
  // Nowhere calmer to go: curl up again and tolerate the vacuum this time.
  beginSettling(cat)
  cat.unbothered = true
}

function beginSettling(cat: CatState) {
  const goal = cat.onSofa ? (cat.target?.heading ?? cat.heading) : cat.target?.heading ?? REST_HEADING
  const turn = wrap(goal - cat.heading)
  // Cats circle once before lying down; turn the long way round in the nearer direction.
  Object.assign(cat, { phase: 'settling', time: 0, speed: 0, settleFrom: cat.heading, settleTo: cat.heading + turn + Math.sign(turn || 1) * Math.PI * 2 })
}

const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t) }

/**
 * Advances the cat by one frame. Returns true while it is moving or changing
 * pose and needs further frames; a resting cat costs no frames of its own.
 */
export function stepCat(cat: CatState, setting: CatSetting, vacuum: VacuumPoint | null, seconds: number): boolean {
  if (!Number.isFinite(seconds) || seconds < 0) return false
  const dt = Math.min(seconds, 0.1)
  cat.time += dt
  const near = vacuum ? distance(cat, vacuum) : Infinity
  if (cat.unbothered && near > CAT_WAKE_DISTANCE + 0.4) cat.unbothered = false
  const disturbed = !cat.onSofa && !cat.unbothered && near < CAT_WAKE_DISTANCE
  switch (cat.phase) {
    case 'sleeping':
      if (!disturbed) return false
      cat.displaced++
      Object.assign(cat, { phase: 'waking', time: 0 })
      return true
    case 'perched':
      return false
    case 'waking':
      // A very close vacuum cuts the stretch short: the cat hops straight up and away.
      if (cat.time >= WAKE_TIME || (near < 0.5 && cat.time > 0.2)) startWalk(cat, setting, vacuum)
      return true
    case 'walking': {
      const target = cat.path[cat.waypoint]
      if (!target) {
        if (cat.toSofa) Object.assign(cat, { phase: 'crouching', time: 0, speed: 0 })
        else { cat.visited.push({ x: cat.x, z: cat.z }); beginSettling(cat) }
        return true
      }
      const dx = target.x - cat.x, dz = target.z - cat.z
      const remaining = Math.hypot(dx, dz)
      if (remaining < 1e-4) { cat.waypoint++; return true }
      const error = wrap(Math.atan2(dx, dz) - cat.heading)
      cat.heading += Math.sign(error) * Math.min(Math.abs(error), TURN_SPEED * dt)
      const wanted = (near < 1.1 ? TROT_SPEED : WALK_SPEED) * Math.max(0.15, 1 - Math.abs(error) / 1.6)
      cat.speed += (wanted - cat.speed) * Math.min(1, dt * 6)
      const travel = Math.min(remaining, cat.speed * dt)
      cat.x += dx / remaining * travel
      cat.z += dz / remaining * travel
      cat.gait += travel / CAT_STRIDE * Math.PI * 2
      return true
    }
    case 'settling': {
      if (disturbed && cat.time > 0.3) {
        cat.displaced++
        startWalk(cat, setting, vacuum)
        return true
      }
      const turning = smooth((cat.time - 0.55) / 1.15)
      const previous = cat.heading
      cat.heading = cat.settleFrom + (cat.settleTo - cat.settleFrom) * turning
      cat.gait += Math.abs(cat.heading - previous) * 2.2
      if (cat.time >= CAT_SETTLE_TIME) {
        cat.heading = wrap(cat.settleTo)
        cat.phase = cat.onSofa ? 'perched' : 'sleeping'
        cat.time = 0
      }
      return true
    }
    case 'crouching': {
      const sofa = setting.sofa
      if (!sofa) { beginSettling(cat); return true }
      const error = wrap(Math.atan2(sofa.seat.x - cat.x, sofa.seat.z - cat.z) - cat.heading)
      if (Math.abs(error) > 0.02) {
        cat.heading += Math.sign(error) * Math.min(Math.abs(error), TURN_SPEED * 0.6 * dt)
        cat.gait += TURN_SPEED * 0.6 * dt * 1.5
        cat.time = 0
      } else if (cat.time >= CROUCH_TIME) {
        Object.assign(cat, { phase: 'leaping', time: 0, jumpFrom: { x: cat.x, z: cat.z } })
      }
      return true
    }
    case 'leaping': {
      const sofa = setting.sofa!
      const t = Math.min(1, cat.time / LEAP_TIME)
      const ease = 1 - (1 - t) ** 1.6
      cat.x = cat.jumpFrom.x + (sofa.seat.x - cat.jumpFrom.x) * ease
      cat.z = cat.jumpFrom.z + (sofa.seat.z - cat.jumpFrom.z) * ease
      cat.y = sofa.seatY * ease + LEAP_HEIGHT * 4 * t * (1 - t)
      if (t >= 1) {
        cat.onSofa = true
        cat.y = sofa.seatY
        cat.target = { ...sofa.seat, heading: sofa.heading }
        beginSettling(cat)
      }
      return true
    }
  }
}

/** Keeps a cat consistent with changed furnishings without restarting its story. */
export function reconcileCat(cat: CatState, setting: CatSetting) {
  if (cat.onSofa) return
  if (cat.phase === 'walking') {
    const goal = cat.toSofa ? setting.sofa?.approach : cat.target && isCatRestClear(setting, cat.target) ? cat.target : undefined
    const path = goal ? planCatWalk(cat, setting, null, goal) : null
    if (path) { cat.path = path; cat.waypoint = 1; return }
    startWalk(cat, setting, null)
    return
  }
  if (['sleeping', 'settling'].includes(cat.phase) && !isCatRestClear(setting, cat)) {
    // A new furnishing landed on the cat: it moves without counting a disturbance.
    Object.assign(cat, { phase: 'waking', time: WAKE_TIME * 0.6 })
  }
}

/** Animation targets; the renderer eases toward these, so phases blend smoothly. */
export interface CatPose {
  rise: number
  sit: number
  curl: number
  roll: number
  crouch: number
  leap: number
  walk: number
  headPitch: number
  headYaw: number
  headTilt: number
  eyes: number
  ears: number
  tailLift: number
  tailHook: number
  wiggle: number
}

export const SLEEPING_POSE: CatPose = { rise: 0, sit: 0, curl: 1, roll: 0.2, crouch: 0, leap: 0, walk: 0, headPitch: 0.6, headYaw: 0, headTilt: 0.45, eyes: 0, ears: 0.2, tailLift: 0, tailHook: 0, wiggle: 0 }
const STANDING: CatPose = { rise: 1, sit: 0, curl: 0, roll: 0, crouch: 0, leap: 0, walk: 0, headPitch: 0.05, headYaw: 0, headTilt: 0, eyes: 1, ears: 1, tailLift: 1, tailHook: 1, wiggle: 0 }

/** Where the vacuum is relative to the cat's face, clamped to a natural neck turn. */
export function catLookAt(cat: CatState, vacuum: VacuumPoint | null, limit = 1.15) {
  if (!vacuum) return 0
  return Math.max(-limit, Math.min(limit, wrap(Math.atan2(vacuum.x - cat.x, vacuum.z - cat.z) - cat.heading)))
}

/** A slow blink every few seconds is a cat's friendly greeting. */
function slowBlink(time: number) {
  const cycle = time % 3.6
  return cycle > 2.6 ? 1 - Math.sin((cycle - 2.6) / 1 * Math.PI) * 0.92 : 1
}

export function catPose(cat: CatState, vacuum: VacuumPoint | null): CatPose {
  const near = vacuum ? distance(cat, vacuum) : Infinity
  const look = catLookAt(cat, vacuum)
  const t = cat.time
  switch (cat.phase) {
    case 'sleeping':
    case 'perched': {
      const range = cat.onSofa ? CAT_NOTICE_DISTANCE + 0.6 : CAT_NOTICE_DISTANCE
      const notice = smooth((range - near) / (range - CAT_WAKE_DISTANCE))
      if (cat.onSofa) {
        // Safe up high: lift the head, watch the vacuum and slow-blink at it.
        return { ...SLEEPING_POSE, curl: 1 - notice * 0.3, headPitch: 0.75 - notice * 0.8, headYaw: look * notice * 0.8,
          headTilt: notice * 0.18, eyes: notice * 0.6 * slowBlink(t), ears: 0.2 + notice * 0.75 }
      }
      return { ...SLEEPING_POSE, headPitch: 0.75 - notice * 0.25, headYaw: look * notice * 0.35, eyes: notice > 0.55 ? 0.22 : 0, ears: 0.2 + notice * 0.8 }
    }
    case 'waking':
      if (t < 0.35) return { ...SLEEPING_POSE, curl: 0.6, roll: 0.05, headPitch: 0.1, headYaw: look, eyes: 0.85, ears: 1, tailLift: 0.15 }
      if (t < 0.75) return { ...STANDING, rise: 0.55, sit: 1, headPitch: -0.05, headYaw: look, headTilt: -0.12, tailLift: 0.25, tailHook: 0 }
      return { ...STANDING, headYaw: look * 0.6, tailLift: 0.7 }
    case 'walking':
      return { ...STANDING, walk: Math.min(1, cat.speed / 0.25), headYaw: near < 1.3 ? look * 0.45 : 0, headPitch: 0.12 }
    case 'settling':
      if (t < 0.55) return { ...STANDING, sit: 1, rise: 0.6, headYaw: look, headTilt: 0.2, tailLift: 0.35, tailHook: 0.3 }
      if (t < 1.75) return { ...STANDING, walk: 0.55, headPitch: 0.25, tailLift: 0.8 }
      // Lie down, curl, and close the eyes slowly.
      return { ...SLEEPING_POSE, eyes: Math.max(0, 0.5 - (t - 1.75) * 0.5) }
    case 'crouching':
      return { ...STANDING, rise: 0.8, crouch: 1, headPitch: -0.3, tailLift: 0.25, tailHook: 0, wiggle: cat.time > 0.25 ? 1 : 0 }
    case 'leaping':
      return { ...STANDING, leap: Math.sin(Math.min(1, t / LEAP_TIME) * Math.PI), headPitch: -0.15, tailLift: 0.45, tailHook: 0 }
  }
}
