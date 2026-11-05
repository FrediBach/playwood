import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { ObjectNotches } from './object-notches'
import type { Project, Vec3 } from './types'

/** Exact quarter-turn frames for a bounded fallback search. No resampling. */
export function* shellOrientations(source: ObjectNotches) {
  const sizes = source.planes.map(p => p.length - 1)
  for (const order of [[2, 1, 0], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [0, 1, 2]]) {
    for (const sx of [-1, 1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const signs = [sx, sy, sz]
      const axes = order.map((axis, i) => new Vector3().setComponent(axis, signs[i]))
      const matrix = new Matrix4().makeBasis(axes[0], axes[1], axes[2])
      if (matrix.determinant() < 0 || order.every((axis, i) => axis === i && signs[i] === 1)) continue
      const extent = order.map(axis => source.bounds.max[axis] - source.bounds.min[axis])
      const planes = order.map((axis, i) => signs[i] > 0
        ? source.planes[axis].map(v => v - source.bounds.min[axis])
        : source.planes[axis].map(v => source.bounds.max[axis] - v).reverse())
      const dimensions = order.map(axis => sizes[axis]), occupied = new Uint8Array(source.occupied.length)
      for (let x = 0; x < dimensions[0]; x++) for (let y = 0; y < dimensions[1]; y++) for (let z = 0; z < dimensions[2]; z++) {
        const cell = [0, 0, 0], coordinates = [x, y, z]
        coordinates.forEach((value, i) => { cell[order[i]] = signs[i] > 0 ? value : dimensions[i] - value - 1 })
        occupied[(x * dimensions[1] + y) * dimensions[2] + z] = source.occupied[(cell[0] * sizes[1] + cell[1]) * sizes[2] + cell[2]]
      }
      const turn = new Quaternion().setFromRotationMatrix(matrix)
      const restore = (project: Project): Project => ({ ...project, panels: project.panels.map(panel => {
        const position: Vec3 = [0, 0, 0]
        order.forEach((axis, i) => { position[axis] = source.bounds.min[axis] + (signs[i] > 0 ? panel.position[i] : extent[i] - panel.position[i]) })
        const rotation = new Euler().setFromQuaternion(turn.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
        return { ...panel, position, rotation: [rotation.x, rotation.y, rotation.z] }
      }) })
      yield { shape: { planes, occupied, bounds: { min: [0, 0, 0], max: extent } } as ObjectNotches, restore }
    }
  }
}
