import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { VacuumPlan, VacuumPoint } from './robot-vacuum-navigation'
import { catPose, createCat, reconcileCat, SLEEPING_POSE, stepCat, type CatPose, type CatSetting, type CatState } from './room-cat'

/* A procedural ginger tabby in meters. The rig is a short spine (hips, waist,
   chest) so the same body can stand, sit, crouch, leap and curl into a sleeping
   ring. It faces local +Z. Each rigid part is one vertex-coloured geometry, so
   the whole cat costs about 28 draw calls. */

type Triple = [number, number, number]
const TAIL_SEGMENTS = 10
const TAIL_LENGTH = 0.031
const FRONT_LEG = [0.078, 0.074] as const
const HIND_LEG = [0.082, 0.08] as const
const STAND_HEIGHT = 0.19
const LIE_HEIGHT = 0.066
const FUR = '#c97a3e', STRIPE = '#9c5527', CREAM = '#f0dcc0', PINK = '#dc958e', NOSE = '#c9706c'

interface Piece { shape: THREE.BufferGeometry; color: string; position?: Triple; scale?: Triple; rotation?: Triple }

/** Bakes transformed, coloured primitives into one geometry for a single draw call. */
function bake(pieces: Piece[]) {
  const parts = pieces.map(({ shape, color, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0] }) => {
    const part = shape.clone()
    part.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(...scale)))
    const { r, g, b } = new THREE.Color(color)
    part.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: part.attributes.position.count }, () => [r, g, b]).flat(), 3))
    return part
  })
  const merged = mergeGeometries(parts)!
  parts.forEach(part => part.dispose())
  return merged
}

function catResources() {
  const sphere = new THREE.SphereGeometry(1, 22, 16)
  const cone = new THREE.ConeGeometry(1, 1, 3, 1)
  const whisker = new THREE.CylinderGeometry(0.0006, 0.0003, 0.07, 3)
  const ear = (side: number) => bake([
    { shape: cone, color: FUR, position: [0, 0.02, 0], scale: [0.024, 0.044, 0.014], rotation: [0, side * 0.55, 0] },
    { shape: cone, color: PINK, position: [0, 0.018, 0.005], scale: [0.015, 0.033, 0.008], rotation: [0, side * 0.55, 0] },
  ])
  const lowerLeg = (radius: number, length: number) => bake([
    { shape: new THREE.CapsuleGeometry(radius, length - 0.02, 4, 10), color: FUR, position: [0, -length / 2, 0] },
    { shape: sphere, color: CREAM, position: [0, -length + 0.004, 0.008], scale: [0.019, 0.012, 0.026] },
  ])
  const upperLeg = (radius: number, length: number, trim: number) => bake([{ shape: new THREE.CapsuleGeometry(radius, length - trim, 4, 10), color: FUR, position: [0, -length / 2, 0] }])
  const geometries = {
    mid: bake([
      { shape: sphere, color: FUR, scale: [0.074, 0.071, 0.1] },
      { shape: sphere, color: CREAM, position: [0, -0.03, 0], scale: [0.055, 0.045, 0.085] },
    ]),
    chest: bake([
      { shape: sphere, color: FUR, position: [0, 0.006, 0.05], scale: [0.069, 0.074, 0.075] },
    ]),
    hips: bake([{ shape: sphere, color: FUR, position: [0, 0.005, -0.05], scale: [0.077, 0.075, 0.08] }]),
    head: bake([
      { shape: sphere, color: FUR, scale: [0.058, 0.051, 0.054] },
      ...[-1, 1].map((side): Piece => ({ shape: sphere, color: FUR, position: [side * 0.027, -0.017, 0.024], scale: [0.031, 0.027, 0.03] })),
      { shape: sphere, color: CREAM, position: [0, -0.022, 0.046], scale: [0.03, 0.019, 0.02] },
      { shape: sphere, color: NOSE, position: [0, -0.006, 0.062], scale: [0.0085, 0.0055, 0.006] },
      // Forehead tabby "M".
      ...[-0.016, 0, 0.016].map((x): Piece => ({ shape: sphere, color: STRIPE, position: [x, 0.037, 0.03], scale: [0.0045, 0.014, 0.004], rotation: [-0.75, 0, x * 18] })),
      ...[-1, 1].flatMap(side => [-0.12, 0, 0.12].map((angle): Piece => ({ shape: whisker, color: '#f5efe6', position: [side * 0.046, -0.022, 0.05], rotation: [angle, 0, side * (Math.PI / 2 - 0.12)] }))),
    ]),
    lash: bake([{ shape: sphere, color: '#3b2617', scale: [0.0135, 0.0118, 0.006] }]),
    iris: bake([
      { shape: sphere, color: '#b7b23c', position: [0, 0, 0.0015], scale: [0.012, 0.0108, 0.006] },
      { shape: sphere, color: '#16100c', position: [0, 0, 0.0038], scale: [0.0035, 0.0092, 0.004] },
    ]),
    ears: [ear(-1), ear(1)],
    frontUpper: upperLeg(0.019, FRONT_LEG[0], 0.02),
    frontLower: lowerLeg(0.015, FRONT_LEG[1]),
    hindUpper: upperLeg(0.026, HIND_LEG[0], 0.03),
    hindLower: lowerLeg(0.015, HIND_LEG[1]),
    tail: Array.from({ length: TAIL_SEGMENTS }, (_, index) => bake([{
      shape: new THREE.CapsuleGeometry(0.017 - index * 0.0006, TAIL_LENGTH, 4, 8),
      color: index % 3 === 2 || index === TAIL_SEGMENTS - 1 ? STRIPE : FUR,
      position: [0, 0, -TAIL_LENGTH / 2], rotation: [Math.PI / 2, 0, 0],
    }])),
  }
  for (const shape of [sphere, cone, whisker]) shape.dispose()
  const materials = {
    fur: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    eye: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, emissive: '#3c3a10', emissiveIntensity: 0.25 }),
  }
  return {
    materials, geometries,
    dispose() {
      Object.values(materials).forEach(material => material.dispose())
      Object.values(geometries).flat().forEach(geometry => geometry.dispose())
    },
  }
}
type Resources = ReturnType<typeof catResources>

