import { Euler, Quaternion, Vector3 } from 'three'
import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { getConnectorPlacements, resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project, Side } from './types'

const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const sides: Side[] = ['left', 'right', 'top', 'bottom']

function fits(parent: Panel, child: Panel, connection: Connection) {
  const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
  return new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) < 0.1
    && axes.every(axis => Math.abs(axis.clone().applyQuaternion(rotation(expected)).dot(axis.clone().applyQuaternion(rotation(child)))) > 0.99999)
}

/** Solve every slot of one physical clamp, including a child with exchanged cut axes. */
function fitJoint(members: Panel[], count: number, color: string): Connection[] | undefined {
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

/** Attach each of the four rim edges. Replace occupied 90°/T clamps with one
 * complete T/cross joint when another closing panel already shares that edge.
 * The whole operation is prepared before the caller commits it to history.
 */
export function connectClosingPanel(project: Project, panel: Panel, boundaryIds: readonly string[]): Project {
  const panels = [...resolvePanels(project), panel]
  const byId = new Map(panels.map(item => [item.id, item]))
  let connections = [...project.connections]
  const removedIds = new Set<string>()
  const placements = (group: Connection[]) => group.filter(item => item.count > 0).flatMap(item => getConnectorPlacements(item, byId.get(item.parentId)!, byId.get(item.childId)!).map(pose => new Vector3(...pose.position)))
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
        const positions = placements(group)
        const collisions = connections.filter(connection => !replace.has(jointId(connection)) && connection.count > 0
          && placements([connection]).some(existing => positions.some(position => position.distanceTo(existing) < 40 - 0.1)))
        if (!collisions.length) { accepted = true; break }
        for (const collision of collisions) {
          replace.add(jointId(collision))
          for (const connection of connections.filter(item => jointId(item) === jointId(collision))) { members.add(connection.parentId); members.add(connection.childId) }
        }
        const upgraded = fitJoint([...members].map(id => byId.get(id)!), count, color)
        if (!upgraded) break
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
  const next = { ...project, panels, connections, ...(connectorOverrides ? { connectorOverrides } : {}) }
  const before = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(next).find(issue => !before.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return next
}
