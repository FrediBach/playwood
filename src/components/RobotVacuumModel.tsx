import { useLayoutEffect, useMemo, useRef } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { Vec3 } from '@/lib/types'

// Procedural visual approximation of the black Dreame X50 Ultra Complete.
// Metres; the origin is on the floor and the front faces +Z. No project IDs or
// pointer targets are attached to these decorative room objects.
const noRaycast = () => null
const CHARCOAL = '#252625'
const BLACK = '#111312'
const CHAMPAGNE = '#b8ab8b'

function Box({ position, size, color, radius = 0.004, roughness = 0.5, metalness = 0.1 }: {
  position: Vec3; size: Vec3; color: string; radius?: number; roughness?: number; metalness?: number
}) {
  return <RoundedBox position={position} args={size} radius={radius} smoothness={3} castShadow receiveShadow raycast={noRaycast}>
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness}/>
  </RoundedBox>
}

function Disc({ position, radius, height, color, metalness = 0.1, roughness = 0.48 }: {
  position: Vec3; radius: number; height: number; color: string; metalness?: number; roughness?: number
}) {
  return <mesh position={position} castShadow receiveShadow raycast={noRaycast}>
    <cylinderGeometry args={[radius, radius, height, 80]}/>
    <meshStandardMaterial color={color} roughness={roughness} metalness={metalness}/>
  </mesh>
}

// A small outlined wordmark made from geometry keeps the preview local, with no
// font request, text atlas, or texture resource to retain across Strict Mode.
const LETTERS: Record<string, number[][][]> = {
  D: [[[0, 0], [0, 1], [0.36, 1], [0.58, 0.83], [0.58, 0.17], [0.36, 0], [0, 0]]],
  R: [[[0, 0], [0, 1], [0.43, 1], [0.58, 0.85], [0.58, 0.62], [0.43, 0.49], [0, 0.49]], [[0.3, 0.49], [0.62, 0]]],
  E: [[[0.58, 0], [0, 0], [0, 1], [0.58, 1]], [[0, 0.5], [0.48, 0.5]]],
  A: [[[0, 0], [0.29, 1], [0.58, 0]], [[0.12, 0.4], [0.46, 0.4]]],
  M: [[[0, 0], [0, 1], [0.3, 0.48], [0.6, 1], [0.6, 0]]],
}

function Brand({ position, width, rotation }: { position: Vec3; width: number; rotation?: Vec3 }) {
  const vertices = useMemo(() => {
    const points: number[] = []
    const word = 'DREAME'
    const size = width / (word.length * 0.78 - 0.18)
    for (let letter = 0; letter < word.length; letter++) {
      for (const path of LETTERS[word[letter]]) for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1], [bx, by] = path[i]
        const length = Math.hypot(bx - ax, by - ay)
        const dx = -(by - ay) / length * 0.04, dy = (bx - ax) / length * 0.04
        const quad = [[ax + dx, ay + dy], [ax - dx, ay - dy], [bx - dx, by - dy], [bx + dx, by + dy]]
        for (const index of [0, 1, 2, 0, 2, 3]) {
          points.push((quad[index][0] + letter * 0.78) * size - width / 2, (quad[index][1] - 0.5) * size, 0)
        }
      }
    }
    return new Float32Array(points)
  }, [width])
  return <mesh position={position} rotation={rotation} raycast={noRaycast}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[vertices, 3]}/></bufferGeometry>
    <meshBasicMaterial color={CHAMPAGNE} side={THREE.DoubleSide}/>
  </mesh>
}

function DockRibs() {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < 76; i++) {
      const x = (i / 75 - 0.5) * 0.333
      const cornerX = Math.max(0, Math.abs(x) - 0.145)
      const z = 0.2035 + Math.sqrt(0.025 ** 2 - cornerX ** 2)
      matrix.makeTranslation(x, 0.45, z)
      ref.current.setMatrixAt(i, matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[undefined, undefined, 76]} castShadow receiveShadow raycast={noRaycast}>
    <cylinderGeometry args={[0.001, 0.001, 0.237, 6]}/>
    <meshStandardMaterial color="#3b3c39" metalness={0.18} roughness={0.52}/>
  </instancedMesh>
}

function RampTreads() {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < 28; i++) {
      matrix.makeTranslation(i % 2 ? 0.139 : -0.139, 0.011, 0.082 + Math.floor(i / 2) * 0.019)
      ref.current.setMatrixAt(i, matrix)
    }
    ref.current.instanceMatrix.needsUpdate = true
    ref.current.computeBoundingSphere()
  }, [])
  return <instancedMesh ref={ref} args={[undefined, undefined, 28]} receiveShadow raycast={noRaycast}>
    <boxGeometry args={[0.058, 0.003, 0.007]}/><meshStandardMaterial color="#393b37" roughness={0.75}/>
  </instancedMesh>
}

