import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { FurnishingPlacement, SeatedPose, Workstation } from '@/lib/preview-furnishings'
import { staticWorkTime, workFrame } from './desk-work'
import { drawWorkScreen, workScreenKey } from './desk-screen'
import {
  FOREARM, HAND, HIP, LAP_LAPTOP, LAP_WORKSTATION, NECK, SHOULDER, UPPER_ARM, restingPose, shoulderPoint, solveArm, workPose,
  type BodyPose,
} from './seated-pose'
import { createPreviewBooks, type PreviewBook, type PreviewBookArrangement, type PreviewBookSupport } from '@/lib/preview-books'
import type { Vec3 } from '@/lib/types'

// Metres, with the supporting surface at y=0 and the front facing +Z.
// These shapes deliberately stay inside the envelopes used by the detector.
const noRaycast = () => null
const INK = '#343b37'
const LINEN = '#d7cbb9'

function Box({ position, size, color, radius = 0, rotation, roughness = 0.8, metalness = 0 }: {
  position: Vec3; size: Vec3; color: string; radius?: number; rotation?: Vec3; roughness?: number; metalness?: number
}) {
  const material = <meshStandardMaterial color={color} roughness={roughness} metalness={metalness}/>
  return radius > 0
    ? <RoundedBox position={position} args={size} radius={radius} smoothness={2} rotation={rotation} castShadow receiveShadow raycast={noRaycast}>{material}</RoundedBox>
    : <mesh position={position} rotation={rotation} castShadow receiveShadow raycast={noRaycast}><boxGeometry args={size}/>{material}</mesh>
}

function Ellipsoid({ position, size, color, rotation, roughness = 0.9 }: {
  position: Vec3; size: Vec3; color: string; rotation?: Vec3; roughness?: number
}) {
  return <mesh position={position} scale={size} rotation={rotation} castShadow receiveShadow raycast={noRaycast}>
    <sphereGeometry args={[1, 20, 14]}/><meshStandardMaterial color={color} roughness={roughness}/>
  </mesh>
}

function Stem({ from, to, radius, color, endRadius = radius }: {
  from: Vec3; to: Vec3; radius: number; color: string; endRadius?: number
}) {
  const [fromX, fromY, fromZ] = from, [toX, toY, toZ] = to
  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(fromX, fromY, fromZ), end = new THREE.Vector3(toX, toY, toZ)
    const delta = end.clone().sub(start)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize())
    return { position: start.add(end).multiplyScalar(0.5), quaternion, length: delta.length() }
  }, [fromX, fromY, fromZ, toX, toY, toZ])
  return <mesh position={position} quaternion={quaternion} castShadow receiveShadow raycast={noRaycast}>
    <cylinderGeometry args={[endRadius, radius, length, 12]}/><meshStandardMaterial color={color} roughness={0.8}/>
  </mesh>
}

/** Cover artwork and spine marks share one small mesh per book. */
function bookArtworkGeometry(book: PreviewBook) {
  const positions: number[] = [], normals: number[] = [], colors: number[] = []
  let layer = 0
  const triangle = (points: [number, number][], color: string, cover: boolean, offset: number) => {
    const tint = new THREE.Color(color)
    for (const [u, v] of points) {
      positions.push(...(cover ? [book.thickness / 2 + offset, v, -u] : [u, v, book.depth / 2 + offset]))
      normals.push(...(cover ? [1, 0, 0] : [0, 0, 1]))
      colors.push(tint.r, tint.g, tint.b)
    }
  }
  const rect = (x: number, y: number, width: number, height: number, color: string, cover = true) => {
    const left = x - width / 2, right = x + width / 2, bottom = y - height / 2, top = y + height / 2
    const offset = 0.00015 + layer++ * 0.000015
    triangle([[left, bottom], [right, bottom], [right, top]], color, cover, offset)
    triangle([[left, bottom], [right, top], [left, top]], color, cover, offset)
  }
  const disc = (x: number, y: number, radius: number, color: string, half = false) => {
    const offset = 0.00015 + layer++ * 0.000015
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * (half ? 1 : 2), b = (i + 1) / 24 * Math.PI * (half ? 1 : 2)
      triangle([[x, y], [x + Math.cos(a) * radius, y + Math.sin(a) * radius], [x + Math.cos(b) * radius, y + Math.sin(b) * radius]], color, true, offset)
    }
  }
  const w = book.depth, h = book.height
  switch (book.design) {
    case 'band':
      rect(0, -h * 0.06, w * 0.91, h * 0.36, book.coverColor)
      disc(w * 0.16, h * 0.19, w * 0.17, book.accentColor)
      break
    case 'arch':
      rect(0, -h * 0.12, w * 0.59, h * 0.36, book.coverColor)
      disc(0, h * 0.06, w * 0.295, book.coverColor, true)
      rect(w * 0.13, -h * 0.08, w * 0.1, h * 0.43, book.accentColor)
      break
    case 'grid':
      for (const x of [-1, 1]) for (const y of [-1, 1]) rect(x * w * 0.19, y * h * 0.17, w * 0.30, h * 0.23, x === y ? book.coverColor : book.accentColor)
      break
    case 'minimal':
      disc(0, -h * 0.065, w * 0.30, book.coverColor)
      rect(0, -h * 0.065, w * 0.76, h * 0.025, book.accentColor)
      break
    case 'split':
      rect(-w * 0.18, h * 0.045, w * 0.32, h * 0.62, book.coverColor)
      rect(w * 0.18, -h * 0.06, w * 0.32, h * 0.62, book.accentColor)
      break
  }
  rect(-w * 0.10, h * 0.39, w * 0.57, h * 0.022, book.accentColor)
  rect(-w * 0.18, h * 0.345, w * 0.41, h * 0.009, book.accentColor)
  rect(0, -h * 0.40, w * 0.26, h * 0.009, book.accentColor)
  for (let i = 0; i < book.stripeCount; i++) rect(0, h * 0.27 - i * 0.008, book.thickness * 0.64, 0.0025, book.accentColor, false)
  rect(0, -h * 0.29, book.thickness * 0.60, h * 0.08, book.coverColor, false)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

