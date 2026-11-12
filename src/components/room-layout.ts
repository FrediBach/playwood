import * as THREE from 'three'

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

