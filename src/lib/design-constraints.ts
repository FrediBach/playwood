import { Euler, Quaternion, Vector3 } from 'three'
import type { ConstraintReference, ConstraintRequirement, DesignConstraint, Panel, Vec3 } from './types'

export const DESIGN_CONSTRAINT_TOLERANCE = 0.1
export const MAX_DESIGN_CONSTRAINTS = 1000
const axes = ['x', 'y', 'z'] as const
const basis = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const format = (value: number) => `${Number(value.toFixed(2))} mm`

export interface DesignConstraintEvaluation {
  constraint: DesignConstraint
  actual: number
  /** Closest permitted measurement; equals actual while inside the limits. */
  target: number
  /** Positive error in millimeters; zero within the shared numerical tolerance. */
  violation: number
  issue?: string
}

export function designConstraintPanelIds(constraint: DesignConstraint): string[] {
  return 'panelId' in constraint ? [constraint.panelId] : [...constraint.panelIds]
}

/** Inclusive limits in millimeters; missing limits leave that direction free. */
export function designConstraintLimits(constraint: DesignConstraint): { min?: number; max?: number } {
  if (constraint.kind === 'equal-dimension' || constraint.kind === 'level') return { min: 0, max: 0 }
  switch (constraint.relation) {
    case 'minimum': return { min: constraint.value }
    case 'maximum': return { max: constraint.value }
    case 'range': return { min: constraint.min, max: constraint.max }
    default: return { min: constraint.value, max: constraint.value }
  }
}

export function describeDesignConstraintRequirement(constraint: DesignConstraint): string {
  const { min, max } = designConstraintLimits(constraint)
  if (min === max) return `exactly ${format(min!)}`
  if (max === undefined) return `at least ${format(min!)}`
  if (min === undefined) return `at most ${format(max)}`
  return `between ${format(min)} and ${format(max)}`
}

/** World extents of rectangular stock, including thickness. Input must be resolved. */
export function getDesignConstraintBounds(panel: Panel): { min: Vec3; max: Vec3 } {
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const lengths = [panel.width, panel.height, panel.thickness]
  const half: Vec3 = [0, 0, 0]
  basis.forEach((axis, index) => {
    const direction = axis.clone().applyQuaternion(rotation)
    axes.forEach((name, coordinate) => { half[coordinate] += Math.abs(direction[name]) * lengths[index] / 2 })
  })
  return { min: panel.position.map((value, axis) => value - half[axis]) as Vec3,
    max: panel.position.map((value, axis) => value + half[axis]) as Vec3 }
}

export function designConstraintCoordinate(panel: Panel, reference: ConstraintReference, axis: 'x' | 'y' | 'z' = 'y'): number {
  const index = axes.indexOf(axis)
  return reference === 'center' ? panel.position[index] : getDesignConstraintBounds(panel)[reference][index]
}

export function designConstraintGeometryIssue(panel: Panel): string | undefined {
  if (panel.customOutline) return `${panel.name}: position and gap rules currently require a rectangular outline.`
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  if (basis.some(axis => {
    const direction = axis.clone().applyQuaternion(rotation)
    return !axes.some(name => Math.abs(direction[name]) > 1 - 1e-8)
  })) return `${panel.name}: position and gap rules currently require panels aligned with the world axes.`
  return undefined
}

export function measureDesignConstraint(constraint: DesignConstraint, resolvedPanels: readonly Panel[]): DesignConstraintEvaluation {
  const panels = designConstraintPanelIds(constraint).map(id => resolvedPanels.find(panel => panel.id === id))
  const { min, max } = designConstraintLimits(constraint)
  const issue = panels.some(panel => !panel) ? 'This rule refers to a missing panel.'
    : constraint.kind === 'dimension' || constraint.kind === 'equal-dimension' ? undefined
      : panels.map(panel => designConstraintGeometryIssue(panel!)).find(Boolean)
  if (issue) return { constraint, actual: NaN, target: min ?? max ?? 0, violation: Infinity, issue }
  const [a, b] = panels as Panel[]
  const actual = constraint.kind === 'floor' ? designConstraintCoordinate(a, constraint.reference)
    : constraint.kind === 'dimension' ? a[constraint.dimension]
      : constraint.kind === 'equal-dimension' ? b[constraint.dimension] - a[constraint.dimension]
        : constraint.kind === 'level' ? designConstraintCoordinate(b, constraint.references[1]) - designConstraintCoordinate(a, constraint.references[0])
          : designConstraintCoordinate(b, 'min', constraint.axis) - designConstraintCoordinate(a, 'max', constraint.axis)
  const target = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, actual))
  const error = Math.abs(actual - target)
  return { constraint, actual, target, violation: error <= DESIGN_CONSTRAINT_TOLERANCE ? 0 : error }
}

export function evaluateDesignConstraints(constraints: readonly DesignConstraint[] | undefined, resolvedPanels: readonly Panel[]): DesignConstraintEvaluation[] {
  return (constraints ?? []).map(constraint => measureDesignConstraint(constraint, resolvedPanels))
}