function Book({ book }: { book: PreviewBook }) {
  const geometry = useMemo(() => bookArtworkGeometry(book), [book])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group position={book.position} rotation={book.rotation}>
    <Box position={[0, 0, -0.0015]} size={[book.thickness - 0.005, book.height - 0.006, book.depth - 0.006]} color="#e6e0d0"/>
    {[-1, 1].map(side => <Box key={side} position={[side * (book.thickness / 2 - 0.0015), 0, 0]} size={[0.003, book.height, book.depth]} color={book.color}/>)}
    <Box position={[0, 0, book.depth / 2 - 0.002]} size={[book.thickness, book.height, 0.004]} color={book.color}/>
    <mesh geometry={geometry} receiveShadow raycast={noRaycast}><meshStandardMaterial vertexColors roughness={0.87}/></mesh>
  </group>
}

function Books({ seed, arrangement, supportSide }: { seed: string; arrangement?: PreviewBookArrangement; supportSide?: PreviewBookSupport }) {
  const books = useMemo(() => createPreviewBooks(seed, arrangement, supportSide), [seed, arrangement, supportSide])
  return <group>{books.map((book, i) => <Book key={i} book={book}/>)}</group>
}

/** Variant 0 is the established look; others pick from small curated sets. */
const pick = <T,>(options: readonly T[], variant = 0, salt = 0) => options[(variant + salt * 7) % options.length]
const CERAMICS = ['#e3d7c1', '#a9b8b0', '#c9876a', '#3f4744', '#d9c7a7'] as const
const LIGHT_CERAMICS = ['#e3d7c1', '#f1ece2', '#d9c7a7', '#c8d3cc'] as const
const POTS = ['#ae795b', '#d9d2c4', '#5d6b66', '#c08b6a'] as const
const SHADES = ['#e9dfca', '#d8c6a5', '#c9d2c6', '#e6d3c2'] as const
const FABRICS = ['#b9aa8f', '#7f8f86', '#c98f73', '#5f6b78', '#d8cbb3', '#a6787a'] as const
const WOODS = ['#79624b', '#a07b56', '#4f4239', '#b99a76'] as const
type Styled = { variant?: number; tone?: 'dark' }
const ceramic = ({ variant, tone }: Styled, salt = 0) => tone === 'dark' ? pick(LIGHT_CERAMICS, variant, salt) : pick(CERAMICS, variant, salt)

