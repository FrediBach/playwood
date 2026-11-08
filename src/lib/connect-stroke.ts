import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { fitAddedConnectorClearance } from './connector-clearance'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId, getDefaultConnectorColor } from './connector-selection'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { resolvePanels, validateProject } from './model'
import { assertNoNewTrofastIssues } from './trofast'
import type { Connection, ConnectorType, Panel, Project, Side, Vec3 } from './types'

export interface ConnectStroke {
  startPanelId: string
  endPanelId: string
  start: Vec3
  end: Vec3
}

export interface ConnectStrokeResult {
  candidate: Project | null
  reason: string
  connectorId?: string
  position?: Vec3
  type?: ConnectorType
  panelIds?: string[]
}

const MAX_SNAP = 20
const EPSILON = 1e-6
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const rotation = (panel: Pick<Panel, 'rotation'>) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const sides: Side[] = ['left', 'right', 'top', 'bottom']

function fits(parent: Panel, child: Panel, connection: Connection) {
  const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
  if (new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) > 0.5) return false
  const expectedRotation = rotation(expected), actualRotation = rotation(child)
  return axes.every(axis => Math.abs(axis.clone().applyQuaternion(expectedRotation).dot(axis.clone().applyQuaternion(actualRotation))) > 0.99999)
}

/** Clamp bodies may overlap their own boards; unrelated stock remains an obstacle,
 * including hidden panels. Bounds retain the model's conservative shape limits. */
function assertStockClearance(panels: Panel[], members: Set<string>, type: ConnectorType, position: Vec3, orientation: Vec3) {
  const quaternion = rotation({ rotation: orientation })
  const matrix = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion))
  const bodies = CONNECTOR_LOCAL_BOUNDS[type].map(bounds => {
    const min = new Vector3(...bounds.min), max = new Vector3(...bounds.max)
    return new OBB(min.clone().add(max).multiplyScalar(0.5).applyQuaternion(quaternion).add(new Vector3(...position)),
      max.sub(min).multiplyScalar(0.5), matrix)
  })
  for (const panel of panels) {
    if (members.has(panel.id)) continue
    const box = new OBB(new Vector3(...panel.position),
      new Vector3(...[panel.width, panel.height, panel.thickness].map(value => Math.max(0.1, value / 2 - 0.5))),
      new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation(panel))))
    if (bodies.some(body => body.intersectsOBB(box, 1e-8))) throw new Error(`The connector would overlap ${panel.name}. Choose another position along the edge.`)
  }
}

/** Infer one stationary joint or append one piece to an existing complete joint.
 * The gesture midpoint controls the position along the shared edge; only a small,
 * visible snap is allowed. Previous panels and hardware never move. */
