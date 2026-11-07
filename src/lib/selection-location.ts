import { Box3, Euler, Matrix4, Vector3 } from 'three'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { getProjectBounds, resolvePanels } from './model'
import { constructionBounds } from './object-geometry'
import type { ConstructionObjects, Project, Vec3 } from './types'

export interface SelectionLocation {
  min: Vec3
  max: Vec3
  rotation?: Vec3
  note: string
}

export function panelLocation(project: Project, ids: readonly string[]): SelectionLocation | null {
  const selected = new Set(ids)
  const panels = resolvePanels(project).filter(panel => selected.has(panel.id))
  if (!panels.length) return null
  const bounds = getProjectBounds(panels.map(panel => ({ ...panel, trofastInserts: [] })))
  return { min: bounds.min, max: bounds.max, rotation: panels.length === 1 ? panels[0].rotation : undefined,
    note: 'Panel stock bounds · Y is up' }
}

export function objectLocation(objects: ConstructionObjects, ids: readonly string[]): SelectionLocation | null {
  const bounds = constructionBounds(objects, ids)
  if (!bounds) return null
  const node = ids.length === 1 ? objects.nodes.find(node => node.id === ids[0]) : undefined
  return { ...bounds, rotation: node?.kind === 'box' ? node.rotation : undefined, note: 'Source-box bounds · Y is up' }
}

export function connectorLocation(project: Project, ids: readonly string[]): SelectionLocation | null {
  const selected = new Set(ids)
  const panels = resolvePanels(project), bounds = new Box3(), rotations: Vec3[] = []
  for (const piece of getPhysicalConnectors(project).filter(piece => selected.has(piece.id))) {
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    if (!rail) continue
    const placement = rail.placements[piece.index]
    const slide = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    const position = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent), slide)
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(...placement.rotation)).setPosition(position)
    for (const part of CONNECTOR_LOCAL_BOUNDS[piece.type]) {
      bounds.union(new Box3(new Vector3(...part.min), new Vector3(...part.max)).applyMatrix4(matrix))
    }
    rotations.push(placement.rotation)
  }
  if (bounds.isEmpty()) return null
  return { min: bounds.min.toArray() as Vec3, max: bounds.max.toArray() as Vec3,
    rotation: rotations.length === 1 ? rotations[0] : undefined, note: 'CAD envelope · Y is up' }
}