function TableLamp({ variant }: Styled) {
  return <group>
    <mesh position={[0, 0.013, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.085, 0.09, 0.026, 32]}/><meshStandardMaterial color="#b7a78d" roughness={0.6} metalness={0.25}/>
    </mesh>
    <Stem from={[0, 0.024, 0]} to={[0, 0.32, 0]} radius={0.007} color="#8b795c"/>
    <mesh position={[0, 0.328, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.078, 0.122, 0.18, 36, 1, true]}/><meshStandardMaterial color={pick(SHADES, variant)} roughness={0.95} side={THREE.DoubleSide}/>
    </mesh>
    <mesh position={[0, 0.239, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <circleGeometry args={[0.119, 32]}/><meshStandardMaterial color="#f0dfb8" emissive="#ecd39d" emissiveIntensity={0.3} side={THREE.DoubleSide}/>
    </mesh>
  </group>
}

function KeyboardKeys() {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const matrix = new THREE.Matrix4()
    for (let row = 0; row < 4; row++) for (let col = 0; col < 13; col++) {
      matrix.makeTranslation((col - 6) * 0.0235, 0.024, 0.112 + row * 0.023)
      ref.current.setMatrixAt(row * 13 + col, matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [])
  return <instancedMesh ref={ref} args={[undefined, undefined, 52]} castShadow receiveShadow raycast={noRaycast}>
    <boxGeometry args={[0.0195, 0.004, 0.017]}/><meshStandardMaterial color="#deded4" roughness={0.82}/>
  </instancedMesh>
}

/** Desk work animates in the live room; exports and reduced motion show one still moment. */
const WorkAnimation = createContext(false)
const workClock = () => performance.now() / 1000

/** A screen showing the work story of `seed`, redrawn only when what it shows changes. */
function WorkScreen({ seed, size, position }: { seed: number; size: [number, number]; position: Vec3 }) {
  const animate = useContext(WorkAnimation)
  const [width, height] = [Math.round(216 * size[0] / size[1]), 216]
  const resources = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return { canvas, texture, context: canvas.getContext('2d'), key: '', drawn: 0 }
  }, [width, height])
  useEffect(() => () => resources.texture.dispose(), [resources])
  const draw = (time: number) => {
    const { context, texture } = resources
    if (!context) return
    const frame = workFrame(seed, time)
    const key = workScreenKey(frame, width, height)
    if (key === resources.key) return
    resources.key = key
    drawWorkScreen(context, width, height, frame)
    texture.needsUpdate = true
  }
  useLayoutEffect(() => {
    resources.key = ''
    draw(animate ? workClock() : staticWorkTime(seed))
  })
  useFrame(() => {
    if (!animate || document.hidden) return
    const now = performance.now()
    // About twenty redraws a second is plenty for typing and a moving cursor.
    if (now - resources.drawn < 45) return
    resources.drawn = now
    draw(now / 1000)
  })
  return <mesh position={position} raycast={noRaycast}>
    <planeGeometry args={size}/>
    <meshStandardMaterial map={resources.texture} emissiveMap={resources.texture} emissive="#ffffff" emissiveIntensity={0.5} roughness={0.35}/>
  </mesh>
}

function Computer({ workSeed }: { workSeed?: number }) {
  return <group>
    <Box position={[0, 0.009, -0.12]} size={[0.205, 0.018, 0.15]} color="#9a9f98" radius={0.006} metalness={0.55} roughness={0.4}/>
    <Box position={[0, 0.097, -0.15]} size={[0.055, 0.17, 0.033]} color="#a7aba4" radius={0.006} metalness={0.5} roughness={0.4}/>
    <Box position={[0, 0.314, -0.135]} size={[0.54, 0.314, 0.028]} color={INK} radius={0.009} roughness={0.45}/>
    {workSeed !== undefined ? <WorkScreen seed={workSeed} size={[0.511, 0.281]} position={[0, 0.318, -0.1205]}/> : <>
      <mesh position={[0, 0.318, -0.1205]} raycast={noRaycast}>
        <planeGeometry args={[0.511, 0.281]}/><meshStandardMaterial color="#6c8581" emissive="#526e70" emissiveIntensity={0.25} roughness={0.4}/>
      </mesh>
      {/* A quiet, abstract desktop gives the screen depth without tiny UI text. */}
      <mesh position={[0.111, 0.342, -0.1198]} raycast={noRaycast}>
        <circleGeometry args={[0.082, 32]}/><meshStandardMaterial color="#bdbca6" emissive="#bdbca6" emissiveIntensity={0.12}/>
      </mesh>
      <Box position={[-0.095, 0.316, -0.1188]} size={[0.181, 0.187, 0.001]} color="#deddd3"/>
      <Box position={[-0.095, 0.378, -0.118]} size={[0.143, 0.022, 0.001]} color="#a6afa0"/>
      {[0, 1, 2, 3].map(row => <Box key={row} position={[-0.11 + (row % 2) * 0.015, 0.342 - row * 0.025, -0.118]} size={[row % 2 ? 0.133 : 0.103, 0.006, 0.001]} color="#a8afa7"/>)}
      <Box position={[0.047, 0.195, -0.118]} size={[0.16, 0.013, 0.001]} color="#c5d0c8" radius={0.0004}/>
    </>}
    <Box position={[-0.042, 0.013, 0.148]} size={[0.355, 0.022, 0.122]} color="#9ea49c" radius={0.007} metalness={0.25} roughness={0.5}/>
    <group position={[-0.042, 0, 0]}><KeyboardKeys/></group>
    <Box position={[0.236, 0.002, 0.145]} size={[0.128, 0.004, 0.19]} color="#8c9184" radius={0.001}/>
    <WorkMouse seed={workSeed}/>
  </group>
}

/** The mouse follows the cursor of the work story, so it moves under the person's hand. */
function WorkMouse({ seed }: { seed?: number }) {
  const animate = useContext(WorkAnimation)
  const ref = useRef<THREE.Group>(null)
  const place = (time: number) => {
    if (!ref.current || seed === undefined) return
    const frame = workFrame(seed, time)
    const cursor = frame.activity === 'pointing' ? frame.cursor : [0.66, 0.62]
    // The computer faces the person, so the person's right is the computer's +X.
    ref.current.position.set((cursor[0] - 0.66) * 0.13, 0, (cursor[1] - 0.62) * 0.08)
  }
  useLayoutEffect(() => place(animate ? workClock() : staticWorkTime(seed ?? 0)))
  useFrame(() => { if (animate && !document.hidden) place(workClock()) })
  return <group ref={ref}>
    <Ellipsoid position={[0.236, 0.018, 0.142]} size={[0.032, 0.02, 0.052]} color="#e2e0d6" roughness={0.55}/>
    <Box position={[0.236, 0.038, 0.125]} size={[0.004, 0.003, 0.012]} color="#939b93" radius={0.001}/>
  </group>
}

/** Open laptop, hinge at the back; fits 0.34 × 0.25 × 0.27 m. */
function Laptop({ variant, workSeed }: Styled & { workSeed?: number }) {
  const shell = pick(['#a9ada8', '#3c4044', '#c9c3b8'] as const, variant)
  return <group>
    <Box position={[0, 0.007, 0.02]} size={[0.32, 0.014, 0.22]} color={shell} radius={0.005} metalness={0.5} roughness={0.38}/>
    <Box position={[0, 0.0145, 0.035]} size={[0.27, 0.001, 0.085]} color="#2f3336" roughness={0.7}/>
    <Box position={[0, 0.0145, 0.105]} size={[0.105, 0.001, 0.045]} color={shell} radius={0.0005} metalness={0.35} roughness={0.3}/>
    <group position={[0, 0.014, -0.088]} rotation={[-0.25, 0, 0]}>
      <Box position={[0, 0.105, 0]} size={[0.32, 0.21, 0.008]} color={shell} radius={0.004} metalness={0.5} roughness={0.38}/>
      {workSeed !== undefined ? <WorkScreen seed={workSeed} size={[0.29, 0.18]} position={[0, 0.107, 0.0045]}/>
        : <mesh position={[0, 0.107, 0.0045]} raycast={noRaycast}>
          <planeGeometry args={[0.29, 0.18]}/><meshStandardMaterial color="#6c8581" emissive="#526e70" emissiveIntensity={0.25} roughness={0.4}/>
        </mesh>}
    </group>
  </group>
}

function SmallPlant(props: Styled) {
  const count = 9 + ((props.variant ?? 0) % 3) * 2
  const leaves = useMemo(() => Array.from({ length: count }, (_, index) => {
    const angle = index * 2.4
    const height = 0.175 + (index % 4) * 0.03
    return { angle, height, x: Math.sin(angle) * 0.055, z: Math.cos(angle) * 0.055 }
  }), [count])
  return <group>
    <mesh position={[0, 0.052, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.063, 0.047, 0.104, 28]}/><meshStandardMaterial color={props.tone === 'dark' && !props.variant ? '#d9d2c4' : pick(POTS, props.variant)} roughness={0.94}/>
    </mesh>
    <mesh position={[0, 0.104, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.055, 0.055, 0.003, 24]}/><meshStandardMaterial color="#594d3b" roughness={1}/>
    </mesh>
    {leaves.map(({ x, z, height, angle }, index) => <group key={angle}>
      <Stem from={[0, 0.105, 0]} to={[x, height, z]} radius={0.002} color="#727a4d"/>
      <Ellipsoid position={[x, height, z]} size={[0.023, 0.012, 0.044]} rotation={[0.5, angle, 0]} color={index % 2 ? '#6b7b50' : '#809064'}/>
    </group>)}
  </group>
}

const VASE_PROFILES: readonly (readonly [number, number][])[] = [
  [[0, 0], [0.045, 0], [0.058, 0.012], [0.077, 0.066], [0.079, 0.10], [0.065, 0.145], [0.034, 0.181], [0.03, 0.219], [0.035, 0.239],
    [0.029, 0.24], [0.024, 0.219], [0.028, 0.181], [0.057, 0.144], [0.065, 0.1], [0.048, 0.02], [0, 0.015]],
  [[0, 0], [0.05, 0], [0.06, 0.03], [0.062, 0.2], [0.07, 0.25], [0.064, 0.252], [0.055, 0.2], [0.053, 0.03], [0, 0.02]],
  [[0, 0], [0.03, 0], [0.085, 0.07], [0.083, 0.12], [0.04, 0.17], [0.045, 0.175], [0.038, 0.168], [0.075, 0.12], [0.077, 0.07], [0.025, 0.01], [0, 0.01]],
]

function Vase(props: Styled) {
  const shape = (props.variant ?? 0) % VASE_PROFILES.length
  const profile = useMemo(() => VASE_PROFILES[shape].map(([radius, y]) => new THREE.Vector2(radius, y)), [shape])
  return <mesh castShadow receiveShadow raycast={noRaycast}>
    <latheGeometry args={[profile, 32]}/><meshStandardMaterial color={ceramic(props)} roughness={0.72}/>
  </mesh>
}

function Mug(props: Styled) {
  const color = ceramic(props, 1)
  return <group>
    <mesh position={[0, 0.047, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.04, 0.038, 0.094, 24, 1, true]}/><meshStandardMaterial color={color} roughness={0.5} side={THREE.DoubleSide}/>
    </mesh>
    <mesh position={[0, 0.003, 0]} raycast={noRaycast}><cylinderGeometry args={[0.038, 0.038, 0.006, 24]}/><meshStandardMaterial color={color} roughness={0.5}/></mesh>
    <mesh position={[0, 0.082, 0]} raycast={noRaycast}><cylinderGeometry args={[0.037, 0.037, 0.002, 24]}/><meshStandardMaterial color="#5a3d2b" roughness={0.3}/></mesh>
    <mesh position={[0.045, 0.05, 0]} castShadow raycast={noRaycast}>
      <torusGeometry args={[0.02, 0.006, 8, 16]}/><meshStandardMaterial color={color} roughness={0.5}/>
    </mesh>
  </group>
}

function Notebook({ variant }: Styled) {
  return <group>
    <Box position={[0, 0.009, 0]} size={[0.21, 0.018, 0.148]} color={pick(FABRICS, variant)} radius={0.003}/>
    <Box position={[0, 0.009, 0]} size={[0.204, 0.0175, 0.142]} color="#efe9dc"/>
    <Box position={[0.08, 0.0185, 0]} size={[0.006, 0.001, 0.15]} color={INK}/>
  </group>
}

/** Leaning frame with abstract art; fits 0.30 × 0.38 × 0.09 m. */
function PictureFrame({ variant }: Styled) {
  const art = pick(FABRICS, variant, 1), accent = pick(FABRICS, variant, 3)
  return <group position={[0, 0, 0.03]} rotation={[-0.16, 0, 0]}>
    <Box position={[0, 0.18, 0]} size={[0.28, 0.36, 0.022]} color={pick(['#2f2c29', '#b89c78', '#e8e2d6'] as const, variant)} radius={0.003}/>
    <Box position={[0, 0.18, 0.0115]} size={[0.236, 0.316, 0.001]} color="#f2ede3"/>
    <mesh position={[-0.02, 0.2, 0.0125]} raycast={noRaycast}><circleGeometry args={[0.055, 28]}/><meshStandardMaterial color={art}/></mesh>
    <Box position={[0.03, 0.12, 0.0125]} size={[0.12, 0.05, 0.001]} color={accent}/>
  </group>
}

/** A woven, open container sized to its compartment. */
function Basket({ size, variant }: Styled & { size: Vec3 }) {
  const [w, h, d] = size, wall = 0.008
  const color = pick(['#b89b6c', '#cdb58a', '#8d7a5c', '#d6cbb6'] as const, variant)
  return <group>
    <Box position={[0, 0.005, 0]} size={[w, 0.01, d]} color={color} radius={0.004}/>
    {[-1, 1].map(sign => <Box key={`x${sign}`} position={[sign * (w / 2 - wall / 2), h / 2, 0]} size={[wall, h, d]} color={color} radius={0.003} roughness={1}/>)}
    {[-1, 1].map(sign => <Box key={`z${sign}`} position={[0, h / 2, sign * (d / 2 - wall / 2)]} size={[w, h, wall]} color={color} radius={0.003} roughness={1}/>)}
    {[0.3, 0.6].map(level => <Box key={level} position={[0, h * level, d / 2 + 0.0005]} size={[w * 0.98, 0.006, 0.001]} color="#7a6748"/>)}
    <Box position={[0, h * 0.75, 0]} size={[w - 0.03, h * 0.35, d - 0.03]} color={pick(FABRICS, variant, 2)} radius={0.02} roughness={1}/>
  </group>
}

function StorageBox({ size, variant }: Styled & { size: Vec3 }) {
  const [w, h, d] = size
  return <group>
    <Box position={[0, h / 2, 0]} size={[w, h, d]} color={pick(['#d9d3c7', '#7d8f8a', '#c4a484', '#3e4a52'] as const, variant)} radius={0.006}/>
    <Box position={[0, h * 0.6, d / 2 + 0.0006]} size={[Math.min(0.09, w * 0.4), 0.035, 0.001]} color="#f2eee5"/>
    <Box position={[0, h * 0.35, d / 2 + 0.0006]} size={[0.06, 0.012, 0.002]} color={INK} radius={0.004}/>
  </group>
}

function Records({ variant }: Styled) {
  const sleeves = useMemo(() => Array.from({ length: 13 }, (_, index) => ({ x: -0.084 + index * 0.014, last: index === 12, color: pick(FABRICS, (variant ?? 0) + index * 5) })), [variant])
  return <group>{sleeves.map(({ x, last, color }) => <Box key={x} position={[x, 0.156, 0]} size={[0.004, 0.31, 0.31]}
    color={color} rotation={[0, 0, last ? -0.08 : 0]}/>)}</group>
}

function Jars(props: Styled) {
  return <group>{[-0.095, 0, 0.095].map((x, index) => {
    const height = [0.18, 0.13, 0.155][index]
    return <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow raycast={noRaycast}>
        <cylinderGeometry args={[0.045, 0.045, height, 24]}/><meshStandardMaterial color="#e8ece6" transparent opacity={0.55} roughness={0.1}/>
      </mesh>
      <mesh position={[0, height * 0.35, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.04, 0.04, height * 0.7, 20]}/><meshStandardMaterial color={['#c99a5b', '#e8dcc4', '#7b5a3e'][index]} roughness={1}/>
      </mesh>
      <mesh position={[0, height + 0.012, 0]} raycast={noRaycast}>
        <cylinderGeometry args={[0.047, 0.047, 0.022, 24]}/><meshStandardMaterial color={pick(WOODS, props.variant, index)} roughness={0.8}/>
      </mesh>
    </group>
  })}</group>
}

function FruitBowl(props: Styled) {
  const profile = useMemo(() => [[0, 0.002], [0.05, 0], [0.11, 0.04], [0.128, 0.07], [0.123, 0.071], [0.105, 0.045], [0.048, 0.008], [0, 0.01]]
    .map(([radius, y]) => new THREE.Vector2(radius, y)), [])
  const fruit = pick([['#e08a2c', '#e8962f', '#d47a22'], ['#b8c24a', '#c33f2e', '#d9b23a'], ['#c33f2e', '#a93527', '#d9b23a']] as const, props.variant)
  return <group>
    <mesh castShadow receiveShadow raycast={noRaycast}><latheGeometry args={[profile, 32]}/><meshStandardMaterial color={ceramic(props, 2)} roughness={0.6} side={THREE.DoubleSide}/></mesh>
    {[[-0.035, 0.05, 0.01], [0.038, 0.05, -0.01], [0, 0.075, 0.03]].map((position, index) =>
      <Ellipsoid key={position.join(':')} position={position as Vec3} size={[0.036, 0.034, 0.036]} color={fruit[index]} roughness={0.55}/>)}
  </group>
}

function Textiles({ variant }: Styled) {
  return <group>{[0, 1, 2].map(index => <Box key={index} position={[(index % 2) * 0.006, 0.02 + index * 0.038, 0]} size={[0.28 - index * 0.01, 0.036, 0.22]}
    color={pick(FABRICS, variant, index)} radius={0.014} roughness={1}/>)}</group>
}

function Tray(props: Styled) {
  return <group>
    <Box position={[0, 0.01, 0]} size={[0.38, 0.02, 0.26]} color={pick(WOODS, props.variant)} radius={0.006}/>
    <mesh position={[-0.09, 0.07, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.035, 0.035, 0.1, 24]}/><meshStandardMaterial color="#f1ead9" roughness={0.9}/>
    </mesh>
    <mesh position={[-0.09, 0.126, 0]} raycast={noRaycast}><cylinderGeometry args={[0.001, 0.001, 0.012, 4]}/><meshStandardMaterial color={INK}/></mesh>
    <group position={[0.08, 0.02, 0]} scale={0.55}><FruitBowl {...props}/></group>
  </group>
}

/** Plate, cutlery and glass, laid towards local +Z. */
function PlaceSetting(props: Styled) {
  return <group>
    <mesh position={[0, 0.006, 0.01]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.132, 0.12, 0.012, 36]}/><meshStandardMaterial color={ceramic(props, 3)} roughness={0.4}/>
    </mesh>
    <mesh position={[0, 0.0125, 0.01]} raycast={noRaycast}><cylinderGeometry args={[0.09, 0.09, 0.001, 32]}/><meshStandardMaterial color="#f4f0e8" roughness={0.35}/></mesh>
    <Box position={[-0.165, 0.002, 0.02]} size={[0.012, 0.004, 0.19]} color="#b9bbb6" metalness={0.8} roughness={0.3}/>
    <Box position={[0.16, 0.002, 0.03]} size={[0.014, 0.004, 0.2]} color="#b9bbb6" metalness={0.8} roughness={0.3}/>
    <mesh position={[0.16, 0.06, -0.1]} castShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.034, 0.03, 0.12, 20, 1, true]}/><meshStandardMaterial color="#e6eeec" transparent opacity={0.4} roughness={0.05} side={THREE.DoubleSide}/>
    </mesh>
  </group>
}

