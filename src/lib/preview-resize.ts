import { Euler, Quaternion, Vector3 } from 'three'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import { roundNiceValue } from './nice-values'
import { movePanels, resizePanelEdge } from './structure-edit'
import type { Panel, Project, Vec3 } from './types'

export interface PreviewResizeHandle {
  id: string
  position: Vec3
  direction: Vec3
  label: string
  sizes?: { label: string; value: number }[]
}

export interface PreviewResizeSelection { panelId?: string; connectorId?: string }

type Operation = { kind: 'move'; panelId: string; direction: Vec3 }
  | { kind: 'edge'; panelId: string; dimension: 'width' | 'height'; side: -1 | 1 }

interface Driver { operation: Operation; scale: number }

export interface PreviewResizeSession {
  original: Project
  handles: PreviewResizeHandle[]
  selection: PreviewResizeSelection
  drivers: Map<string, Driver>
}

const vector = (values: Vec3) => new Vector3(...values)
const axesOf = (panel: Panel) => {
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(rotation))
}
const changesSize = (original: Panel[], project: Project) => project.panels.some(panel => {
  const before = original.find(item => item.id === panel.id)
  return before && (Math.abs(panel.width - before.width) > 1e-6 || Math.abs(panel.height - before.height) > 1e-6)
})
const apply = (project: Project, operation: Operation, distance: number) => operation.kind === 'edge'
  ? resizePanelEdge(project, operation.panelId, operation.dimension, operation.side, distance)
  : movePanels(project, [operation.panelId], vector(operation.direction).multiplyScalar(distance).toArray() as Vec3)

function connectorPosition(project: Project, id: string): Vec3 | null {
  const piece = getPhysicalConnectors(project).find(item => item.id === id)
  if (!piece) return null
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)
  if (!rail) return null
  return vector(rail.placements[piece.index].position).addScaledVector(vector(rail.tangent),
    connectorSlide(rail, piece.index, project.connectorOverrides?.[id]?.slide)).toArray() as Vec3
}

/** Probe structural edits once when selection changes. A handle must change cuts,
 * preserve joints and angles, and move its root along one exact direction. */
export function preparePreviewResize(project: Project, selection: PreviewResizeSelection): PreviewResizeSession | null {
  if (!!selection.panelId === !!selection.connectorId) return null
  const panels = resolvePanels(project)
  const session: PreviewResizeSession = { original: project, handles: [], selection, drivers: new Map() }
  const add = (id: string, position: Vec3, operation: Operation, direction: Vector3, label: string) => {
    // A limit may prevent outward growth while an inward push remains possible.
    for (const probe of [1, -1]) {
      try {
        const next = apply(project, operation, probe)
        if (!changesSize(panels, next)) continue
        let scale = 1
        let actualDirection = direction.clone().normalize()
        if (selection.connectorId) {
          const nextPosition = connectorPosition(next, selection.connectorId)
          if (!nextPosition) continue
          const delta = vector(nextPosition).sub(vector(position)).multiplyScalar(1 / probe)
          scale = delta.length()
          if (scale < 1e-5) continue
          actualDirection = delta.normalize()
          if (session.handles.some(handle => vector(handle.direction).dot(actualDirection) > 1 - 1e-6)) return
        }
        session.handles.push({ id, position, direction: actualDirection.toArray() as Vec3, label })
        session.drivers.set(id, { operation, scale })
        return
      } catch { /* A constrained direction simply has no handle. */ }
    }
  }

  if (selection.panelId) {
    const panel = panels.find(item => item.id === selection.panelId && item.visible)
    if (!panel) return null
    const axes = axesOf(panel)
    for (const [index, dimension] of (['width', 'height'] as const).entries()) for (const side of [-1, 1] as const) {
      const direction = axes[index].clone().multiplyScalar(side)
      const position = vector(panel.position).addScaledVector(direction, panel[dimension] / 2).toArray() as Vec3
      add(`panel-${dimension}-${side === 1 ? 'positive' : 'negative'}`, position,
        { kind: 'edge', panelId: panel.id, dimension, side }, direction,
        `${dimension === 'width' ? 'Width' : 'Height'} · ${side === 1 ? 'positive' : 'negative'} edge`)
    }
    for (const side of [-1, 1] as const) {
      const direction = axes[2].clone().multiplyScalar(side)
      add(`panel-normal-${side === 1 ? 'positive' : 'negative'}`, panel.position,
        { kind: 'move', panelId: panel.id, direction: direction.toArray() as Vec3 }, direction,
        `Connected panels · ${side === 1 ? 'forward' : 'backward'}`)
    }
  } else {
    const piece = getPhysicalConnectors(project).find(item => item.id === selection.connectorId)
    const position = connectorPosition(project, selection.connectorId!)
    if (!piece || !position) return null
    const joint = (id: string) => id.replace(/:\d+$/, '')
    const connections = project.connections.filter(connection => joint(connection.id) === joint(piece.connection.id))
    const memberIds = new Set(connections.flatMap(connection => [connection.parentId, connection.childId]))
    const members = panels.filter(panel => memberIds.has(panel.id) && panel.visible)
    if (members.length !== memberIds.size) return null
    for (const panel of members) for (const side of [-1, 1] as const) {
      const direction = axesOf(panel)[2].multiplyScalar(side)
      add(`connector-${panel.id}-normal-${side === 1 ? 'positive' : 'negative'}`, position,
        { kind: 'move', panelId: panel.id, direction: direction.toArray() as Vec3 }, direction,
        `Connected panels · ${panel.name} · ${side === 1 ? 'forward' : 'backward'}`)
    }
    const parent = panels.find(panel => panel.id === piece.connection.parentId)!
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const dimension = Math.abs(axesOf(parent)[0].dot(vector(rail.tangent))) > 0.99 ? 'width' : 'height'
    const axis = axesOf(parent)[dimension === 'width' ? 0 : 1]
    for (const side of [-1, 1] as const) {
      add(`connector-seam-${side === 1 ? 'positive' : 'negative'}`, position,
        { kind: 'edge', panelId: parent.id, dimension, side }, axis.clone().multiplyScalar(side),
        `Along joint · ${side === 1 ? 'forward' : 'backward'}`)
    }
  }
  return session.handles.length ? session : null
}

