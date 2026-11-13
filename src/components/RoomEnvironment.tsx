import { useEffect, useMemo } from 'react'
import { getRoomLayout, RUG_OFFSET } from './room-layout'
import { Banana } from './Banana'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { DEFAULT_ROOM_STYLE, roomFloorStyle, rugSize, type RoomFloorStyle, type RoomStyleInput } from '@/lib/room-floor-style'
import { parquetTextures, rugTextures } from './room-floor-textures'
import { planWallArt, wallObstacles } from '@/lib/room-wall-art'
import type { FurnishingPlacement } from '@/lib/preview-furnishings'
import { RoomWallArt } from './RoomWallArt'
import { RoomWalls } from './RoomWalls'
import { lowerWallTop, roomWallStyle } from '@/lib/room-wall-style'
import { roomLighting } from '@/lib/room-lighting'
import { RoomLights } from './RoomLighting'

RectAreaLightUniformsLib.init()

type Triple = [number, number, number]

function Box({ position, size, color, radius = 0, rotation, roughness = 0.85, metalness = 0 }: {
  position: Triple; size: Triple; color: string; radius?: number; rotation?: Triple; roughness?: number; metalness?: number
}) {
  const material = <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  return radius > 0
    ? <RoundedBox position={position} args={size} radius={radius} smoothness={3} rotation={rotation} castShadow receiveShadow>{material}</RoundedBox>
    : <mesh position={position} rotation={rotation} castShadow receiveShadow><boxGeometry args={size} />{material}</mesh>
}

function LoungeChair({ position }: { position: Triple }) {
  return <group position={position} rotation={[0, -0.2, 0]} name="Lounge chair, 43 cm seat height">
    {[-1, 1].flatMap(x => [-1, 1].map(z => <Box key={`${x}-${z}`} position={[x * 0.29, 0.16, z * 0.275]} size={[0.045, 0.32, 0.045]} color="#68513b" radius={0.008} rotation={[z * 0.06, 0, -x * 0.06]} />))}
    <Box position={[0, 0.325, 0]} size={[0.78, 0.13, 0.76]} color="#ae9b81" radius={0.045} />
    <Box position={[0, 0.395, 0.015]} size={[0.61, 0.07, 0.65]} color="#c6b79f" radius={0.03} />
    <Box position={[0, 0.64, -0.29]} size={[0.76, 0.46, 0.14]} color="#b3a18b" radius={0.06} rotation={[-0.13, 0, 0]} />
    <Box position={[0, 0.635, -0.195]} size={[0.58, 0.35, 0.095]} color="#c6b79f" radius={0.045} rotation={[-0.13, 0, 0]} />
    {[-1, 1].map(side => <Box key={side} position={[side * 0.35, 0.5, 0]} size={[0.12, 0.26, 0.74]} color="#b9a88f" radius={0.055} />)}
    <Box position={[0.14, 0.57, -0.05]} size={[0.3, 0.29, 0.105]} color="#62705d" radius={0.045} rotation={[-0.25, -0.15, -0.12]} />
  </group>
}

function Plant({ position }: { position: Triple }) {
  const branches = useMemo(() => Array.from({ length: 15 }, (_, i) => {
    const angle = i * 2.4
    const height = 0.55 + i * 0.065
    const radius = 0.23 + Math.sin(i * 1.3) * 0.09
    const tip = new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    const start = new THREE.Vector3(0, height - 0.24, 0)
    const delta = tip.clone().sub(start)
    return { tip, middle: start.add(tip).multiplyScalar(0.5), length: delta.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()), angle }
  }), [])
  return <group position={position} name="Indoor ficus">
    <mesh position={[0, 0.185, 0]} castShadow receiveShadow><cylinderGeometry args={[0.205, 0.15, 0.37, 48]} /><meshStandardMaterial color="#c3b5a0" roughness={0.95} /></mesh>
    <mesh position={[0, 0.371, 0]}><cylinderGeometry args={[0.192, 0.192, 0.008, 32]} /><meshStandardMaterial color="#4c4231" roughness={1} /></mesh>
    <mesh position={[0, 0.91, 0]} castShadow><cylinderGeometry args={[0.009, 0.02, 1.08, 10]} /><meshStandardMaterial color="#6e5e3c" roughness={1} /></mesh>
    {branches.map((branch, i) => <group key={i}>
      <mesh position={branch.middle} quaternion={branch.quaternion} castShadow><cylinderGeometry args={[0.003, 0.005, branch.length, 6]} /><meshStandardMaterial color="#6b7247" roughness={1} /></mesh>
      <mesh position={branch.tip} rotation={[0.35 + Math.sin(i) * 0.4, -branch.angle, 0.25]} scale={[0.095, 0.027, 0.18]} castShadow receiveShadow><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color={i % 3 === 0 ? '#76805a' : i % 3 === 1 ? '#536748' : '#637750'} roughness={0.8} /></mesh>
    </group>)}
  </group>
}

