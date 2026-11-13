import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createPanel } from '@/lib/model'
import { createVacuumPlan, isVacuumSegmentClear, rejoinVacuumRoute, VACUUM_CLEARANCE, type VacuumPlan } from './robot-vacuum-navigation'
import { advanceVacuum, createVacuumMotion, driveVacuum, VACUUM_MANUAL_SPEED, VACUUM_MANUAL_TURN_SPEED, VACUUM_SPEED } from './robot-vacuum-motion'

describe('preview vacuum movement', () => {
  it('rolls out slowly, stops to turn, and follows the next straight segment without cutting the corner', () => {
    const motion = createVacuumMotion({ x: 0, z: 0 })
    const route = [{ x: 0, z: 0.6 }, { x: 0.6, z: 0.6 }, { x: 0, z: 0.6 }]
    let turned = false, reachedSecondLeg = false
    for (let frame = 0; frame < 1200; frame++) {
      const before = { ...motion }
      advanceVacuum(motion, route, 1 / 60)
      expect(Math.hypot(motion.x - before.x, motion.z - before.z)).toBeLessThanOrEqual(VACUUM_SPEED / 60 + 0.00001)
      if (motion.heading !== before.heading) {
        turned = true
        expect(motion.x).toBe(before.x)
        expect(motion.z).toBe(before.z)
      }
      if (motion.x > 0.001) {
        reachedSecondLeg = true
        expect(motion.z).toBeCloseTo(0.6, 5)
      }
    }
    expect(turned).toBe(true)
    expect(reachedSecondLeg).toBe(true)
  })

  it('has the same cleaning speed at different normal frame rates and clamps a suspended frame', () => {
    const route = [{ x: 0, z: 20 }]
    const positions = [30, 60, 120].map(fps => {
      const motion = createVacuumMotion({ x: 0, z: 0 })
      for (let frame = 0; frame < fps * 10; frame++) advanceVacuum(motion, route, 1 / fps)
      return motion.z
    })
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.004)
    const motion = createVacuumMotion({ x: 0, z: 0 })
    advanceVacuum(motion, route, 300)
    expect(motion.z).toBeLessThanOrEqual(VACUUM_SPEED * 0.1)
  })

  it('loops from the exit without returning to the dock or teleporting', () => {
    const motion = createVacuumMotion({ x: 0, z: 0 })
    const route = [{ x: 0, z: 0.1 }, { x: 0.1, z: 0.1 }, { x: 0, z: 0.1 }]
    let loops = 0
    for (let frame = 0; frame < 1800; frame++) {
      const before = { ...motion }
      advanceVacuum(motion, route, 1 / 60)
      if (before.waypoint === 2 && motion.waypoint === 1) loops++
      if (motion.waypoint > 0) expect(motion.z).toBeCloseTo(0.1, 5)
      expect(Math.hypot(motion.x - before.x, motion.z - before.z)).toBeLessThan(0.003)
    }
    expect(loops).toBeGreaterThan(1)
  })

  it('retraces a recovery path once, then keeps subsequent laps on the cleaning sweep', () => {
    const motion = createVacuumMotion({ x: -0.1, z: 0 })
    const route = [{ x: 0, z: 0 }, { x: 0, z: 0.1 }, { x: 0.1, z: 0.1 }, { x: 0, z: 0.1 }]
    let laps = 0
    for (let frame = 0; frame < 2400; frame++) {
      const before = { ...motion }
      advanceVacuum(motion, route, 1 / 60, 2)
      expect(Math.hypot(motion.x - before.x, motion.z - before.z)).toBeLessThan(0.003)
      if (before.waypoint === 3 && motion.waypoint === 2) laps++
      if (laps) expect(motion.z).toBeCloseTo(0.1, 5)
    }
    expect(laps).toBeGreaterThan(1)
  })
})

