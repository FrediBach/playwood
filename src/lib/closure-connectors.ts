import { Euler, Quaternion, Vector3 } from 'three'
import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { ConnectorClearanceError, fitAddedConnectorClearance } from './connector-clearance'
import { getConnectorRail } from './connector-movement'
import { resolvePanels, validateProject } from './model'
import { outlineConnectionAligned } from './outline-closures'
import type { Connection, Panel, Project, Side } from './types'

const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const sides: Side[] = ['left', 'right', 'top', 'bottom']

/** Prefer two clamps per edge, falling back to one only on a new joint whose
 * hardware cannot fit. Existing pieces and their saved overrides stay fixed. */
export function fitClosingConnectorClearance(original: Project, candidate: Project): Project {
  const retained = new Set(original.connections.map(connection => connection.id))
  let next = candidate
  for (;;) {
    try { return fitAddedConnectorClearance(original, next) }
    catch (error) {
      if (!(error instanceof ConnectorClearanceError)) throw error
      const connection = next.connections.find(item => item.id === error.connectionId)
      if (!connection || retained.has(connection.id) || connection.count !== 2) throw error
      // No partial slides escape a failed fit. Retry all newly installed pieces
      // after reducing this joint; the shared T/cross branches keep count zero.
      next = { ...next, connections: next.connections.map(item => item === connection ? { ...item, count: 1 } : item) }
    }
  }
}

function fits(parent: Panel, child: Panel, connection: Connection) {
  const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
  return new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) < 0.1
    && axes.every(axis => Math.abs(axis.clone().applyQuaternion(rotation(expected)).dot(axis.clone().applyQuaternion(rotation(child)))) > 0.99999)
}