function CuttingBoard({ variant }: Styled) {
  return <group>
    <Box position={[0, 0.0125, 0]} size={[0.4, 0.025, 0.26]} color={pick(WOODS, variant, 3)} radius={0.008}/>
    <Ellipsoid position={[0.06, 0.045, 0]} size={[0.08, 0.025, 0.05]} color="#c98b4a" roughness={0.9}/>
    <Ellipsoid position={[-0.09, 0.04, 0.05]} size={[0.025, 0.02, 0.025]} color="#b8c24a"/>
  </group>
}

function Speaker({ variant }: Styled) {
  const body = pick([INK, '#d8d2c6', '#6c5a49'] as const, variant)
  return <group>
    <Box position={[0, 0.135, 0]} size={[0.16, 0.27, 0.18]} color={body} radius={0.01} roughness={0.7}/>
    {[[0.18, 0.05], [0.075, 0.025]].map(([y, radius]) => <mesh key={y} position={[0, y, 0.0905]} raycast={noRaycast}>
      <circleGeometry args={[radius, 28]}/><meshStandardMaterial color="#2a2c2e" roughness={0.9}/>
    </mesh>)}
  </group>
}

/** A flat screen on a foot, sized by the detector. */
function Television({ size }: { size: Vec3 }) {
  const [w, h, d] = size, screen = h - 0.07
  return <group>
    <Box position={[0, 0.006, 0]} size={[Math.min(0.36, w * 0.4), 0.012, d * 0.85]} color="#2c2e30" radius={0.004} metalness={0.4} roughness={0.5}/>
    <Box position={[0, 0.04, -0.01]} size={[0.06, 0.06, 0.02]} color="#2c2e30" metalness={0.4} roughness={0.5}/>
    <Box position={[0, 0.07 + screen / 2, -0.01]} size={[w, screen, 0.03]} color="#1e2022" radius={0.004} roughness={0.35}/>
    <mesh position={[0, 0.07 + screen / 2, 0.0055]} raycast={noRaycast}>
      <planeGeometry args={[w - 0.02, screen - 0.02]}/><meshStandardMaterial color="#1a2126" emissive="#2b3a40" emissiveIntensity={0.2} roughness={0.15} metalness={0.2}/>
    </mesh>
  </group>
}