describe('manual vacuum driving', () => {
  const roomPlan = (): VacuumPlan => ({
    dock: { x: -1.5, z: -1.5 }, start: { x: -1.5, z: -1.35 }, floorY: -0.012,
    room: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, obstacles: [], petObstacles: [],
    waypoints: [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }, { x: -1, z: -1 }],
  })
  const bounds = new Box3(new Vector3(-0.7, 0, -0.35), new Vector3(0.7, 1.2, 0.35))

  it('moves forward and backward relative to the robot heading', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 0 })
    for (let frame = 0; frame < 60; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeCloseTo(VACUUM_MANUAL_SPEED)
    expect(motion.x).toBe(0)
    for (let frame = 0; frame < 60; frame++) driveVacuum(motion, { forward: -1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeCloseTo(0)
    motion.heading = Math.PI / 2
    driveVacuum(motion, { forward: 1, turn: 0 }, plan, 0.1)
    expect(motion.x).toBeCloseTo(VACUUM_MANUAL_SPEED * 0.1)
    expect(motion.z).toBeCloseTo(0)
  })

  it('turns in place and accepts simultaneous forward and turn input', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 0 })
    driveVacuum(motion, { forward: 0, turn: 1 }, plan, 0.1)
    expect(motion.heading).toBeCloseTo(VACUUM_MANUAL_TURN_SPEED * 0.1)
    expect([motion.x, motion.z]).toEqual([0, 0])
    driveVacuum(motion, { forward: 1, turn: 1 }, plan, 0.1)
    expect(motion.x).toBeGreaterThan(0)
    expect(motion.z).toBeGreaterThan(0)
    expect(Math.hypot(motion.x, motion.z)).toBeCloseTo(VACUUM_MANUAL_SPEED * 0.1)
    const before = { ...motion }
    driveVacuum(motion, { forward: 0, turn: -1 }, plan, 0.1)
    expect(motion.heading).toBeLessThan(before.heading)
    expect([motion.x, motion.z]).toEqual([before.x, before.z])
  })

  it('moves up to a wall instead of rejecting the entire last step', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 1.77 })
    driveVacuum(motion, { forward: 1, turn: 0 }, plan, 0.1)
    expect(motion.z).toBeGreaterThan(1.77)
    expect(motion.z).toBeLessThanOrEqual(plan.room.maxZ - VACUUM_CLEARANCE)
    expect(motion.z).toBeCloseTo(plan.room.maxZ - VACUUM_CLEARANCE, 5)
    for (let frame = 0; frame < 60; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeLessThanOrEqual(plan.room.maxZ - VACUUM_CLEARANCE)
    driveVacuum(motion, { forward: -1, turn: 0 }, plan, 0.1)
    expect(motion.z).toBeLessThan(1.77)
  })

  it('sweeps against furniture and stops before a thin panel between step endpoints', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 0.07 })
    plan.obstacles.push({ id: 'panel:thin', minX: -1, maxX: 1, minZ: 0.3, maxZ: 0.301 })
    driveVacuum(motion, { forward: 1, turn: 0 }, plan, 0.1)
    expect(motion.z).toBeGreaterThan(0.07)
    expect(motion.z).toBeCloseTo(0.3 - VACUUM_CLEARANCE, 5)
    expect(motion.z).toBeLessThan(0.3 - VACUUM_CLEARANCE)
    expect(isVacuumSegmentClear(motion, motion, plan.obstacles, plan.room)).toBe(true)
    const stopped = { ...motion }
    driveVacuum(motion, { forward: 1, turn: 1 }, plan, 0.1)
    expect(motion.heading).toBeGreaterThan(stopped.heading)
    expect(isVacuumSegmentClear(stopped, motion, plan.obstacles, plan.room)).toBe(true)
  })

  it('avoids real room furniture and the resolved user project', () => {
    const plan = createVacuumPlan(bounds, [createPanel({ id: 'wall', width: 1200, height: 600, thickness: 18, position: [0, 300, 2000] })])!
    const wall = plan.obstacles.find(item => item.id === 'panel:wall')!
    const motion = createVacuumMotion({ x: 0, z: wall.minZ - VACUUM_CLEARANCE - 0.02 })
    for (let frame = 0; frame < 120; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeLessThan(wall.minZ - VACUUM_CLEARANCE)
    expect(motion.z).toBeCloseTo(wall.minZ - VACUUM_CLEARANCE, 5)
    const chair = plan.obstacles.find(item => item.id === 'room:chair')!
    motion.x = (chair.minX + chair.maxX) / 2
    motion.z = chair.maxZ + VACUUM_CLEARANCE + 0.02
    for (let frame = 0; frame < 120; frame++) driveVacuum(motion, { forward: -1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeGreaterThan(chair.maxZ + VACUUM_CLEARANCE)
    expect(motion.z).toBeCloseTo(chair.maxZ + VACUUM_CLEARANCE, 5)
  })

  it('clamps suspended frames and input magnitudes without jumping', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 0 })
    driveVacuum(motion, { forward: 20, turn: 30 }, plan, 300)
    expect(Math.hypot(motion.x, motion.z)).toBeCloseTo(VACUUM_MANUAL_SPEED * 0.1)
    expect(motion.heading).toBeCloseTo(VACUUM_MANUAL_TURN_SPEED * 0.1)
    const before = { ...motion }
    driveVacuum(motion, { forward: 1, turn: 1 }, plan, NaN)
    expect(motion).toEqual(before)
  })

  it('leaves the dock along its lane without reversing into the housing or steering through its sides', () => {
    const plan = createVacuumPlan(bounds, [])!, motion = createVacuumMotion(plan.start)
    driveVacuum(motion, { forward: -1, turn: 0 }, plan, 0.1)
    expect([motion.x, motion.z]).toEqual([plan.start.x, plan.start.z])
    motion.heading = Math.PI / 2
    driveVacuum(motion, { forward: 1, turn: 0 }, plan, 0.1)
    expect([motion.x, motion.z]).toEqual([plan.start.x, plan.start.z])
    motion.heading = 0
    for (let frame = 0; frame < 30; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(motion.x).toBe(plan.start.x)
    expect(motion.z).toBeCloseTo(plan.start.z + 0.2)
    for (let frame = 0; frame < 60; frame++) driveVacuum(motion, { forward: -1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBe(plan.start.z)
    for (let frame = 0; frame < 120; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(isVacuumSegmentClear(motion, motion, plan.obstacles, plan.room)).toBe(true)
    const outside = { ...motion }
    driveVacuum(motion, { forward: 1, turn: 1 }, plan, 0.1)
    expect(motion.x).toBeGreaterThan(outside.x)
    expect(isVacuumSegmentClear(outside, motion, plan.obstacles, plan.room)).toBe(true)
  })

  it('keeps other obstacles active while leaving the dock', () => {
    const plan = createVacuumPlan(bounds, [])!, motion = createVacuumMotion(plan.start)
    plan.obstacles.push({ id: 'new-furniture', minX: motion.x - 0.1, maxX: motion.x + 0.1, minZ: motion.z + 0.3, maxZ: motion.z + 0.4 })
    for (let frame = 0; frame < 120; frame++) driveVacuum(motion, { forward: 1, turn: 0 }, plan, 1 / 60)
    expect(motion.z).toBeLessThan(plan.start.z + 0.3 - VACUUM_CLEARANCE)
    expect(motion.z).toBeCloseTo(plan.start.z + 0.3 - VACUUM_CLEARANCE, 5)
  })

  it('can resume a safe automatic route from the manually driven position', () => {
    const plan = roomPlan(), motion = createVacuumMotion({ x: 0, z: 0 })
    for (let frame = 0; frame < 80; frame++) driveVacuum(motion, { forward: 1, turn: 1 }, plan, 1 / 60)
    const stopped = { ...motion }
    const route = rejoinVacuumRoute(plan, motion)!
    expect(route).not.toBeNull()
    expect(motion).toEqual(stopped)
    motion.waypoint = 0
    motion.speed = 0
    for (let frame = 0; frame < 2400; frame++) {
      const previous = { ...motion }
      advanceVacuum(motion, route, 1 / 60)
      expect(isVacuumSegmentClear(previous, motion, plan.obstacles, plan.room)).toBe(true)
      expect(Math.hypot(motion.x - previous.x, motion.z - previous.z)).toBeLessThanOrEqual(VACUUM_SPEED / 60 + 0.00001)
    }
    expect(Math.hypot(motion.x - stopped.x, motion.z - stopped.z)).toBeGreaterThan(0.1)
  })
})
