import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { seededRandom } from '@/lib/preview-furnishing-variation'
import type { CurtainStyle, WallStyle } from '@/lib/room-wall-style'
import { fabricTextures, lowerWallTextures, paintTextures, type WallTextures } from './room-wall-textures'
import { aroundHole, type WallFace, type WallRect } from './room-wall-geometry'

/** Quads for the given rectangles, with UVs in tile units so textures keep their physical scale. */
function wallGeometry(face: WallFace, rects: readonly WallRect[], tile: [number, number], offset: number, vFrom = 0) {
  const [ox, oy, oz] = face.origin, [ax, , az] = face.along
  // The wall normal is along × up, which faces into the room.
  const nx = -az, nz = ax
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (const rect of rects) {
    const base = positions.length / 3
    for (const [s, y] of [[rect.s0, rect.y0], [rect.s1, rect.y0], [rect.s1, rect.y1], [rect.s0, rect.y1]]) {
      positions.push(ox + ax * s + nx * offset, oy + y, oz + az * s + nz * offset)
      uvs.push(s / tile[0], (y - vFrom) / tile[1])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function useDisposable<T extends { dispose(): void }>(items: readonly (T | null | undefined)[]) {
  useEffect(() => () => { for (const item of items) item?.dispose() }, [items])
}

function WallSurface({ face, rect, textures, offset, vFrom, roughness, cutout, name }: {
  face: WallFace; rect: WallRect; textures: WallTextures; offset: number; vFrom?: number; roughness: number; cutout?: boolean; name: string
}) {
  const geometry = useMemo(() => wallGeometry(face, aroundHole(rect, face.hole), textures.tile, offset, vFrom),
    [face, rect, textures.tile, offset, vFrom])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh name={name} geometry={geometry} receiveShadow>
    <meshStandardMaterial map={textures.map} bumpMap={textures.bump} bumpScale={0.6} roughness={roughness} alphaTest={cutout ? 0.5 : 0} />
  </mesh>
}

/** A straight run of trim along a wall, split around the window. */
function Trim({ face, length, y, height, depth, color, roughness = 0.5 }: { face: WallFace; length: number; y: number; height: number; depth: number; color: string; roughness?: number }) {
  const parts = aroundHole({ s0: 0, s1: length, y0: y, y1: y + height }, face.hole).filter(part => part.y1 - part.y0 >= height - 1e-6)
  const [ox, oy, oz] = face.origin, [ax, , az] = face.along
  const rotation = Math.atan2(-az, ax)
  return <>{parts.map(part => {
    const s = (part.s0 + part.s1) / 2
    return <mesh key={part.s0} position={[ox + ax * s + -az * depth / 2, oy + y + height / 2, oz + az * s + ax * depth / 2]} rotation={[0, rotation, 0]} castShadow receiveShadow>
      <boxGeometry args={[part.s1 - part.s0, height, depth]} /><meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  })}</>
}

const ROD_COLORS: Record<Exclude<CurtainStyle['rod'], 'track'>, { color: string; metalness: number; roughness: number }> = {
  black: { color: '#2b2b29', metalness: 0.5, roughness: 0.45 },
  brass: { color: '#b08d57', metalness: 0.9, roughness: 0.32 },
  oak: { color: '#a77d55', metalness: 0, roughness: 0.6 },
}

/** Pleated fabric: folds flare towards the hem, with irregular depth like real drapery. */
function curtainGeometry(width: number, height: number, folds: number, depth: number, seed: string) {
  const random = seededRandom(seed)
  const columns = Math.max(24, Math.ceil(width * folds * 10)), rows = 18
  const geometry = new THREE.PlaneGeometry(width, height, columns, rows)
  const position = geometry.attributes.position
  const phase = random() * Math.PI * 2, wobble = random() * Math.PI * 2, ripple = 0.8 + random() * 0.6
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i)
    const drop = (height / 2 - y) / height // 0 at the heading, 1 at the hem
    const angle = (x + width / 2) * folds * Math.PI * 2 + phase
    // Pinch-pleat heading gathers tightly; folds open and deepen towards the hem.
    const heading = drop < 0.05 ? 0.55 + drop * 9 : 1
    const amplitude = depth * (0.7 + 0.45 * drop) * (1 + 0.22 * Math.sin(x * 2.3 + wobble)) * heading
    const z = amplitude * (Math.sin(angle) + 0.28 * Math.sin(2 * angle + ripple))
    position.setXYZ(i, x * (1 + 0.035 * drop), y, z)
  }
  geometry.computeVertexNormals()
  return geometry
}

function fabricMaterial(style: CurtainStyle, textures: WallTextures, sheer: boolean) {
  const velvet = style.fabric === 'velvet' && !sheer
  return <meshPhysicalMaterial map={textures.map} bumpMap={textures.bump} bumpScale={0.4} roughness={velvet ? 0.72 : 0.95}
    sheen={velvet ? 1 : 0.35} sheenRoughness={velvet ? 0.35 : 0.8} sheenColor={velvet ? '#ffffff' : '#f4efe6'}
    side={THREE.DoubleSide} transparent={sheer} opacity={sheer ? 0.55 : 1} depthWrite={!sheer} />
}

function Curtain({ style, textures, x, z, top, bottom, width, seed }: { style: CurtainStyle; textures: WallTextures; x: number; z: number; top: number; bottom: number; width: number; seed: string }) {
  const height = top - bottom
  const geometry = useMemo(() => curtainGeometry(width, height, style.folds, style.depth, seed), [width, height, style.folds, style.depth, seed])
  useEffect(() => () => geometry.dispose(), [geometry])
  const map = useMemo(() => {
    const scaled = { map: textures.map.clone(), bump: textures.bump.clone() }
    for (const texture of [scaled.map, scaled.bump]) texture.repeat.set(width / textures.tile[0], height / textures.tile[1])
    return scaled
  }, [textures, width, height])
  useDisposable([map.map, map.bump])
  return <mesh name={`Curtain, ${style.fabric}`} position={[x, (top + bottom) / 2, z]} rotation={[0, Math.PI / 2, 0]} geometry={geometry} castShadow receiveShadow>
    {fabricMaterial(style, { ...textures, ...map }, false)}
  </mesh>
}

function Sheer({ style, textures, x, z, top, bottom, width, seed }: { style: CurtainStyle; textures: WallTextures; x: number; z: number; top: number; bottom: number; width: number; seed: string }) {
  const height = top - bottom
  const geometry = useMemo(() => curtainGeometry(width, height, 13, 0.018, seed), [width, height, seed])
  useEffect(() => () => geometry.dispose(), [geometry])
  const map = useMemo(() => {
    const scaled = { map: textures.map.clone(), bump: textures.bump.clone() }
    for (const texture of [scaled.map, scaled.bump]) texture.repeat.set(width / textures.tile[0], height / textures.tile[1])
    return scaled
  }, [textures, width, height])
  useDisposable([map.map, map.bump])
  return <mesh name="Sheer curtain" position={[x, (top + bottom) / 2, z]} rotation={[0, Math.PI / 2, 0]} geometry={geometry} receiveShadow>
    {fabricMaterial(style, { ...textures, ...map }, true)}
  </mesh>
}

export interface WindowOpening { z: number; width: number; height: number; bottom: number }

export function RoomWalls({ style, floorY, leftX, rightX, backZ, depth, height, window }: {
  style: WallStyle; floorY: number; leftX: number; rightX: number; backZ: number; depth: number; height: number; window: WindowOpening
}) {
  const { key, lower, curtain } = style
  const back = useMemo<WallFace>(() => ({ name: 'Back wall', origin: [leftX, floorY, backZ], along: [1, 0, 0] }), [leftX, floorY, backZ])
  // Along the left wall, s runs towards the back so the surface faces into the room.
  const left = useMemo<WallFace>(() => ({
    name: 'Left wall', origin: [leftX, floorY, backZ + depth], along: [0, 0, -1],
    hole: { s0: backZ + depth - window.z - window.width / 2, s1: backZ + depth - window.z + window.width / 2, y0: window.bottom, y1: window.bottom + window.height },
  }), [leftX, floorY, backZ, depth, window])
  const lengths = { back: rightX - leftX, left: depth }

  const upper = useMemo(() => paintTextures(style.paint, style.finish, key), [style.paint, style.finish, key])
  useDisposable([upper.map, upper.bump])
  const lowerTextures = useMemo(() => lower.kind === 'none' ? null : lowerWallTextures(lower, style.skirting, key), [lower, style.skirting, key])
  useDisposable([lowerTextures?.map, lowerTextures?.bump])
  const fabric = useMemo(() => fabricTextures(curtain, key), [curtain, key])
  useDisposable([fabric.map, fabric.bump])
  const voile = useMemo(() => curtain.sheer ? fabricTextures(curtain, key, true) : null, [curtain, key])
  useDisposable([voile?.map, voile?.bump])

  const split = lower.kind === 'none' ? 0 : lower.height
  const roughness = style.finish === 'plaster' ? 0.62 : style.finish === 'grasscloth' ? 0.95 : 0.88
  const lowerRoughness = lower.kind === 'tiles' ? 0.22 : lower.kind === 'two-tone' ? 0.88 : 0.6
  const railColor = lower.kind === 'tiles' ? lower.color : style.trim

  // Curtains hang from a rod above the window, or from a ceiling track.
  const track = curtain.rod === 'track'
  const top = track ? height - 0.01 : Math.min(height - 0.08, window.bottom + window.height + 0.2)
  // Clear of the window sill, which projects 15.5 cm into the room.
  const curtainX = leftX + 0.24
  const overlap = Math.min(0.22, curtain.width * 0.3)
  const edges = [window.z - window.width / 2, window.z + window.width / 2]
  const rodLength = window.width + 2 * (curtain.width - overlap) + 0.3
  const rod = !track && ROD_COLORS[curtain.rod as Exclude<CurtainStyle['rod'], 'track'>]
  return <group name="Walls">
    {[back, left].map(face => {
      const length = face === back ? lengths.back : lengths.left
      return <group key={face.name} name={face.name}>
        <WallSurface name={`${face.name}, ${style.finish}`} face={face} rect={{ s0: 0, s1: length, y0: split, y1: height }} textures={upper} offset={0.001} roughness={roughness} />
        {lowerTextures && <WallSurface name={`${face.name}, ${lower.kind}`} face={face} rect={{ s0: 0, s1: length, y0: 0, y1: lowerTextures.planeHeight }}
          textures={lowerTextures} offset={0.0018} roughness={lowerRoughness} cutout={lowerTextures.cutout} />}
        <Trim face={face} length={length} y={0} height={style.skirting} depth={lower.kind === 'panelled' ? 0.024 : 0.018} color={style.trim} />
        {lower.rail && <Trim face={face} length={length} y={lower.height - (lower.kind === 'tiles' ? 0.012 : 0.03)} height={lower.kind === 'tiles' ? 0.018 : 0.035}
          depth={lower.kind === 'tiles' ? 0.014 : 0.022} color={railColor} roughness={lower.kind === 'tiles' ? 0.25 : 0.5} />}
      </group>
    })}

    {rod && <group name={`Curtain rod, ${curtain.rod}`}>
      <mesh position={[curtainX, floorY + top + 0.035, window.z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.011, 0.011, rodLength, 20]} /><meshStandardMaterial {...rod} />
      </mesh>
      {[-1, 1].map(side => <group key={side}>
        <mesh position={[curtainX, floorY + top + 0.035, window.z + side * rodLength / 2]} castShadow><sphereGeometry args={[0.024, 20, 14]} /><meshStandardMaterial {...rod} /></mesh>
        <mesh position={[(leftX + curtainX) / 2, floorY + top + 0.035, window.z + side * (rodLength / 2 - 0.12)]} castShadow><boxGeometry args={[curtainX - leftX, 0.014, 0.014]} /><meshStandardMaterial {...rod} /></mesh>
      </group>)}
    </group>}
    {track && <mesh name="Curtain track" position={[curtainX, floorY + height - 0.006, window.z]}><boxGeometry args={[0.04, 0.012, window.width + 2 * curtain.width + 0.3]} /><meshStandardMaterial color="#e9e6df" roughness={0.6} /></mesh>}

    {voile && <Sheer style={curtain} textures={voile} x={curtainX - 0.055} z={window.z} top={floorY + top} bottom={floorY + 0.012} width={window.width + 0.3} seed={`${key}:sheer`} />}
    {edges.map((edge, index) => {
      const side = index ? 1 : -1
      return <Curtain key={side} style={curtain} textures={fabric} x={curtainX} z={edge + side * (curtain.width / 2 - overlap)}
        top={floorY + top} bottom={floorY + 0.008} width={curtain.width} seed={`${key}:${side}`} />
    })}
  </group>
}
