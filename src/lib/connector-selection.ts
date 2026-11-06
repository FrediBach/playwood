import type { Connection, ConnectorOverride, Project } from './types'
import { DEFAULT_CONNECTOR_COLOR, getConnectorMaterial } from './connector-options'

/** Stable identity for each physical piece of hardware along a joint. */
export const connectorId = (connectionId: string, index: number) => JSON.stringify([connectionId, index])

/** Decode persisted hardware identities before using their connection or index. */
export function parseConnectorId(id: string): [string, number] {
  let key: unknown
  try { key = JSON.parse(id) } catch { throw new Error('Invalid connector selection ID.') }
  if (!Array.isArray(key) || key.length !== 2 || typeof key[0] !== 'string'
    || typeof key[1] !== 'number' || !Number.isInteger(key[1]) || key[1] < 0 || key[1] >= 20) {
    throw new Error('Invalid connector selection ID.')
  }
  return [key[0], key[1]]
}

export function getPhysicalConnectors(project: Pick<Project, 'connections' | 'connectorOverrides'>) {
  return project.connections.flatMap(connection => Array.from({ length: connection.count }, (_, index) => {
    const id = connectorId(connection.id, index)
    const override = project.connectorOverrides?.[id]
    const type = override?.type ?? connection.type
    return { id, connection, index, type, color: override?.color ?? connection.color,
      material: getConnectorMaterial(type, override?.material ?? connection.material), removed: override?.removed ?? false }
  })).filter(connector => !connector.removed)
}

/** Match installed hardware, including per-piece colors but excluding removals.
 * Equal totals keep the first encountered color; an empty project uses red. */
export function getDefaultConnectorColor(project: Pick<Project, 'connections' | 'connectorOverrides'>): string {
  const counts = new Map<string, number>()
  for (const piece of getPhysicalConnectors(project)) {
    const color = piece.color.toLowerCase()
    counts.set(color, (counts.get(color) ?? 0) + 1)
  }
  let color: string = DEFAULT_CONNECTOR_COLOR
  let maximum = 0
  for (const [candidate, count] of counts) {
    if (count > maximum) { color = candidate; maximum = count }
  }
  return color
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