function Cushion({ variant }: Styled) {
  return <Box position={[0, 0.055, 0]} size={[0.42, 0.11, 0.36]} color={pick(FABRICS, variant, 4)} radius={0.045} roughness={1}/>
}

/** Mattress, duvet and pillows; pillows at local -X. */
function Bedding({ size, variant }: Styled & { size: Vec3 }) {
  const [w, , d] = size
  const duvet = pick(['#ece6da', '#c9d2cc', '#d8c6b3', '#b9c0c9'] as const, variant)
  return <group>
    <Box position={[0, 0.08, 0]} size={[w, 0.16, d]} color="#f3efe7" radius={0.04} roughness={0.95}/>
    <Box position={[w * 0.13, 0.18, 0]} size={[w * 0.74, 0.05, d + 0.01]} color={duvet} radius={0.024} roughness={1}/>
    <Box position={[w * 0.43, 0.212, 0]} size={[w * 0.14, 0.03, d - 0.02]} color={pick(FABRICS, variant, 2)} radius={0.012} roughness={1}/>
    {(d > 1.2 ? [-d / 4, d / 4] : [0]).map(z => <Ellipsoid key={z} position={[-w / 2 + 0.2, 0.2, z]} size={[0.14, 0.05, Math.min(0.3, d / 2 - 0.06)]} color="#faf7f1" roughness={1}/>)}
  </group>
}