interface LegRig { hip: THREE.Group; knee: THREE.Group }
interface CatRig {
  body: THREE.Group; mid: THREE.Group; front: THREE.Group; rear: THREE.Group; neck: THREE.Group; head: THREE.Group; tailBase: THREE.Group
  ears: THREE.Group[]; eyes: THREE.Group[]; irises: THREE.Object3D[]; legs: LegRig[]; tail: THREE.Group[]
}

function Leg({ resources, position, hind, register }: { resources: Resources; position: Triple; hind: boolean; register: (rig: LegRig) => void }) {
  const hip = useRef<THREE.Group>(null), knee = useRef<THREE.Group>(null)
  useLayoutEffect(() => { if (hip.current && knee.current) register({ hip: hip.current, knee: knee.current }) }, [register])
  const { geometries: g, materials: m } = resources
  return <group ref={hip} position={position}>
    <mesh geometry={hind ? g.hindUpper : g.frontUpper} material={m.fur} castShadow />
    <group ref={knee} position={[0, -(hind ? HIND_LEG : FRONT_LEG)[0], 0]}>
      <mesh geometry={hind ? g.hindLower : g.frontLower} material={m.fur} castShadow />
    </group>
  </group>
}

function CatModel({ resources, rig }: { resources: Resources; rig: RefObject<Partial<CatRig>> }) {
  const single = <K extends 'body' | 'mid' | 'front' | 'rear' | 'neck' | 'head' | 'tailBase'>(key: K) => (value: THREE.Group | null) => { if (value) rig.current![key] = value }
  const list = <K extends 'ears' | 'eyes' | 'irises' | 'tail'>(key: K, index: number) => (value: THREE.Object3D | null) => {
    if (!value) return
    const items = (rig.current![key] ??= []) as THREE.Object3D[]
    items[index] = value
  }
  const legs = useMemo(() => [0, 1, 2, 3].map(index => (leg: LegRig) => { (rig.current!.legs ??= [])[index] = leg }), [rig])
  const { materials: m, geometries: g } = resources
  const tail = (index: number): ReactNode => index >= TAIL_SEGMENTS ? null
    : <group ref={list('tail', index)} position={index ? [0, 0, -TAIL_LENGTH] : [0, 0, 0]}>
      <mesh geometry={g.tail[index]} material={m.fur} castShadow />
      {tail(index + 1)}
    </group>
  return <group ref={single('body')}>
    <group ref={single('mid')}><mesh geometry={g.mid} material={m.fur} castShadow receiveShadow /></group>
    <group ref={single('front')} position={[0, 0, 0.055]}>
      <mesh geometry={g.chest} material={m.fur} castShadow receiveShadow />
      <Leg resources={resources} position={[0.037, -0.03, 0.072]} hind={false} register={legs[1]} />
      <Leg resources={resources} position={[-0.037, -0.03, 0.072]} hind={false} register={legs[3]} />
      <group ref={single('neck')} position={[0, 0.03, 0.1]}>
        <group ref={single('head')} position={[0, 0.046, 0.034]} scale={1.16}>
          <mesh geometry={g.head} material={m.fur} castShadow receiveShadow />
          {[-1, 1].map((side, index) => <group key={side} ref={list('eyes', index)} position={[side * 0.024, 0.008, 0.045]} rotation={[0, side * 0.42, side * -0.12]}>
            <mesh geometry={g.lash} material={m.fur} />
            <mesh ref={list('irises', index)} geometry={g.iris} material={m.eye} />
          </group>)}
          {[-1, 1].map((side, index) => <group key={side} ref={list('ears', index)} position={[side * 0.031, 0.041, -0.006]}>
            <mesh geometry={g.ears[index]} material={m.fur} castShadow />
          </group>)}
        </group>
      </group>
    </group>
    <group ref={single('rear')} position={[0, 0, -0.055]}>
      <mesh geometry={g.hips} material={m.fur} castShadow receiveShadow />
      <Leg resources={resources} position={[0.042, -0.025, -0.062]} hind register={legs[0]} />
      <Leg resources={resources} position={[-0.042, -0.025, -0.062]} hind register={legs[2]} />
      <group ref={single('tailBase')} position={[0, 0.03, -0.115]}>{tail(0)}</group>
    </group>
  </group>
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** [front swing, front knee, hind swing, hind knee]; negative swing reaches forward. */
const LEGS = {
  lie: [1.3, -0.3, -1.25, 2.35],
  stand: [0, 0.05, -0.42, 0.72],
  sit: [0.5, 0, -1.3, 2.45],
  crouch: [-0.55, 1.05, -0.95, 1.75],
  leap: [-1.15, 0.15, 1.0, 0.25],
}
// Lateral-sequence walk: left hind, left fore, right hind, right fore.
const GAIT_OFFSET = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]

