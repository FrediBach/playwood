import { isVacuumSegmentClear, VACUUM_CLEARANCE, type VacuumPlan } from './robot-vacuum-navigation'

/** Preview-only movement, in meters and seconds. The robot faces local +Z. */
export interface VacuumPoint { x: number; z: number }
export interface VacuumMotion extends VacuumPoint {
  heading: number
  waypoint: number
  speed: number
}

export const VACUUM_SPEED = 0.12
export const VACUUM_MANUAL_SPEED = 0.4
export const VACUUM_MANUAL_TURN_SPEED = 1.8
const TURN_SPEED = 0.9
const ACCELERATION = 0.16

export function createVacuumMotion(start: VacuumPoint): VacuumMotion {
  return { ...start, heading: 0, waypoint: 0, speed: 0 }
}

/**
 * Robot-relative driving: +forward faces local +Z; +turn turns left toward +X.
 * Sweep the whole step and stop at the nearest obstruction, including thin
 * panels between endpoints. Rotation in place is safe for the circular body.
 */
export function driveVacuum(motion: VacuumMotion, controls: { forward: number; turn: number }, plan: VacuumPlan, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  const dt = Math.min(seconds, 0.1)
  const forward = Number.isFinite(controls.forward) ? Math.max(-1, Math.min(1, controls.forward)) : 0
  const turn = Number.isFinite(controls.turn) ? Math.max(-1, Math.min(1, controls.turn)) : 0
  motion.heading += turn * VACUUM_MANUAL_TURN_SPEED * dt
  motion.speed = 0
  if (!forward) return

  const from = { x: motion.x, z: motion.z }
  const distance = forward * VACUUM_MANUAL_SPEED * dt
  const headingX = Math.sin(motion.heading), headingZ = Math.cos(motion.heading)
  let to = { x: from.x + headingX * distance, z: from.z + headingZ * distance }
  let obstacles = plan.obstacles
  const dock = obstacles.find(item => item.id === 'dock')
  const onRamp = dock && Math.abs(from.x - plan.start.x) < 1e-7
    && from.z >= plan.start.z - 1e-7 && from.z <= dock.maxZ + VACUUM_CLEARANCE
  if (onRamp) {
    // A docked robot starts inside the station's conservative footprint. It may
    // drive along its exit lane, but cannot steer through the housing or reverse
    // behind its original position. A small heading tolerance makes alignment
    // possible with discrete key events without permitting lateral movement.
    if (Math.abs(headingX) > 0.08) return
    to = { x: plan.start.x, z: Math.max(plan.start.z, to.z) }
    obstacles = obstacles.filter(item => item.id !== 'dock')
  }
  if (!isVacuumSegmentClear(from, from, obstacles, plan.room)) return
  let fraction = 1
  if (!isVacuumSegmentClear(from, to, obstacles, plan.room)) {
    let safe = 0, blocked = 1
    for (let iteration = 0; iteration < 16; iteration++) {
      const candidate = (safe + blocked) / 2
      const point = { x: from.x + (to.x - from.x) * candidate, z: from.z + (to.z - from.z) * candidate }
      if (isVacuumSegmentClear(from, point, obstacles, plan.room)) safe = candidate
      else blocked = candidate
    }
    fraction = safe
  }
  motion.x = from.x + (to.x - from.x) * fraction
  motion.z = from.z + (to.z - from.z) * fraction
  motion.speed = Math.hypot(motion.x - from.x, motion.z - from.z) / dt
}

/** Mutates transient motion only. Turns happen at a waypoint, never across corners. */
export function advanceVacuum(motion: VacuumMotion, waypoints: readonly VacuumPoint[], seconds: number, loopStart = 1) {
  const target = waypoints[motion.waypoint]
  if (!target || seconds <= 0) return
  // A suspended or very slow frame must not jump across the room on resume.
  const dt = Math.min(seconds, 0.1)
  const dx = target.x - motion.x, dz = target.z - motion.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.00001) {
    motion.x = target.x
    motion.z = target.z
    // Repeat the sweep without replaying a one-time dock exit or return trail.
    motion.waypoint = motion.waypoint + 1 < waypoints.length ? motion.waypoint + 1 : Math.min(loopStart, waypoints.length - 1)
    return
  }
  const heading = Math.atan2(dx, dz)
  const turn = Math.atan2(Math.sin(heading - motion.heading), Math.cos(heading - motion.heading))
  if (Math.abs(turn) > 0.002) {
    motion.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_SPEED * dt)
    motion.speed = 0
    return
  }
  motion.heading = heading
  motion.speed = Math.min(VACUUM_SPEED, motion.speed + ACCELERATION * dt, Math.sqrt(2 * ACCELERATION * distance))
  const travel = Math.min(distance, motion.speed * dt)
  motion.x += dx / distance * travel
  motion.z += dz / distance * travel
}