function Chair({ seatHeight, variant }: { seatHeight: number } & Styled) {
  const wood = pick(WOODS, variant), fabric = variant ? pick(FABRICS, variant, 5) : LINEN
  return <group>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Stem key={`${x}-${z}`}
      from={[x * 0.21, -seatHeight, z * 0.19]}
      to={[x * 0.175, -0.038, z * 0.155]} radius={0.015} endRadius={0.02} color={wood}/>))}
    <Box position={[0, -0.043, 0.015]} size={[0.44, 0.06, 0.415]} color="#b1a58d" radius={0.025}/>
    <Box position={[0, -0.013, 0.015]} size={[0.405, 0.026, 0.39]} color={fabric} radius={0.012}/>
    {[-1, 1].map(side => <Stem key={side} from={[side * 0.178, -0.045, -0.155]} to={[side * 0.188, 0.375, -0.173]} radius={0.015} color={wood}/>)}
    <Box position={[0, 0.267, -0.176]} size={[0.423, 0.245, 0.045]} color={fabric} radius={0.02} rotation={[-0.055, 0, 0]}/>
  </group>
}

// Clothes keep clear of the skin tones so a sweater never reads as bare skin.
const PEOPLE = [
  { skin: '#bc8c6b', hair: '#443a31', sweater: '#6f7c5f', trousers: '#525e62', shoe: '#65584b' },
  { skin: '#8d5f45', hair: '#1f1b19', sweater: '#3f5d78', trousers: '#3e4650', shoe: '#2f2a27' },
  { skin: '#e2b99a', hair: '#9b6a3f', sweater: '#5f6b78', trousers: '#c9bfae', shoe: '#7a6248' },
  { skin: '#5e3d2c', hair: '#151312', sweater: '#d6d9d2', trousers: '#2f3a36', shoe: '#3b302a' },
  { skin: '#d5a684', hair: '#6d6a66', sweater: '#8a4b4f', trousers: '#4a4440', shoe: '#5a4c40' },
] as const

/** One smooth torso, hips to neckline, with sloping shoulders (radius, height). */
const TORSO_PROFILE = [
  [0.001, -0.012], [0.1, -0.008], [0.143, 0.018], [0.149, 0.06], [0.141, 0.13], [0.134, 0.19], [0.138, 0.25], [0.146, 0.31],
  [0.15, 0.352], [0.147, 0.386], [0.13, 0.418], [0.1, 0.44], [0.07, 0.456], [0.046, 0.466], [0.001, 0.469],
].map(([radius, y]) => new THREE.Vector2(radius, y))
const TORSO_DEPTH = 0.64

const shade = (color: string, amount: number) => `#${new THREE.Color(color).multiplyScalar(amount).getHexString()}`

interface ArmRig { upper: THREE.Mesh | null; elbow: THREE.Mesh | null; fore: THREE.Mesh | null; hand: THREE.Mesh | null }
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const SEGMENT = new THREE.Vector3()

function setSegment(mesh: THREE.Mesh | null, from: THREE.Vector3, to: THREE.Vector3) {
  if (!mesh) return
  const delta = SEGMENT.subVectors(to, from), length = delta.length()
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(Y_AXIS, delta.divideScalar(length || 1))
  mesh.scale.set(1, length, 1)
}

function blendPose(current: BodyPose, target: BodyPose, amount: number) {
  const mix = (a: number, b: number) => a + (b - a) * amount
  current.lean = mix(current.lean, target.lean)
  current.headPitch = mix(current.headPitch, target.headPitch)
  current.headYaw = mix(current.headYaw, target.headYaw)
  current.headRoll = mix(current.headRoll, target.headRoll)
  current.hands.forEach((hand, index) => {
    const goal = target.hands[index]
    for (const key of ['position', 'direction', 'pole'] as const) hand[key] = hand[key].map((value, axis) => mix(value, goal[key][axis])) as Vec3
  })
}

const RIG = {
  shoulder: new THREE.Vector3(), elbow: new THREE.Vector3(), wrist: new THREE.Vector3(), palm: new THREE.Vector3(),
  direction: new THREE.Vector3(), pole: new THREE.Vector3(), origin: new THREE.Vector3(), up: new THREE.Vector3(), matrix: new THREE.Matrix4(),
}

