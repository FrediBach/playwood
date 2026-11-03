import { isVacuumSegmentClear, rejoinVacuumRoute, type VacuumPlan, type VacuumPoint } from './robot-vacuum-navigation'

export interface VacuumRecoveryRoute {
  waypoints: VacuumPoint[]
  /** The return trail is visited once; subsequent sweeps start at this index. */
  loopStart: number
}

const samePoint = (a: VacuumPoint, b: VacuumPoint) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-8

/** Keep the takeover point and only the bends needed to retrace a manual drive. */
export function recordVacuumTrail(trail: VacuumPoint[], point: VacuumPoint, plan: VacuumPlan): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return
  const last = trail.at(-1)
  if (last && samePoint(last, point)) return
  const previous = trail.at(-2)
  const snapshot = { x: point.x, z: point.z }
  if (previous && isVacuumSegmentClear(previous, snapshot, plan.obstacles, plan.room)) trail[trail.length - 1] = snapshot
  else trail.push(snapshot)
}

/**
 * A manual drive can pass through a gap missed by the coverage grid. Retrace its
 * known safe bends until the current sweep becomes visible again. Every segment
 * is checked against today's furnishings; changed obstacles may require waiting.
 */
export function recoverVacuumRoute(plan: VacuumPlan, position: VacuumPoint, trail: readonly VacuumPoint[]): VacuumRecoveryRoute | null {
  const direct = rejoinVacuumRoute(plan, position, true)
  if (direct) return { waypoints: direct, loopStart: 1 }
  const prefix: VacuumPoint[] = []
  let current = position
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index]
    if (samePoint(current, point)) continue
    if (!isVacuumSegmentClear(current, point, plan.obstacles, plan.room)) return null
    prefix.push({ x: point.x, z: point.z })
    current = point
    const joined = rejoinVacuumRoute(plan, current, true)
    if (joined) return { waypoints: [...prefix, ...joined], loopStart: prefix.length + 1 }
  }
  return null
}
