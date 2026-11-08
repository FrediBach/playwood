import { Euler, Vector3 } from 'three'
import { designConstraintGeometryIssue, getDesignConstraintBounds } from './design-constraints'
import type { DesignConstraint, Panel } from './types'

/** Infer adjacent clear openings from three parallel, overlapping boundary panels. */
export function equalOpeningSelection(panels: readonly Panel[], selectedIds: readonly string[], id?: string): Extract<DesignConstraint, { kind: 'opening-ratio' }> | null {
  const ids = [...new Set(selectedIds)]
  if (ids.length !== 3) return null
  const selected = ids.map(id => panels.find(panel => panel.id === id))
  if (selected.some(panel => !panel || designConstraintGeometryIssue(panel))) return null
  const boundaries = selected as Panel[]
  const normals = boundaries.map(panel => new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)))
  const axisIndex = [0, 1, 2].find(axis => normals.every(normal => Math.abs(normal.getComponent(axis)) > .99999))
  if (axisIndex === undefined) return null
  const bounds = boundaries.map(getDesignConstraintBounds)
  if ([0, 1, 2].some(axis => axis !== axisIndex
    && Math.min(...bounds.map(bound => bound.max[axis])) - Math.max(...bounds.map(bound => bound.min[axis])) <= .001)) return null
  const ordered = [...boundaries].sort((a, b) => a.position[axisIndex] - b.position[axisIndex])
  for (let index = 1; index < ordered.length; index++) {
    if (getDesignConstraintBounds(ordered[index]).min[axisIndex] - getDesignConstraintBounds(ordered[index - 1]).max[axisIndex] < -.001) return null
  }
  return { id: id ?? crypto.randomUUID(), enabled: true, kind: 'opening-ratio', axis: (['x', 'y', 'z'] as const)[axisIndex], ratio: 1,
    panelIds: [ordered[0].id, ordered[1].id, ordered[1].id, ordered[2].id] }
}