/** Preview from the pointer-down snapshot, stopping at the last feasible cut.
 * No state is persisted here, so callers can cancel or commit one undo step. */
export function movePreviewResize(session: PreviewResizeSession, handleId: string, distance: number, local = false): { project: Project; distance: number; limited: boolean } {
  if (!Number.isFinite(distance)) throw new Error('Panel movement must be a finite distance.')
  const handle = session.handles.find(item => item.id === handleId)
  const driver = session.drivers.get(handleId)
  if (!handle || !driver || Math.abs(distance) < 1e-6) return { project: session.original, distance: 0, limited: false }
  const attempt = (amount: number) => {
    if (local && (!session.selection.panelId || driver.operation.kind !== 'edge')) throw new Error('Only panel edges can resize independently.')
    const next = local && driver.operation.kind === 'edge'
      ? resizePanelEdge(session.original, driver.operation.panelId, driver.operation.dimension, driver.operation.side, amount, true)
      : apply(session.original, driver.operation, amount / driver.scale)
    if (session.selection.connectorId) {
      const position = connectorPosition(next, session.selection.connectorId)
      const target = vector(handle.position).addScaledVector(vector(handle.direction), amount)
      if (!position || vector(position).distanceTo(target) > 0.01) throw new Error('The connector reached the end of this resize direction.')
    }
    return next
  }
  try { return { project: attempt(distance), distance, limited: false } }
  catch {
    let lower = 0, upper = 1, project = session.original
    // Bisection also handles support/contact limits, which need not coincide
    // with the individual panel dimension limits.
    for (let iteration = 0; iteration < 20; iteration++) {
      const middle = (lower + upper) / 2
      try { const next = attempt(distance * middle); project = next; lower = middle }
      catch { upper = middle }
    }
    return { project, distance: distance * lower, limited: true }
  }
}

/** Round only the released cut, then replay the gesture from its original
 * snapshot so its fixed edge and structural direction remain authoritative. */
export function finishPreviewResize(session: PreviewResizeSession, handleId: string, result: ReturnType<typeof movePreviewResize>, local = false): ReturnType<typeof movePreviewResize> {
  const settings = session.original.niceValues
  if (!settings?.enabled || Math.abs(result.distance) < 1e-6) return result
  const driver = session.drivers.get(handleId)
  if (!driver) return result
  const operation = driver.operation
  const changed = session.original.panels.flatMap(panel => {
    const after = result.project.panels.find(item => item.id === panel.id)
    return after ? (['width', 'height'] as const).flatMap(dimension => {
      const change = after[dimension] - panel[dimension]
      return Math.abs(change) > 1e-6 ? [{ panelId: panel.id, dimension, before: panel[dimension], after: after[dimension], change }] : []
    }) : []
  })
  const cut = operation.kind === 'edge'
    ? changed.find(item => item.panelId === operation.panelId && item.dimension === operation.dimension)
    : changed.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
  if (!cut) return result
  const rate = operation.kind === 'edge' ? 1 / (local ? 1 : driver.scale) : cut.change / result.distance
  const rounded = roundNiceValue(cut.after, settings.step, 40, 4000)
  // A nearby limit can rule out the closest multiple. Try its neighbors rather
  // than accepting the off-grid endpoint produced by preview bisection.
  const targets = [rounded, rounded - settings.step, rounded + settings.step]
    .filter(value => value >= 40 && value <= 4000)
    .sort((a, b) => Math.abs(a - cut.after) - Math.abs(b - cut.after))
  for (const target of targets) {
    const distance = (target - cut.before) / rate
    const next = movePreviewResize(session, handleId, distance, local)
    const panel = next.project.panels.find(item => item.id === cut.panelId)
    if (!next.limited && panel && Math.abs(panel[cut.dimension] - target) < 1e-5) return next
  }
  throw new Error('This resize cannot reach a nice value while preserving its joints and constraints. Try another size or a smaller nice-value step.')
}
