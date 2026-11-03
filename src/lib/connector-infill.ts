import { Vector3 } from 'three'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { fitAddedConnectorClearance } from './connector-clearance'
import { resolvePanels } from './model'
import { assertNoNewTrofastIssues } from './trofast'
import type { Project } from './types'

function endpoints(project: Project, ids: readonly string[]) {
  const wanted = new Set(ids)
  const selected = getPhysicalConnectors(project).filter(piece => wanted.has(piece.id))
  if (ids.length !== 2 || selected.length !== 2) throw new Error('Select two matching connectors on the same panels.')
  const [first, second] = selected
  const pair = (piece: typeof first) => [piece.connection.parentId, piece.connection.childId].sort().join('/')
  if (pair(first) !== pair(second)) throw new Error('Select connectors that connect the same panels.')
  if (first.type !== second.type || first.material !== second.material || first.color.toLowerCase() !== second.color.toLowerCase()) {
    throw new Error('Choose connectors with the same type, material, and color.')
  }
  const managed = new Set(project.assemblies?.instances.flatMap(instance => Object.values(instance.panelIds)))
  if (managed.has(first.connection.parentId) || managed.has(first.connection.childId) || first.connection.id.startsWith('assembly-link/')) {
    throw new Error('Disassemble the affected assembly before adding connectors between these pieces.')
  }
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  const rail = getConnectorRail(first.connection, panels, project.connections)!
  const other = getConnectorRail(second.connection, panels, project.connections)
  if (!rail || !other) throw new Error('These connectors have no usable shared edge.')
  const start = rail.along[first.index] + connectorSlide(rail, first.index, project.connectorOverrides?.[first.id]?.slide)
  const position = new Vector3(...rail.placements[first.index].position).addScaledVector(new Vector3(...rail.tangent), start - rail.along[first.index])
  const endPosition = new Vector3(...other.placements[second.index].position).addScaledVector(new Vector3(...other.tangent), connectorSlide(other, second.index, project.connectorOverrides?.[second.id]?.slide))
  const delta = endPosition.sub(position), tangent = new Vector3(...rail.tangent)
  const distance = delta.dot(tangent)
  if (delta.addScaledVector(tangent, -distance).length() > .001 || Math.abs(distance) < .001 || start + distance < rail.lower - .001 || start + distance > rail.upper + .001) {
    throw new Error('These connectors do not share a usable straight joint.')
  }
  return { first, rail, panels, start, distance }
}

export function connectorInfillReason(project: Project, ids: readonly string[]) {
  try { endpoints(project, ids); return '' } catch (error) { return (error as Error).message }
}

/** Append stable hardware indices and compensate existing slides for the new rail spacing. */
export function addConnectorsBetween(project: Project, ids: readonly string[], count: number): Project {
  const { first, rail, panels, start, distance } = endpoints(project, ids)
  const connection = first.connection
  if (connection.count >= 20) throw new Error('This joint already has the maximum of 20 stored connectors.')
  if (!Number.isInteger(count) || count < 1 || connection.count + count > 20) throw new Error(`Choose a whole number from 1 to ${20 - connection.count}.`)
  const updated = { ...connection, count: connection.count + count }
  const connections = project.connections.map(item => item.id === connection.id ? updated : item)
  const nextRail = getConnectorRail(updated, panels, connections)!
  const connectorOverrides = { ...project.connectorOverrides }
  for (let index = 0; index < connection.count; index++) {
    const id = connectorId(connection.id, index)
    connectorOverrides[id] = { ...connectorOverrides[id], slide: rail.along[index] + connectorSlide(rail, index, connectorOverrides[id]?.slide) - nextRail.along[index] }
  }
  for (let i = 1; i <= count; i++) {
    const index = connection.count + i - 1
    connectorOverrides[connectorId(connection.id, index)] = { type: first.type, material: first.material, color: first.color,
      slide: start + distance * i / (count + 1) - nextRail.along[index] }
  }
  const candidate = { ...project, connections, connectorOverrides }
  try {
    if (fitAddedConnectorClearance(project, candidate) !== candidate) throw new Error('Spacing changed')
  } catch {
    throw new Error('Not enough room for that quantity at equal spacing. Choose fewer connectors or move existing hardware.')
  }
  return assertNoNewTrofastIssues(project, candidate)
}
