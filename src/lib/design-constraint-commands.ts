import { getAssemblyInstance, isPanelConnectedToAssembly } from './assemblies'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { DESIGN_CONSTRAINT_TOLERANCE, designConstraintLimits, designConstraintPanelIds, evaluateDesignConstraints, isPanelDimensionLocked, parseDesignConstraints } from './design-constraints'
import { resolvePanels } from './model'
import { reconcileDesignConstraints } from './structure-edit'
import { assertNoNewTrofastIssues } from './trofast'
import type { DesignConstraint, Project } from './types'

/** Prepare a rule and its geometry as one transaction, outside committed state. */
export function setDesignConstraint(project: Project, rule: DesignConstraint, anchorPanelId?: string): Project {
  const constraints = parseDesignConstraints([
    ...(project.constraints ?? []).filter(item => item.id !== rule.id), rule,
  ], project.panels)
  let next: Project = { ...project, constraints }
  if (!rule.enabled) return next
  const old = project.constraints?.find(item => item.id === rule.id)
  if ((!old || JSON.stringify(old) !== JSON.stringify(rule)) && designConstraintPanelIds(rule).some(id =>
    getAssemblyInstance(project, id) || isPanelConnectedToAssembly(project, id))) {
    throw new Error('This panel belongs or connects to a linked assembly. Use the assembly’s editable values, or disassemble and disconnect it before adding a constraint.')
  }
  const changed = evaluateDesignConstraints([rule], resolvePanels(next))[0]
  if (changed.issue) throw new Error(changed.issue)
  if (changed.violation > DESIGN_CONSTRAINT_TOLERANCE) next = reconcileDesignConstraints(next, anchorPanelId, rule.id)
  return assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, next))
}

/** Freeze each selected cut at its current size in one immutable transaction. */
export function lockPanelSizes(project: Project, panelIds: readonly string[]): Project {
  return setPanelDimensionLocked(setPanelDimensionLocked(project, panelIds, 'width', true), panelIds, 'height', true)
}

/** Exact dimension rules are the saved locks. Unlocking pauses them without discarding their settings. */
export function setPanelDimensionLocked(project: Project, panelIds: readonly string[], dimension: 'width' | 'height', locked: boolean): Project {
  let next = project
  const panels = new Map(project.panels.map(panel => [panel.id, panel]))
  for (const id of new Set(panelIds)) {
    const panel = panels.get(id)
    if (!panel) throw new Error('The selected panel no longer exists.')
    if (!locked) {
      if (!isPanelDimensionLocked(next.constraints, id, dimension)) continue
      next = { ...next, constraints: next.constraints!.map(rule => isPanelDimensionLocked([rule], id, dimension) ? { ...rule, enabled: false } : rule) }
    } else if (!isPanelDimensionLocked(next.constraints, id, dimension)) {
      const paused = next.constraints?.find(rule => {
        if (rule.enabled || rule.kind !== 'dimension' || rule.panelId !== id || rule.dimension !== dimension) return false
        const { min, max } = designConstraintLimits(rule)
        return min === panel[dimension] && max === min
      })
      next = setDesignConstraint(next, paused ? { ...paused, enabled: true } : {
        id: crypto.randomUUID(), enabled: true, kind: 'dimension', panelId: id,
        dimension, relation: 'exact', value: panel[dimension],
      })
    }
  }
  return next
}
