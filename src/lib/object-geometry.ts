import { findObjectSolids, type ObjectSolid } from './object-solids'
import { findObjectPrism, type ObjectPrism } from './object-prism'
import { Euler, Matrix4, Vector3 } from 'three'
import { parseConstructionObjects } from './construction-objects'
import type { ConstructionObject, ConstructionObjects, Vec3 } from './types'

export interface ObjectBounds { min: Vec3; max: Vec3 }
export interface ObjectSurface { id: string; positions: Float32Array; volume: number; bounds: ObjectBounds | null; cuboid: boolean; prism?: ObjectPrism; solids?: ObjectSolid[] }
export const OBJECT_CELL_LIMIT = 100000
const SURFACE_VERTEX_LIMIT = 600000

export function constructionBoxBounds(box: Extract<ConstructionObject, { kind: 'box' }>): ObjectBounds {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(...box.rotation)).elements
  const dimensions = [box.width, box.height, box.depth]
  // Orthogonal transforms have exact 0/±1 coefficients. Remove trig roundoff.
  const half = [0, 1, 2].map(axis => dimensions.reduce((sum, size, local) => sum + Math.abs(Math.round(matrix[local * 4 + axis])) * size / 2, 0))
  return { min: box.position.map((value, axis) => value - half[axis]) as Vec3,
    max: box.position.map((value, axis) => value + half[axis]) as Vec3 }
}

/** Returns each selected leaf once, including when an ancestor is selected too. */
export function constructionLeaves(objects: ConstructionObjects, ids: readonly string[]): Extract<ConstructionObject, { kind: 'box' }>[] {
  const byId = new Map(objects.nodes.map(node => [node.id, node])), leaves = new Map<string, Extract<ConstructionObject, { kind: 'box' }>>()
  const visit = (id: string) => {
    const node = byId.get(id)
    if (!node) return
    if (node.kind === 'box') leaves.set(id, node)
    else node.children.forEach(visit)
  }
  ids.forEach(visit)
  return [...leaves.values()]
}

export function constructionBounds(objects: ConstructionObjects, ids: readonly string[]): ObjectBounds | null {
  const boxes = constructionLeaves(objects, ids).map(constructionBoxBounds)
  if (!boxes.length) return null
  return { min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]))) as Vec3,
    max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]))) as Vec3 }
}

/** Exact coordinate-plane subdivision; no voxel resolution or dimensional rounding.
 * A worker owns evaluation and callers terminate it when its source changes. */
export function evaluateConstructionObjects(input: ConstructionObjects, splitSolids = false): ObjectSurface[] {
  const objects = parseConstructionObjects(input), byId = new Map(objects.nodes.map(node => [node.id, node]))
  let remainingCells = OBJECT_CELL_LIMIT, remainingVertices = SURFACE_VERTEX_LIMIT
  return objects.roots.filter(id => byId.get(id)!.visible).map(id => {
    const boxes = constructionLeaves(objects, [id]).map(box => ({ id: box.id, ...constructionBoxBounds(box) }))
    const planes = [0, 1, 2].map(axis => [...new Set(boxes.flatMap(box => [box.min[axis], box.max[axis]]))].sort((a, b) => a - b))
    const [nx, ny, nz] = planes.map(axis => axis.length - 1), count = nx * ny * nz
    remainingCells -= count
    if (remainingCells < 0) throw new Error('Object preview is too complex. Use fewer boxes or align their boundaries.')
    const boxBounds = new Map(boxes.map(box => [box.id, box]))
    const compile = (nodeId: string): ((point: Vec3) => boolean) => {
      const node = byId.get(nodeId)!
      if (node.kind === 'box') {
        const bounds = boxBounds.get(nodeId)!
        return point => point.every((value, axis) => value > bounds.min[axis] && value < bounds.max[axis])
      }
      const children = node.children.map(compile)
      if (node.operation === 'union') return point => children.some(child => child(point))
      if (node.operation === 'intersect') return point => children.every(child => child(point))
      const cutters = children.slice(1)
      return point => children[0](point) && !cutters.some(child => child(point))
    }
    const contains = compile(id), occupied = new Uint8Array(count)
    const index = (x: number, y: number, z: number) => (x * ny + y) * nz + z
    let volume = 0, occupiedCount = 0
    const first = [Infinity, Infinity, Infinity], last = [-Infinity, -Infinity, -Infinity]
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
      const cell = [x, y, z], lo = cell.map((n, axis) => planes[axis][n]), hi = cell.map((n, axis) => planes[axis][n + 1])
      if (!contains(lo.map((value, axis) => (value + hi[axis]) / 2) as Vec3)) continue
      occupied[index(x, y, z)] = 1
      occupiedCount++
      cell.forEach((value, axis) => { first[axis] = Math.min(first[axis], value); last[axis] = Math.max(last[axis], value) })
      volume += (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2])
      lo.forEach((value, axis) => { min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], hi[axis]) })
    }
    const positions: number[] = []
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
      if (!occupied[index(x, y, z)]) continue
      const cell = [x, y, z]
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const neighbor = [...cell]; neighbor[axis] += sign
        if (neighbor[axis] >= 0 && neighbor[axis] < [nx, ny, nz][axis] && occupied[index(neighbor[0], neighbor[1], neighbor[2])]) continue
        const u = (axis + 1) % 3, v = (axis + 2) % 3
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => {
          const point = [0, 0, 0]
          point[axis] = planes[axis][cell[axis] + (sign > 0 ? 1 : 0)]
          point[u] = planes[u][cell[u] + a]; point[v] = planes[v][cell[v] + b]
          return point
        })
        remainingVertices -= 6
        if (remainingVertices < 0) throw new Error('Object preview has too many surface faces. Simplify the shape.')
        for (const corner of sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) positions.push(...corners[corner].map(value => value / 1000))
      }
    }
    // Count cells, not approximate volumes: even a tiny cavity must prevent cuboid conversion.
    const cuboid = occupiedCount > 0 && occupiedCount === first.reduce((count, value, axis) => count * (last[axis] - value + 1), 1)
    const prism = !cuboid && occupiedCount ? findObjectPrism(planes, occupied) : undefined
    const solids = splitSolids && occupiedCount && !cuboid && !prism ? findObjectSolids(planes, occupied) : undefined
    return { id, solids, positions: new Float32Array(positions), volume, bounds: occupiedCount ? { min, max } : null, cuboid, prism }
  })
}

