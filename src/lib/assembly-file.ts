import { instantiateAssembly, parseAssemblyData } from './assemblies'
import { evaluateAssemblyDefinition } from './assembly-parameters'
import type { AssemblyDefinition, Project } from './types'

export interface AssemblyFile {
  format: 'playwood-assembly'
  version: 1
  definition: AssemblyDefinition
}

/** Export the reusable construction, with this instance's values as its defaults. */
export function createAssemblyFile(project: Project, instanceId: string): AssemblyFile {
  const instance = project.assemblies?.instances.find(item => item.id === instanceId)
  const source = project.assemblies?.definitions.find(item => item.id === instance?.definitionId)
  if (!instance || !source) throw new Error('Choose an assembly to export.')
  const evaluated = evaluateAssemblyDefinition(source, instance.parameterValues)
  const definition: AssemblyDefinition = {
    ...evaluated,
    name: instance.name,
    panels: evaluated.panels.map(panel => ({ ...panel, ...instance.finish })),
    ...(source.parameters ? { parameters: source.parameters.map(parameter => ({
      ...parameter, defaultValue: instance.parameterValues?.[parameter.id] ?? parameter.defaultValue,
    })) } : {}),
  }
  return structuredClone({ format: 'playwood-assembly', version: 1, definition })
}

/** Reuse project validation and allocate a fresh source for every import. */
export function parseAssemblyFile(value: unknown): AssemblyDefinition {
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'playwood-assembly') {
    throw new Error('Choose a Playwood assembly file. Use Import project for a full project.')
  }
  if (!('version' in value) || value.version !== 1) throw new Error('This assembly file version is not supported.')
  if (!('definition' in value)) throw new Error('This assembly file is missing its design.')
  const empty: Project = { version: 1, name: 'Assembly', panels: [], connections: [] }
  const data = parseAssemblyData({ definitions: [value.definition], instances: [], links: [] }, empty)
  const definition = { ...data.definitions[0], id: crypto.randomUUID() }
  if (definition.panels.length < 2) throw new Error('An assembly needs at least two panels.')
  // Also check the evaluated geometry before offering placement in the workspace.
  instantiateAssembly({ ...empty, assemblies: { ...data, definitions: [definition] } }, definition.id)
  return definition
}
