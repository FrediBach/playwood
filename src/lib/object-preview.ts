import { constructionBoxBounds } from './object-geometry'
import type { ObjectSurface } from './object-geometry'
import type { ConstructionObjects, Vec3 } from './types'

export type ObjectPreviewSurface = Pick<ObjectSurface, 'id' | 'positions' | 'volume' | 'warningPositions'> & { warningsPending?: boolean }

/** Reuse only shapes proven identical under a common positive axis scale and translation; never display stale Boolean results. */
export function reuseObjectPreview(source: ConstructionObjects, current: ConstructionObjects, surfaces: ObjectPreviewSurface[]): ObjectPreviewSurface[] {
  const before = new Map(source.nodes.map(node => [node.id, node]))
  const after = new Map(current.nodes.map(node => [node.id, node]))
  const roots = new Set(current.roots)
  return surfaces.flatMap(surface => {
    if (!roots.has(surface.id) || !(after.get(surface.id)?.visible || after.get(surface.id)?.wireframe)) return []
    let delta: Vec3 | undefined, scale: Vec3 | undefined
    const matches = (id: string): boolean => {
      const a = before.get(id), b = after.get(id)
      if (!a || !b || a.kind !== b.kind) return false
      if (a.kind === 'box' && b.kind === 'box') {
        if (a.rotation.some((value, axis) => value !== b.rotation[axis])) return false
        const oldBounds = constructionBoxBounds(a), newBounds = constructionBoxBounds(b)
        scale ??= oldBounds.min.map((value, axis) => (newBounds.max[axis] - newBounds.min[axis]) / (oldBounds.max[axis] - value)) as Vec3
        delta ??= oldBounds.min.map((value, axis) => newBounds.min[axis] - value * scale![axis]) as Vec3
        return scale.every(value => Number.isFinite(value) && value > 0) && oldBounds.min.every((value, axis) =>
          Math.abs(value * scale![axis] + delta![axis] - newBounds.min[axis]) < 1e-8 &&
          Math.abs(oldBounds.max[axis] * scale![axis] + delta![axis] - newBounds.max[axis]) < 1e-8)
      }
      return a.kind === 'boolean' && b.kind === 'boolean' && a.operation === b.operation &&
        a.children.length === b.children.length && a.children.every((child, index) => child === b.children[index] && matches(child))
    }
    if (!matches(surface.id) || !delta || !scale) return []
    const scaled = scale.some(value => Math.abs(value - 1) > 1e-12)
    if (!scaled && delta.every(value => value === 0)) return [surface]
    const offset = delta, factors = scale
    const transform = (positions: Float32Array) => positions.map((value, index) => value * factors[index % 3] + offset[index % 3] / 1000)
    return [{ id: surface.id, volume: surface.volume * factors[0] * factors[1] * factors[2],
      // Clearance thresholds are absolute millimeters; scaled warnings need worker evaluation.
      warningsPending: scaled || surface.warningsPending,
      warningPositions: scaled ? undefined : surface.warningPositions && transform(surface.warningPositions),
      positions: transform(surface.positions) }]
  })
}
