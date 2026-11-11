import { snapDistance, snapTargets, type SnapSettings } from './preview-snap'
import { Vector3 } from 'three'
import type { Camera } from 'three'
import type { Connection, Panel, Project, Vec3 } from './types'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { getConnectorPlacements, getConnectorSeam } from './model'
import { getPanelMovementDelta } from './panel-movement-direction'

/** The rail shared by every panel clamped by this piece of hardware. */
export function getConnectorRail(connection: Connection, panels: Panel[], connections: Connection[]) {
  const id = connection.id.replace(/:\d+$/, '')
  return connectorRail(connection, new Map(panels.map(panel => [panel.id, panel])),
    connections.filter(item => item.id.replace(/:\d+$/, '') === id))
}

/** Batch-local indices: never retain geometry across project edits. */
function railsFor(panels: Panel[], connections: Connection[]) {
  const panelsById = new Map(panels.map(panel => [panel.id, panel]))
  const groups = new Map<string, Connection[]>()
  for (const connection of connections) {
    const id = connection.id.replace(/:\d+$/, ''), group = groups.get(id)
    if (group) group.push(connection)
    else groups.set(id, [connection])
  }
  return (connection: Connection) => connectorRail(connection, panelsById, groups.get(connection.id.replace(/:\d+$/, '')) ?? [])
}

function connectorRail(connection: Connection, panelsById: Map<string, Panel>, branches: Connection[]) {
  const parent = panelsById.get(connection.parentId), child = panelsById.get(connection.childId)
  if (!parent?.visible || !child?.visible) return null
  let lower = -Infinity, upper = Infinity
  for (const branch of branches) {
    const member = panelsById.get(branch.childId)
    if (!member?.visible) return null
    const seam = getConnectorSeam(branch, parent, member)
    lower = Math.max(lower, seam.lower)
    upper = Math.min(upper, seam.upper)
  }
  const tangent = getConnectorSeam(connection, parent, child).tangent
  const middle = (lower + upper) / 2
  const reach = Math.max(0, (upper - lower) / 2)
  const center = getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0]
  const original = getConnectorSeam(connection, parent, child)
  const origin = new Vector3(...center.position).addScaledVector(new Vector3(...tangent), middle - (original.lower + original.upper) / 2)
  const along = Array.from({ length: connection.count }, (_, i) => connection.count === 1 ? middle : middle - reach + 2 * reach * i / (connection.count - 1))
  return { lower, upper, tangent, along, placements: along.map(value => ({ rotation: center.rotation,
    position: origin.clone().addScaledVector(new Vector3(...tangent), value - middle).toArray() as Vec3 })) }
}

export function connectorSlide(rail: NonNullable<ReturnType<typeof getConnectorRail>>, index: number, slide = 0) {
  return rail.upper <= rail.lower ? 0 : Math.max(rail.lower - rail.along[index], Math.min(rail.upper - rail.along[index], slide))
}

export function getConnectorKeyboardSlides(project: Pick<Project, 'connections' | 'connectorOverrides'>, panels: Panel[], ids: readonly string[],
  options: { camera: Camera; key: string; shiftKey: boolean; viewport: { width: number; height: number }; snapSettings?: SnapSettings; keyboardStep?: number }) {
  const slides: Record<string, number> = {}
  const selectedIds = new Set(ids)
  for (const piece of getPhysicalConnectors(project).filter(piece => selectedIds.has(piece.id))) {
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    if (!rail || rail.upper <= rail.lower) continue
    const current = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    const position = new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), current).toArray() as Vec3
    const delta = getPanelMovementDelta({ ...options, position, axes: [rail.tangent] })
    if (!delta) continue
    const step = options.keyboardStep ?? (options.snapSettings?.grid ? options.snapSettings.spacing : 10)
    const requested = new Vector3(...delta).dot(new Vector3(...rail.tangent)) * step / 10
    const amount = options.snapSettings ? snapDistance(position, rail.tangent, requested,
      snapTargets({ ...project, version: 1, name: '', panels }, [], ids, true), { ...options.snapSettings, tolerance: Math.min(options.snapSettings.tolerance, Math.abs(requested) * 0.45) }) : requested
    let next = connectorSlide(rail, piece.index, current + amount)
    // Keep physical pieces from passing through or overlapping their neighbors.
    for (let i = 0; i < rail.along.length; i++) {
      if (i === piece.index) continue
      const id = connectorId(piece.connection.id, i)
      if (project.connectorOverrides?.[id]?.removed) continue
      const neighbor = rail.along[i] + connectorSlide(rail, i, slides[id] ?? project.connectorOverrides?.[id]?.slide)
      const here = rail.along[piece.index] + current
      if (next > current && neighbor >= here) next = Math.max(current, Math.min(next, neighbor - 40 - rail.along[piece.index]))
      if (next < current && neighbor <= here) next = Math.min(current, Math.max(next, neighbor + 40 - rail.along[piece.index]))
    }
    if (Math.abs(next - current) > 1e-8) slides[piece.id] = next
  }
  return slides
}

/** Preserve physical rail positions proportionally, including manually reordered pieces. */
export function rescaleConnectorSlides(before: Project, after: Project, beforePanels: Panel[], afterPanels: Panel[]): Project {
  // Hidden stock still has installed hardware and must resize identically.
  const visibleBefore = beforePanels.map(panel => ({ ...panel, visible: true }))
  const visibleAfter = afterPanels.map(panel => ({ ...panel, visible: true }))
  const beforeRail = railsFor(visibleBefore, before.connections), afterRail = railsFor(visibleAfter, after.connections)
  const connections = new Map(after.connections.map(connection => [connection.id, connection]))
  const overrides = { ...after.connectorOverrides }
  let changed = false
  for (const connection of before.connections) {
    if (!connection.count) continue
    const nextConnection = connections.get(connection.id)
    if (!nextConnection || nextConnection.count !== connection.count) continue
    const oldRail = beforeRail(connection)
    const newRail = afterRail(nextConnection)
    if (!oldRail || !newRail) continue
    const oldSpan = oldRail.upper - oldRail.lower, newSpan = newRail.upper - newRail.lower
    if (oldSpan <= 1e-6 || newSpan < 0 || Math.abs(newSpan - oldSpan) < 1e-6) continue
    const positions = oldRail.along.map((along, index) => {
      const id = connectorId(connection.id, index)
      const oldPosition = along + connectorSlide(oldRail, index, before.connectorOverrides?.[id]?.slide)
      const newPosition = newRail.lower + (oldPosition - oldRail.lower) * newSpan / oldSpan
      const slide = newPosition - newRail.along[index]
      if (Math.abs(slide - (overrides[id]?.slide ?? 0)) > 1e-6) {
        overrides[id] = { ...overrides[id], slide }
        changed = true
      }
      return { id, oldPosition, newPosition }
    }).filter(piece => !before.connectorOverrides?.[piece.id]?.removed)
      .sort((a, b) => a.oldPosition - b.oldPosition)
    for (let index = 1; index < positions.length; index++) {
      const previous = positions[index - 1], current = positions[index]
      const oldGap = current.oldPosition - previous.oldPosition
      if (current.newPosition - previous.newPosition < Math.min(40, oldGap) - 1e-6) {
        throw new Error('This resize would crowd connectors together. Move or remove some connectors, or use a larger dimension.')
      }
    }
  }
  return changed ? { ...after, connectorOverrides: overrides } : after
}