export function describeDesignConstraint(constraint: DesignConstraint, panels: readonly Panel[]): string {
  const name = (id: string) => panels.find(panel => panel.id === id)?.name ?? 'Missing panel'
  const reference = (value: ConstraintReference) => value === 'min' ? 'bottom' : value === 'max' ? 'top' : 'center'
  switch (constraint.kind) {
    case 'floor': return `${name(constraint.panelId)} ${reference(constraint.reference)}: ${describeDesignConstraintRequirement(constraint)} above floor`
    case 'dimension': return `${name(constraint.panelId)} ${constraint.dimension}: ${describeDesignConstraintRequirement(constraint)}`
    case 'equal-dimension': return `${name(constraint.panelIds[0])} and ${name(constraint.panelIds[1])}: equal ${constraint.dimension}`
    case 'level': return `${name(constraint.panelIds[0])} ${reference(constraint.references[0])} level with ${name(constraint.panelIds[1])} ${reference(constraint.references[1])}`
    case 'gap': return `${name(constraint.panelIds[0])} → ${name(constraint.panelIds[1])}: ${describeDesignConstraintRequirement(constraint)} along ${constraint.axis.toUpperCase()}`
  }
}

/** Validate serialized requirements without changing geometry or discarding rules. */
export function parseDesignConstraints(raw: unknown, panels: readonly Panel[]): DesignConstraint[] {
  if (!Array.isArray(raw) || raw.length > MAX_DESIGN_CONSTRAINTS) throw new Error(`Projects support up to ${MAX_DESIGN_CONSTRAINTS} design rules.`)
  const panelIds = new Set(panels.map(panel => panel.id)), ids = new Set<string>()
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
  const reference = (value: unknown): ConstraintReference => {
    if (value !== 'min' && value !== 'center' && value !== 'max') throw new Error('Invalid design rule reference.')
    return value
  }
  const panel = (value: unknown): string => {
    if (typeof value !== 'string' || !panelIds.has(value)) throw new Error('A design rule refers to a missing panel.')
    return value
  }
  const pair = (value: unknown): [string, string] => {
    if (!Array.isArray(value) || value.length !== 2 || value[0] === value[1]) throw new Error('A design rule needs two different panels.')
    return [panel(value[0]), panel(value[1])]
  }
  const dimension = (value: unknown): 'width' | 'height' => {
    if (value !== 'width' && value !== 'height') throw new Error('Invalid design rule dimension.')
    return value
  }
  const amount = (value: unknown, min = 0, max = 200000): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Design rule values must be between ${min} and ${max} mm.`)
    return value
  }
  const requirement = (value: Record<string, unknown>, min: number, max: number): ConstraintRequirement => {
    if (value.relation === 'range') {
      if ('value' in value) throw new Error('A range rule needs minimum and maximum values, without an exact value.')
      const lower = amount(value.min, min, max), upper = amount(value.max, min, max)
      if (lower > upper) throw new Error('The minimum constraint value must not exceed its maximum.')
      return { relation: 'range', min: lower, max: upper }
    }
    if ('min' in value || 'max' in value) throw new Error('Minimum and maximum values require a range rule.')
    if (value.relation !== undefined && value.relation !== 'exact' && value.relation !== 'minimum' && value.relation !== 'maximum') throw new Error('Invalid design rule relation.')
    const target = amount(value.value, min, max)
    return value.relation === undefined ? { value: target } : { relation: value.relation, value: target }
  }
  const equality = (value: Record<string, unknown>) => {
    if (['relation', 'value', 'min', 'max'].some(field => field in value)) throw new Error('Matching panel dimensions and levels use equality, without numeric limits.')
  }
  return raw.map(value => {
    if (!record(value) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200 || ids.has(value.id)) throw new Error('Design rule IDs must be unique and nonempty.')
    if (typeof value.enabled !== 'boolean') throw new Error('Invalid design rule enabled state.')
    ids.add(value.id)
    const base = { id: value.id, enabled: value.enabled }
    switch (value.kind) {
      case 'floor': return { ...base, kind: 'floor', panelId: panel(value.panelId), reference: reference(value.reference), ...requirement(value, 0, 100000) }
      case 'dimension': return { ...base, kind: 'dimension', panelId: panel(value.panelId), dimension: dimension(value.dimension), ...requirement(value, 40, 4000) }
      case 'equal-dimension': {
        equality(value)
        return { ...base, kind: 'equal-dimension', panelIds: pair(value.panelIds), dimension: dimension(value.dimension) }
      }
      case 'level': {
        equality(value)
        if (!Array.isArray(value.references) || value.references.length !== 2) throw new Error('A level rule needs two measurement references.')
        return { ...base, kind: 'level', panelIds: pair(value.panelIds), references: [reference(value.references[0]), reference(value.references[1])] }
      }
      case 'gap': {
        if (value.axis !== 'x' && value.axis !== 'y' && value.axis !== 'z') throw new Error('Invalid design rule axis.')
        if (value.relation === undefined) throw new Error('Invalid design rule relation.')
        const limits = requirement(value, 0, 200000)
        return { ...base, kind: 'gap', panelIds: pair(value.panelIds), axis: value.axis,
          ...(limits.relation === 'range' ? limits : { relation: limits.relation ?? 'exact', value: limits.value }) }
      }
      default: throw new Error('Unsupported design rule kind.')
    }
  })
}

/** Copy self-contained requirements. Absolute floor placement never follows a copy. */
export function copyDesignConstraints(constraints: readonly DesignConstraint[] | undefined, panelIds: ReadonlyMap<string, string>): DesignConstraint[] {
  return (constraints ?? []).flatMap(constraint => {
    if (constraint.kind === 'floor' || designConstraintPanelIds(constraint).some(id => !panelIds.has(id))) return []
    const id = crypto.randomUUID()
    return [{ ...constraint, id, ...('panelId' in constraint ? { panelId: panelIds.get(constraint.panelId)! }
      : { panelIds: constraint.panelIds.map(panelId => panelIds.get(panelId)!) as [string, string] }) } as DesignConstraint]
  })
}
