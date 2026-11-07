import { Euler, Quaternion, Vector3 } from 'three'
import { isPanelConnectedToAssembly } from './assemblies'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { designConstraintPanelIds } from './design-constraints'
import { resolvePanels, validateProject } from './model'
import { assertNoNewTrofastIssues } from './trofast'
import type { Connection, Panel, Project, Vec3 } from './types'

const EPSILON = 0.001
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const point = (panel: Panel) => new Vector3(...panel.position)

/** Replace two matching stock rectangles with their bounding rectangle, keeping
 * all other panels and installed hardware at their resolved world placements. */
export function mergePanels(project: Project, ids: readonly string[]): Project {
  if (ids.length !== 2 || ids[0] === ids[1]) throw new Error('Select exactly two panels to merge.')
  const selected = new Set(ids), before = resolvePanels(project)
  const a = before.find(panel => panel.id === ids[0]), b = before.find(panel => panel.id === ids[1])
  if (!a || !b) throw new Error('Select two existing panels.')
  if (ids.some(id => isPanelConnectedToAssembly(project, id))) throw new Error('Disassemble and disconnect linked assemblies before merging their panels.')
  if (project.constraints?.some(rule => designConstraintPanelIds(rule).some(id => selected.has(id)))) throw new Error('Remove saved rules on these panels before merging them.')
  if ([a, b].some(panel => panel.customOutline || panel.cornerRadius || panel.pattern !== 'solid' || panel.trofastInserts?.length)) throw new Error('Merge needs solid rectangular panels without rounded corners or inserts.')
  if (a.thickness !== b.thickness || a.material !== b.material || a.color !== b.color || (a.finishCoverage ?? 0) !== (b.finishCoverage ?? 0) || a.visible !== b.visible) throw new Error('Match the panels’ thickness, material, finish and visibility before merging.')
  if (rotation(a).angleTo(rotation(b)) > 1e-5) throw new Error('The panels must have matching orientations.')
  const delta = point(b).sub(point(a)).applyQuaternion(rotation(a).invert())
  if (Math.abs(delta.z) > EPSILON) throw new Error('The panels must lie in the same plane.')
  const horizontal = Math.abs(delta.y) < EPSILON && Math.abs(a.height - b.height) < EPSILON && Math.abs(delta.x) >= (a.width + b.width) / 2 - EPSILON
  const vertical = Math.abs(delta.x) < EPSILON && Math.abs(a.width - b.width) < EPSILON && Math.abs(delta.y) >= (a.height + b.height) / 2 - EPSILON
  if (!horizontal && !vertical) throw new Error('Line up two non-overlapping panels with matching edges across the gap.')
  const dimension = horizontal ? 'width' : 'height', axis = horizontal ? 'x' : 'y'
  const low = Math.min(-a[dimension] / 2, delta[axis] - b[dimension] / 2)
  const high = Math.max(a[dimension] / 2, delta[axis] + b[dimension] / 2)
  if (high - low > 4000) throw new Error('The merged panel would exceed the 4,000 mm cut limit.')
  const shift = new Vector3(); shift[axis] = (low + high) / 2
  const merged: Panel = { ...a, [dimension]: high - low, position: point(a).add(shift.applyQuaternion(rotation(a))).toArray() as Vec3 }
  const panels = before.filter(panel => panel.id !== b.id).map(panel => panel.id === a.id ? merged : panel)
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const connections = project.connections.map(original => {
    if (!selected.has(original.parentId) && !selected.has(original.childId)) return original
    if (selected.has(original.parentId) && selected.has(original.childId)) throw new Error('Remove joints across the gap before merging these panels.')
    if (original.outlineEdge !== undefined) throw new Error('Detach fitted outline joints before merging.')
    const connection = { ...original, parentId: original.parentId === b.id ? a.id : original.parentId, childId: original.childId === b.id ? a.id : original.childId, role: 'support' as const }
    const parent = byId.get(connection.parentId)!, child = byId.get(connection.childId)!
    const expected = (c: Connection) => resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...c, role: undefined }] })[1]
    const baseline = expected(connection)
    const offsetAxis = point(expected({ ...connection, offset: connection.offset + 1 })).sub(point(baseline))
    const insetAxis = point(expected({ ...connection, inset: connection.inset + 1 })).sub(point(baseline))
    const difference = point(child).sub(point(baseline))
    connection.offset += difference.dot(offsetAxis) / offsetAxis.lengthSq()
    connection.inset += difference.dot(insetAxis) / insetAxis.lengthSq()
    if (Math.abs(connection.inset) < EPSILON) connection.inset = 0
    if (point(expected(connection)).distanceTo(point(child)) > EPSILON) throw new Error('These joints cannot fit one continuous panel. Detach them before merging.')
    return connection
  })
  // Baking only affected driving edges avoids multiple parents or cycles after
  // contracting the selected nodes; unaffected driving trees remain intact.
  const overrides = { ...project.connectorOverrides }
  const visibleBefore = before.map(panel => ({ ...panel, visible: true }))
  const visibleAfter = panels.map(panel => ({ ...panel, visible: true }))
  const connectionsById = new Map(connections.map(connection => [connection.id, connection]))
  for (const piece of getPhysicalConnectors(project)) {
    const connection = connectionsById.get(piece.connection.id)!
    if (connection === piece.connection) continue
    const oldRail = getConnectorRail(piece.connection, visibleBefore, project.connections)!
    const newRail = getConnectorRail(connection, visibleAfter, connections)!
    const oldPosition = new Vector3(...oldRail.placements[piece.index].position).addScaledVector(new Vector3(...oldRail.tangent), connectorSlide(oldRail, piece.index, overrides[piece.id]?.slide))
    const base = new Vector3(...newRail.placements[piece.index].position)
    const slide = oldPosition.clone().sub(base).dot(new Vector3(...newRail.tangent))
    if (base.addScaledVector(new Vector3(...newRail.tangent), connectorSlide(newRail, piece.index, slide)).distanceTo(oldPosition) > EPSILON) throw new Error('Merging would move existing hardware. Detach its joints first.')
    overrides[piece.id] = { ...overrides[piece.id], slide }
  }
  const next: Project = { ...project, panels, connections, connectorOverrides: overrides,
    listGroups: project.listGroups?.map(group => group.kind === 'panels' ? { ...group, itemIds: group.itemIds.filter(id => id !== b.id) } : group) }
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const issue = validateProject(next).find(issue => (issue.severity === 'error' || issue.id.startsWith('collision-')) && (!previous.has(issue.id) || issue.panelIds.includes(a.id)))
  if (issue) throw new Error(`Cannot merge panels: ${issue.message}`)
  return assertNoNewTrofastIssues(project, next)
}
