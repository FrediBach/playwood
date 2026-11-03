/** Preview-only movement, in meters and seconds. The robot faces local +Z. */
export interface VacuumPoint { x: number; z: number }
export interface VacuumMotion extends VacuumPoint {
  heading: number
  waypoint: number
  speed: number
}

export const VACUUM_SPEED = 0.12
const TURN_SPEED = 0.9
const ACCELERATION = 0.16

export function createVacuumMotion(start: VacuumPoint): VacuumMotion {
  return { ...start, heading: 0, waypoint: 0, speed: 0 }
}

/** Mutates transient motion only. Turns happen at a waypoint, never across corners. */
export function advanceVacuum(motion: VacuumMotion, waypoints: readonly VacuumPoint[], seconds: number) {
  const target = waypoints[motion.waypoint]
  if (!target || seconds <= 0) return
  // A suspended or very slow frame must not jump across the room on resume.
  const dt = Math.min(seconds, 0.1)
  const dx = target.x - motion.x, dz = target.z - motion.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.00001) {
    motion.x = target.x
    motion.z = target.z
    // The route ends back at the first (undocked) waypoint. Repeat the sweep.
    motion.waypoint = motion.waypoint + 1 < waypoints.length ? motion.waypoint + 1 : Math.min(1, waypoints.length - 1)
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
