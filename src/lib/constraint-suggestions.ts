import { Euler, Quaternion, Vector3 } from 'three'
import { getAssemblyInstance, isPanelConnectedToAssembly } from './assemblies'
import { setDesignConstraint, setPanelDimensionLocked } from './design-constraint-commands'
import { DESIGN_CONSTRAINT_TOLERANCE, designConstraintCoordinate, designConstraintGeometryIssue, designConstraintLimits,
  designConstraintPanelIds, getDesignConstraintBounds, isPanelDimensionLocked } from './design-constraints'
import { resolvePanels } from './model'
import { distributePanels } from './panel-distribution'
import type { ConstraintReference, DesignConstraint, Panel, Project } from './types'

/**
 * A complete, prefilled rule set for one menu click. Values come from the
 * current resolved geometry; rule IDs are assigned when the suggestion is applied.
 */
export interface ConstraintSuggestion {
  /** Stable within one selection, independent of measured values. */
  id: string
  label: string
  rules: DesignConstraint[]
  /** True when applying the rules also changes geometry. */
  adjusts: boolean
  anchorPanelId?: string
  /** Lock suggestions reuse paused exact rules through the lock command. */
  lock?: { dimension: 'width' | 'height'; panelIds: string[] }
  /** Equal-spacing suggestions first move inner panels with the distribution command. */
  distributeIds?: string[]
}

const TOLERANCE = DESIGN_CONSTRAINT_TOLERANCE
const axes = ['x', 'y', 'z'] as const
const axisNames = { x: 'side-to-side', y: 'vertical', z: 'front-to-back' } as const
const round = (value: number) => Math.round(value * 100) / 100
const format = (value: number) => `${Number(value.toFixed(1))} mm`
const rule = (value: Record<string, unknown>) => ({ id: '', enabled: true, ...value }) as DesignConstraint
const sameValue = (values: readonly number[]) => Math.max(...values) - Math.min(...values) <= TOLERANCE

function localAxis(panel: Panel, dimension: 'width' | 'height') {
  return new Vector3(dimension === 'width' ? 1 : 0, dimension === 'height' ? 1 : 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation)))
}

/** Value-independent identities, including the reversed form of symmetric relationships. */
function signatures(constraint: DesignConstraint): string[] {
  const ids = designConstraintPanelIds(constraint)
  const limits = designConstraintLimits(constraint)
  const bounds = [limits.min, limits.max].map(value => value === undefined ? '' : round(value)).join(':')
  switch (constraint.kind) {
    case 'floor': return [`floor/${ids[0]}/${constraint.reference}/${bounds}`]
    case 'dimension': return [`dimension/${ids[0]}/${constraint.dimension}/${bounds}`]
    case 'position': return [`position/${ids[0]}/${constraint.axis}/${constraint.reference}/${bounds}`]
    case 'gap': return [`gap/${ids.join('/')}/${constraint.axis}/${bounds}`]
    case 'setback': return [`setback/${ids.join('/')}/${constraint.axis}/${constraint.references.join('/')}/${bounds}`]
    case 'equal-dimension': {
      const second = constraint.secondDimension ?? constraint.dimension
      return [`equal/${ids[0]}/${constraint.dimension}/${ids[1]}/${second}`, `equal/${ids[1]}/${second}/${ids[0]}/${constraint.dimension}`]
    }
    case 'level': return [`level/${ids[0]}/${constraint.references[0]}/${ids[1]}/${constraint.references[1]}`, `level/${ids[1]}/${constraint.references[1]}/${ids[0]}/${constraint.references[0]}`]
    case 'opening-ratio': return [`opening/${ids.join('/')}/${constraint.axis}/${constraint.ratio}`]
  }
}

/** Ordered parallel boundaries whose common normal is a world axis, with nonnegative clear gaps. */
function spacing(panels: readonly Panel[]) {
  const normals = panels.map(panel => new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)))
  const axis = [0, 1, 2].find(index => normals.every(normal => Math.abs(normal.getComponent(index)) > 1 - 1e-6))
  if (axis === undefined) return undefined
  const ordered = [...panels].sort((a, b) => a.position[axis] - b.position[axis])
  const gaps = ordered.slice(1).map((panel, index) => getDesignConstraintBounds(panel).min[axis] - getDesignConstraintBounds(ordered[index]).max[axis])
  if (gaps.some(gap => gap < -TOLERANCE)) return undefined
  return { axis: axes[axis], ordered, gaps }
}

/**
 * One-click design rules inferred from the selection. Only rules whose values can be
 * taken from current geometry (or from the primary selected panel) are offered, and
 * rules that already exist are omitted. Requires resolved world placement.
 */
