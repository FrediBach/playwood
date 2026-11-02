import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { FurnishingPlacement } from '@/lib/preview-furnishings'
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

function TableLamp() {
  return <group>
    <mesh position={[0, 0.013, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.085, 0.09, 0.026, 32]}/><meshStandardMaterial color="#b7a78d" roughness={0.6} metalness={0.25}/>
    </mesh>
    <Stem from={[0, 0.024, 0]} to={[0, 0.32, 0]} radius={0.007} color="#8b795c"/>
    <mesh position={[0, 0.328, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.078, 0.122, 0.18, 36, 1, true]}/><meshStandardMaterial color="#e9dfca" roughness={0.95} side={THREE.DoubleSide}/>
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

function Computer() {
  return <group>
    <Box position={[0, 0.009, -0.12]} size={[0.205, 0.018, 0.15]} color="#9a9f98" radius={0.006} metalness={0.55} roughness={0.4}/>
    <Box position={[0, 0.097, -0.15]} size={[0.055, 0.17, 0.033]} color="#a7aba4" radius={0.006} metalness={0.5} roughness={0.4}/>
    <Box position={[0, 0.314, -0.135]} size={[0.54, 0.314, 0.028]} color={INK} radius={0.009} roughness={0.45}/>
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
    <Box position={[-0.042, 0.013, 0.148]} size={[0.355, 0.022, 0.122]} color="#9ea49c" radius={0.007} metalness={0.25} roughness={0.5}/>
    <group position={[-0.042, 0, 0]}><KeyboardKeys/></group>
    <Box position={[0.236, 0.002, 0.145]} size={[0.128, 0.004, 0.19]} color="#8c9184" radius={0.001}/>
    <Ellipsoid position={[0.236, 0.018, 0.142]} size={[0.032, 0.02, 0.052]} color="#e2e0d6" roughness={0.55}/>
    <Box position={[0.236, 0.038, 0.125]} size={[0.004, 0.003, 0.012]} color="#939b93" radius={0.001}/>
  </group>
}

function SmallPlant() {
  const leaves = useMemo(() => Array.from({ length: 9 }, (_, index) => {
    const angle = index * 2.4
    const height = 0.175 + (index % 4) * 0.03
    return { angle, height, x: Math.sin(angle) * 0.055, z: Math.cos(angle) * 0.055 }
  }), [])
  return <group>
    <mesh position={[0, 0.052, 0]} castShadow receiveShadow raycast={noRaycast}>
      <cylinderGeometry args={[0.063, 0.047, 0.104, 28]}/><meshStandardMaterial color="#ae795b" roughness={0.94}/>
    </mesh>
    <mesh position={[0, 0.104, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[0.055, 0.055, 0.003, 24]}/><meshStandardMaterial color="#594d3b" roughness={1}/>
    </mesh>
    {leaves.map(({ x, z, height, angle }, index) => <group key={index}>
      <Stem from={[0, 0.105, 0]} to={[x, height, z]} radius={0.002} color="#727a4d"/>
      <Ellipsoid position={[x, height, z]} size={[0.023, 0.012, 0.044]} rotation={[0.5, angle, 0]} color={index % 2 ? '#6b7b50' : '#809064'}/>
    </group>)}
  </group>
}

function Vase() {
  const profile = useMemo(() => [
    [0, 0], [0.045, 0], [0.058, 0.012], [0.077, 0.066], [0.079, 0.10],
    [0.065, 0.145], [0.034, 0.181], [0.03, 0.219], [0.035, 0.239],
    [0.029, 0.24], [0.024, 0.219], [0.028, 0.181], [0.057, 0.144], [0.065, 0.1],
    [0.048, 0.02], [0, 0.015],
  ].map(([radius, y]) => new THREE.Vector2(radius, y)), [])
  return <mesh castShadow receiveShadow raycast={noRaycast}>
    <latheGeometry args={[profile, 32]}/><meshStandardMaterial color="#e3d7c1" roughness={0.72}/>
  </mesh>
}

function Chair({ seatHeight }: { seatHeight: number }) {
  return <group>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Stem key={`${x}-${z}`}
      from={[x * 0.21, -seatHeight, z * 0.19]}
      to={[x * 0.175, -0.038, z * 0.155]} radius={0.015} endRadius={0.02} color="#79624b"/>))}
    <Box position={[0, -0.043, 0.015]} size={[0.44, 0.06, 0.415]} color="#b1a58d" radius={0.025}/>
    <Box position={[0, -0.013, 0.015]} size={[0.405, 0.026, 0.39]} color={LINEN} radius={0.012}/>
    {[-1, 1].map(side => <Stem key={side} from={[side * 0.178, -0.045, -0.155]} to={[side * 0.188, 0.375, -0.173]} radius={0.015} color="#79624b"/>)}
    <Box position={[0, 0.267, -0.176]} size={[0.423, 0.245, 0.045]} color={LINEN} radius={0.02} rotation={[-0.055, 0, 0]}/>
  </group>
}

