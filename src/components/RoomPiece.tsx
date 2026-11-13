import { useEffect, useMemo, type ReactNode } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { RoomPiece as RoomPieceSpec } from './room-layout'
import type { Panel } from '@/lib/types'
import { whiteboardTexture } from './whiteboard-sketch'

type Triple = [number, number, number]

/** Preview-only reference furniture for each room style; all meshes are static and render on demand. */

function Block({ position, size, color, radius = 0, rotation, roughness = 0.85, metalness = 0 }: {
  position: Triple; size: Triple; color: string; radius?: number; rotation?: Triple; roughness?: number; metalness?: number
}) {
  const material = <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  return radius > 0
    ? <RoundedBox position={position} args={size} radius={radius} smoothness={3} rotation={rotation} castShadow receiveShadow>{material}</RoundedBox>
    : <mesh position={position} rotation={rotation} castShadow receiveShadow><boxGeometry args={size} />{material}</mesh>
}

/** A round rod between two points. */
function Rod({ from, to, radius, children }: { from: Triple; to: Triple; radius: number; children: ReactNode }) {
  const [x1, y1, z1] = from, [x2, y2, z2] = to
  const { middle, length, quaternion } = useMemo(() => {
    const delta = new THREE.Vector3(x2 - x1, y2 - y1, z2 - z1)
    return {
      middle: [(x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2] as Triple, length: delta.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()),
    }
  }, [x1, y1, z1, x2, y2, z2])
  return <mesh position={middle} quaternion={quaternion} castShadow receiveShadow><cylinderGeometry args={[radius, radius, length, 12]} />{children}</mesh>
}