export function getConnectStrokeCandidate(project: Project, stroke: ConnectStroke): ConnectStrokeResult {
  const rejected = (reason: string): ConnectStrokeResult => ({ candidate: null, reason })
  if (![...stroke.start, ...stroke.end].every(Number.isFinite)) return rejected('Choose a position on each panel.')
  if (stroke.startPanelId === stroke.endPanelId) return rejected('End the line on a different panel.')
  const panels = resolvePanels(project)
  const first = panels.find(panel => panel.id === stroke.startPanelId), second = panels.find(panel => panel.id === stroke.endPanelId)
  if (!first?.visible || !second?.visible) return rejected('Start and end the line on visible panels.')
  if ([first, second].some(panel => isPanelConnectedToAssembly(project, panel.id))) {
    return rejected('Disassemble the affected assembly before drawing a connector here.')
  }
  if ([first, second].some(panel => panel.customOutline)) return rejected('Drawing connectors currently needs rectangular panel edges.')
  if ([first, second].some(panel => panel.thickness < 16 || panel.thickness > 19)) return rejected('These connectors need panels 16–19 mm thick.')

  const midpoint = new Vector3(...stroke.start).add(new Vector3(...stroke.end)).multiplyScalar(0.5)
  const groups = new Map<string, Connection[]>()
  for (const connection of project.connections) groups.set(jointId(connection), [...groups.get(jointId(connection)) ?? [], connection])
  const existing = [...groups.values()].filter(group => {
    const members = new Set(group.flatMap(connection => [connection.parentId, connection.childId]))
    return members.has(first.id) && members.has(second.id)
  })
  const options: { connection: Connection; group: Connection[]; existing: boolean }[] = []
  for (const group of existing) {
    const connection = group.find(item => item.count > 0)
    if (connection) options.push({ connection, group, existing: true })
  }
  if (!existing.length) {
    if (project.connections.length >= 400) return rejected('Projects support up to 400 connections. Remove unused joints first.')
    const color = getDefaultConnectorColor(project)
    const id = `${crypto.randomUUID()}:0`
    for (const [parent, child] of [[first, second], [second, first]]) {
      const relative = new Vector3(...child.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
      for (const type of ['90', '105', '150'] as const) for (const side of sides) for (const flip of [false, true]) for (const quarterTurn of [false, true]) {
        const connection: Connection = { id, parentId: parent.id, childId: child.id, type, side, flip,
          quarterTurn, offset: side === 'left' || side === 'right' ? relative.y : relative.x, inset: 0, color, count: 1, role: 'support' }
        if (fits(parent, child, connection)) options.push({ connection, group: [connection], existing: false })
      }
    }
  }
  let reason = existing.length ? 'This joint has no usable connector rail.' : 'No compatible edge joint fits these panels. Align their edges for a 90°, 105°, or 150° connector.'
  const results: { result: ConnectStrokeResult; distance: number }[] = []
  for (const option of options) {
    try {
      const { connection, group } = option
      const members = new Set(group.flatMap(item => [item.parentId, item.childId]))
      if (group.some(item => item.partial)) throw new Error('Complete this T or cross joint before adding another connector.')
      if (panels.some(panel => members.has(panel.id) && panel.customOutline)) throw new Error('Drawing connectors currently needs rectangular panel edges.')
      if (connection.side === 'front' || connection.side === 'back') throw new Error('Choose an exposed panel edge for this connector.')
      if (option.existing && connection.count >= 20) throw new Error('This joint already has the maximum of 20 stored connectors.')
      const connections = option.existing ? project.connections : [...project.connections, connection]
      const rail = getConnectorRail(connection, panels, connections)
      if (!rail || rail.upper < rail.lower - EPSILON) throw new Error('There is not enough shared edge for a connector.')
      const tangent = new Vector3(...rail.tangent)
      const intended = rail.along[0] + midpoint.clone().sub(new Vector3(...rail.placements[0].position)).dot(tangent)
      const along = Math.max(rail.lower, Math.min(rail.upper, intended))
      if (Math.abs(along - intended) > MAX_SNAP + EPSILON) throw new Error('Draw closer to the shared edge, leaving room for the whole connector.')
      const updated = option.existing ? { ...connection, count: connection.count + 1 } : connection
      const nextConnections = connections.map(item => item.id === connection.id ? updated : item)
      const nextRail = getConnectorRail(updated, panels, nextConnections)!
      const overrides = { ...project.connectorOverrides }
      if (option.existing) for (let index = 0; index < connection.count; index++) {
        const id = connectorId(connection.id, index)
        overrides[id] = { ...overrides[id], slide: rail.along[index] + connectorSlide(rail, index, overrides[id]?.slide) - nextRail.along[index] }
      }
      const index = option.existing ? connection.count : 0
      const id = connectorId(updated.id, index)
      overrides[id] = { slide: along - nextRail.along[index] }
      let candidate: Project = { ...project, connections: nextConnections, connectorOverrides: overrides }
      // Validate this joint even if an unrelated imported diagnostic already exists.
      const affected = validateProject({ version: 1, name: '', panels: panels.filter(panel => members.has(panel.id)),
        connections: nextConnections.filter(item => jointId(item) === jointId(updated)), connectorOverrides: overrides })
      const issue = affected.find(item => item.severity === 'error' || item.id.startsWith('collision-'))
      if (issue) throw new Error(issue.message)
      candidate = fitAddedConnectorClearance(project, candidate)
      const fitted = nextRail.along[index] + connectorSlide(nextRail, index, candidate.connectorOverrides?.[id]?.slide)
      if (Math.abs(fitted - along) > MAX_SNAP + EPSILON) throw new Error('Another connector occupies that position. Draw farther along the edge.')
      const position = new Vector3(...nextRail.placements[index].position).addScaledVector(tangent, fitted - nextRail.along[index]).toArray() as Vec3
      assertStockClearance(panels, members, connection.type, position, nextRail.placements[index].rotation)
      candidate = assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, candidate))
      results.push({ result: { candidate, reason: '', connectorId: id, position, type: connection.type, panelIds: [...members] },
        distance: midpoint.distanceToSquared(new Vector3(...position)) })
    } catch (error) { reason = (error as Error).message }
  }
  return results.sort((a, b) => a.distance - b.distance)[0]?.result ?? rejected(reason)
}
