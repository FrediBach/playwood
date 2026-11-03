import { connectorId, editConnectors, getPhysicalConnectors } from './connector-selection'
import { getConnectorMaterial } from './connector-options'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { resolvePanels, validateProject } from './model'
import { panelValuesEqual } from './selection'
import { assertNoNewTrofastIssues } from './trofast'
import type { ConnectorType, Project } from './types'

/** Angled hardware changes the whole joint; T/cross choices reserve extra openings. */
export function changeConnectorType(project: Project, ids: readonly string[], type: ConnectorType): Project {
  if (type === 't' || type === 'cross') return assertNoNewTrofastIssues(project, editConnectors(project, ids, { type }))
  const wanted = new Set(ids)
  const selected = getPhysicalConnectors(project).filter(piece => wanted.has(piece.id))
  if (!selected.length) return project
  const jointId = (id: string) => id.replace(/:\d+$/, '')
  const joints = new Set(selected.map(piece => jointId(piece.connection.id)))
  const connections = project.connections.filter(connection => joints.has(jointId(connection.id)))
  if (connections.some(connection => connection.type === 't' || connection.type === 'cross')) {
    throw new Error('This joint has T or Cross branches. Detach the extra panels before replacing it with an angled connector.')
  }
  const changed = new Set(connections.filter(connection => connection.type !== type).map(connection => connection.id))
  if (!changed.size) return assertNoNewTrofastIssues(project, editConnectors(project, ids, { type }))

  // Materialized assembly geometry must continue to agree with its source and links.
  const managedPanels = new Set(project.assemblies?.instances.flatMap(instance => Object.values(instance.panelIds)))
  if (connections.some(connection => changed.has(connection.id) &&
    (managedPanels.has(connection.childId) || connection.id.startsWith('assembly-link/')))) {
    throw new Error('Disassemble the affected assembly before changing its joint angle.')
  }

  const next = editConnectors(project, ids, { type })
  const connectorOverrides = { ...next.connectorOverrides }
  for (const connection of connections) {
    if (!changed.has(connection.id)) continue
    // All clamps on one seam must use the same angle, even if only one is selected.
    // Removed clamps stay removed; colors, slides and stable identities survive.
    for (let index = 0; index < connection.count; index++) {
      const id = connectorId(connection.id, index), override = connectorOverrides[id]
      if (!override) continue
      const { type: _type, ...rest } = override
      connectorOverrides[id] = { ...rest,
        ...(rest.material !== undefined ? { material: getConnectorMaterial(type, rest.material) } : {}),
      }
    }
  }
  let candidate: Project = { ...next, connectorOverrides,
    connections: project.connections.map(connection => changed.has(connection.id) ? { ...connection, type,
      ...(connection.material !== undefined ? { material: getConnectorMaterial(type, connection.material) } : {}),
    } : connection),
  }
  const beforePanels = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  candidate = { ...candidate, panels: resolvePanels(candidate) }
  const moved = new Set(candidate.panels.filter(panel => {
    const before = beforePanels.get(panel.id)!
    return !panelValuesEqual(panel.position, before.position) || !panelValuesEqual(panel.rotation, before.rotation)
  }).map(panel => panel.id))
  if ([...moved].some(id => managedPanels.has(id))) {
    throw new Error('Disassemble the affected assembly before moving its panels with a new joint angle.')
  }
  if (candidate.panels.some(panel => panel.position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000))) {
    throw new Error('This joint angle would exceed the project placement limits.')
  }
  candidate = assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, candidate))
  const previousIssues = new Set(validateProject(project).map(issue => issue.id))
  const affected = new Set([...moved, ...connections.filter(connection => changed.has(connection.id))
    .flatMap(connection => [connection.parentId, connection.childId])])
  const problem = validateProject(candidate).find(issue =>
    (issue.severity === 'error' || issue.id.startsWith('collision-')) &&
    (!previousIssues.has(issue.id) || (issue.severity === 'error' && issue.panelIds.some(id => affected.has(id)))))
  if (problem) throw new Error(`Cannot change this joint angle: ${problem.message}`)
  return candidate
}