function SeatedPerson({ seatHeight = 0.46, chair = false }: { seatHeight?: number; chair?: boolean }) {
  const skin = '#bc8c6b', hair = '#443a31', sweater = '#a7aa95', trousers = '#525e62', shoe = '#65584b'
  const footY = -seatHeight
  return <group>
    {chair && <Chair seatHeight={seatHeight}/>}
    <Ellipsoid position={[0, 0.082, 0]} size={[0.164, 0.083, 0.123]} color={trousers}/>
    <Ellipsoid position={[0, 0.31, -0.022]} size={[0.17, 0.244, 0.105]} color={sweater} rotation={[-0.07, 0, 0]}/>
    <Ellipsoid position={[0, 0.505, -0.031]} size={[0.185, 0.073, 0.102]} color={sweater}/>
    <Stem from={[0, 0.53, -0.032]} to={[0, 0.639, -0.021]} radius={0.038} endRadius={0.035} color={skin}/>
    <Ellipsoid position={[0, 0.708, -0.012]} size={[0.081, 0.111, 0.085]} color={skin}/>
    <Ellipsoid position={[0, 0.743, -0.033]} size={[0.084, 0.085, 0.078]} color={hair}/>
    <Ellipsoid position={[0, 0.805, -0.043]} size={[0.06, 0.037, 0.057]} color={hair}/>
    <Ellipsoid position={[0, 0.697, 0.07]} size={[0.014, 0.025, 0.02]} color={skin}/>
    {[-1, 1].map(side => <group key={side}>
      <Ellipsoid position={[side * 0.077, 0.706, -0.006]} size={[0.013, 0.023, 0.015]} color={skin}/>
      <Stem from={[side * 0.09, 0.083, 0.015]} to={[side * 0.1, 0.048, 0.29]} radius={0.075} endRadius={0.061} color={trousers}/>
      <Ellipsoid position={[side * 0.1, 0.047, 0.295]} size={[0.063, 0.063, 0.075]} color={trousers}/>
      <Stem from={[side * 0.1, 0.035, 0.31]} to={[side * 0.105, footY + 0.095, 0.374]} radius={0.058} endRadius={0.037} color={trousers}/>
      <Ellipsoid position={[side * 0.105, footY + 0.043, 0.421]} size={[0.052, 0.043, 0.105]} color={shoe} roughness={0.65}/>
      <Box position={[side * 0.105, footY + 0.012, 0.425]} size={[0.098, 0.023, 0.19]} color="#49453e" radius={0.01}/>
      <Ellipsoid position={[side * 0.17, 0.476, -0.022]} size={[0.069, 0.085, 0.074]} color={sweater}/>
      <Stem from={[side * 0.176, 0.48, -0.014]} to={[side * 0.19, 0.275, 0.079]} radius={0.062} endRadius={0.047} color={sweater}/>
      <Ellipsoid position={[side * 0.19, 0.275, 0.08]} size={[0.047, 0.048, 0.051]} color={sweater}/>
      <Stem from={[side * 0.19, 0.275, 0.08]} to={[side * 0.133, 0.159, 0.246]} radius={0.046} endRadius={0.031} color={sweater}/>
      <Ellipsoid position={[side * 0.122, 0.141, 0.272]} size={[0.034, 0.023, 0.059]} rotation={[-0.25, side * 0.15, 0]} color={skin}/>
    </group>)}
  </group>
}

export function PreviewFurnishings({ placements }: { placements: FurnishingPlacement[] }) {
  return <group name="Preview furnishings">
    {placements.map(placement => <group key={placement.id} name={placement.kind} position={placement.position} rotation={[0, placement.rotation, 0]}
      userData={{ previewFurnishing: placement.kind, sourcePanelId: placement.panelId }}>
      {placement.kind === 'books' && <Books seed={placement.bookSeed ?? placement.id} arrangement={placement.bookArrangement} supportSide={placement.bookSupport}/>}
      {placement.kind === 'table-lamp' && <TableLamp/>}
      {placement.kind === 'computer' && <Computer/>}
      {placement.kind === 'plant' && <SmallPlant/>}
      {placement.kind === 'vase' && <Vase/>}
      {(placement.kind === 'seated-person' || placement.kind === 'seated-person-chair') && <SeatedPerson seatHeight={placement.seatHeight} chair={placement.kind === 'seated-person-chair'}/>}
    </group>)}
  </group>
}
