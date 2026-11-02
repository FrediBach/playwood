import { resolvePanels } from './model'
import { DESIGN_CONSTRAINT_TOLERANCE, describeDesignConstraint, designConstraintPanelIds, evaluateDesignConstraints } from './design-constraints'
import type { Panel, Project } from './types'

const geometry = (panel: Panel | undefined) => panel && JSON.stringify([
  panel.width, panel.height, panel.thickness, panel.position, panel.rotation, panel.customOutline,
])

/** Final check for a candidate. Imported violations may remain, but cannot worsen.
 * This never solves, rewrites rule targets, or changes a history snapshot. */
export function assertDesignConstraintEdit(before: Project, candidate: Project): Project {
  // A reconstruction must not accidentally erase requirements. Explicit removal
  // uses an empty array; project replacement is a separate history operation.
  const next = candidate.constraints === undefined && before.constraints?.length
    ? { ...candidate, constraints: before.constraints } : candidate
  const panelIds = new Set(next.panels.map(panel => panel.id))
  if (next.constraints?.some(rule => designConstraintPanelIds(rule).some(id => !panelIds.has(id)))) {
    throw new Error('This edit would remove a panel referenced by a saved constraint. Remove its constraint before replacing that panel.')
  }
  if (!next.constraints?.some(rule => rule.enabled)) return next
  const previousPanels = resolvePanels(before), panels = resolvePanels(next)
  const previous = new Map(evaluateDesignConstraints(before.constraints, previousPanels).map(row => [row.constraint.id, row]))
  for (const row of evaluateDesignConstraints(next.constraints, panels)) {
    if (!row.constraint.enabled || (!row.issue && row.violation <= DESIGN_CONSTRAINT_TOLERANCE)) continue
    const old = previous.get(row.constraint.id)
    const unchangedRule = old?.constraint.enabled && JSON.stringify(old.constraint) === JSON.stringify(row.constraint)
    if (unchangedRule && old) {
      if (!row.issue && !old.issue && row.violation <= old.violation + 1e-6) continue
      if (row.issue === old.issue && designConstraintPanelIds(row.constraint).every(id =>
        geometry(panels.find(panel => panel.id === id)) === geometry(previousPanels.find(panel => panel.id === id)))) continue
    }
    const rule = describeDesignConstraint(row.constraint, panels)
    const detail = row.issue || `The resulting measurement is ${Number(row.actual.toFixed(2))} mm; ${row.constraint.kind === 'gap' && row.constraint.relation === 'minimum' ? 'at least ' : ''}${Number(row.target.toFixed(2))} mm is required.`
    throw new Error(`${rule}: ${detail} Edit or disable this constraint to continue.`)
  }
  return next
}
