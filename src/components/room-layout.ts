import * as THREE from 'three'
import { DEFAULT_ROOM_STYLE, roomFloorStyle, rugSize, type RoomStyleInput } from '@/lib/room-floor-style'

// Leave clearance for hardware below panels resting at world Y = 0.
export const PREVIEW_FLOOR_Y = -0.012

// All room dimensions are meters. Reference furnishings deliberately keep their
// real dimensions when the user's assembly grows or moves. Room placement is
// anchored to the world origin so translating a creation does not move its wall.
export function getRoomLayout(bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3())
  const leftX = -size.x / 2 - 2.6
  const rightX = size.x / 2 + 5.1
  const backZ = -size.z / 2 - 0.65
  const depth = Math.max(18, size.z + 7)
  const height = Math.max(3.15, size.y + 1.1)
  const chairX = size.x / 2 + 1.05
  return {
    floorY: PREVIEW_FLOOR_Y,
    centerX: 0,
    backZ, leftX, rightX,
    width: rightX - leftX,
    depth,
    height,
    chairX,
    chairZ: 0.12,
    plantX: -size.x / 2 - 0.7,
    plantZ: -size.z / 2 + 0.12,
  }
}

export type RoomPieceKind = 'sofa' | 'stove' | 'whiteboard' | 'rocking-horse'

/**
 * Each room style's own piece of reference furniture, in metres. Width runs
 * along local X, depth along local Z (the front faces +Z), and the origin is
 * the centre of its floor footprint.
 */
export interface RoomPiece { kind: RoomPieceKind; x: number; z: number; rotation: number; width: number; depth: number; height: number }

/**
 * Only an auto-furnished room adds its style's piece: a two-seat sofa across
 * the side table from the lounge chair, a freestanding stove or a mobile
 * whiteboard beyond the floor lamp, or a rocking horse in front of the creation.
 */
export function getRoomPiece(bounds: THREE.Box3, style: RoomStyleInput = DEFAULT_ROOM_STYLE): RoomPiece | null {
  if (!style.furnished) return null
  const { chairX, backZ } = getRoomLayout(bounds)
  switch (style.theme) {
    case 'living': return { kind: 'sofa', x: chairX + 1.8, z: 0.42, rotation: -0.85, width: 1.5, depth: 0.82, height: 0.8 }
    case 'kitchen': return { kind: 'stove', x: chairX + 1.45, z: backZ + 0.34, rotation: 0, width: 0.6, depth: 0.62, height: 0.92 }
    case 'office': return { kind: 'whiteboard', x: chairX + 1.6, z: backZ + 0.6, rotation: -0.25, width: 1.3, depth: 0.55, height: 1.86 }
    case 'kids': return { kind: 'rocking-horse', x: bounds.min.x - 0.45, z: bounds.max.z + 0.75, rotation: -0.55, width: 0.76, depth: 0.32, height: 0.72 }
  }
}

/** Axis-aligned floor footprint of a turned rectangle. */
export function roomPieceFootprint({ x, z, width, depth, rotation }: Pick<RoomPiece, 'x' | 'z' | 'width' | 'depth' | 'rotation'>) {
  const halfX = (Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * depth) / 2
  const halfZ = (Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * depth) / 2
  return { minX: x - halfX, maxX: x + halfX, minZ: z - halfZ, maxZ: z + halfZ }
}

/** The rug is centred slightly right of and in front of the creation. */
export const RUG_OFFSET = { x: 0.12, z: 0.16 } as const

export interface RoomRug { x: number; z: number; width: number; depth: number; round: boolean }

/** Floor footprint of the room's rug, in meters, matching `RoomEnvironment`. */
export function getRoomRug(bounds: THREE.Box3, style: RoomStyleInput = DEFAULT_ROOM_STYLE): RoomRug {
  const size = bounds.getSize(new THREE.Vector3())
  const rug = roomFloorStyle(style).rug
  const [width, depth] = rugSize(rug, size.x, size.z)
  return { x: getRoomLayout(bounds).centerX + RUG_OFFSET.x, z: RUG_OFFSET.z, width, depth, round: rug.shape === 'round' }
}
