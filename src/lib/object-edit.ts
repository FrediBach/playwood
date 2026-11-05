import { constructionBounds, constructionBoxBounds, constructionLeaves, moveConstructionSelection, resizeConstructionSelection } from './object-geometry'
import { panelSnapPoints, snapDistance, type SnapSettings } from './preview-snap'
import type { PreviewResizeHandle } from './preview-resize'
import type { ConstructionObjects, Panel, Vec3 } from './types'

export type ObjectResizeEdge = { axis: 0 | 1 | 2; side: -1 | 1 }
export interface ObjectResizeHandle extends PreviewResizeHandle, ObjectResizeEdge {}

/** Source-volume edges, including selected cutters, are distinct from Boolean result faces. */
export function objectResizeHandles(objects: ConstructionObjects, ids: readonly string[]): ObjectResizeHandle[] {
  const bounds = constructionBounds(objects, ids)
  if (!bounds) return []
  return ([0, 1, 2] as const).flatMap(axis => ([-1, 1] as const).map(side => ({
    id: `object-${axis}-${side}`, axis, side, label: `Object ${side > 0 ? '+' : '−'}${['X', 'Y', 'Z'][axis]} edge`,
    position: bounds.min.map((value, i) => i === axis ? (side > 0 ? bounds.max[i] : value) : (value + bounds.max[i]) / 2) as Vec3,
    direction: [0, 1, 2].map(i => i === axis ? side : 0) as Vec3,
    sizes: [{ label: ['Width', 'Height', 'Depth'][axis], value: bounds.max[axis] - bounds.min[axis] }],
  })))
}

export function objectSnapTargets(objects: ConstructionObjects, ids: readonly string[], panels: readonly Panel[]): Vec3[] {
  const excluded = new Set(constructionLeaves(objects, ids).map(node => node.id))
  const nodes = new Map(objects.nodes.map(node => [node.id, node]))
  const visibleRoots = objects.roots.filter(id => nodes.get(id)?.visible)
  return [...constructionLeaves(objects, visibleRoots).filter(box => !excluded.has(box.id)).flatMap(box => {
    const bounds = constructionBoxBounds(box)
    return [bounds.min, bounds.max]
  }), ...panels.filter(panel => panel.visible).flatMap(panelSnapPoints)]
}

/** Snap moving source boundaries; keyboard tolerance avoids trapping a selection at its last snap. */
export function snapObjectDelta(objects: ConstructionObjects, ids: readonly string[], panels: readonly Panel[], delta: Vec3, settings: SnapSettings, keyboard = false): Vec3 {
  const sources = constructionLeaves(objects, ids).flatMap(box => { const bounds = constructionBoxBounds(box); return [bounds.min, bounds.max] })
  const targets = objectSnapTargets(objects, ids, panels)
  return delta.map((amount, axis) => {
    if (Math.abs(amount) < 1e-8) return amount
    const options = keyboard ? { ...settings, tolerance: Math.min(settings.tolerance, Math.abs(amount) * 0.45) } : settings
    const direction = [0, 0, 0] as Vec3; direction[axis] = 1
    let result = amount, best = Infinity
    for (const source of sources) {
      const candidate = snapDistance(source, direction, amount, targets, options), error = Math.abs(candidate - amount)
      const coordinate = source[axis] + amount
      const exact = settings.grid && Math.abs(coordinate / settings.spacing - Math.round(coordinate / settings.spacing)) < 1e-8
        || settings.geometry && targets.some(target => Math.abs(target[axis] - coordinate) < 1e-8)
      if ((error > 1e-8 || exact) && error < best) { result = candidate; best = error }
    }
    return result
  }) as Vec3
}

/** Scale selected leaves while holding the opposite source-bound face fixed. */
export function resizeObjectEdge(objects: ConstructionObjects, ids: readonly string[], edge: ObjectResizeEdge, distance: number): ConstructionObjects {
  const bounds = constructionBounds(objects, ids)
  if (!bounds || !Number.isFinite(distance)) throw new Error('Select an object with finite dimensions to resize.')
  const size = bounds.max[edge.axis] - bounds.min[edge.axis] + distance
  if (size <= 0) throw new Error('Object dimensions must remain positive.')
  const resized = resizeConstructionSelection(objects, ids, edge.axis, size)
  return moveConstructionSelection(resized, ids, [0, 1, 2].map(axis => axis === edge.axis ? edge.side * distance / 2 : 0) as Vec3)
}

export function previewObjectResize(objects: ConstructionObjects, ids: readonly string[], panels: readonly Panel[], edge: ObjectResizeEdge, distance: number, settings: SnapSettings, keyboard = false) {
  const handle = objectResizeHandles(objects, ids).find(handle => handle.axis === edge.axis && handle.side === edge.side)
  if (!handle) throw new Error('This object edge no longer exists.')
  const options = keyboard ? { ...settings, tolerance: Math.min(settings.tolerance, Math.abs(distance) * 0.45) } : settings
  const snapped = snapDistance(handle.position, handle.direction, distance, objectSnapTargets(objects, ids, panels), options)
  return { objects: resizeObjectEdge(objects, ids, edge, snapped), distance: snapped }
}
