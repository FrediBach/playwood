import { Euler, Quaternion, Vector3 } from 'three'
import { evaluateAssemblyDefinition } from './assembly-parameters'
import { materializeAssemblies } from './assemblies'
import { resolvePanels } from './model'
import type { AssemblyDefinition, AssemblyParameter, Connection, Panel, Project, Vec3 } from './types'

const EPSILON = 1e-5
const rotation = (angles: Vec3) => new Quaternion().setFromEuler(new Euler(...angles))
const vector = (point: Vec3) => new Vector3(...point)
const flat = (definition: AssemblyDefinition): Project => ({ version: 1, name: definition.name, panels: definition.panels, connections: definition.connections })
const mismatch = () => new Error('These values conflict with a shared assembly design or an editable value. Adjust its related dimensions together.')

/** Keep affine parameter bindings authoritative when a common dimension changes. */
function parameterValue(parameter: AssemblyParameter, panels: Map<string, Panel>, panelId: (id: string) => string = id => id): number {
  const values = parameter.bindings.map(binding => {
    const panel = panels.get(panelId(binding.panelId))
    if (!panel) throw mismatch()
    return (panel[binding.dimension] - binding.offset) / binding.scale
  })
  if (!values.length || values.some(value => !Number.isFinite(value) || Math.abs(value - values[0]) > EPSILON)) throw mismatch()
  return Math.round(values[0] * 1e8) / 1e8
}

function sameShape(actual: Panel, expected: Panel): boolean {
  return (['width', 'height', 'thickness', 'holeSize', 'holeSpacing'] as const)
    .every(field => Math.abs(actual[field] - expected[field]) < EPSILON)
    && Math.abs((actual.cornerRadius ?? 0) - (expected.cornerRadius ?? 0)) < EPSILON
}

/** Refit a suppressed loose corner using its new panels, preserving its ID. */
function refitConnection(connection: Connection, panels: Map<string, Panel>): Connection {
  const parent = panels.get(connection.parentId), child = panels.get(connection.childId)
  if (!parent || !child) throw mismatch()
  const expected = (offset: number) => resolvePanels({ version: 1, name: 'Corner', panels: [parent, child],
    connections: [{ ...connection, offset, role: undefined }] })[1]
  const baseline = expected(connection.offset)
  const tangent = vector(expected(connection.offset + 1).position).sub(vector(baseline.position))
  const delta = vector(child.position).sub(vector(baseline.position))
  const offset = connection.offset + delta.dot(tangent) / tangent.lengthSq()
  if (!Number.isFinite(offset) || vector(expected(offset).position).distanceTo(vector(child.position)) > EPSILON) throw mismatch()
  return Math.abs(offset - connection.offset) < EPSILON ? connection : { ...connection, offset: Math.round(offset * 1e8) / 1e8 }
}

/**
 * Resize the materialized structure in one solve, then retain its authoritative
 * assembly sources, instance controls, and ports. A shared source must still
 * describe every instance exactly; inconsistent edits are rejected atomically.
 */
export function rescaleAssemblies(project: Project, resize: (project: Project, parameters?: readonly AssemblyParameter[], trofastWorld?: boolean) => Project): Project {
  const data = project.assemblies
  if (!data?.instances.length) return resize(project)
  const { assemblies: _data, ...plain } = project
  const worldParameters = data.instances.flatMap(instance => {
    const definition = data.definitions.find(item => item.id === instance.definitionId)!
    return (definition.parameters ?? []).map(parameter => ({ ...parameter,
      id: `${instance.id}/${parameter.id}`,
      defaultValue: instance.parameterValues?.[parameter.id] ?? parameter.defaultValue,
      bindings: parameter.bindings.map(binding => ({ ...binding, panelId: instance.panelIds[binding.panelId] })),
    }))
  })
  const desired = resize(plain, worldParameters)
  const desiredPanels = new Map(resolvePanels(desired).map(panel => [panel.id, panel]))
  const activeDefinitions = new Set(data.instances.map(instance => instance.definitionId))
  const definitions = data.definitions.map(definition => {
    if (!activeDefinitions.has(definition.id)) return definition
    const resized = resize(flat(definition), definition.parameters, false)
    const panels = new Map(resized.panels.map(panel => [panel.id, panel]))
    const parameters = definition.parameters?.map(parameter => ({ ...parameter, defaultValue: parameterValue(parameter, panels) }))
    return { ...definition, panels: resized.panels, connections: resized.connections,
      ...(parameters ? { parameters } : {}) }
  })
  const byDefinition = new Map(definitions.map(definition => [definition.id, definition]))
  const instances = data.instances.map(instance => {
    const definition = byDefinition.get(instance.definitionId)!
    const parameterValues: Record<string, number> = {}
    for (const parameter of definition.parameters ?? []) {
      const value = parameterValue(parameter, desiredPanels, id => instance.panelIds[id])
      // Explicit overrides stay explicit, including ones equal to the default.
      if (Object.hasOwn(instance.parameterValues ?? {}, parameter.id) || Math.abs(value - parameter.defaultValue) > EPSILON) parameterValues[parameter.id] = value
    }
    const local = resolvePanels(flat(evaluateAssemblyDefinition(definition, parameterValues)))
    const orientation = rotation(instance.rotation)
    const first = local[0], actualFirst = desiredPanels.get(instance.panelIds[first.id])!
    const position = vector(actualFirst.position).sub(vector(first.position).applyQuaternion(orientation))
    for (const panel of local) {
      const actual = desiredPanels.get(instance.panelIds[panel.id])
      if (!actual || !sameShape(actual, panel)
        || vector(panel.position).applyQuaternion(orientation).add(position).distanceTo(vector(actual.position)) > EPSILON
        || Math.abs(rotation(actual.rotation).dot(orientation.clone().multiply(rotation(panel.rotation)))) < 1 - EPSILON) throw mismatch()
    }
    return { ...instance, position: position.toArray() as Vec3,
      ...(Object.keys(parameterValues).length || instance.parameterValues ? { parameterValues } : {}) }
  })
  const loosePorts = data.loosePorts?.map(port => ({ ...port, connection: refitConnection(port.connection, desiredPanels) }))
  const next = materializeAssemblies({ ...desired, assemblies: { ...data, definitions, instances, ...(loosePorts ? { loosePorts } : {}) } })
  // Rebuilding shared corners may move hardware, but must never replace the
  // intended structure with a different shape or silently lose a panel.
  if (next.panels.length !== desired.panels.length || next.panels.some(panel => {
    const actual = desiredPanels.get(panel.id)
    return !actual || !sameShape(actual, panel) || vector(actual.position).distanceTo(vector(panel.position)) > EPSILON
  })) throw mismatch()
  return next
}
