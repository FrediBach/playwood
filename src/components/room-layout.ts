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