function SideTable({ position }: { position: Triple }) {
  return <group position={position} name="Side table">
    <mesh position={[0, 0.235, 0]} castShadow receiveShadow><cylinderGeometry args={[0.105, 0.13, 0.47, 40]} /><meshStandardMaterial color="#9a6d4b" roughness={0.75} /></mesh>
    <mesh position={[0, 0.49, 0]} castShadow receiveShadow><cylinderGeometry args={[0.235, 0.235, 0.04, 48]} /><meshStandardMaterial color="#ad815b" roughness={0.65} /></mesh>
    <Box position={[-0.03, 0.52, 0.015]} size={[0.19, 0.023, 0.14]} color="#e5ddd0" rotation={[0, 0.1, 0]} />
    <Box position={[-0.03, 0.534, 0.015]} size={[0.19, 0.005, 0.14]} color="#667161" rotation={[0, 0.1, 0]} />
    <mesh position={[0.07, 0.563, -0.07]} castShadow><cylinderGeometry args={[0.035, 0.029, 0.1, 24]} /><meshStandardMaterial color="#ece6d9" roughness={0.45} /></mesh>
    <Banana />
  </group>
}

/** Parquet with UVs in tile units, so a pattern can turn without stretching. */
function ParquetFloor({ style, position, width, depth }: { style: RoomFloorStyle; position: Triple; width: number; depth: number }) {
  const { parquet, key } = style
  const textures = useMemo(() => parquetTextures(parquet, key), [parquet, key])
  useEffect(() => () => { textures.map.dispose(); textures.bump.dispose() }, [textures])
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(width, depth)
    const uv = plane.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / textures.metres, uv.getY(i) * depth / textures.metres)
    return plane
  }, [width, depth, textures.metres])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => {
    for (const map of [textures.map, textures.bump]) map.rotation = parquet.angle
  }, [textures, parquet.angle])
  return <mesh name={`Parquet floor, ${parquet.pattern}, ${parquet.wood.id}`} position={position} rotation={[-Math.PI / 2, 0, 0]} geometry={geometry} receiveShadow>
    <meshStandardMaterial map={textures.map} bumpMap={textures.bump} bumpScale={0.5} roughness={parquet.roughness} />
  </mesh>
}

function Rug({ style, position, extent }: { style: RoomFloorStyle; position: Triple; extent: [number, number] }) {
  const { rug, key } = style
  const [width, depth] = rugSize(rug, ...extent)
  const textures = useMemo(() => rugTextures(rug, key, [width, depth]), [rug, key, width, depth])
  useEffect(() => () => { textures.map.dispose(); textures.bump.dispose(); textures.fringe?.dispose() }, [textures])
  const pile = !['kilim', 'stripes', 'jute'].includes(rug.pattern)
  const material = <meshStandardMaterial map={textures.map} bumpMap={textures.bump} bumpScale={pile ? 0.7 : 1} roughness={1} />
  const [x, y, z] = position
  return <group name={`Rug, ${rug.pattern}, ${width.toFixed(1)} × ${depth.toFixed(1)} m`} position={[x, y + rug.pile / 2, z]}>
    {rug.shape === 'round'
      ? <mesh receiveShadow><cylinderGeometry args={[width / 2, width / 2, rug.pile, 96]} />{material}</mesh>
      : <mesh receiveShadow><boxGeometry args={[width, rug.pile, depth]} />{material}</mesh>}
    {textures.fringe && [1, -1].map(side => <mesh key={side} position={[side * (width / 2 + 0.035), -rug.pile / 2 + 0.0012, 0]} rotation={[-Math.PI / 2, 0, side > 0 ? 0 : Math.PI]} receiveShadow>
      <planeGeometry args={[0.07, depth - 0.04]} /><meshStandardMaterial map={textures.fringe} alphaTest={0.4} roughness={1} side={THREE.DoubleSide} />
    </mesh>)}
  </group>
}

const NO_FURNISHINGS: readonly FurnishingPlacement[] = []