export function suggestDesignConstraints(project: Project, selectedIds: readonly string[]): ConstraintSuggestion[] {
  const ids = [...new Set(selectedIds)]
  if (!ids.length || ids.some(id => getAssemblyInstance(project, id) || isPanelConnectedToAssembly(project, id))) return []
  const resolved = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  const panels = ids.map(id => resolved.get(id))
  if (panels.some(panel => !panel)) return []
  const selected = panels as Panel[]
  const primary = selected[0]
  const aligned = selected.every(panel => !designConstraintGeometryIssue(panel))
  const existing = new Set((project.constraints ?? []).filter(item => item.enabled).flatMap(signatures))
  const suggestions: ConstraintSuggestion[] = []
  const offer = (suggestion: Omit<ConstraintSuggestion, 'adjusts'> & { adjusts?: boolean }) => {
    const rules = suggestion.rules.filter(item => !signatures(item).some(signature => existing.has(signature)))
    if (rules.length) suggestions.push({ adjusts: false, ...suggestion, rules })
  }
  const bottom = (panel: Panel) => designConstraintCoordinate(panel, 'min', 'y')

  if (aligned) {
    const grounded = selected.filter(panel => Math.abs(bottom(panel)) <= TOLERANCE)
    if (grounded.length) offer({ id: 'ground', label: grounded.length === selected.length ? 'Stick to ground' : `Stick ${grounded.length} grounded panels to ground`,
      rules: grounded.map(panel => rule({ kind: 'floor', panelId: panel.id, reference: 'min', relation: 'exact', value: 0 })) })
    else if (selected.length === 1 && bottom(primary) > TOLERANCE) offer({ id: 'floor-height', label: `Keep bottom ${format(bottom(primary))} above floor`,
      rules: [rule({ kind: 'floor', panelId: primary.id, reference: 'min', relation: 'exact', value: round(bottom(primary)) })] })
  }

  for (const dimension of ['width', 'height'] as const) {
    const unlocked = selected.filter(panel => !isPanelDimensionLocked(project.constraints, panel.id, dimension) && panel[dimension] >= 40 && panel[dimension] <= 4000)
    if (!unlocked.length) continue
    const values = unlocked.map(panel => panel[dimension])
    const plural = selected.length > 1 ? `${dimension}s` : dimension
    suggestions.push({ id: `lock-${dimension}`, adjusts: false,
      label: sameValue(values) ? `Lock ${plural} at ${format(values[0])}` : `Lock ${plural} at current sizes`,
      rules: unlocked.map(panel => rule({ kind: 'dimension', panelId: panel.id, dimension, relation: 'exact', value: panel[dimension] })),
      lock: { dimension, panelIds: unlocked.map(panel => panel.id) } })
  }

  if (selected.length > 1) {
    for (const dimension of ['width', 'height'] as const) {
      // Equal cuts are design intent only when they run the same way in the room;
      // otherwise matching values are usually coincidental.
      const direction = localAxis(primary, dimension)
      if (selected.some(panel => Math.abs(localAxis(panel, dimension).dot(direction)) < 1 - 1e-6)) continue
      const equal = sameValue(selected.map(panel => panel[dimension]))
      offer({ id: `equal-${dimension}`, adjusts: !equal, anchorPanelId: equal ? undefined : primary.id,
        label: equal ? `Keep ${dimension}s equal` : `Match ${dimension}s to ${primary.name}`,
        rules: selected.slice(1).map(panel => rule({ kind: 'equal-dimension', panelIds: [primary.id, panel.id], dimension })) })
    }
  }

  if (selected.length > 1 && aligned) {
    const allGrounded = selected.every(panel => Math.abs(bottom(panel)) <= TOLERANCE)
    const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...primary.rotation))
    const parallel = selected.every(panel => Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation)).dot(normal)) > 1 - 1e-6)
    for (const [reference, name] of [['min', 'bottoms'], ['max', 'tops']] as [ConstraintReference, string][]) {
      if (reference === 'min' && allGrounded) continue
      const level = sameValue(selected.map(panel => designConstraintCoordinate(panel, reference)))
      // Moving mixed orientations (a top onto its legs' bottoms) is rarely intended.
      if (!level && !parallel) continue
      offer({ id: `level-${reference}`, adjusts: !level, anchorPanelId: level ? undefined : primary.id,
        label: level ? `Keep ${name} level` : `Align ${name} with ${primary.name}`,
        rules: selected.slice(1).map(panel => rule({ kind: 'level', panelIds: [primary.id, panel.id], references: [reference, reference] })) })
    }
  }

  if (selected.length === 2 && aligned) {
    const options = axes.map((axis, index) => {
      const [a, b] = [...selected].sort((first, second) => first.position[index] - second.position[index])
      return { axis, a, b, gap: getDesignConstraintBounds(b).min[index] - getDesignConstraintBounds(a).max[index] }
    }).filter(option => option.gap > TOLERANCE)
    const widest = options.sort((first, second) => second.gap - first.gap)[0]
    if (widest) offer({ id: 'gap', label: `Keep ${format(widest.gap)} ${axisNames[widest.axis]} gap`,
      rules: [rule({ kind: 'gap', panelIds: [widest.a.id, widest.b.id], axis: widest.axis, relation: 'exact', value: round(widest.gap) })] })
  }

  if (selected.length > 2 && aligned) {
    const layout = spacing(selected)
    if (layout) {
      const equal = sameValue(layout.gaps)
      const { ordered } = layout
      offer({ id: 'distribute', adjusts: !equal, distributeIds: equal ? undefined : ordered.map(panel => panel.id),
        label: equal ? 'Keep spacing equal' : 'Distribute equally',
        rules: ordered.slice(2).map((panel, index) => rule({ kind: 'opening-ratio', axis: layout.axis, ratio: 1,
          panelIds: [ordered[index].id, ordered[index + 1].id, ordered[index + 1].id, panel.id] })) })
    }
  }

  if (selected.length === 1 && aligned) {
    offer({ id: 'pin', label: 'Pin current position',
      rules: axes.map((axis, index) => rule({ kind: 'position', panelId: primary.id, axis, reference: 'center', value: round(primary.position[index]) })) })
  }
  return suggestions
}

/** Apply one suggestion as a single immutable candidate, or throw without changes. */
export function applyConstraintSuggestion(project: Project, suggestion: ConstraintSuggestion): Project {
  if (suggestion.lock) return setPanelDimensionLocked(project, suggestion.lock.panelIds, suggestion.lock.dimension, true)
  let next = project
  if (suggestion.distributeIds) {
    // Distribution keeps both ends fixed; the opening rules then preserve the result.
    try { next = distributePanels(project, suggestion.distributeIds) } catch { next = project }
  }
  for (const item of suggestion.rules) next = setDesignConstraint(next, { ...item, id: crypto.randomUUID() }, suggestion.anchorPanelId)
  return next
}
