import { Vector3 } from 'three'
import type { SeatedPose, Workstation } from '@/lib/preview-furnishings'
import type { Vec3 } from '@/lib/types'
import { POINTER_HOME, type WorkFrame } from './desk-work'

/*
 * Seated person in metres, origin at the top of the seat, facing +Z. The
 * person's left is +X. The torso pivots forward around the hips; the arms are
 * two-bone chains solved from the shoulders to the wrists.
 */
export const HIP: Vec3 = [0, 0.07, -0.03]
/** Torso-frame joints, for the person's left side; the right mirrors X. */
export const SHOULDER: Vec3 = [0.156, 0.386, 0]
export const NECK: Vec3 = [0, 0.552, 0.014]
export const HEAD_CENTER = 0.07
export const UPPER_ARM = 0.27
export const FOREARM = 0.25
/** From the wrist to the middle of the hand. */
export const HAND = 0.048

export interface HandPose {
  /** Middle of the hand. */
  position: Vec3
  /** The way the fingers point. */
  direction: Vec3
  /** The way the elbow bends. */
  pole: Vec3
}

export interface BodyPose {
  lean: number
  /** Head rotation relative to the torso; positive pitch looks down, positive yaw turns to the person's left. */
  headPitch: number
  headYaw: number
  headRoll: number
  /** Person's left hand, then right. */
  hands: [HandPose, HandPose]
}

const SIDES = [1, -1] as const

export function torsoPoint(lean: number, point: Vec3): Vec3 {
  const cos = Math.cos(lean), sin = Math.sin(lean)
  return [HIP[0] + point[0], HIP[1] + point[1] * cos - point[2] * sin, HIP[2] + point[1] * sin + point[2] * cos]
}

export const shoulderPoint = (lean: number, side: 1 | -1) => torsoPoint(lean, [SHOULDER[0] * side, SHOULDER[1], SHOULDER[2]])

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, factor: number): Vec3 => [a[0] * factor, a[1] * factor, a[2] * factor]
const normal = (a: Vec3): Vec3 => { const length = Math.hypot(...a) || 1; return scale(a, 1 / length) }
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export const wristOf = (hand: HandPose): Vec3 => add(hand.position, scale(normal(hand.direction), -HAND))

/** Two-bone solution; an unreachable wrist stops at full reach along the same line. */
export function solveArm(shoulder: Vector3, wrist: Vector3, pole: Vector3, elbowOut: Vector3, wristOut: Vector3) {
  const reach = UPPER_ARM + FOREARM
  const along = wrist.clone().sub(shoulder)
  const length = Math.min(Math.max(along.length(), Math.abs(UPPER_ARM - FOREARM) + 1e-4), reach - 1e-4)
  along.normalize()
  wristOut.copy(shoulder).addScaledVector(along, length)
  const a = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + length * length) / (2 * length)
  const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - a * a))
  const bend = pole.clone().addScaledVector(along, -pole.dot(along))
  if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0).addScaledVector(along, -along.y)
  bend.normalize()
  elbowOut.copy(shoulder).addScaledVector(along, a).addScaledVector(bend, h)
}

/** Lean just enough for both hands to reach the keyboard comfortably. */
export function workLean(station: Workstation) {
  for (let lean = 0.06; lean < 0.34; lean += 0.02) {
    const fits = SIDES.every(side => distance(shoulderPoint(lean, side), wristOf(keyboardHand(station, side, 0))) <= (UPPER_ARM + FOREARM) * 0.93)
    if (fits) return lean
  }
  return 0.34
}

function keyboardHand(station: Workstation, side: 1 | -1, lift: number): HandPose {
  const spread = station.kind === 'laptop' ? 0.058 : 0.068
  return {
    position: add(station.keyboard, [side * spread, 0.021 + lift, -0.012]),
    direction: [-side * 0.18, -0.3, 1],
    pole: [side * 0.18, -1, -0.15],
  }
}

/** The mouse or trackpad position that puts the cursor at u, v. */
export function pointerAt(station: Workstation, cursor: readonly [number, number]): Vec3 {
  const [rangeX, rangeZ] = station.kind === 'laptop' ? [0.045, 0.03] : [0.13, 0.08]
  return add(station.pointer, [-(cursor[0] - POINTER_HOME[0]) * rangeX, 0, (POINTER_HOME[1] - cursor[1]) * rangeZ])
}

function pointerHand(station: Workstation, cursor: readonly [number, number], dip: number): HandPose {
  const laptop = station.kind === 'laptop'
  return {
    position: add(pointerAt(station, cursor), laptop ? [0.012, 0.016 - dip, -0.02] : [0.004, 0.03 - dip, -0.028]),
    direction: laptop ? [0.2, -0.35, 1] : [0.05, -0.4, 1],
    pole: [-0.22, -1, -0.2],
  }
}

function restingHand(station: Workstation, side: 1 | -1): HandPose {
  const laptop = station.kind === 'laptop'
  return {
    position: add(station.keyboard, laptop ? [side * 0.075, 0.004, -0.07] : [side * 0.13, -0.012, -0.11]),
    direction: [-side * 0.45, -0.1, 1],
    pole: [side * 0.3, -1, -0.1],
  }
}

