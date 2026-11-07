import type { ObjectSurface } from './object-geometry'
import type { ConstructionObjects, Vec3 } from './types'

export type ObjectPreviewSurface = Pick<ObjectSurface, 'id' | 'positions' | 'volume' | 'warningPositions'>

/** Reuse only shapes proven identical up to translation; never display stale Boolean results. */
export function reuseObjectPreview(source: ConstructionObjects, current: ConstructionObjects, surfaces: ObjectPreviewSurface[]): ObjectPreviewSurface[] {
  const before = new Map(source.nodes.map(node => [node.id, node]))
  const after = new Map(current.nodes.map(node => [node.id, node]))
  const roots = new Set(current.roots)
  return surfaces.flatMap(surface => {
    if (!roots.has(surface.id) || !(after.get(surface.id)?.visible || after.get(surface.id)?.wireframe)) return []
    let delta: Vec3 | undefined
    const matches = (id: string): boolean => {
      const a = before.get(id), b = after.get(id)
      if (!a || !b || a.kind !== b.kind) return false
      if (a.kind === 'box' && b.kind === 'box') {
        if (a.width !== b.width || a.height !== b.height || a.depth !== b.depth || a.rotation.some((value, axis) => value !== b.rotation[axis])) return false
        const offset = b.position.map((value, axis) => value - a.position[axis]) as Vec3
        delta ??= offset
        return offset.every((value, axis) => Math.abs(value - delta![axis]) < 1e-8)
      }
      return a.kind === 'boolean' && b.kind === 'boolean' && a.operation === b.operation &&
        a.children.length === b.children.length && a.children.every((child, index) => child === b.children[index] && matches(child))
    }
    if (!matches(surface.id) || !delta) return []
    if (delta.every(value => value === 0)) return [surface]
    const offset = delta
    return [{ id: surface.id, volume: surface.volume, warningPositions: surface.warningPositions?.map((value, index) => value + offset[index % 3] / 1000), positions: surface.positions.map((value, index) => value + offset[index % 3] / 1000) }]
  })
}
