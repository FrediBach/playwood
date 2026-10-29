import type { Connection, ConnectorOverride, Project } from './types'

/** Stable identity for each physical piece of hardware along a joint. */
export const connectorId = (connectionId: string, index: number) => JSON.stringify([connectionId, index])

export function getPhysicalConnectors(project: Pick<Project, 'connections' | 'connectorOverrides'>) {
  return project.connections.flatMap(connection => Array.from({ length: connection.count }, (_, index) => {
    const id = connectorId(connection.id, index)
    const override = project.connectorOverrides?.[id]
    return { id, connection, index, type: override?.type ?? connection.type, color: override?.color ?? connection.color, removed: override?.removed ?? false }
  })).filter(connector => !connector.removed)
}

export function editConnectors(project: Project, ids: readonly string[], patch: ConnectorOverride): Project {
  const wanted = new Set(ids)
  const selected = getPhysicalConnectors(project).filter(connector => wanted.has(connector.id))
  if (!selected.length) return project
  const connectorOverrides = { ...project.connectorOverrides }
  for (const connector of selected) connectorOverrides[connector.id] = { ...connectorOverrides[connector.id], ...patch }
  return { ...project, connectorOverrides }
}

export function connectorFinish(connection: Connection, index: number, overrides: Project['connectorOverrides']) {
  return overrides?.[connectorId(connection.id, index)]
}