export function rotateConstructionSelection(objects: ConstructionObjects, ids: readonly string[], axis: 0 | 1 | 2): ConstructionObjects {
  const bounds = constructionBounds(objects, ids)
  if (!bounds) return objects
  const center = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5)
  const turn = new Matrix4().makeRotationAxis(new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0), Math.PI / 2)
  const leaves = new Set(constructionLeaves(objects, ids).map(node => node.id))
  return parseConstructionObjects({ ...objects, nodes: objects.nodes.map(node => {
    if (node.kind !== 'box' || !leaves.has(node.id)) return node
    const position = new Vector3(...node.position).sub(center).applyMatrix4(turn).add(center).toArray() as Vec3
    const rotation = new Euler().setFromRotationMatrix(turn.clone().multiply(new Matrix4().makeRotationFromEuler(new Euler(...node.rotation))))
    return { ...node, position, rotation: [rotation.x, rotation.y, rotation.z].map(value => Math.round(value / (Math.PI / 2)) * Math.PI / 2) }
  }) })
}

export function moveConstructionSelection(objects: ConstructionObjects, ids: readonly string[], delta: Vec3): ConstructionObjects {
  const leaves = new Set(constructionLeaves(objects, ids).map(node => node.id))
  return parseConstructionObjects({ ...objects, nodes: objects.nodes.map(node => node.kind === 'box' && leaves.has(node.id)
    ? { ...node, position: node.position.map((value, axis) => value + delta[axis]) } : node) })
}

/** Resize source bounds on one world axis, preserving each orthogonal box's orientation. */
export function resizeConstructionSelection(objects: ConstructionObjects, ids: readonly string[], axis: 0 | 1 | 2, size: number): ConstructionObjects {
  const bounds = constructionBounds(objects, ids)
  if (!bounds) return objects
  const factor = size / (bounds.max[axis] - bounds.min[axis]), center = (bounds.max[axis] + bounds.min[axis]) / 2
  const leaves = new Set(constructionLeaves(objects, ids).map(node => node.id))
  return parseConstructionObjects({ ...objects, nodes: objects.nodes.map(node => {
    if (node.kind !== 'box' || !leaves.has(node.id)) return node
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...node.rotation)).elements
    const local = [0, 1, 2].find(index => Math.abs(matrix[index * 4 + axis]) > 0.5)!
    const dimension = (['width', 'height', 'depth'] as const)[local]
    return { ...node, [dimension]: node[dimension] * factor,
      position: node.position.map((value, index) => index === axis ? center + (value - center) * factor : value) }
  }) })
}