const LEVEL = new THREE.Quaternion(), YAW = new THREE.Quaternion(), TILT = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0)

function applyPose(rig: CatRig, pose: CatPose, gait: number, time: number) {
  const { rise, sit, curl, crouch, leap, walk } = pose
  const pitch = -0.55 * sit - 0.32 * leap + 0.06 * crouch
  const bob = Math.abs(Math.sin(gait)) * 0.006 * walk
  rig.body.position.y = lerp(lerp(LIE_HEIGHT, STAND_HEIGHT, rise), 0.135, sit) - crouch * 0.055 + bob
  rig.body.rotation.set(pitch, 0, pose.roll)
  const breathing = 1 + Math.sin(time * Math.PI * 2 / 3.4) * 0.03 * (1 - rise)
  rig.mid.scale.set(breathing, breathing, 1)
  rig.front.rotation.set(curl * 0.08, curl * 1.0, 0)
  rig.rear.rotation.set(0, -curl * 1.0 + Math.sin(time * 17) * 0.13 * pose.wiggle, Math.sin(time * 17) * 0.04 * pose.wiggle)
  // Keep the tail's wrap axis vertical: without the body's sideways roll, a
  // sleeping tail stays on the floor instead of rising as it curls around.
  LEVEL.setFromEuler(TILT.set(pitch, 0, 0)).multiply(YAW.setFromAxisAngle(UP, rig.rear.rotation.y))
  rig.tailBase.position.y = lerp(-0.008, 0.03, Math.max(rise, sit))
  rig.tailBase.quaternion.copy(rig.body.quaternion).multiply(rig.rear.quaternion).invert().multiply(LEVEL)
  rig.neck.position.y = lerp(0.005, 0.03, Math.max(rise, 1 - curl))
  rig.neck.rotation.set(pose.headPitch - pitch * 0.85 + Math.sin(gait * 2) * 0.03 * walk, pose.headYaw + curl * 0.85, 0)
  rig.head.rotation.z = pose.headTilt
  rig.legs.forEach((leg, index) => {
    const front = index % 2 === 1
    const at = (key: keyof typeof LEGS, offset: number) => LEGS[key][(front ? 0 : 2) + offset]
    const blend = (offset: number) => {
      let value = lerp(at('lie', offset), at('stand', offset), rise)
      value = lerp(value, at('sit', offset), sit)
      value = lerp(value, at('crouch', offset), crouch)
      return lerp(value, at('leap', offset), leap)
    }
    const step = gait + GAIT_OFFSET[index]
    const amount = walk * rise
    leg.hip.rotation.x = blend(0) + Math.sin(step) * 0.42 * amount
    leg.knee.rotation.x = blend(1) + Math.max(0, Math.cos(step)) * (front ? 1.05 : -0.8) * amount
  })
  const blink = time % 4.7 > 4.55 ? 0.1 : 1
  const eyes = pose.eyes > 0.5 ? pose.eyes * blink : pose.eyes
  rig.eyes.forEach(eye => eye.scale.set(1, Math.max(0.14, eyes), 1))
  rig.irises.forEach(iris => { iris.visible = eyes > 0.2 })
  rig.ears.forEach((ear, index) => {
    const side = index ? 1 : -1
    // Relaxed ears lie back and outward; alert ears stand up and turn forward.
    const flick = pose.ears < 0.9 && pose.ears > 0.35 ? Math.max(0, Math.sin(time * 9 + index * 2)) ** 8 * 0.35 : 0
    ear.rotation.set(-(1 - pose.ears) * 0.45 - flick, 0, side * (0.2 + (1 - pose.ears) * 0.55))
  })
  rig.tail.forEach((segment, index) => {
    const u = index / (TAIL_SEGMENTS - 1)
    const lift = pose.tailLift
    // Down: drop to the floor with pitch alone, then wrap with yaw alone, so
    // the two never mix into a tilt that lifts the tip.
    const down = [-1.2, -0.35, 1.55][index] ?? 0
    const up = index === 0 ? 1.25 : u > 0.62 ? 0.08 + pose.tailHook * 0.34 : 0.07
    const low = index === 0 ? 0.05 : -0.02
    let pitchValue = lerp(lerp(down, low, Math.min(1, lift * 2)), up, Math.max(0, lift * 2 - 1))
    pitchValue += crouch * (index === 0 ? -0.15 : 0) + leap * (index === 0 ? -0.8 : 0.02)
    const sway = Math.sin(time * 2.1 - index * 0.55) * 0.07 * lift + Math.sin(time * 13 - index) * 0.2 * crouch * u
    // Wrap only after the tail has reached the floor, so it lies flat around the body.
    segment.rotation.set(pitchValue, -curl * (index < 3 ? 0 : 0.55) + sway, 0)
  })
}

