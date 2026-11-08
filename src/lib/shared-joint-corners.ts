import { Euler, Quaternion, Vector3 } from 'three'
import { fitAddedConnectorClearance } from './connector-clearance'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId } from './connector-selection'
import { resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project, Side } from './types'

const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const pairKey = (a: string, b: string) => [a, b].sort().join('/')
const sides: Side[] = ['left', 'right', 'top', 'bottom']
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))

/** Add corners where two members extend beyond the other stock in a shared joint. */
export function addSharedJointCorners(original: Project, selectedIds: readonly string[] = []) {
  let project = original, joints = 0, connectors = 0
  const panels = resolvePanels(project)
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const selected = new Set(selectedIds)
  const managed = new Set(project.assemblies?.instances.flatMap(instance => Object.values(instance.panelIds)))
  const groups = new Map<string, Connection[]>()
  for (const connection of project.connections) {
    if (connection.type !== 't' && connection.type !== 'cross') continue
    const id = jointId(connection)
    groups.set(id, [...groups.get(id) ?? [], connection])
  }
  const previousErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const completed = new Set(project.connections.filter(connection => connection.type === '90').map(connection => pairKey(connection.parentId, connection.childId)))
  for (const group of groups.values()) {
    const members = [...new Set(group.flatMap(connection => [connection.parentId, connection.childId]))].map(id => byId.get(id)!)
    if (members.some(panel => !panel) || group.some(connection => connection.outlineEdge !== undefined)) continue
    for (const parent of members) for (const child of members) {
      if (parent.id === child.id || !parent.visible || !child.visible || managed.has(parent.id) || managed.has(child.id)) continue
      if (selected.size === 1 ? !selected.has(parent.id) && !selected.has(child.id)
        : selected.size > 1 && (!selected.has(parent.id) || !selected.has(child.id))) continue
      const key = pairKey(parent.id, child.id)
      if (completed.has(key)) continue
      const relative = new Vector3(...child.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
      for (const side of sides) for (const flip of [false, true]) for (const quarterTurn of [false, true]) {
        if (completed.has(key)) continue
        const connection: Connection = { id: `${crypto.randomUUID()}:0`, parentId: parent.id, childId: child.id,
          type: '90', role: 'support', side, flip, quarterTurn, offset: side === 'left' || side === 'right' ? relative.y : relative.x,
          inset: 0, count: 1, color: group[0].color }
        const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
        if (new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) > 0.01
          || !axes.every(axis => Math.abs(axis.clone().applyQuaternion(rotation(expected)).dot(axis.clone().applyQuaternion(rotation(child)))) > 0.99999)) continue
        const rail = getConnectorRail(connection, panels, [connection])
        if (!rail || rail.upper < rail.lower) continue
        const tangent = new Vector3(...rail.tangent)
        const origin = new Vector3(...rail.placements[0].position).addScaledVector(tangent, -rail.along[0])
        // A 40 mm clamp must be wholly beyond the third/fourth panel, not
        // merely outside the shorter common hardware rail's center interval.
        const otherMembers = new Set([...groups.values()].filter(other => {
          const ids = new Set(other.flatMap(item => [item.parentId, item.childId]))
          return ids.has(parent.id) && ids.has(child.id)
        }).flatMap(other => other.flatMap(item => [item.parentId, item.childId])))
        otherMembers.delete(parent.id)
        otherMembers.delete(child.id)
        const blocked = [...otherMembers].map(id => byId.get(id)!).map(panel => {
          const q = rotation(panel)
          const half = [panel.width / 2, panel.height / 2, panel.thickness / 2]
          const extent = axes.reduce((sum, axis, i) => sum + Math.abs(axis.clone().applyQuaternion(q).dot(tangent)) * half[i], 0)
          const center = new Vector3(...panel.position).sub(origin).dot(tangent)
          return [center - extent - 20, center + extent + 20]
        })
        const exposed = (along: number) => blocked.every(([lower, upper]) => along < lower - 0.1 || along > upper + 0.1)
        const ends = [rail.lower, rail.upper].filter(exposed)
        if (!ends.length || (ends.length === 2 && ends[1] - ends[0] < 40)) continue
        connection.count = ends.length
        const fullRail = getConnectorRail(connection, panels, [connection])!
        const overrides = { ...project.connectorOverrides }
        ends.forEach((end, index) => { overrides[connectorId(connection.id, index)] = { slide: end - fullRail.along[index] } })
        const candidate: Project = { ...project, connections: [...project.connections, connection], connectorOverrides: overrides }
        if (candidate.connections.length > 400) continue
        if (validateProject(candidate).some(issue => issue.severity === 'error' && !previousErrors.has(issue.id))) continue
        try {
          const fitted = fitAddedConnectorClearance(project, candidate)
          // The clearance solver may slide pieces; never let a corner wander
          // back into a region occupied by the additional shared-joint stock.
          if (ends.some((_, index) => !exposed(fullRail.along[index] + connectorSlide(fullRail, index,
            fitted.connectorOverrides?.[connectorId(connection.id, index)]?.slide)))) continue
          project = fitted
        } catch { continue }
        completed.add(key)
        joints++
        connectors += connection.count
      }
    }
  }
  return { project, joints, connectors }
}
