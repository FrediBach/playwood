import { fitAddedConnectorClearance } from './connector-clearance'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId } from './connector-selection'
import { resolvePanels, validateProject } from './model'
import type { Project } from './types'

/** Explicit Auto-add restores removed hardware at its saved position, if it still fits. */
export function restoreRemovedConnectors(source: Project, selectedIds: readonly string[] = []) {
  let project = source, connectors = 0
  const restoredJoints = new Set<string>()
  const panels = resolvePanels(source)
  const selected = new Set(selectedIds)
  for (const connection of source.connections) {
    if (!Array.from({ length: connection.count }, (_, index) => source.connectorOverrides?.[connectorId(connection.id, index)]?.removed).some(Boolean)) continue
    const joint = connection.id.replace(/:\d+$/, '')
    const group = source.connections.filter(item => item.id.replace(/:\d+$/, '') === joint)
    const members = new Set(group.flatMap(item => [item.parentId, item.childId]))
    const selectedMembers = [...members].filter(id => selected.has(id)).length
    if (selected.size && selectedMembers < Math.min(2, selected.size)) continue
    const rail = getConnectorRail(connection, panels, source.connections)
    if (!rail || rail.upper < rail.lower) continue
    if (validateProject({ version: 1, name: '', panels: panels.filter(panel => members.has(panel.id)), connections: group, connectorOverrides: project.connectorOverrides })
      .some(issue => issue.severity === 'error')) continue
    for (let index = 0; index < connection.count; index++) {
      const id = connectorId(connection.id, index)
      const override = project.connectorOverrides?.[id]
      if (!override?.removed) continue
      const { removed: _removed, ...appearance } = override
      const overrides = { ...project.connectorOverrides }
      if (Object.keys(appearance).length) overrides[id] = appearance
      else delete overrides[id]
      const candidate = { ...project, connectorOverrides: overrides }
      try {
        const fitted = fitAddedConnectorClearance(project, candidate)
        const savedSlide = connectorSlide(rail, index, override.slide)
        const fittedSlide = connectorSlide(rail, index, fitted.connectorOverrides?.[id]?.slide)
        // Do not relocate a removed corner into another part of the seam.
        if (Math.abs(savedSlide - fittedSlide) > 1e-6) continue
      } catch { continue }
      project = candidate
      connectors++
      restoredJoints.add(joint)
    }
  }
  return { project, connectors, joints: restoredJoints.size }
}
