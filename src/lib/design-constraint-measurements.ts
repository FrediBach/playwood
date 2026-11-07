import { Euler, Vector3 } from 'three'
import { designConstraintCoordinate, getDesignConstraintBounds, measureDesignConstraint } from './design-constraints'
import type { DesignConstraint, Panel, Vec3 } from './types'

export interface MeasurementLine {
  id: string
  from: Vec3
  to: Vec3
  label: string
  leaders?: [Vec3, Vec3][]
}
const axes = { x: 0, y: 1, z: 2 } as const
const format = (value: number) => `${Number(value.toFixed(1))} mm`

function cutDimensionLine(panel: Panel, dimension: 'width' | 'height'): MeasurementLine {
  const rotation = new Euler(...panel.rotation)
  const transform = (point: Vec3): Vec3 => new Vector3(...point).applyEuler(rotation).add(new Vector3(...panel.position)).toArray() as Vec3
  const local: [Vec3, Vec3] = dimension === 'width'
    ? [[-panel.width / 2, panel.height / 2 + 55, panel.thickness / 2], [panel.width / 2, panel.height / 2 + 55, panel.thickness / 2]]
    : [[panel.width / 2 + 55, -panel.height / 2, panel.thickness / 2], [panel.width / 2 + 55, panel.height / 2, panel.thickness / 2]]
  return { id: panel.id, from: transform(local[0]), to: transform(local[1]), label: `${dimension === 'height' ? 'Cut height' : 'Cut width'} · ${format(panel[dimension])}` }
}

/** Measurement geometry in millimeters, using resolved panels before display transforms. */
export function designConstraintMeasurements(constraint: DesignConstraint, panels: Panel[]) {
  const ids = 'panelId' in constraint ? [constraint.panelId] : constraint.panelIds
  const [a, b] = ids.map(id => panels.find(panel => panel.id === id))
  if (!a || (ids.length > 1 && !b)) return null
  const result = measureDesignConstraint(constraint, panels)
  if (result.issue) return null
  const boundsA = getDesignConstraintBounds(a)
  const lines: MeasurementLine[] = []
  if (constraint.kind === 'dimension' || constraint.kind === 'equal-dimension') {
    lines.push(cutDimensionLine(a, constraint.dimension))
    if (constraint.kind === 'equal-dimension' && b) lines.push(cutDimensionLine(b, constraint.secondDimension ?? constraint.dimension))
  } else if (constraint.kind === 'floor') {
    const height = designConstraintCoordinate(a, constraint.reference)
    const anchor: Vec3 = [boundsA.max[0], height, boundsA.max[2]]
    const from: Vec3 = [boundsA.max[0] + 75, 0, boundsA.max[2] + 35]
    const to: Vec3 = [from[0], height, from[2]]
    lines.push({ id: constraint.id, from, to, label: `Floor height · ${format(height)}`, leaders: [[anchor, to]] })
  } else if (constraint.kind === 'level' && b) {
    const boundsB = getDesignConstraintBounds(b)
    const first: Vec3 = [a.position[0], designConstraintCoordinate(a, constraint.references[0]), boundsA.max[2]]
    const second: Vec3 = [b.position[0], designConstraintCoordinate(b, constraint.references[1]), boundsB.max[2]]
    const z = Math.max(boundsA.max[2], boundsB.max[2]) + 60
    const from: Vec3 = [first[0], first[1], z]
    const to: Vec3 = [second[0], second[1], z]
    lines.push({ id: constraint.id, from, to, label: result.violation ? `Level difference · ${format(Math.abs(result.actual))}` : `Same level · ${format(first[1])}`, leaders: [[first, from], [second, to]] })
  } else if (constraint.kind === 'opening-ratio') {
    for (const start of [0, 2]) {
      const measured = designConstraintMeasurements({ id: `${constraint.id}-${start}`, enabled: constraint.enabled, kind: 'gap', panelIds: [constraint.panelIds[start], constraint.panelIds[start + 1]], axis: constraint.axis, relation: 'minimum', value: 0 }, panels)
      if (measured) lines.push(...measured.lines.map(line => ({ ...line, label: `Opening ${start === 0 ? '1' : '2'} · ${line.label}` })))
    }
  } else if (constraint.kind === 'gap' && b) {
    const boundsB = getDesignConstraintBounds(b)
    const axis = axes[constraint.axis]
    const from: Vec3 = [Math.max(boundsA.max[0], boundsB.max[0]) + 65, Math.max(boundsA.max[1], boundsB.max[1]) + 65, Math.max(boundsA.max[2], boundsB.max[2]) + 65]
    const to: Vec3 = [...from]
    from[axis] = boundsA.max[axis]
    to[axis] = boundsB.min[axis]
    const first: Vec3 = [...boundsA.max]
    const second: Vec3 = [...boundsB.max]
    second[axis] = boundsB.min[axis]
    lines.push({ id: constraint.id, from, to, label: `${constraint.axis.toUpperCase()} gap · ${format(result.actual)}`, leaders: [[first, from], [second, to]] })
  }
  return { lines, violation: result.violation }
}