/** Solve every slot of one physical clamp, including a child with exchanged cut axes. */
function fitJoint(members: Panel[], count: number, color: string): Connection[] | undefined {
  if (members.some(panel => panel.customOutline)) {
    const parents = members.filter(panel => !panel.customOutline), children = members.filter(panel => panel.customOutline)
    if (parents.length !== 1 || children.length < 1 || children.length > 2) return
    const parent = parents[0], type = children.length === 2 ? 't' : '90'
    for (const side of sides) for (const flip of [false, true]) {
      const id = crypto.randomUUID(), group: Connection[] = []
      for (const [branch, child] of children.entries()) {
        for (let outlineEdge = 0; outlineEdge < child.customOutline!.length; outlineEdge++) {
          const candidate: Connection = { id: `${id}:${branch}`, parentId: parent.id, childId: child.id, type, role: 'support', outlineEdge,
            side, flip, offset: 0, inset: 0, count: branch ? 0 : count, color }
          if (outlineConnectionAligned(parent, child, candidate)) { group.push(candidate); break }
        }
      }
      if (group.length === children.length
        && !validateProject({ version: 1, name: '', panels: members, connections: group }).some(issue => issue.severity === 'error' || issue.id.startsWith('collision-'))) return group
    }
    return
  }
  const type = members.length === 2 ? '90' : members.length === 3 ? 't' : members.length === 4 ? 'cross' : undefined
  if (!type) return
  for (const parent of members) for (const side of sides) for (const flip of [false, true]) {
    const id = crypto.randomUUID()
    const children = members.filter(panel => panel !== parent)
    const delta = new Vector3(...children[0].position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
    const offset = side === 'left' || side === 'right' ? delta.y : delta.x
    const group: Connection[] = []
    const remaining = new Set(children)
    for (let branch = 0; branch < children.length; branch++) {
      let match: { connection: Connection; panel: Panel } | undefined
      for (const child of remaining) for (const quarterTurn of [false, true]) {
        const candidate: Connection = { id: `${id}:${branch}`, parentId: parent.id, childId: child.id, type, side, flip, offset, inset: 0, count: branch ? 0 : count, color, role: 'support', ...(quarterTurn ? { quarterTurn } : {}) }
        if (fits(parent, child, candidate)) { match = { connection: candidate, panel: child }; break }
      }
      if (!match) break
      group.push(match.connection); remaining.delete(match.panel)
    }
    if (remaining.size) continue
    if (validateProject({ version: 1, name: '', panels: members, connections: group }).some(issue => issue.severity === 'error' || issue.id.startsWith('collision-'))) continue
    return group
  }
}

/** Attach each rim edge. Replace shared clamps with a complete T/cross joint
 * where the closing panels can occupy its slots, then fit hardware clearance.
 * The whole operation is prepared before the caller commits it to history.
 */
export function connectClosingPanel(project: Project, panel: Panel, boundaryIds: readonly string[], options: { fitClearance?: boolean } = {}): Project {
  const panels = [...resolvePanels(project), panel]
  const byId = new Map(panels.map(item => [item.id, item]))
  const visiblePanels = panels.map(item => item.visible ? item : { ...item, visible: true })
  let connections = [...project.connections]
  const removedIds = new Set<string>()
  // Joint promotion is a topology decision: only coincident, overlapping rails
  // share a clamp. Perpendicular corner hardware is handled by sliding below.
  const sharesRail = (first: Connection, group: Connection[], second: Connection) => {
    const a = getConnectorRail(first, visiblePanels, group), b = getConnectorRail(second, visiblePanels, connections)
    if (!a?.placements.length || !b?.placements.length) return false
    const tangent = new Vector3(...a.tangent)
    if (Math.abs(tangent.dot(new Vector3(...b.tangent))) < .99999) return false
    const delta = new Vector3(...b.placements[0].position).sub(new Vector3(...a.placements[0].position))
    if (delta.clone().addScaledVector(tangent, -delta.dot(tangent)).length() > .1) return false
    const bEnds = [b.lower, b.upper].map(value => delta.dot(tangent)
      + (value - b.along[0]) * tangent.dot(new Vector3(...b.tangent)))
    return Math.min(a.upper - a.along[0], Math.max(...bEnds)) >= Math.max(a.lower - a.along[0], Math.min(...bEnds)) - .1
  }
  for (const boundaryId of boundaryIds) {
    const boundary = byId.get(boundaryId)!
    const color = connections.find(connection => connection.parentId === boundaryId || connection.childId === boundaryId)?.color ?? DEFAULT_CONNECTOR_COLOR
    let accepted = false
    for (const count of [2, 1]) {
      let group = fitJoint([boundary, panel], count, color)
      if (!group) continue
      const replace = new Set<string>()
      const members = new Set([boundary.id, panel.id])
      // A promotion can expose another occupied slot, so solve until all
      // overlapping hardware is represented by the same complete joint.
      for (let attempt = 0; attempt < 3; attempt++) {
        const collisions = connections.filter(connection => !replace.has(jointId(connection)) && connection.count > 0
          && group!.some(item => item.count > 0 && sharesRail(item, group!, connection)))
        if (!collisions.length) { accepted = true; break }
        for (const collision of collisions) {
          for (const connection of connections.filter(item => jointId(item) === jointId(collision))) { members.add(connection.parentId); members.add(connection.childId) }
        }
        const shared = [...members].map(id => byId.get(id)!)
        const upgraded = fitJoint(shared, count, color) ?? (count === 2 ? fitJoint(shared, 1, color) : undefined)
        // Some outlines cannot use a shared T/cross joint. Keep their separate
        // clamps and let the clearance pass find distinct positions on the rail.
        if (!upgraded) { accepted = true; break }
        for (const collision of collisions) replace.add(jointId(collision))
        group = upgraded
      }
      if (!accepted) continue
      connections.filter(connection => replace.has(jointId(connection))).forEach(connection => removedIds.add(connection.id))
      connections = [...connections.filter(connection => !replace.has(jointId(connection))), ...group]
      break
    }
    if (!accepted) throw new Error(`Cannot fit connectors along ${boundary.name}. Check panel thickness, shared edge length, and nearby hardware.`)
  }
  if (connections.length > 400) throw new Error('Projects support up to 400 connections.')
  const connectorOverrides = project.connectorOverrides && Object.fromEntries(Object.entries(project.connectorOverrides).filter(([key]) => {
    try { return !removedIds.has(JSON.parse(key)[0]) } catch { return true }
  }))
  const candidate = { ...project, panels, connections, ...(connectorOverrides ? { connectorOverrides } : {}) }
  const next = options.fitClearance === false ? candidate : fitClosingConnectorClearance(project, candidate)
  const before = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(next).find(issue => !before.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return next
}
