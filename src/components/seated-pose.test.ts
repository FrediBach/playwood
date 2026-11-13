import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { Workstation } from '@/lib/preview-furnishings'
import { WORK_CYCLE, workFrame } from './desk-work'
import { FOREARM, HAND, LAP_WORKSTATION, UPPER_ARM, restingPose, shoulderPoint, solveArm, workLean, workPose } from './seated-pose'

// The starter desk: a computer keyboard about 49 cm in front of the seat.
const DESK: Workstation = { kind: 'computer', keyboard: [0.042, 0.33, 0.49], pointer: [-0.236, 0.326, 0.498], screen: [0, 0.622, 0.76], screenSize: [0.511, 0.281] }

function arm(lean: number, side: 1 | -1, hand: Vector3, direction: Vector3, pole: Vector3) {
  const shoulder = new Vector3(...shoulderPoint(lean, side)), elbow = new Vector3(), wrist = new Vector3()
  solveArm(shoulder, hand.clone().addScaledVector(direction.normalize(), -HAND), pole, elbow, wrist)
  return { shoulder, elbow, wrist }
}

describe('seated working pose', () => {
  it('keeps both arm bones at their lengths, reaching or not', () => {
    for (const target of [[0.1, 0.2, 0.3], [0.2, 0.3, 2], [0.16, 0.4, 0.02]] as const) {
      const { shoulder, elbow, wrist } = arm(0.1, 1, new Vector3(...target), new Vector3(0, 0, 1), new Vector3(0.3, -1, 0))
      expect(shoulder.distanceTo(elbow)).toBeCloseTo(UPPER_ARM, 6)
      expect(elbow.distanceTo(wrist)).toBeCloseTo(FOREARM, 6)
    }
  })

  it('leans just enough to type at the desk and on the lap', () => {
    const deep: Workstation = { ...DESK, keyboard: [DESK.keyboard[0], DESK.keyboard[1], 0.64] }
    expect(workLean(DESK)).toBeLessThan(0.2)
    expect(workLean(deep)).toBeGreaterThan(workLean(DESK))
    expect(workLean(LAP_WORKSTATION)).toBeCloseTo(0.06, 6)
  })

  it('puts hands on the keyboard, mouse or chin through a whole cycle', () => {
    for (const station of [DESK, LAP_WORKSTATION]) for (let time = 0; time < WORK_CYCLE; time += 0.5) {
      const frame = workFrame(11, time)
      const { base, handOffsets } = workPose(station, frame, time)
      base.hands.forEach((hand, index) => {
        const side = index === 0 ? 1 : -1
        const target = new Vector3(...hand.position).add(new Vector3(...handOffsets[index]))
        const direction = new Vector3(...hand.direction)
        const { wrist } = arm(base.lean, side, target, direction.clone(), new Vector3(...hand.pole))
        // The solved hand lands where the pose asks, within a centimetre.
        expect(wrist.clone().addScaledVector(direction.normalize(), HAND).distanceTo(target)).toBeLessThan(0.01)
      })
      if (frame.activity === 'typing') {
        expect(base.hands[0].position[0]).toBeGreaterThan(station.keyboard[0])
        expect(base.hands[1].position[0]).toBeLessThan(station.keyboard[0])
      }
      expect(Math.abs(base.headYaw)).toBeLessThanOrEqual(0.6)
    }
  })

  it('looks down at the screen while working and at the book while reading', () => {
    const typing = Array.from({ length: 200 }, (_, index) => index * 0.2).map(time => workFrame(3, time)).find(frame => frame.activity === 'typing')!
    expect(workPose(LAP_WORKSTATION, typing, 0).base.headPitch).toBeGreaterThan(0.2)
    expect(restingPose('reading').headPitch).toBeGreaterThan(restingPose(undefined).headPitch)
  })
})
