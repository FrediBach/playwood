import { Camera, Mesh, Object3D, Vector3 } from 'three'

/** Normalized device coordinates: left <= right and bottom <= top. */
export interface SelectionRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

interface ProjectedBounds extends SelectionRectangle {
  clipped: boolean
  hasGeometry: boolean
}

/** Select whole projected parts, including parts occluded by other geometry. */
export function getBoxSelection(scene: Object3D, camera: Camera, rectangle: SelectionRectangle, kind: 'panels' | 'connectors'): string[] {
  if (!Object.values(rectangle).every(Number.isFinite) || rectangle.left > rectangle.right || rectangle.bottom > rectangle.top) return []
  // The supplied root may itself be below an invisible scene group.
  for (let parent: Object3D | null = scene; parent; parent = parent.parent) if (!parent.visible) return []
  scene.updateWorldMatrix(true, true)
  camera.updateWorldMatrix(true, false)
  const key = kind === 'panels' ? 'panelId' : 'connectorId'
  const bounds = new Map<string, ProjectedBounds>()
  const point = new Vector3()
  const visit = (object: Object3D, owner?: string) => {
    if (!object.visible) return
    const id = typeof object.userData[key] === 'string' ? object.userData[key] as string : owner
    if (id && object instanceof Mesh && camera.layers.test(object.layers)) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      if (materials.some(material => material.visible)) {
        const geometry = object.geometry
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        const box = geometry.boundingBox
        if (box && !box.isEmpty()) {
          let projected = bounds.get(id)
          if (!projected) {
            projected = { left: Infinity, top: -Infinity, right: -Infinity, bottom: Infinity, clipped: false, hasGeometry: false }
            bounds.set(id, projected)
          }
          projected.hasGeometry = true
          for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
            point.set(x, y, z).applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
            // Perspective projection can mirror points behind the camera into the box.
            if (point.z >= 0) projected.clipped = true
            point.applyMatrix4(camera.projectionMatrix)
            if (![point.x, point.y, point.z].every(Number.isFinite) || point.z < -1 || point.z > 1) projected.clipped = true
            projected.left = Math.min(projected.left, point.x)
            projected.right = Math.max(projected.right, point.x)
            projected.bottom = Math.min(projected.bottom, point.y)
            projected.top = Math.max(projected.top, point.y)
          }
        }
      }
    }
    for (const child of object.children) visit(child, id)
  }
  visit(scene)
  const epsilon = 1e-7
  return [...bounds].filter(([, box]) => box.hasGeometry && !box.clipped
    && box.left >= rectangle.left - epsilon && box.right <= rectangle.right + epsilon
    && box.bottom >= rectangle.bottom - epsilon && box.top <= rectangle.top + epsilon).map(([id]) => id)
}