/** Places the torso, head and arm meshes; reuses scratch vectors because it runs every animated frame. */
function applyBodyPose(torso: THREE.Group | null, head: THREE.Group | null, arms: readonly ArmRig[], body: BodyPose, offsets: [Vec3, Vec3]) {
  torso?.rotation.set(body.lean, 0, 0)
  head?.rotation.set(body.headPitch, body.headYaw, body.headRoll, 'YXZ')
  const { shoulder, elbow, wrist, palm, direction, pole, origin, up, matrix } = RIG
  ;([1, -1] as const).forEach((side, index) => {
    const rig = arms[index], hand = body.hands[index]
    shoulder.fromArray(shoulderPoint(body.lean, side))
    direction.fromArray(hand.direction).normalize()
    palm.fromArray(hand.position).add(origin.fromArray(offsets[index]))
    solveArm(shoulder, palm.addScaledVector(direction, -HAND), pole.fromArray(hand.pole), elbow, wrist)
    setSegment(rig.upper, shoulder, elbow)
    rig.elbow?.position.copy(elbow)
    setSegment(rig.fore, elbow, wrist)
    if (rig.hand) {
      rig.hand.position.copy(wrist).addScaledVector(direction, HAND)
      // Palms face down unless the hand points up, as under the chin.
      if (Math.abs(direction.y) > 0.8) up.set(side * 0.6, 0, -1)
      else up.copy(Y_AXIS)
      rig.hand.quaternion.setFromRotationMatrix(matrix.lookAt(direction, origin.set(0, 0, 0), up))
    }
  })
}

const clonePose = (pose: BodyPose): BodyPose => ({ ...pose, hands: pose.hands.map(hand => ({ ...hand })) as BodyPose['hands'] })

function SeatedPerson({ seatHeight = 0.46, chair = false, variant = 0, pose, workSeed, workstation }: {
  seatHeight?: number; chair?: boolean; pose?: SeatedPose; workSeed?: number; workstation?: Workstation
} & Styled) {
  const { skin, hair, sweater, trousers, shoe } = pick(PEOPLE, variant)
  const animate = useContext(WorkAnimation)
  const footY = -seatHeight
  const station = workstation ?? (pose === 'laptop' ? LAP_WORKSTATION : undefined)
  const seed = station ? workSeed : undefined
  const torso = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null)
  const arms = useRef<[ArmRig, ArmRig]>([{ upper: null, elbow: null, fore: null, hand: null }, { upper: null, elbow: null, fore: null, hand: null }])
  const motion = useRef<{ pose: BodyPose; last: number } | null>(null)

  const target = (time: number) => station && seed !== undefined
    ? workPose(station, workFrame(seed, time), time)
    : { base: restingPose(pose), handOffsets: [[0, 0, 0], [0, 0, 0]] as [Vec3, Vec3] }

  const apply = (body: BodyPose, offsets: [Vec3, Vec3]) => applyBodyPose(torso.current, head.current, arms.current, body, offsets)

  useLayoutEffect(() => {
    const time = animate ? workClock() : staticWorkTime(seed ?? 0)
    const { base, handOffsets } = target(time)
    motion.current = { pose: clonePose(base), last: 0 }
    apply(base, handOffsets)
  })

  useFrame(() => {
    const current = motion.current
    if (!animate || seed === undefined || !current || document.hidden) return
    const now = workClock()
    const dt = current.last ? Math.min(now - current.last, 0.1) : 0
    current.last = now
    const { base, handOffsets } = target(now)
    // Hands travel between keyboard, mouse and chin; key strikes stay crisp.
    blendPose(current.pose, base, 1 - Math.exp(-7 * dt))
    apply(current.pose, handOffsets)
  })

  return <group>
    {chair && <Chair seatHeight={seatHeight} variant={variant}/>}
    <Ellipsoid position={[0, 0.082, -0.005]} size={[0.164, 0.083, 0.128]} color={trousers}/>
    <group ref={torso} position={HIP}>
      <mesh scale={[1, 1, TORSO_DEPTH]} castShadow receiveShadow raycast={noRaycast}>
        <latheGeometry args={[TORSO_PROFILE, 40]}/><meshStandardMaterial color={sweater} roughness={0.95}/>
      </mesh>
      {/* A ribbed hem and a crew neckline make the top read as clothing. */}
      <mesh position={[0, 0.045, 0]} scale={[1, 1, TORSO_DEPTH]} castShadow receiveShadow raycast={noRaycast}>
        <cylinderGeometry args={[0.1505, 0.1515, 0.032, 40, 1, true]}/><meshStandardMaterial color={shade(sweater, 0.82)} roughness={1} side={THREE.DoubleSide}/>
      </mesh>
      <mesh position={[0, 0.462, 0.002]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.82, 1]} castShadow raycast={noRaycast}>
        <torusGeometry args={[0.046, 0.0095, 10, 28]}/><meshStandardMaterial color={shade(sweater, 0.82)} roughness={1}/>
      </mesh>
      {[-1, 1].map(side => <Ellipsoid key={side} position={[side * (SHOULDER[0] - 0.006), SHOULDER[1] + 0.004, 0]} size={[0.043, 0.047, 0.047]} color={sweater}/>)}
      <Stem from={[0, 0.43, 0]} to={[0, NECK[1] + 0.025, NECK[2]]} radius={0.04} endRadius={0.036} color={skin}/>
      <group ref={head} position={NECK}>
        <Ellipsoid position={[0, 0.068, 0.008]} size={[0.081, 0.111, 0.085]} color={skin}/>
        <Ellipsoid position={[0, 0.103, -0.013]} size={[0.084, 0.085, 0.078]} color={hair}/>
        <Ellipsoid position={[0, 0.165, -0.023]} size={[0.06, 0.037, 0.057]} color={hair}/>
        <Ellipsoid position={[0, 0.057, 0.09]} size={[0.014, 0.025, 0.02]} color={skin}/>
        {[-1, 1].map(side => <Ellipsoid key={side} position={[side * 0.077, 0.066, 0.014]} size={[0.013, 0.023, 0.015]} color={skin}/>)}
      </group>
    </group>
    {[-1, 1].map(side => <group key={side}>
      <Stem from={[side * 0.09, 0.083, 0.015]} to={[side * 0.1, 0.048, 0.29]} radius={0.075} endRadius={0.061} color={trousers}/>
      <Ellipsoid position={[side * 0.1, 0.047, 0.295]} size={[0.063, 0.063, 0.075]} color={trousers}/>
      <Stem from={[side * 0.1, 0.035, 0.31]} to={[side * 0.105, footY + 0.095, 0.374]} radius={0.058} endRadius={0.037} color={trousers}/>
      <Ellipsoid position={[side * 0.105, footY + 0.043, 0.421]} size={[0.052, 0.043, 0.105]} color={shoe} roughness={0.65}/>
      <Box position={[side * 0.105, footY + 0.012, 0.425]} size={[0.098, 0.023, 0.19]} color="#49453e" radius={0.01}/>
    </group>)}
    {([0, 1] as const).map(index => {
      const rig = arms.current[index]
      return <group key={index}>
        <mesh ref={mesh => { rig.upper = mesh }} castShadow receiveShadow raycast={noRaycast}>
          <cylinderGeometry args={[0.034, 0.039, 1, 14]}/><meshStandardMaterial color={sweater} roughness={0.95}/>
        </mesh>
        <mesh ref={mesh => { rig.elbow = mesh }} castShadow receiveShadow raycast={noRaycast}>
          <sphereGeometry args={[0.034, 14, 10]}/><meshStandardMaterial color={sweater} roughness={0.95}/>
        </mesh>
        <mesh ref={mesh => { rig.fore = mesh }} castShadow receiveShadow raycast={noRaycast}>
          <cylinderGeometry args={[0.027, 0.033, 1, 14]}/><meshStandardMaterial color={sweater} roughness={0.95}/>
        </mesh>
        <mesh ref={mesh => { rig.hand = mesh }} scale={[0.034, 0.021, 0.056]} castShadow receiveShadow raycast={noRaycast}>
          <sphereGeometry args={[1, 18, 12]}/><meshStandardMaterial color={skin} roughness={0.9}/>
        </mesh>
      </group>
    })}
    {pose === 'reading' && <group position={[0, 0.27, 0.22]} rotation={[-0.9, 0, 0]}>
      <Box position={[0, 0, 0]} size={[0.15, 0.2, 0.022]} color={pick(FABRICS, variant, 1)} radius={0.002}/>
      <Box position={[0, 0, 0.0115]} size={[0.142, 0.192, 0.001]} color="#efe9dc"/>
    </group>}
    {/* Turned towards the sitter and scaled to stay inside the seated clearance envelope. */}
    {pose === 'laptop' && <group position={LAP_LAPTOP.position} rotation={[0, Math.PI, 0]} scale={LAP_LAPTOP.scale}><Laptop variant={variant} workSeed={workSeed}/></group>}
  </group>
}