function Sofa() {
  const fabric = '#7f8572', cushion = '#8d927f'
  return <>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}:${z}`} position={[x * 0.68, 0.06, z * 0.33]} castShadow>
      <cylinderGeometry args={[0.02, 0.014, 0.12, 12]} /><meshStandardMaterial color="#5c4632" roughness={0.6} />
    </mesh>))}
    <Block position={[0, 0.22, 0]} size={[1.5, 0.2, 0.82]} color={fabric} radius={0.04} />
    {[-1, 1].map(x => <Block key={x} position={[x * 0.31, 0.385, 0.06]} size={[0.61, 0.13, 0.64]} color={cushion} radius={0.05} />)}
    <Block position={[0, 0.555, -0.32]} size={[1.5, 0.48, 0.18]} color={fabric} radius={0.06} />
    {[-1, 1].map(x => <Block key={x} position={[x * 0.31, 0.6, -0.2]} size={[0.6, 0.34, 0.13]} color={cushion} radius={0.055} rotation={[-0.14, 0, 0]} />)}
    {[-1, 1].map(x => <Block key={x} position={[x * 0.685, 0.47, 0]} size={[0.13, 0.3, 0.82]} color={fabric} radius={0.055} />)}
    <Block position={[-0.42, 0.56, -0.08]} size={[0.36, 0.34, 0.11]} color="#c9a36b" radius={0.05} rotation={[-0.3, 0.2, 0.12]} />
  </>
}

function Stove() {
  const enamel = '#e8e5dd', steel = '#b9bcbd'
  const handle = (y: number, length: number) => <group position={[0, y, 0.335]}>
    <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.009, 0.009, length, 12]} /><meshStandardMaterial color={steel} roughness={0.3} metalness={0.8} /></mesh>
    {[-1, 1].map(side => <mesh key={side} position={[side * (length / 2 - 0.03), 0, -0.015]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.006, 0.006, 0.03, 8]} /><meshStandardMaterial color={steel} roughness={0.3} metalness={0.8} /></mesh>)}
  </group>
  return <>
    <Block position={[0, 0.02, -0.01]} size={[0.56, 0.04, 0.56]} color="#2c2b29" />
    <Block position={[0, 0.47, 0]} size={[0.6, 0.86, 0.6]} color={enamel} roughness={0.35} metalness={0.05} />
    <Block position={[0, 0.91, 0]} size={[0.6, 0.02, 0.6]} color="#1d1d1d" roughness={0.25} />
    <Block position={[0, 0.965, -0.285]} size={[0.6, 0.09, 0.03]} color={enamel} roughness={0.35} />
    {/* Gas burners under cast-iron pan supports. */}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}:${z}`} position={[x * 0.14, 0.92, z * 0.14]}>
      <mesh position={[0, 0.008, 0]}><cylinderGeometry args={[0.04, 0.045, 0.016, 24]} /><meshStandardMaterial color="#3a3a38" roughness={0.5} metalness={0.4} /></mesh>
      {[0, Math.PI / 2].map(angle => <mesh key={angle} position={[0, 0.022, 0]} rotation={[0, angle, 0]} castShadow><boxGeometry args={[0.22, 0.012, 0.012]} /><meshStandardMaterial color="#232322" roughness={0.7} /></mesh>)}
    </group>))}
    {/* Control knobs, oven door with window, and the drawer. */}
    {[-0.2, -0.1, 0, 0.1, 0.2].map(x => <mesh key={x} position={[x, 0.84, 0.31]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.018, 0.02, 0.025, 20]} /><meshStandardMaterial color="#2f2f2e" roughness={0.4} /></mesh>)}
    <Block position={[0, 0.47, 0.305]} size={[0.54, 0.5, 0.012]} color={enamel} roughness={0.3} />
    <Block position={[0, 0.47, 0.312]} size={[0.38, 0.22, 0.004]} color="#141414" roughness={0.1} metalness={0.3} />
    {handle(0.69, 0.46)}
    <Block position={[0, 0.13, 0.305]} size={[0.54, 0.13, 0.012]} color={enamel} roughness={0.3} />
    {handle(0.17, 0.3)}
    {/* A lidded pot at the back and a kettle at the front. */}
    <group position={[-0.14, 0.932, -0.14]}>
      <mesh position={[0, 0.065, 0]} castShadow receiveShadow><cylinderGeometry args={[0.1, 0.095, 0.13, 32, 1, true]} /><meshStandardMaterial color={steel} roughness={0.25} metalness={0.85} side={THREE.DoubleSide} /></mesh>
      <mesh position={[0, 0.133, 0]} castShadow><cylinderGeometry args={[0.103, 0.103, 0.008, 32]} /><meshStandardMaterial color={steel} roughness={0.3} metalness={0.8} /></mesh>
      <mesh position={[0, 0.148, 0]}><sphereGeometry args={[0.014, 12, 8]} /><meshStandardMaterial color="#2f2f2e" roughness={0.4} /></mesh>
    </group>
    <group position={[0.14, 0.932, 0.14]} rotation={[0, -0.6, 0]}>
      <mesh position={[0, 0.07, 0]} castShadow receiveShadow><cylinderGeometry args={[0.065, 0.085, 0.14, 28]} /><meshStandardMaterial color="#b6463b" roughness={0.35} /></mesh>
      <mesh position={[0, 0.15, 0]} castShadow><sphereGeometry args={[0.065, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#b6463b" roughness={0.35} /></mesh>
      <mesh position={[0, 0.222, 0]}><sphereGeometry args={[0.013, 12, 8]} /><meshStandardMaterial color="#2f2f2e" roughness={0.4} /></mesh>
      <Rod from={[0.06, 0.06, 0]} to={[0.13, 0.15, 0]} radius={0.011}><meshStandardMaterial color="#b6463b" roughness={0.35} /></Rod>
      <mesh position={[-0.03, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><torusGeometry args={[0.055, 0.008, 8, 20, Math.PI]} /><meshStandardMaterial color="#2f2f2e" roughness={0.4} /></mesh>
    </group>
  </>
}

function Whiteboard({ panels }: { panels: readonly Panel[] }) {
  const frame = '#b8bcc0'
  const texture = useMemo(() => whiteboardTexture(panels), [panels])
  useEffect(() => () => texture.dispose(), [texture])
  return <>
    {[-1, 1].map(side => <group key={side} position={[side * 0.62, 0, 0]}>
      <Block position={[0, 0.065, 0]} size={[0.06, 0.04, 0.55]} color={frame} roughness={0.4} metalness={0.6} />
      {[-1, 1].map(z => <mesh key={z} position={[0, 0.024, z * 0.23]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.024, 0.024, 0.022, 16]} /><meshStandardMaterial color="#2b2b2b" roughness={0.6} /></mesh>)}
      <Block position={[0, 0.97, 0]} size={[0.04, 1.78, 0.04]} color={frame} roughness={0.4} metalness={0.6} />
    </group>)}
    <Block position={[0, 0.55, 0]} size={[1.24, 0.03, 0.03]} color={frame} roughness={0.4} metalness={0.6} />
    <Block position={[0, 1.32, 0]} size={[1.2, 0.9, 0.03]} color={frame} roughness={0.4} metalness={0.6} />
    <mesh name="Whiteboard furniture sketch" position={[0, 1.32, 0.016]} receiveShadow><planeGeometry args={[1.16, 0.86]} /><meshStandardMaterial map={texture} roughness={0.25} /></mesh>
    {/* A few notes beside the drawing leave the construction unobstructed. */}
    <group position={[0, 1.32, 0.018]}>
      {[[0.47, 0.24, '#f3d86a', 0.05], [0.49, 0.13, '#f2a7b5', -0.08], [0.46, -0.22, '#b8dc93', 0.06]].map(([x, y, color, turn]) =>
        <mesh key={`${x}:${y}`} position={[x as number, y as number, 0.001]} rotation={[0, 0, turn as number]}><planeGeometry args={[0.075, 0.075]} /><meshStandardMaterial color={color as string} roughness={0.9} /></mesh>)}
    </group>
    <Block position={[0, 0.865, 0.04]} size={[1.0, 0.012, 0.06]} color={frame} roughness={0.4} metalness={0.6} />
    {['#2c4d8f', '#b83c32', '#2a2a2a'].map((color, index) => <mesh key={color} position={[-0.3 + index * 0.09, 0.882, 0.045]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.009, 0.009, 0.13, 10]} /><meshStandardMaterial color={color} roughness={0.5} />
    </mesh>)}
  </>
}

function RockingHorse() {
  // Rockers are arcs of a 1 m circle touching the floor at their middle.
  const arc = 0.8
  const wood = <meshStandardMaterial color="#9a6b45" roughness={0.6} />
  const body = <meshStandardMaterial color="#f1e8da" roughness={0.55} />
  const hair = <meshStandardMaterial color="#6b4a2f" roughness={0.9} />
  return <>
    {[-1, 1].map(z => <mesh key={z} position={[0, 1.02, z * 0.13]} rotation={[0, 0, -Math.PI / 2 - arc / 2]} scale={[1, 1, 0.6]} castShadow receiveShadow>
      <torusGeometry args={[1, 0.016, 8, 48, arc]} />{wood}
    </mesh>)}
    {[-1, 1].map(x => <Rod key={x} from={[x * 0.3, 0.068, -0.13]} to={[x * 0.3, 0.068, 0.13]} radius={0.012}>{wood}</Rod>)}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Rod key={`${x}:${z}`} from={[x * 0.16, 0.38, z * 0.05]} to={[x * 0.25, 0.06, z * 0.13]} radius={0.018}>{wood}</Rod>))}
    <mesh position={[0, 0.43, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow><capsuleGeometry args={[0.095, 0.26, 8, 20]} />{body}</mesh>
    <mesh position={[0.19, 0.55, 0]} rotation={[0, 0, -0.6]} castShadow><capsuleGeometry args={[0.062, 0.14, 8, 16]} />{body}</mesh>
    <mesh position={[0.29, 0.63, 0]} rotation={[0, 0, -2.1]} castShadow><capsuleGeometry args={[0.052, 0.13, 8, 16]} />{body}</mesh>
    {[-1, 1].map(z => <group key={z}>
      <mesh position={[0.25, 0.71, z * 0.03]} rotation={[z * 0.2, 0, -0.3]} castShadow><coneGeometry args={[0.018, 0.05, 10]} />{body}</mesh>
      <mesh position={[0.31, 0.665, z * 0.046]}><sphereGeometry args={[0.009, 10, 8]} /><meshStandardMaterial color="#1d1b1a" roughness={0.3} /></mesh>
    </group>)}
    <mesh position={[0.15, 0.6, 0]} rotation={[0, 0, -0.6]} castShadow><boxGeometry args={[0.035, 0.2, 0.03]} />{hair}</mesh>
    <Rod from={[-0.22, 0.47, 0]} to={[-0.32, 0.3, 0]} radius={0.022}>{hair}</Rod>
    <Block position={[-0.02, 0.525, 0]} size={[0.17, 0.03, 0.21]} color="#b2433a" radius={0.012} roughness={0.5} />
    <Rod from={[0.27, 0.62, -0.09]} to={[0.27, 0.62, 0.09]} radius={0.01}>{wood}</Rod>
  </>
}

const NAMES: Record<RoomPieceSpec['kind'], string> = {
  sofa: 'Two-seat sofa, 150 cm wide',
  stove: 'Freestanding gas stove, 60 cm wide',
  whiteboard: 'Mobile whiteboard, 120 × 90 cm',
  'rocking-horse': 'Rocking horse',
}

export function RoomPiece({ piece, floorY, panels }: { piece: RoomPieceSpec; floorY: number; panels: readonly Panel[] }) {
  return <group name={NAMES[piece.kind]} position={[piece.x, floorY, piece.z]} rotation={[0, piece.rotation, 0]}>
    {piece.kind === 'sofa' ? <Sofa /> : piece.kind === 'stove' ? <Stove /> : piece.kind === 'whiteboard' ? <Whiteboard panels={panels} /> : <RockingHorse />}
  </group>
}
