import { disassembleAssembly } from './assemblies'
import type { Connection, Project } from './types'

/** Bake only the instances whose source-owned hardware is being replaced.
 * Their materialized panels and connections retain their IDs and world poses;
 * neighboring assembly links remain connected through ordinary corner ports.
 * Call only after accepting a complete replacement joint, then report the names.
 */
export function prepareJointUpgrade(project: Project, replacedConnections: readonly Connection[]): {
  project: Project; disassembledNames: string[];
} {
  const data = project.assemblies
  if (!data || !replacedConnections.length) return { project, disassembledNames: [] }
  const replaced = new Set(replacedConnections.map(connection => connection.id))
  const affected = new Set<string>()
  const definitionsById = new Map(data.definitions.map(definition => [definition.id, definition]))
  for (const instance of data.instances) {
    const definition = definitionsById.get(instance.definitionId)
    if (!definition) throw new Error('This assembly has no source definition.')
    if (definition.connections.some(connection => replaced.has(instance.connectionIds?.[connection.id] ?? `assembly/${instance.id}/${connection.id}`))) {
      affected.add(instance.id)
    }
  }
  // A materialized shared corner belongs to its link, not either source. Both
  // endpoints must become ordinary panels before that hardware can be replaced.
  for (const link of data.links) {
    if (!replacedConnections.some(connection => connection.id.startsWith(`assembly-link/${link.id}:`))) continue
    for (const endpoint of [link.a, link.b]) if (endpoint.instanceId) affected.add(endpoint.instanceId)
  }
  const instances = data.instances.filter(instance => affected.has(instance.id))
  return {
    project: instances.reduce((next, instance) => disassembleAssembly(next, instance.id), project),
    disassembledNames: instances.map(instance => instance.name),
  }
}