export function RoomEnvironment({ bounds, style: input = DEFAULT_ROOM_STYLE, furnishings = NO_FURNISHINGS }: { bounds: THREE.Box3; style?: RoomStyleInput; furnishings?: readonly FurnishingPlacement[] }) {
  const layout = getRoomLayout(bounds)
  const { floorY, leftX, rightX, backZ, width, depth, height, chairX, chairZ, plantX, plantZ } = layout
  const centerX = (leftX + rightX) / 2
  const centerZ = backZ + depth / 2
  const { seed, theme, density = 'balanced' } = input
  const style = useMemo(() => roomFloorStyle({ seed, theme }), [seed, theme])
  const walls = useMemo(() => roomWallStyle({ seed, theme }), [seed, theme])
  // Art hangs clear of a dado rail or painted lower wall, including its scallops.
  const dado = lowerWallTop(walls.lower)
  const { min: { x: minX }, max: { x: maxX, y: maxY } } = bounds
  const wallArt = useMemo(() => planWallArt({
    seed, theme, density, chairX, plantX,
    wall: { left: leftX, right: rightX, height, dado },
    creation: { minX, maxX },
    obstacles: wallObstacles({ bounds: { min: { x: minX }, max: { x: maxX, y: maxY } }, floorY, chairX, plantX, furnishings }),
  }), [seed, theme, density, chairX, plantX, leftX, rightX, height, dado, minX, maxX, maxY, floorY, furnishings])
  const lighting = useMemo(() => roomLighting({ seed, theme }), [seed, theme])
  const windowZ = backZ + 2.1
  const windowWidth = 2.4
  const windowHeight = 2.25
  const windowBottom = 0.35
  const windowOpening = useMemo(() => ({ z: windowZ, width: windowWidth, height: windowHeight, bottom: windowBottom }), [windowZ])
  const lampPosition = useMemo<Triple>(() => [chairX + 0.63, floorY, chairZ - 0.34], [chairX, floorY, chairZ])
  return <group name="Modern home">
    <RoomLights lighting={lighting} theme={theme} bounds={bounds} floorY={floorY} leftX={leftX} width={width} height={height}
      window={windowOpening} lampPosition={lampPosition} sheer={walls.curtain.sheer} />

    <ParquetFloor style={style} position={[centerX, floorY - 0.006, centerZ]} width={width} depth={depth} />
    {/* A single-sided ceiling fills the upper view from inside the room while
        allowing an elevated orbit to see through it. It does not block daylight. */}
    <mesh position={[centerX, floorY + height, centerZ]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, depth]} /><meshStandardMaterial color="#edeae3" emissive="#edeae3" emissiveIntensity={lighting.ceiling} roughness={1} />
    </mesh>
    <Box position={[centerX, floorY + height / 2, backZ - 0.09]} size={[width, height, 0.18]} color="#e5e1d7" />

    {/* The left wall is built around a real opening; daylight remains spatial. */}
    <Box position={[leftX - 0.09, floorY + windowBottom / 2, centerZ]} size={[0.18, windowBottom, depth]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight + height) / 2, centerZ]} size={[0.18, height - windowBottom - windowHeight, depth]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight / 2), (backZ + windowZ - windowWidth / 2) / 2]} size={[0.18, windowHeight, windowZ - windowWidth / 2 - backZ]} color="#e9e5dc" />
    <Box position={[leftX - 0.09, floorY + (windowBottom + windowHeight / 2), (windowZ + windowWidth / 2 + backZ + depth) / 2]} size={[0.18, windowHeight, backZ + depth - windowZ - windowWidth / 2]} color="#e9e5dc" />
    <mesh position={[leftX - 0.13, floorY + windowBottom + windowHeight / 2, windowZ]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[windowWidth, windowHeight]} /><meshBasicMaterial color={lighting.window.sky} fog={false} />
    </mesh>
    {[windowZ - windowWidth / 2, windowZ, windowZ + windowWidth / 2].map(z => <Box key={z} position={[leftX, floorY + windowBottom + windowHeight / 2, z]} size={[0.055, windowHeight + 0.04, 0.035]} color="#6c716c" />)}
    {[windowBottom, windowBottom + windowHeight].map(y => <Box key={y} position={[leftX, floorY + y, windowZ]} size={[0.055, 0.035, windowWidth + 0.04]} color="#6c716c" />)}
    <Box position={[leftX + 0.04, floorY + windowBottom - 0.012, windowZ]} size={[0.23, 0.035, windowWidth + 0.15]} color="#eeebe1" />
    <RoomWalls style={walls} floorY={floorY} leftX={leftX} rightX={rightX} backZ={backZ} depth={depth} height={height}
      window={windowOpening} />

    <Rug style={style} position={[layout.centerX + RUG_OFFSET.x, floorY - 0.006, RUG_OFFSET.z]} extent={[bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z]} />
    <RoomWallArt plan={wallArt} wallZ={backZ} floorY={floorY} />

    <LoungeChair position={[chairX, floorY, chairZ]} />
    <SideTable position={[chairX + 0.68, floorY, chairZ + 0.42]} />
    <Plant position={[plantX, floorY, plantZ]} />
  </group>
}
