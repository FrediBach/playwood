import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { ArtPiece, WallArtPlan } from '@/lib/room-wall-art'
import { artTexture, GRAIN_TILE_METRES, paperGrainTexture } from './room-wall-art-textures'

const cm = (metres: number) => Math.round(metres * 100)

/** One framed print: four mitred-looking bars around a recessed print, or a stretched canvas. */
function FramedArt({ piece, wallZ, floorY }: { piece: ArtPiece; wallZ: number; floorY: number }) {
  const { frame, width, height } = piece
  const canvas = frame.kind === 'canvas'
  const innerWidth = width - frame.profile * 2, innerHeight = height - frame.profile * 2
  // Rebuild only when the drawing or its size changes, not on every re-plan.
  const { key, style, paper, seed, mat } = piece.art
  const colors = piece.art.colors.join(' ')
  const texture = useMemo(() => artTexture({ key, style, paper, seed, mat, colors: colors.split(' ') }, innerWidth, innerHeight, !canvas),
    [key, style, paper, seed, mat, colors, innerWidth, innerHeight, canvas])
  useEffect(() => () => texture.dispose(), [texture])
  // Clones share the grain's image, so it is uploaded and exported once.
  const grain = useMemo(() => {
    const clone = paperGrainTexture().clone()
    clone.repeat.set(innerWidth / GRAIN_TILE_METRES, innerHeight / GRAIN_TILE_METRES)
    return clone
  }, [innerWidth, innerHeight])
  useEffect(() => () => grain.dispose(), [grain])
  const bar = <meshStandardMaterial color={frame.color} roughness={frame.kind === 'black' ? 0.45 : 0.6} />
  const { depth, profile } = frame
  return <group name={`Artwork, ${style}, ${cm(width)} × ${cm(height)} cm`} position={[piece.x, floorY + piece.y, wallZ]}>
    {canvas
      ? <mesh position={[0, 0, depth / 2]} castShadow receiveShadow><boxGeometry args={[width, height, depth]} /><meshStandardMaterial color={paper} roughness={0.9} /></mesh>
      : <>
        {[1, -1].map(side => <mesh key={`y${side}`} position={[0, side * (height - profile) / 2, depth / 2]} castShadow receiveShadow><boxGeometry args={[width, profile, depth]} />{bar}</mesh>)}
        {[1, -1].map(side => <mesh key={`x${side}`} position={[side * (width - profile) / 2, 0, depth / 2]} castShadow receiveShadow><boxGeometry args={[profile, innerHeight, depth]} />{bar}</mesh>)}
      </>}
    {/* Prints sit in the frame's rebate; a canvas is painted on its face. */}
    <mesh position={[0, 0, canvas ? depth + 0.0006 : depth * 0.55]} receiveShadow>
      <planeGeometry args={[innerWidth, innerHeight]} /><meshStandardMaterial map={texture} bumpMap={grain} bumpScale={canvas ? 0.6 : 0.3} roughness={canvas ? 0.85 : 0.92} />
    </mesh>
  </group>
}

export function RoomWallArt({ plan, wallZ, floorY }: { plan: WallArtPlan; wallZ: number; floorY: number }) {
  const pieces = plan.groups.flatMap(group => group.pieces)
  return <group name={`Wall art, ${pieces.length} ${pieces.length === 1 ? 'piece' : 'pieces'}`}>
    {pieces.map(piece => <FramedArt key={piece.id} piece={piece} wallZ={wallZ} floorY={floorY} />)}
  </group>
}
