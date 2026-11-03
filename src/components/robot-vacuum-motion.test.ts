import { describe, expect, it } from 'vitest'
import { advanceVacuum, createVacuumMotion, VACUUM_SPEED } from './robot-vacuum-motion'

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
})
