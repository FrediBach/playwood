import { Vector3 } from 'three'
import type { Camera } from 'three'
import type { Connection, Panel, Project, Vec3 } from './types'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { getConnectorPlacements, getConnectorSeam } from './model'
import { getPanelMovementDelta } from './panel-movement-direction'

/** The rail shared by every panel clamped by this piece of hardware. */
export function getConnectorRail(connection: Connection, panels: Panel[], connections: Connection[]) {
  const parent = panels.find(panel => panel.id === connection.parentId)
  const child = panels.find(panel => panel.id === connection.childId)
  const joint = (item: Connection) => item.id.replace(/:\d+$/, '')
  const branches = connections.filter(item => joint(item) === joint(connection))
  if (!parent?.visible || !child?.visible) return null
  let lower = -Infinity, upper = Infinity
  for (const branch of branches) {
    const member = panels.find(panel => panel.id === branch.childId)
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
  options: { camera: Camera; key: string; shiftKey: boolean; viewport: { width: number; height: number } }) {
  const slides: Record<string, number> = {}
  const selectedIds = new Set(ids)
  for (const piece of getPhysicalConnectors(project).filter(piece => selectedIds.has(piece.id))) {
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    if (!rail || rail.upper <= rail.lower) continue
    const current = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    const position = new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), current).toArray() as Vec3
    const delta = getPanelMovementDelta({ ...options, position, axes: [rail.tangent] })
    if (!delta) continue
    let next = connectorSlide(rail, piece.index, current + new Vector3(...delta).dot(new Vector3(...rail.tangent)))
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