/** Body: 340 × 457 × 590 mm. Ramp reaches z=0.36; docked robot sits at z=0.15. */
export function DreameDockModel() {
  return <group name="Dreame X50 Ultra Complete base station">
    <Box position={[0, 0.006, 0.11]} size={[0.365, 0.012, 0.5]} color={BLACK} radius={0.005}/>
    <RampTreads/>
    <Box position={[0, 0.073, -0.1385]} size={[0.34, 0.146, 0.18]} color={CHARCOAL} radius={0.016}/>
    <Box position={[0, 0.23, 0]} size={[0.34, 0.19, 0.457]} color="#50504a" radius={0.025} metalness={0.62} roughness={0.38}/>
    <Box position={[0, 0.328, 0]} size={[0.34, 0.006, 0.457]} color={CHAMPAGNE} radius={0.002} metalness={0.65} roughness={0.38}/>
    <Box position={[0, 0.459, 0]} size={[0.34, 0.262, 0.457]} color={CHARCOAL} radius={0.025}/>
    <DockRibs/>
    <Box position={[0, 0.584, 0]} size={[0.326, 0.011, 0.443]} color="#30312e" radius={0.005}/>
    <Box position={[0, 0.563, 0.229]} size={[0.051, 0.004, 0.003]} color={BLACK} radius={0.001}/>
    <mesh position={[0, 0.548, 0.2305]} raycast={noRaycast}>
      <planeGeometry args={[0.008, 0.0015]}/><meshStandardMaterial color="#e3e7dc" emissive="#e3e7dc" emissiveIntensity={0.6}/>
    </mesh>
    <Brand position={[0.082, 0.348, 0.2303]} width={0.063}/>
    <mesh position={[0, 0.164, 0.229]} rotation={[0, 0, Math.PI / 4]} raycast={noRaycast}>
      <planeGeometry args={[0.005, 0.005]}/><meshStandardMaterial color={CHAMPAGNE} metalness={0.5} roughness={0.4}/>
    </mesh>
    {/* The open lower bay leaves the vacuum's raised sensor room to pass. */}
    <Box position={[0, 0.067, -0.043]} size={[0.19, 0.09, 0.009]} color="#080b0a" radius={0.004}/>
    {[-1, 1].map(side => <Box key={side} position={[side * 0.047, 0.04, -0.037]} size={[0.016, 0.018, 0.003]} color="#aaa490" radius={0.001} metalness={0.75}/>)}
  </group>
}

function SideBrush() {
  const vertices = useMemo(() => {
    const points: number[] = []
    for (let arm = 0; arm < 3; arm++) for (let bristle = 0; bristle < 9; bristle++) {
      const angle = arm * Math.PI * 2 / 3 + (bristle - 4) * 0.027
      points.push(Math.sin(angle) * 0.008, 0.009, Math.cos(angle) * 0.008,
        Math.sin(angle) * 0.06, 0.002, Math.cos(angle) * 0.06)
    }
    return new Float32Array(points)
  }, [])
  return <group position={[0.132, 0, 0.075]}>
    <Disc position={[0, 0.009, 0]} radius={0.01} height={0.006} color={BLACK}/>
    <lineSegments raycast={noRaycast}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[vertices, 3]}/></bufferGeometry>
      <lineBasicMaterial color="#73716a"/>
    </lineSegments>
  </group>
}

/** 350 mm diameter, 89 mm body, 111 mm including the extended sensor. */
export function DreameVacuumModel() {
  return <group name="Dreame X50 Ultra Complete robot vacuum">
    {[-1, 1].map(side => <Disc key={side} position={[side * 0.075, 0.004, -0.075]} radius={0.052} height={0.008} color="#aaa79c" roughness={1}/>)}
    <SideBrush/>
    <Disc position={[0, 0.016, 0]} radius={0.165} height={0.019} color={BLACK}/>
    <Disc position={[0, 0.047, 0]} radius={0.175} height={0.064} color="#30322f" roughness={0.4}/>
    <Disc position={[0, 0.0795, 0]} radius={0.173} height={0.004} color={BLACK}/>
    <Disc position={[0, 0.085, 0]} radius={0.169} height={0.008} color="#353632" roughness={0.47}/>
    <mesh position={[0, 0.018, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <torusGeometry args={[0.173, 0.001, 6, 80]}/><meshStandardMaterial color="#55564f" metalness={0.45} roughness={0.5}/>
    </mesh>
    <Brand position={[0, 0.0893, -0.107]} width={0.058} rotation={[-Math.PI / 2, 0, Math.PI]}/>
    <Disc position={[0, 0.089, 0.064]} radius={0.039} height={0.004} color={BLACK}/>
    <Disc position={[0, 0.098, 0.064]} radius={0.0315} height={0.02} color="#101311" roughness={0.27}/>
    <Disc position={[0, 0.108, 0.064]} radius={0.0335} height={0.005} color="#8f8d82" metalness={0.65} roughness={0.37}/>
    <Disc position={[0, 0.1101, 0.064]} radius={0.031} height={0.0018} color="#b5ac97" metalness={0.58} roughness={0.4}/>
    <mesh position={[0, 0.1111, 0.064]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <ringGeometry args={[0.0205, 0.0208, 48]}/><meshBasicMaterial color="#7b786c"/>
    </mesh>
    <mesh position={[0, 0.1112, 0.073]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <ringGeometry args={[0.0021, 0.00245, 20, 1, 0.55, Math.PI * 2 - 1.1]}/><meshBasicMaterial color="#f2ebd9"/>
    </mesh>
    <Box position={[0, 0.045, 0.165]} size={[0.108, 0.041, 0.015]} color="#0c0f0d" radius={0.007} roughness={0.26}/>
    <Box position={[0, 0.045, 0.174]} size={[0.071, 0.029, 0.004]} color="#1d211e" radius={0.006} roughness={0.3}/>
    {[-0.019, 0, 0.019].map((x, i) => <mesh key={x} position={[x, 0.041, 0.177]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <cylinderGeometry args={[i === 1 ? 0.005 : 0.004, i === 1 ? 0.005 : 0.004, 0.002, 20]}/>
      <meshStandardMaterial color={i === 1 ? '#294b4c' : '#4f5c57'} metalness={0.45} roughness={0.18}/>
    </mesh>)}
    <Box position={[0, 0.052, 0.1765]} size={[0.009, 0.004, 0.002]} color="#c2c9bc" radius={0.0008} roughness={0.35}/>
    <Box position={[-0.027, 0.071, 0.174]} size={[0.008, 0.0015, 0.001]} color="#9d574a" radius={0.0004}/>
  </group>
}