/** The screen point in the person's frame. Thinking can look above the screen. */
export function screenPoint(station: Workstation, gaze: readonly [number, number]): Vec3 {
  const [width, height] = station.screenSize
  return add(station.screen, [-(gaze[0] - 0.5) * width, (0.5 - gaze[1]) * height, 0])
}

/** Head angles relative to a leaning torso that look at a point; the eyes do part of the turn. */
export function lookAt(lean: number, point: Vec3, share = 0.8) {
  const head = torsoPoint(lean, [NECK[0], NECK[1] + HEAD_CENTER, NECK[2]])
  const dx = point[0] - head[0], dy = point[1] - head[1], dz = point[2] - head[2]
  const yaw = Math.atan2(dx, Math.max(0.05, dz))
  const down = Math.atan2(-dy, Math.hypot(dx, dz))
  return { headPitch: Math.min(0.75, Math.max(-0.35, down * share - lean)), headYaw: Math.min(0.6, Math.max(-0.6, yaw * share)) }
}

/** The underside of the chin, in the person's frame, for a thinking hand. */
function chinPoint(lean: number, headPitch: number): Vec3 {
  const cos = Math.cos(headPitch), sin = Math.sin(headPitch)
  const chin: Vec3 = [0, 0.018, 0.072]
  return torsoPoint(lean, [NECK[0] + chin[0], NECK[1] + chin[1] * cos - chin[2] * sin, NECK[2] + chin[1] * sin + chin[2] * cos])
}

export interface WorkPose {
  /** Smoothed between activities. */
  base: BodyPose
  /** Quick offsets added after smoothing: key strikes, clicks and scrolling. */
  handOffsets: [Vec3, Vec3]
}

export function workPose(station: Workstation, frame: WorkFrame, time: number): WorkPose {
  const reach = workLean(station)
  const strike = (age: number) => 0.013 * Math.exp(-age * 24)
  const handOffsets: [Vec3, Vec3] = [[0, 0, 0], [0, 0, 0]]
  let lean = reach, roll = 0
  let hands: [HandPose, HandPose]
  switch (frame.activity) {
    case 'typing': {
      const hover = frame.pausing ? 0.008 : 0
      hands = [keyboardHand(station, 1, hover), keyboardHand(station, -1, hover)]
      SIDES.forEach((side, index) => {
        const age = frame.keyAge[index]
        // The striking hand drifts towards its key: column -1 is the person's left (+X).
        const shift = age < 0.4 ? -frame.keyColumn * 0.022 * Math.exp(-age * 4) : 0
        handOffsets[index] = [side === (frame.keyColumn < 0 ? 1 : -1) ? shift : 0, -strike(age), 0]
      })
      roll = frame.pausing ? 0.05 * Math.sin(time * 0.8) : 0
      break
    }
    case 'pointing':
    case 'reading': {
      const click = frame.clickAge < 0.4 ? 0.006 * Math.exp(-frame.clickAge * 18) : 0
      hands = [restingHand(station, 1), pointerHand(station, frame.activity === 'pointing' ? frame.cursor : POINTER_HOME, click)]
      if (frame.activity === 'reading') {
        // Sit back a little and roll the wheel now and then.
        lean = Math.max(0.04, reach - 0.04)
        handOffsets[1] = [0, 0, 0.003 * Math.max(0, Math.sin(time * 9)) * (Math.sin(time * 0.9) > 0.6 ? 1 : 0)]
      }
      break
    }
    case 'thinking': {
      lean = Math.max(0.02, reach * 0.35)
      const look = lookAt(lean, screenPoint(station, frame.gaze), 0.6)
      const chin = chinPoint(lean, look.headPitch)
      hands = [restingHand(station, 1), { position: add(chin, [-0.012, -0.03, 0.006]), direction: [0.15, 1, 0.35], pole: [-0.25, -1, 0.5] }]
      roll = -0.09
      return { base: { lean, ...look, headRoll: roll, hands }, handOffsets }
    }
  }
  const look = lookAt(lean, screenPoint(station, frame.gaze), frame.activity === 'reading' ? 0.55 : 0.75)
  return { base: { lean, ...look, headRoll: roll, hands: hands! }, handOffsets }
}

/** Poses without a workstation: hands on the knees, or holding a book. */
export function restingPose(pose: SeatedPose | undefined): BodyPose {
  const reading = pose === 'reading'
  return {
    lean: reading ? 0.05 : 0.02,
    headPitch: reading ? 0.32 : 0.04,
    headYaw: 0,
    headRoll: 0,
    hands: SIDES.map(side => reading
      ? { position: [side * 0.08, 0.255, 0.235], direction: [-side * 0.5, 0.35, 1], pole: [side * 0.7, -1, -0.2] }
      : { position: [side * 0.118, 0.142, 0.285], direction: [-side * 0.12, -0.35, 1], pole: [side * 0.45, -0.6, -1] }) as [HandPose, HandPose],
  }
}

/** A laptop on the lap, as SeatedPerson places it, in the person's frame. */
export const LAP_LAPTOP = { position: [0, 0.165, 0.2] as Vec3, scale: 0.85 }
export const LAP_WORKSTATION: Workstation = {
  kind: 'laptop',
  keyboard: [0, 0.178, 0.17],
  pointer: [0, 0.178, 0.111],
  screen: [0, 0.266, 0.298],
  screenSize: [0.29 * 0.85, 0.18 * 0.85],
}
