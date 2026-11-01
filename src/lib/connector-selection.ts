import type { Connection, ConnectorOverride, Project } from './types'
import { getConnectorMaterial } from './connector-options'

/** Stable identity for each physical piece of hardware along a joint. */
export const connectorId = (connectionId: string, index: number) => JSON.stringify([connectionId, index])

export function getPhysicalConnectors(project: Pick<Project, 'connections' | 'connectorOverrides'>) {
  return project.connections.flatMap(connection => Array.from({ length: connection.count }, (_, index) => {
    const id = connectorId(connection.id, index)
    const override = project.connectorOverrides?.[id]
    const type = override?.type ?? connection.type
    return { id, connection, index, type, color: override?.color ?? connection.color,
      material: getConnectorMaterial(type, override?.material ?? connection.material), removed: override?.removed ?? false }
  })).filter(connector => !connector.removed)
}

export function editConnectors(project: Project, ids: readonly string[], patch: ConnectorOverride): Project {
  const wanted = new Set(ids)
  const selected = getPhysicalConnectors(project).filter(connector => wanted.has(connector.id))
  if (!selected.length) return project
  const connectorOverrides = { ...project.connectorOverrides }
  for (const connector of selected) {
    const next = { ...connectorOverrides[connector.id], ...patch }
    if (next.material !== undefined || connector.connection.material !== undefined) {
      next.material = getConnectorMaterial(patch.type ?? connector.type, next.material ?? connector.material)
    }
    connectorOverrides[connector.id] = next
  }
  return { ...project, connectorOverrides }
}

export function connectorFinish(connection: Connection, index: number, overrides: Project['connectorOverrides']) {
  return overrides?.[connectorId(connection.id, index)]
}
