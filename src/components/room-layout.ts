import * as THREE from 'three'

// All room dimensions are meters. Reference furnishings deliberately keep their
// real dimensions when the user's assembly grows or moves.
export function getRoomLayout(bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const leftX = bounds.min.x - 2.6
  const rightX = bounds.max.x + 5.1
  const backZ = bounds.min.z - 0.65
  const depth = Math.max(18, size.z + 7)
  return {
    floorY: bounds.min.y - 0.012,
    centerX: center.x,
    backZ, leftX, rightX,
    width: rightX - leftX,
    depth,
    height: Math.max(3.15, size.y + 1.1),
    chairX: bounds.max.x + 1.05,
    chairZ: center.z + 0.12,
  }
}