/** Requests frames for desk work at a calm rate while the tab is visible. */
function WorkTicker() {
  const invalidate = useThree(state => state.invalidate)
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) invalidate() }, 1000 / 30)
    return () => window.clearInterval(timer)
  }, [invalidate])
  return null
}

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const media = window.matchMedia?.(query)
    if (!media) return
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return reduced
}

type Renderer = (placement: FurnishingPlacement, styled: Styled) => React.ReactNode
const sized = (render: (size: Vec3, styled: Styled) => React.ReactNode): Renderer => (placement, styled) => placement.size ? render(placement.size, styled) : null
const seated: Renderer = placement => <SeatedPerson seatHeight={placement.seatHeight} chair={placement.kind === 'seated-person-chair'} variant={placement.variant}
  pose={placement.pose} workSeed={placement.workSeed} workstation={placement.workstation}/>
const RENDERERS: Record<FurnishingPlacement['kind'], Renderer> = {
  books: placement => <Books seed={placement.bookSeed ?? placement.id} arrangement={placement.bookArrangement} supportSide={placement.bookSupport}/>,
  'table-lamp': (_, styled) => <TableLamp {...styled}/>,
  computer: placement => <Computer workSeed={placement.workSeed}/>,
  laptop: (placement, styled) => <Laptop {...styled} workSeed={placement.workSeed}/>,
  plant: (_, styled) => <SmallPlant {...styled}/>,
  vase: (_, styled) => <Vase {...styled}/>,
  mug: (_, styled) => <Mug {...styled}/>,
  notebook: (_, styled) => <Notebook {...styled}/>,
  'picture-frame': (_, styled) => <PictureFrame {...styled}/>,
  basket: sized((size, styled) => <Basket {...styled} size={size}/>),
  'storage-box': sized((size, styled) => <StorageBox {...styled} size={size}/>),
  records: (_, styled) => <Records {...styled}/>,
  jars: (_, styled) => <Jars {...styled}/>,
  bowl: (_, styled) => <FruitBowl {...styled}/>,
  textiles: (_, styled) => <Textiles {...styled}/>,
  tray: (_, styled) => <Tray {...styled}/>,
  'place-setting': (_, styled) => <PlaceSetting {...styled}/>,
  'cutting-board': (_, styled) => <CuttingBoard {...styled}/>,
  speaker: (_, styled) => <Speaker {...styled}/>,
  tv: sized(size => <Television size={size}/>),
  cushion: (_, styled) => <Cushion {...styled}/>,
  bedding: sized((size, styled) => <Bedding {...styled} size={size}/>),
  chair: (placement, styled) => <Chair seatHeight={placement.seatHeight ?? 0.46} {...styled}/>,
  'seated-person': seated,
  'seated-person-chair': seated,
}

/** `animate` lets people at desks work in the live room; other renders stay still. */
export function PreviewFurnishings({ placements, animate = false }: { placements: FurnishingPlacement[]; animate?: boolean }) {
  const reducedMotion = usePrefersReducedMotion()
  const working = animate && !reducedMotion && placements.some(placement => placement.workSeed !== undefined)
  return <WorkAnimation.Provider value={working}><group name="Preview furnishings">
    {working && <WorkTicker/>}
    {placements.map(placement => <group key={placement.id} name={placement.kind} position={placement.position} rotation={[0, placement.rotation, 0]}
      userData={{ previewFurnishing: placement.kind, sourcePanelId: placement.panelId }}>
      {RENDERERS[placement.kind](placement, { variant: placement.variant, tone: placement.tone })}
    </group>)}
  </group></WorkAnimation.Provider>
}