const POSE_KEYS = Object.keys(SLEEPING_POSE) as (keyof CatPose)[]

/**
 * A cat that sleeps on the rug and moves out of the vacuum's way. It shares the
 * vacuum session: editing the project starts a new story at the rug, while
 * furnishing toggles keep its progress. It never edits project state.
 */
export function RoomCat({ setting, plan, vacuum, session }: { setting: CatSetting; plan: VacuumPlan; vacuum: RefObject<VacuumPoint | null>; session: object }) {
  const invalidate = useThree(state => state.invalidate)
  const resources = useMemo(catResources, [])
  useEffect(() => () => resources.dispose(), [resources])
  const root = useRef<THREE.Group>(null)
  const rig = useRef<Partial<CatRig>>({})
  const cat = useRef<{ session: object; state: CatState; pose: CatPose; last: number } | null>(null)

  useLayoutEffect(() => {
    if (!cat.current || cat.current.session !== session) {
      cat.current = { session, state: createCat(setting), pose: { ...SLEEPING_POSE }, last: 0 }
    } else reconcileCat(cat.current.state, setting)
    if (root.current) root.current.userData = cat.current.state
    invalidate()
  }, [setting, session, invalidate])

  useFrame(() => {
    const current = cat.current, group = root.current, parts = rig.current as CatRig
    if (!current || !group || !parts.tail || parts.tail.length < TAIL_SEGMENTS || parts.legs?.length < 4 || document.hidden) return
    const now = performance.now()
    const dt = current.last ? Math.min((now - current.last) / 1000, 0.1) : 0
    current.last = now
    const robot = vacuum.current
    const busy = stepCat(current.state, setting, robot, dt)
    const target = catPose(current.state, robot)
    let settling = false
    for (const key of POSE_KEYS) {
      // Curling and uncurling are slower than ear and eye movements.
      const rate = key === 'curl' || key === 'roll' ? 4 : key === 'eyes' || key === 'ears' ? 9 : 6.5
      const value = current.pose[key] + (target[key] - current.pose[key]) * (dt ? 1 - Math.exp(-rate * dt) : 1)
      if (Math.abs(value - target[key]) > 0.002) settling = true
      current.pose[key] = value
    }
    const state = current.state
    group.position.set(state.x, plan.floorY + state.y, state.z)
    group.rotation.y = state.heading
    applyPose(parts, current.pose, state.gait, now / 1000)
    // A resting cat only animates while the vacuum is already requesting frames.
    if (busy || settling) invalidate()
  })

  return <group ref={root} name="Room cat"><CatModel resources={resources} rig={rig} /></group>
}
