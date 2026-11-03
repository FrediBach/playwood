import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { createVacuumPlan, isVacuumSegmentClear, rejoinVacuumRoute, type VacuumPlan, type VacuumPoint } from './robot-vacuum-navigation'
import { recordVacuumTrail, recoverVacuumRoute } from './robot-vacuum-recovery'
import { getRoomLayout } from './room-layout'

const bounds = new Box3(new Vector3(-0.7, 0, -0.35), new Vector3(0.7, 1.2, 0.35))

function doorwayPlan() {
  const room = getRoomLayout(bounds), opening = 0.5
  return createVacuumPlan(bounds, [
    createPanel({ id: 'left', width: (-opening / 2 - room.leftX) * 1000, height: 500, thickness: 10, position: [(room.leftX - opening / 2) * 500, 250, 2000] }),
    createPanel({ id: 'right', width: (room.rightX - opening / 2) * 1000, height: 500, thickness: 10, position: [(room.rightX + opening / 2) * 500, 250, 2000] }),
  ])!
}

function recordPath(plan: VacuumPlan, points: VacuumPoint[]) {
  const trail: VacuumPoint[] = []
  recordVacuumTrail(trail, points[0], plan)
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index]
    expect(isVacuumSegmentClear(from, to, plan.obstacles, plan.room)).toBe(true)
    // Match frame-by-frame recording, including smooth simplification mid-leg.
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.006)
    for (let step = 1; step <= steps; step++) recordVacuumTrail(trail, {
      x: from.x + (to.x - from.x) * step / steps,
      z: from.z + (to.z - from.z) * step / steps,
    }, plan)
  }
  return trail
}

describe('returning from manual vacuum driving', () => {
  it('keeps a compact safe trail while preserving the original takeover pose', () => {
    const plan = createVacuumPlan(bounds, [])!
    const points = [{ x: 0, z: 3 }, { x: 0, z: 4 }, { x: 1, z: 4 }]
    const trail = recordPath(plan, points)
    expect(trail).toEqual([points[0], points.at(-1)])
    recordVacuumTrail(trail, points.at(-1)!, plan)
    expect(trail).toHaveLength(2)
    points[0].x = 99
    expect(trail[0].x).toBe(0)
  })

  it('retraces a narrow doorway missed by the automatic grid, then loops only the joined sweep', () => {
    const plan = doorwayPlan()
    expect(Math.max(...plan.waypoints.map(point => point.z))).toBeLessThan(2)
    const path = [{ x: 0, z: 1.5 }, { x: 0, z: 3 }, { x: -2.9, z: 3 }, { x: -2.9, z: 2.4 }]
    const trail = recordPath(plan, path), position = path.at(-1)!
    expect(trail.length).toBeLessThan(10)
    expect(rejoinVacuumRoute(plan, position, true)).toBeNull()
    const original = JSON.stringify({ plan, position, trail })
    const recovery = recoverVacuumRoute(plan, position, trail)!
    expect(recovery).not.toBeNull()
    expect(recovery.loopStart).toBeGreaterThan(1)
    expect(recovery.loopStart).toBeLessThan(recovery.waypoints.length)
    const points = [position, ...recovery.waypoints]
    for (let index = 1; index < points.length; index++) {
      expect(isVacuumSegmentClear(points[index - 1], points[index], plan.obstacles, plan.room)).toBe(true)
    }
    // The sweep closes at the join projection, never at a breadcrumb across the partition.
    expect(recovery.waypoints.at(-1)).toEqual(recovery.waypoints[recovery.loopStart - 1])
    expect(recovery.waypoints.slice(recovery.loopStart).every(point => point.z < 2)).toBe(true)
    expect(recovery.waypoints.slice(0, recovery.loopStart - 1).some(point => point.z > 2)).toBe(true)
    expect(isVacuumSegmentClear(recovery.waypoints.at(-1)!, recovery.waypoints[recovery.loopStart], plan.obstacles, plan.room)).toBe(true)
    expect(JSON.stringify({ plan, position, trail })).toBe(original)
  })

  it('uses a direct visible join instead of unnecessarily retracing the trail', () => {
    const plan = doorwayPlan(), position = { x: 0, z: 3 }
    const recovery = recoverVacuumRoute(plan, position, [{ x: 0, z: 1.5 }, position])!
    expect(recovery.loopStart).toBe(1)
    expect(recovery.waypoints).toEqual(rejoinVacuumRoute(plan, position, true))
    expect(isVacuumSegmentClear(position, recovery.waypoints[0], plan.obstacles, plan.room)).toBe(true)
  })

  it('waits when newly added furniture blocks the recorded return path', () => {
    const plan = doorwayPlan()
    const path = [{ x: 0, z: 1.5 }, { x: 0, z: 3 }, { x: -2.9, z: 3 }, { x: -2.9, z: 2.4 }]
    const trail = recordPath(plan, path), position = path.at(-1)!
    expect(recoverVacuumRoute(plan, position, trail)).not.toBeNull()
    const previous = trail.at(-2)!
    const x = (previous.x + position.x) / 2, z = (previous.z + position.z) / 2
    const changed = { ...plan, obstacles: [...plan.obstacles,
      { id: 'new-chair', minX: x - 0.05, maxX: x + 0.05, minZ: z - 0.05, maxZ: z + 0.05 }] }
    expect(recoverVacuumRoute(changed, position, trail)).toBeNull()
    expect(recoverVacuumRoute(plan, position, trail)).not.toBeNull()
  })

  it('never invents a crossing when no manual trail reaches the sweep', () => {
    const plan = doorwayPlan(), position = { x: -2.9, z: 2.4 }
    expect(recoverVacuumRoute(plan, position, [])).toBeNull()
    expect(recoverVacuumRoute(plan, position, [position, { x: -2.9, z: 2.6 }])).toBeNull()
  })

  it('keeps the permitted straight dock exit available before manual undocking completes', () => {
    const plan = createVacuumPlan(bounds, [])!
    const position = { x: plan.start.x, z: plan.start.z + 0.15 }
    const recovery = recoverVacuumRoute(plan, position, [plan.start, position])!
    expect(recovery).toEqual({ waypoints: plan.waypoints, loopStart: 1 })
  })
})
