import { Euler, Quaternion, Vector3 } from 'three'
import type { AssemblyData, AssemblyDefinition, AssemblyEndpoint, AssemblyFinish, AssemblyInstance, AssemblyLink, AssemblyLoosePort, AssemblyParameter, AssemblyPort, AttachmentOptions, Connection, Panel, Project, Vec3 } from './types'
import { attachPanel, getConnectorPlacements, getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { resizePanels } from './structure-edit'
import { evaluateAssemblyDefinition, parseAssemblyParameters, parseAssemblyParameterValues } from './assembly-parameters'

const uid = () => crypto.randomUUID()
const v = (value: Vec3) => new Vector3(...value)
const tuple = (value: Vector3): Vec3 => [value.x, value.y, value.z]
const q = (rotation: Vec3) => new Quaternion().setFromEuler(new Euler(...rotation))
const angles = (rotation: Quaternion): Vec3 => { const e = new Euler().setFromQuaternion(rotation); return [e.x, e.y, e.z] }
const jointId = (id: string) => id.replace(/:\d+$/, '')
const empty = (): AssemblyData => ({ definitions: [], instances: [], links: [] })
const flat = (definition: AssemblyDefinition): Project => ({ version: 1, name: definition.name, panels: definition.panels, connections: definition.connections })
const endpointKey = (endpoint: AssemblyEndpoint) => `${endpoint.instanceId ?? 'loose'}/${endpoint.portId}`
const internalId = (instance: AssemblyInstance, connectionId: string) => instance.connectionIds?.[connectionId] ?? `assembly/${instance.id}/${connectionId}`
const linkPrefix = (linkId: string) => `assembly-link/${linkId}`

function definitionFor(data: AssemblyData, instance: AssemblyInstance): AssemblyDefinition {
  const definition = data.definitions.find(item => item.id === instance.definitionId)
  if (!definition) throw new Error('This assembly has no source definition.')
  return definition
}

function evaluatedFor(data: AssemblyData, instance: AssemblyInstance): AssemblyDefinition {
  return evaluateAssemblyDefinition(definitionFor(data, instance), instance.parameterValues)
}

function instanceFor(project: Project, instanceId: string): AssemblyInstance {
  const instance = project.assemblies?.instances.find(item => item.id === instanceId)
  if (!instance) throw new Error('Choose an assembly instance.')
  return instance
}

export function getAssemblyInstance(project: Project, panelId: string): AssemblyInstance | undefined {
  return project.assemblies?.instances.find(instance => Object.values(instance.panelIds).includes(panelId))
}

function connectedPanelIds(project: Project, ids: Iterable<string>): Set<string> {
  const reached = new Set(ids)
  for (let changed = true; changed;) {
    changed = false
    for (const connection of project.connections) if (reached.has(connection.parentId) || reached.has(connection.childId)) {
      for (const id of [connection.parentId, connection.childId]) if (!reached.has(id)) { reached.add(id); changed = true }
    }
    for (const instance of project.assemblies?.instances ?? []) if (Object.values(instance.panelIds).some(id => reached.has(id))) {
      for (const id of Object.values(instance.panelIds)) if (!reached.has(id)) { reached.add(id); changed = true }
    }
  }
  return reached
}

export function isAssemblyConnected(project: Project, instanceId: string): boolean {
  return !!project.assemblies?.links.some(link => link.a.instanceId === instanceId || link.b.instanceId === instanceId)
}

export function isPanelConnectedToAssembly(project: Project, panelId: string): boolean {
  const reached = connectedPanelIds(project, [panelId])
  return !!project.assemblies?.instances.some(instance => Object.values(instance.panelIds).some(id => reached.has(id)))
}

export function getAssemblyMovementPanelIds(project: Project, instanceIds: readonly string[]): string[] {
  const selected = new Set(instanceIds)
  return [...connectedPanelIds(project, (project.assemblies?.instances ?? []).filter(instance => selected.has(instance.id)).flatMap(instance => Object.values(instance.panelIds)))]
}

function inferPorts(panels: Panel[], connections: Connection[]): AssemblyPort[] {
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const candidates = connections.filter(connection => connection.type === '90' && connection.count > 0 && connection.side !== 'front' && connection.side !== 'back')
  const centers = candidates.map(connection => getConnectorPlacements({ ...connection, count: 1 }, byId.get(connection.parentId)!, byId.get(connection.childId)!)[0].position)
  const center = centers.reduce((sum, position) => sum.add(v(position)), new Vector3()).multiplyScalar(1 / Math.max(1, centers.length))
  return candidates.map((connection, i) => {
    const offset = v(centers[i]).sub(center)
    const label = Math.abs(offset.x) > 1 && Math.abs(offset.y) > 1
      ? `${offset.y > 0 ? 'Top' : 'Bottom'} ${offset.x > 0 ? 'right' : 'left'}` : `Corner ${i + 1}`
    return { id: jointId(connection.id), connectionId: connection.id, label }
  })
}

interface PortFrame { position: Vec3; rotation: Vec3; connection: Connection; panels: [Panel, Panel] }
function localPort(definition: AssemblyDefinition, portId: string): PortFrame {
  const port = definition.ports.find(item => item.id === portId)
  const connection = port && definition.connections.find(item => item.id === port.connectionId)
  if (!connection || connection.type !== '90') throw new Error('This assembly corner is unavailable.')
  const panels = resolvePanels(flat(definition))
  const parent = panels.find(panel => panel.id === connection.parentId)!, child = panels.find(panel => panel.id === connection.childId)!
  if (!parent || !child) throw new Error('This corner refers to a missing panel.')
  return { ...getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0], connection, panels: [parent, child] }
}

function worldPort(data: AssemblyData, endpoint: AssemblyEndpoint, panels: Panel[] = []): PortFrame {
  if (!endpoint.instanceId) {
    const connection = data.loosePorts?.find(port => port.id === endpoint.portId)?.connection
    const parent = connection && panels.find(panel => panel.id === connection.parentId), child = connection && panels.find(panel => panel.id === connection.childId)
    if (!connection || !parent || !child) throw new Error('This shared corner refers to missing loose panels.')
    return { ...getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0], connection, panels: [parent, child] }
  }
  const instance = data.instances.find(item => item.id === endpoint.instanceId)
  if (!instance) throw new Error('This connection refers to a missing instance.')
  const port = localPort(evaluatedFor(data, instance), endpoint.portId)
  const rotation = q(instance.rotation)
  return { ...port, position: tuple(v(port.position).applyQuaternion(rotation).add(v(instance.position))), rotation: angles(rotation.multiply(q(port.rotation))) }
}

function placeAtPort(data: AssemblyData, source: AssemblyInstance, sourcePortId: string, target: AssemblyEndpoint): AssemblyInstance {
  const sourcePort = localPort(evaluatedFor(data, source), sourcePortId)
  const targetPort = worldPort(data, target)
  const rotation = q(targetPort.rotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)).multiply(q(sourcePort.rotation).invert())
  return { ...source, rotation: angles(rotation), position: tuple(v(targetPort.position).sub(v(sourcePort.position).applyQuaternion(rotation))) }
}

function complementary(first: PortFrame, second: PortFrame): boolean {
  if (v(first.position).distanceTo(v(second.position)) > 0.05) return false
  const a = q(first.rotation), b = q(second.rotation)
  const ax = new Vector3(1, 0, 0).applyQuaternion(a), az = new Vector3(0, 0, 1).applyQuaternion(a)
  const bx = new Vector3(1, 0, 0).applyQuaternion(b), bz = new Vector3(0, 0, 1).applyQuaternion(b)
  return (ax.dot(bx) < -0.9999 && az.dot(bz) < -0.9999) || (ax.dot(bz) < -0.9999 && az.dot(bx) < -0.9999)
}

function restoreLoose(project: Project, oldData: AssemblyData): { panels: Panel[]; connections: Connection[] } {
  const managedPanels = new Set(oldData.instances.flatMap(instance => Object.values(instance.panelIds)))
  const managedConnections = new Set(oldData.instances.flatMap(instance => definitionFor(oldData, instance).connections.map(connection => internalId(instance, connection.id))))
  const prefixes = oldData.links.map(link => `${linkPrefix(link.id)}:`)
  return {
    panels: resolvePanels(project).filter(panel => !managedPanels.has(panel.id)),
    connections: project.connections.filter(connection => !managedConnections.has(connection.id) && !prefixes.some(prefix => connection.id.startsWith(prefix))),
  }
}

function crossConnections(link: AssemblyLink, data: AssemblyData, panels: Panel[]): Connection[] {
  const a = worldPort(data, link.a, panels), b = worldPort(data, link.b, panels)
  if (!complementary(a, b)) throw new Error('The connected assembly corners no longer align. Keep matching dimensions or disconnect this instance first.')
  const aInstance = data.instances.find(instance => instance.id === link.a.instanceId), bInstance = data.instances.find(instance => instance.id === link.b.instanceId)
  const ids = [...a.panels.map(panel => aInstance ? aInstance.panelIds[panel.id] : panel.id), ...b.panels.map(panel => bInstance ? bInstance.panelIds[panel.id] : panel.id)]
  const members = ids.map(id => panels.find(panel => panel.id === id)!)
  if (members.some(panel => panel.thickness < 18 || panel.thickness > 19)) throw new Error('Cross connectors at assembly corners need 18–19 mm panels.')
  const parent = members[0]
  const remaining = new Set(members.slice(1))
  const result: Connection[] = []
  for (let branch = 0; branch < 3; branch++) {
    for (const child of remaining) {
      const connection: Connection = { ...a.connection, id: `${linkPrefix(link.id)}:${branch}`, parentId: parent.id, childId: child.id,
        type: 'cross', count: branch === 0 ? Math.max(a.connection.count, b.connection.count) : 0, role: 'support' }
      const test: Project = { version: 1, name: 'Corner', panels: [parent, child], connections: [{ ...connection, role: undefined }] }
      const expected = resolvePanels(test)[1]
      const er = q(expected.rotation), cr = q(child.rotation)
      const aligned = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].every(axis => Math.abs(axis.clone().applyQuaternion(er).dot(axis.clone().applyQuaternion(cr))) > 0.9999)
      if (v(expected.position).distanceTo(v(child.position)) < 0.1 && aligned) { result.push(connection); remaining.delete(child); break }
    }
  }
  if (remaining.size) throw new Error('These corners cannot share a cross connector. Use matching panel depths and aligned edges.')
  return result
}

function rebuild(project: Project, data: AssemblyData, oldData = project.assemblies ?? empty()): Project {
  const loose = restoreLoose(project, oldData)
  const panels = [...loose.panels]
  const connections = [...loose.connections]
  const occupied = new Set(data.links.flatMap(link => [endpointKey(link.a), endpointKey(link.b)]))
  const activeLoose = new Set(data.links.flatMap(link => [link.a, link.b].filter(endpoint => !endpoint.instanceId).map(endpoint => endpoint.portId)))
  const loosePorts = new Map([...(oldData.loosePorts ?? []), ...(data.loosePorts ?? [])].map(port => [port.id, port]))
  for (const port of loosePorts.values()) if (!activeLoose.has(port.id)
    && [port.connection.parentId, port.connection.childId].every(id => panels.some(panel => panel.id === id))
    && !connections.some(connection => connection.id === port.connection.id)) connections.push({ ...port.connection, role: 'support' })
  if (data.loosePorts !== undefined) data = { ...data, loosePorts: data.loosePorts.filter(port => activeLoose.has(port.id)) }
  for (const instance of data.instances) {
    const definition = evaluatedFor(data, instance)
    const rotation = q(instance.rotation)
    for (const panel of resolvePanels(flat(definition))) panels.push({ ...panel, ...instance.finish, id: instance.panelIds[panel.id],
      position: tuple(v(panel.position).applyQuaternion(rotation).add(v(instance.position))), rotation: angles(rotation.clone().multiply(q(panel.rotation))) })
    const suppressed = new Set(definition.ports.filter(port => occupied.has(endpointKey({ instanceId: instance.id, portId: port.id }))).map(port => jointId(port.connectionId)))
    for (const connection of definition.connections) if (!suppressed.has(jointId(connection.id))) connections.push({ ...connection,
      id: internalId(instance, connection.id), parentId: instance.panelIds[connection.parentId], childId: instance.panelIds[connection.childId], role: 'support' })
  }
  for (const link of data.links) connections.push(...crossConnections(link, data, panels))
  if (panels.length > 200 || connections.length > 400) throw new Error('Projects support up to 200 panels and 400 connections.')
  if (panels.some(panel => panel.position.some(number => !Number.isFinite(number) || Math.abs(number) > 100000))) throw new Error('This assembly would exceed the project placement limits.')
  return { ...project, assemblies: data, panels, connections }
}

export function materializeAssemblies(project: Project): Project {
  return project.assemblies ? rebuild(project, project.assemblies) : project
}

function ensureValid(next: Project, previous?: Project, collisionIds?: Set<string>): Project {
  const previousErrors = new Set(previous ? validateProject(previous).filter(issue => issue.severity === 'error').map(issue => issue.id) : [])
  const issue = validateProject(next).find(item => (item.severity === 'error' && !previousErrors.has(item.id))
    || (item.id.startsWith('collision-') && (!collisionIds || item.panelIds.some(id => collisionIds.has(id)))))
  if (issue) throw new Error(issue.message)
  return next
}

export function createAssembly(project: Project, selectedPanelIds: readonly string[], name = 'Box', parameters: AssemblyParameter[] = []): Project {
  const ids = new Set(selectedPanelIds)
  const panels = resolvePanels(project).filter(panel => ids.has(panel.id))
  if (panels.length < 2) throw new Error('Select at least two connected panels to create an assembly.')
  if (panels.some(panel => getAssemblyInstance(project, panel.id))) throw new Error('These panels already belong to an assembly. Edit its source or make it independent.')
  if (project.connections.some(connection => ids.has(connection.parentId) !== ids.has(connection.childId))) throw new Error('Select the complete connected assembly, including every connected panel.')
  const connections = project.connections.filter(connection => ids.has(connection.parentId) && ids.has(connection.childId))
  const reached = new Set([panels[0].id])
  for (let changed = true; changed;) { changed = false; for (const connection of connections) if (reached.has(connection.parentId) || reached.has(connection.childId)) {
    for (const id of [connection.parentId, connection.childId]) if (!reached.has(id)) { reached.add(id); changed = true }
  } }
  if (reached.size !== panels.length) throw new Error('An assembly must be one connected set of panels.')
  const bounds = getProjectBounds(panels), center = tuple(v(bounds.min).add(v(bounds.max)).multiplyScalar(0.5))
  const local = panels.map(panel => ({ ...panel, position: tuple(v(panel.position).sub(v(center))) }))
  let definition: AssemblyDefinition = { id: uid(), name: name.trim().slice(0, 120) || 'Assembly', panels: local, connections: connections.map(connection => ({ ...connection })), ports: inferPorts(local, connections) }
  if (parameters.length) definition = evaluateAssemblyDefinition({ ...definition, parameters: parseAssemblyParameters(parameters, local) })
  const instance: AssemblyInstance = { id: uid(), definitionId: definition.id, name: definition.name, position: center, rotation: [0, 0, 0], panelIds: Object.fromEntries(local.map(panel => [panel.id, panel.id])), connectionIds: Object.fromEntries(connections.map(connection => [connection.id, connection.id])) }
  const data = project.assemblies ?? empty()
  const base = { ...project, panels: project.panels.filter(panel => !ids.has(panel.id)), connections: project.connections.filter(connection => !ids.has(connection.parentId)) }
  return ensureValid(rebuild(base, { ...data, definitions: [...data.definitions, definition], instances: [...data.instances, instance] }), project, parameters.length ? ids : new Set())
}

function newInstance(data: AssemblyData, definition: AssemblyDefinition, source?: AssemblyInstance): AssemblyInstance {
  const number = data.instances.filter(instance => instance.definitionId === definition.id).length + 1
  const jointIds = new Map<string, string>()
  const connectionIds = Object.fromEntries(definition.connections.map(connection => {
    const joint = jointId(connection.id)
    if (!jointIds.has(joint)) jointIds.set(joint, uid())
    return [connection.id, `${jointIds.get(joint)}:${connection.id.match(/:(\d+)$/)?.[1] ?? '0'}`]
  }))
  // A clipboard copy may outlive a source control that was removed meanwhile.
  const parameterValues = source?.parameterValues && Object.fromEntries(Object.entries(source.parameterValues)
    .filter(([id]) => definition.parameters?.some(parameter => parameter.id === id)))
  return { id: uid(), definitionId: definition.id, name: `${definition.name} ${number}`, position: source ? [...source.position] : [0, 0, 0], rotation: source ? [...source.rotation] : [0, 0, 0],
    panelIds: Object.fromEntries(definition.panels.map(panel => [panel.id, uid()])), connectionIds, ...(source?.finish ? { finish: { ...source.finish } } : {}),
    ...(parameterValues && Object.keys(parameterValues).length ? { parameterValues } : {}) }
}

function separateInstance(project: Project, data: AssemblyData, instanceId: string): AssemblyData {
  const instance = data.instances.find(item => item.id === instanceId)!
  const definition = evaluatedFor(data, instance)
  const panelBounds = getProjectBounds(resolvePanels(project).filter(panel => !Object.values(instance.panelIds).includes(panel.id)))
  const ownPanels = resolvePanels(flat(definition)).map(panel => ({ ...panel, position: tuple(v(panel.position).applyQuaternion(q(instance.rotation)).add(v(instance.position))), rotation: angles(q(instance.rotation).multiply(q(panel.rotation))) }))
  const ownBounds = getProjectBounds(ownPanels)
  const delta = project.panels.length ? panelBounds.max[0] + 120 - ownBounds.min[0] : 0
  return { ...data, instances: data.instances.map(item => item.id === instanceId ? { ...item, position: [item.position[0] + delta, item.position[1], item.position[2]] } : item) }
}

export function instantiateAssembly(project: Project, definitionId: string): Project {
  const data = project.assemblies ?? empty(), definition = data.definitions.find(item => item.id === definitionId)
  if (!definition) throw new Error('Choose an assembly source.')
  const instance = newInstance(data, definition)
  instance.position[1] = -getProjectBounds(resolvePanels(flat(evaluateAssemblyDefinition(definition)))).min[1]
  const nextData = separateInstance(project, { ...data, instances: [...data.instances, instance] }, instance.id)
  return ensureValid(rebuild(project, nextData), project, new Set(Object.values(instance.panelIds)))
}

export function duplicateAssembly(project: Project, instanceId: string): Project {
  const source = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, source)
  const instance = newInstance(data, definition, source)
  const nextData = separateInstance(project, { ...data, instances: [...data.instances, instance] }, instance.id)
  return ensureValid(rebuild(project, nextData), project, new Set(Object.values(instance.panelIds)))
}

export interface AssemblyAttachmentTarget { id: string; label: string; position: Vec3; project?: Project; error?: string }

function withMatchingLinks(data: AssemblyData, instanceId: string): AssemblyData {
  const instance = data.instances.find(item => item.id === instanceId)!, definition = definitionFor(data, instance)
  const links = [...data.links], used = new Set(links.flatMap(link => [endpointKey(link.a), endpointKey(link.b)]))
  for (const port of definition.ports) {
    const a = { instanceId, portId: port.id }
    if (used.has(endpointKey(a))) continue
    for (const other of data.instances) {
      if (other.id === instanceId) continue
      for (const otherPort of definitionFor(data, other).ports) {
        const b = { instanceId: other.id, portId: otherPort.id }
        if (used.has(endpointKey(a)) || used.has(endpointKey(b))) continue
        if (complementary(worldPort(data, a), worldPort(data, b))) { links.push({ id: uid(), a: b, b: a }); used.add(endpointKey(a)); used.add(endpointKey(b)) }
      }
    }
  }
  return { ...data, links }
}

export function getAssemblyAttachmentTargets(project: Project, instanceId: string, sourceInstanceId?: string, copiedSource?: AssemblyInstance): AssemblyAttachmentTarget[] {
  const target = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, target)
  if (sourceInstanceId === instanceId) return []
  const source = sourceInstanceId ? instanceFor(project, sourceInstanceId) : copiedSource ? newInstance(data, definitionFor(data, copiedSource), copiedSource) : newInstance(data, definition, target)
  if (sourceInstanceId && data.links.some(link => link.a.instanceId === sourceInstanceId || link.b.instanceId === sourceInstanceId)) return [{ id: 'connected', label: 'Disconnect first', position: source.position, error: 'Disconnect this instance before attaching it somewhere else.' }]
  const sourceDefinition = definitionFor(data, source)
  const occupied = new Set(data.links.flatMap(link => [endpointKey(link.a), endpointKey(link.b)]))
  return definition.ports.filter(port => !occupied.has(endpointKey({ instanceId, portId: port.id }))).map(port => {
    const endpoint = { instanceId, portId: port.id }, position = worldPort(data, endpoint).position
    const options = sourceDefinition.ports.map(sourcePort => {
      const placed = placeAtPort(data, source, sourcePort.id, endpoint)
      const score = Math.abs(q(placed.rotation).dot(q(source.rotation)))
      return { placed, score }
    }).sort((a, b) => b.score - a.score)
    let error = 'This assembly has no compatible corner.'
    for (const { placed } of options) {
      try {
        let nextData = { ...data, instances: sourceInstanceId ? data.instances.map(item => item.id === source.id ? placed : item) : [...data.instances, placed] }
        nextData = withMatchingLinks(nextData, placed.id)
        if (!nextData.links.some(link => endpointKey(link.a) === endpointKey(endpoint) || endpointKey(link.b) === endpointKey(endpoint))) continue
        const next = ensureValid(rebuild(project, nextData), project, new Set(Object.values(placed.panelIds)))
        return { id: `${instanceId}/${port.id}`, label: port.label, position, project: next }
      } catch (reason) { error = reason instanceof Error ? reason.message : 'This corner cannot be connected.' }
    }
    return { id: `${instanceId}/${port.id}`, label: port.label, position, error }
  })
}

/** Place a copied instance by one of its panels while retaining its rigid design. */
export function attachAssemblyCopyToPanel(project: Project, source: AssemblyInstance, parentId: string, options: AttachmentOptions): Project {
  const data = project.assemblies!, currentDefinition = definitionFor(data, source)
  const parameterValues = Object.fromEntries(Object.entries(source.parameterValues ?? {})
    .filter(([id]) => currentDefinition.parameters?.some(parameter => parameter.id === id)))
  source = { ...source, parameterValues }
  const definition = evaluatedFor(data, source)
  let error: unknown = new Error('This assembly cannot fit on this edge.')
  for (const panel of resolvePanels(flat(definition))) {
    try {
      const instance = newInstance(data, definition, source)
      const child = { ...panel, ...instance.finish, id: instance.panelIds[panel.id] }
      const attached = attachPanel(project, parentId, child, options)
      const placed = attached.panels.at(-1)!
      const rotation = q(placed.rotation).multiply(q(panel.rotation).invert())
      instance.rotation = angles(rotation)
      instance.position = tuple(v(placed.position).sub(v(panel.position).applyQuaternion(rotation)))
      const next = rebuild(project, { ...data, instances: [...data.instances, instance] })
      next.connections.push({ ...attached.connections.at(-1)!, role: 'support' })
      return ensureValid(next, project, new Set(Object.values(instance.panelIds)))
    } catch (reason) { error = reason }
  }
  throw error
}

export function removeAssembly(project: Project, instanceId: string): Project {
  const removed = instanceFor(project, instanceId)
  const data = project.assemblies!
  const removedIds = new Set(Object.values(removed.panelIds))
  const base = { ...project, connections: project.connections.filter(connection => !removedIds.has(connection.parentId) && !removedIds.has(connection.childId)) }
  return rebuild(base, { ...data, instances: data.instances.filter(instance => instance.id !== instanceId), links: data.links.filter(link => link.a.instanceId !== instanceId && link.b.instanceId !== instanceId) })
}

export function disconnectAssembly(project: Project, instanceId: string): Project {
  instanceFor(project, instanceId)
  const data = project.assemblies!
  const links = data.links.filter(link => link.a.instanceId !== instanceId && link.b.instanceId !== instanceId)
  if (links.length === data.links.length) return project
  return rebuild(project, separateInstance(project, { ...data, links }, instanceId))
}

/** Bake only this instance; mixed corner joints retain their existing hardware. */
export function disassembleAssembly(project: Project, instanceId: string): Project {
  const instance = instanceFor(project, instanceId), data = project.assemblies!, definition = evaluatedFor(data, instance)
  const loosePorts = [...(data.loosePorts ?? [])]
  const convert = (endpoint: AssemblyEndpoint): AssemblyEndpoint => {
    if (endpoint.instanceId !== instanceId) return endpoint
    const original = localPort(definition, endpoint.portId).connection
    const port: AssemblyLoosePort = { id: uid(), connection: { ...original, id: internalId(instance, original.id),
      parentId: instance.panelIds[original.parentId], childId: instance.panelIds[original.childId], role: 'support' } }
    loosePorts.push(port)
    return { portId: port.id }
  }
  const links = data.links.map(link => ({ ...link, a: convert(link.a), b: convert(link.b) }))
    // A joint between two ordinary corners is now ordinary project hardware.
    // Leaving its materialized connections in place makes every panel editable.
    .filter(link => link.a.instanceId || link.b.instanceId)
  const used = new Set(links.flatMap(link => [link.a, link.b].filter(endpoint => !endpoint.instanceId).map(endpoint => endpoint.portId)))
  return { ...project, assemblies: { ...data, instances: data.instances.filter(item => item.id !== instanceId), links,
    loosePorts: loosePorts.filter(port => used.has(port.id)) } }
}

/** Explicit detach/remove restores both ordinary corners before editing panels. */
export function releaseAssemblyLinksForPanels(project: Project, panelIds: readonly string[]): Project {
  const data = project.assemblies
  if (!data?.loosePorts?.length) return project
  const selected = new Set(panelIds)
  const ports = new Set(data.loosePorts.filter(port => selected.has(port.connection.parentId) || selected.has(port.connection.childId)).map(port => port.id))
  const links = data.links.filter(link => ![link.a, link.b].some(endpoint => !endpoint.instanceId && ports.has(endpoint.portId)))
  return links.length === data.links.length ? project : rebuild(project, { ...data, links })
}

export function makeAssemblyIndependent(project: Project, instanceId: string): Project {
  const instance = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, instance)
  const copy: AssemblyDefinition = { ...structuredClone(definition), id: uid(), name: `${definition.name.slice(0, 108)} independent` }
  return rebuild(project, { ...data, definitions: [...data.definitions, copy], instances: data.instances.map(item => item.id === instanceId ? { ...item, definitionId: copy.id } : item) })
}

export function renameAssembly(project: Project, instanceId: string, name: string): Project {
  instanceFor(project, instanceId)
  const data = project.assemblies!
  return rebuild(project, { ...data, instances: data.instances.map(instance => instance.id === instanceId ? { ...instance, name: name.trim().slice(0, 120) || 'Assembly' } : instance) })
}

export function updateAssemblyFinish(project: Project, instanceId: string, finish: AssemblyFinish): Project {
  instanceFor(project, instanceId)
  if (finish.color !== undefined && !/^#[\da-f]{6}$/i.test(finish.color)) throw new Error('Choose a valid finish color.')
  if (finish.material !== undefined && !['birch', 'oak', 'walnut', 'mdf', 'painted'].includes(finish.material)) throw new Error('Choose a valid panel material.')
  const data = project.assemblies!
  return rebuild(project, { ...data, instances: data.instances.map(instance => instance.id === instanceId ? { ...instance, finish: { ...instance.finish, ...finish } } : instance) })
}

export function resetAssemblyFinish(project: Project, instanceId: string): Project {
  instanceFor(project, instanceId)
  const data = project.assemblies!
  return rebuild(project, { ...data, instances: data.instances.map(instance => { if (instance.id !== instanceId) return instance; const { finish: _finish, ...rest } = instance; return rest }) })
}

function solveInstancePlacements(data: AssemblyData): AssemblyData {
  const instances = [...data.instances], visited = new Set<string>()
  for (const root of instances) {
    if (visited.has(root.id)) continue
    visited.add(root.id)
    const queue = [root.id]
    while (queue.length) {
      const current = queue.shift()!
      for (const link of data.links) {
        const target = link.a.instanceId === current ? link.a : link.b.instanceId === current ? link.b : undefined
        if (!target) continue
        const source = target === link.a ? link.b : link.a
        if (!source.instanceId) continue
        if (visited.has(source.instanceId)) continue
        const index = instances.findIndex(instance => instance.id === source.instanceId)
        instances[index] = placeAtPort({ ...data, instances }, instances[index], source.portId, target)
        visited.add(source.instanceId); queue.push(source.instanceId)
      }
    }
  }
  return { ...data, instances }
}

/** Author the shared controls; existing instances retain their own overrides. */
export function updateAssemblyParameters(project: Project, instanceId: string, parameters: AssemblyParameter[]): Project {
  const instance = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, instance)
  const parsed = parseAssemblyParameters(parameters, definition.panels)
  if (JSON.stringify(parsed) === JSON.stringify(definition.parameters ?? [])) return project
  const nextDefinition = evaluateAssemblyDefinition({ ...definition, parameters: parsed })
  const allowed = new Set(parsed.map(parameter => parameter.id))
  const instances = data.instances.map(item => {
    if (item.definitionId !== definition.id || !item.parameterValues) return item
    const { parameterValues: previous, ...rest } = item
    const parameterValues = Object.fromEntries(Object.entries(previous).filter(([id]) => allowed.has(id)))
    return Object.keys(parameterValues).length ? { ...rest, parameterValues } : rest
  })
  const nextData = solveInstancePlacements({ ...data, instances, definitions: data.definitions.map(item => item.id === definition.id ? nextDefinition : item) })
  return ensureValid(rebuild(project, nextData), project)
}

/** Change only this instance. An undefined entry restores its source default. */
export function updateAssemblyParameterValues(project: Project, instanceId: string, values: Record<string, number | undefined>): Project {
  const instance = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, instance)
  const parameters = definition.parameters ?? []
  const parameterValues: Record<string, number> = Object.assign(Object.create(null), instance.parameterValues)
  for (const [id, value] of Object.entries(values)) {
    if (!parameters.some(parameter => parameter.id === id)) throw new Error('Choose a configurable value from this assembly source.')
    if (value === undefined) delete parameterValues[id]
    else parameterValues[id] = value
  }
  const checked = parseAssemblyParameterValues(parameterValues, parameters)
  if (JSON.stringify(checked) === JSON.stringify(instance.parameterValues ?? {})) return project
  const { parameterValues: _previous, ...rest } = instance
  const nextInstance = Object.keys(checked).length ? { ...rest, parameterValues: checked } : rest
  const nextData = solveInstancePlacements({ ...data, instances: data.instances.map(item => item.id === instanceId ? nextInstance : item) })
  return ensureValid(rebuild(project, nextData), project)
}

export function resetAssemblyParameterValues(project: Project, instanceId: string): Project {
  const instance = instanceFor(project, instanceId)
  return updateAssemblyParameterValues(project, instanceId, Object.fromEntries(Object.keys(instance.parameterValues ?? {}).map(id => [id, undefined])))
}

export function updateAssemblyDefinition(project: Project, instanceId: string, patch: Partial<Panel>, partIds?: readonly string[]): Project {
  const instance = instanceFor(project, instanceId), data = project.assemblies!, definition = definitionFor(data, instance)
  const ids = new Set(partIds ?? definition.panels.map(panel => panel.id))
  if (![...ids].every(id => definition.panels.some(panel => panel.id === id))) throw new Error('Choose panels from this assembly source.')
  const editable = ['name', 'width', 'height', 'thickness', 'material', 'color', 'pattern', 'visible', 'holeSize', 'holeSpacing'] as const
  const entries = editable.flatMap(key => patch[key] === undefined ? [] : [[key, patch[key]] as const])
  // A restored field can commit again on blur after a rejected edit. Preserve
  // the exact project and undo history rather than solving unchanged geometry.
  if (definition.panels.filter(panel => ids.has(panel.id)).every(panel => entries.every(([key, value]) => panel[key] === value))) return project
  const controlled = definition.parameters?.flatMap(parameter => parameter.bindings) ?? []
  if (controlled.some(binding => ids.has(binding.panelId) && patch[binding.dimension] !== undefined
    && definition.panels.find(panel => panel.id === binding.panelId)![binding.dimension] !== patch[binding.dimension])) {
    throw new Error('This dimension is controlled by an editable value. Edit its default in Editable values, or remove that dimension from the value first.')
  }
  const { width, height, ...properties } = Object.fromEntries(entries) as Partial<Panel>
  let edited: Project = { ...flat(definition), panels: definition.panels.map(panel => ids.has(panel.id) ? { ...panel, ...properties } : panel) }
  if (width !== undefined || height !== undefined) edited = resizePanels(edited, [...ids], { width, height })
  edited = parseProject({ ...edited, panels: resolvePanels(edited) })
  ensureValid(edited)
  if (controlled.some(binding => Math.abs(edited.panels.find(panel => panel.id === binding.panelId)![binding.dimension]
    - definition.panels.find(panel => panel.id === binding.panelId)![binding.dimension]) > 1e-6)) {
    throw new Error('This edit would change a dimension controlled by a configurable value. Edit the configurable value instead.')
  }
  const nextDefinition = { ...definition, panels: edited.panels, connections: edited.connections }
  const nextData = solveInstancePlacements({ ...data, definitions: data.definitions.map(item => item.id === definition.id ? nextDefinition : item) })
  return ensureValid(rebuild(project, nextData), project)
}

export function moveAssemblies(project: Project, instanceIds: readonly string[], delta: Vec3): Project {
  if (!delta.every(Number.isFinite)) throw new Error('Assembly movement must be finite.')
  const data = project.assemblies
  if (!data) return project
  if (delta.every(number => number === 0)) return project
  const panelIds = new Set(getAssemblyMovementPanelIds(project, instanceIds))
  const managed = new Set(data.instances.flatMap(instance => Object.values(instance.panelIds)))
  const base = { ...project, panels: project.panels.map(panel => panelIds.has(panel.id) && !managed.has(panel.id) ? { ...panel, position: tuple(v(panel.position).add(v(delta))) } : panel) }
  const nextData = { ...data, instances: data.instances.map(instance => Object.values(instance.panelIds).some(id => panelIds.has(id)) ? { ...instance, position: tuple(v(instance.position).add(v(delta))) } : instance) }
  const next = rebuild(base, nextData)
  if (next.panels.some(panel => panel.position.some(value => Math.abs(value) > 100000))) throw new Error('This move exceeds the project placement limits.')
  return next
}

/** Validate authoritative metadata and require its materialized geometry to agree. */
export function parseAssemblyData(value: unknown, project: Project): AssemblyData {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  const text = (item: unknown): string => { if (typeof item !== 'string' || !item.length || item.length > 200) throw new Error('Invalid assembly identifier or name.'); return item }
  const vector = (item: unknown): Vec3 => { if (!Array.isArray(item) || item.length !== 3 || !item.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 100000)) throw new Error('Invalid assembly transform.'); return item as Vec3 }
  if (!record(value) || !Array.isArray(value.definitions) || !Array.isArray(value.instances) || !Array.isArray(value.links) || value.definitions.length > 200 || value.instances.length > 200 || value.links.length > 400) throw new Error('Invalid assembly metadata.')
  const definitions: AssemblyDefinition[] = value.definitions.map(raw => {
    if (!record(raw) || !Array.isArray(raw.ports)) throw new Error('Invalid assembly source.')
    const parsed = parseProject({ version: 1, name: raw.name, panels: raw.panels, connections: raw.connections })
    const ports = raw.ports.map((port): AssemblyPort => {
      if (!record(port)) throw new Error('Invalid assembly corner.')
      const result = { id: text(port.id), connectionId: text(port.connectionId), label: text(port.label) }
      const connection = parsed.connections.find(item => item.id === result.connectionId)
      if (!connection || connection.type !== '90' || connection.count < 1 || connection.side === 'front' || connection.side === 'back') throw new Error('Assembly corners must refer to an edge corner joint.')
      return result
    })
    if (new Set(ports.map(port => port.id)).size !== ports.length || new Set(ports.map(port => port.connectionId)).size !== ports.length) throw new Error('Assembly corners must be unique.')
    return { id: text(raw.id), name: parsed.name, panels: parsed.panels, connections: parsed.connections, ports,
      ...(raw.parameters === undefined ? {} : { parameters: parseAssemblyParameters(raw.parameters, parsed.panels) }) }
  })
  if (new Set(definitions.map(definition => definition.id)).size !== definitions.length) throw new Error('Assembly source IDs must be unique.')
  const allPanelIds = new Set<string>()
  const allConnectionIds = new Set<string>()
  const instances: AssemblyInstance[] = value.instances.map(raw => {
    if (!record(raw) || !record(raw.panelIds)) throw new Error('Invalid assembly instance.')
    const definitionId = text(raw.definitionId), definition = definitions.find(item => item.id === definitionId)
    if (!definition || Object.keys(raw.panelIds).length !== definition.panels.length) throw new Error('An assembly instance has a missing source or panel mapping.')
    const panelIds = Object.fromEntries(definition.panels.map(panel => {
      const id = text((raw.panelIds as Record<string, unknown>)[panel.id])
      if (allPanelIds.has(id) || !project.panels.some(item => item.id === id)) throw new Error('Assembly panel mappings must be unique and refer to existing panels.')
      allPanelIds.add(id)
      return [panel.id, id]
    }))
    const instance: AssemblyInstance = { id: text(raw.id), definitionId, name: text(raw.name), position: vector(raw.position), rotation: vector(raw.rotation), panelIds }
    if (raw.connectionIds !== undefined) {
      if (!record(raw.connectionIds) || Object.keys(raw.connectionIds).length !== definition.connections.length) throw new Error('Invalid assembly connector mapping.')
      instance.connectionIds = Object.fromEntries(definition.connections.map(connection => {
        const id = text((raw.connectionIds as Record<string, unknown>)[connection.id])
        if (allConnectionIds.has(id)) throw new Error('Assembly connector mappings must be unique.')
        allConnectionIds.add(id)
        return [connection.id, id]
      }))
    }
    if (raw.finish !== undefined) {
      if (!record(raw.finish) || Object.keys(raw.finish).some(key => key !== 'color' && key !== 'material')) throw new Error('Invalid assembly finish override.')
      const finish: AssemblyFinish = {}
      if (raw.finish.color !== undefined) { if (typeof raw.finish.color !== 'string' || !/^#[\da-f]{6}$/i.test(raw.finish.color)) throw new Error('Invalid assembly finish color.'); finish.color = raw.finish.color }
      if (raw.finish.material !== undefined) { if (typeof raw.finish.material !== 'string' || !['birch', 'oak', 'walnut', 'mdf', 'painted'].includes(raw.finish.material)) throw new Error('Invalid assembly material.'); finish.material = raw.finish.material as AssemblyFinish['material'] }
      instance.finish = finish
    }
    if (raw.parameterValues !== undefined) instance.parameterValues = parseAssemblyParameterValues(raw.parameterValues, definition.parameters ?? [])
    return instance
  })
  if (new Set(instances.map(instance => instance.id)).size !== instances.length) throw new Error('Assembly instance IDs must be unique.')
  let loosePorts: AssemblyLoosePort[] | undefined
  if (value.loosePorts !== undefined) {
    if (!Array.isArray(value.loosePorts) || value.loosePorts.length > 400) throw new Error('Invalid loose assembly corners.')
    loosePorts = value.loosePorts.map(raw => {
      if (!record(raw) || !record(raw.connection)) throw new Error('Invalid loose assembly corner.')
      const parsed = parseProject({ version: 1, name: 'Loose corner', panels: project.panels, connections: [raw.connection] })
      const connection = parsed.connections[0]
      if (connection.type !== '90' || connection.role !== 'support' || connection.side === 'front' || connection.side === 'back'
        || allPanelIds.has(connection.parentId) || allPanelIds.has(connection.childId) || project.connections.some(item => item.id === connection.id)) throw new Error('A loose corner must reference two ordinary panels and its suppressed corner connector.')
      return { id: text(raw.id), connection }
    })
    if (new Set(loosePorts.map(port => port.id)).size !== loosePorts.length || new Set(loosePorts.map(port => port.connection.id)).size !== loosePorts.length) throw new Error('Loose assembly corners must be unique.')
  }
  const usedPorts = new Set<string>()
  const endpoint = (raw: unknown): AssemblyEndpoint => {
    if (!record(raw)) throw new Error('Invalid assembly connection endpoint.')
    const result: AssemblyEndpoint = { ...(raw.instanceId === undefined ? {} : { instanceId: text(raw.instanceId) }), portId: text(raw.portId) }
    const instance = instances.find(item => item.id === result.instanceId)
    const found = result.instanceId ? instance && definitions.find(item => item.id === instance.definitionId)!.ports.some(port => port.id === result.portId)
      : loosePorts?.some(port => port.id === result.portId)
    if (!found || usedPorts.has(endpointKey(result))) throw new Error('An assembly corner is missing or connected more than once.')
    usedPorts.add(endpointKey(result)); return result
  }
  const links: AssemblyLink[] = value.links.map(raw => {
    if (!record(raw)) throw new Error('Invalid assembly connection.')
    const link = { id: text(raw.id), a: endpoint(raw.a), b: endpoint(raw.b) }
    if (link.a.instanceId === link.b.instanceId) throw new Error('A shared assembly connection needs distinct endpoints and at least one instance.')
    return link
  })
  if (new Set(links.map(link => link.id)).size !== links.length) throw new Error('Assembly connection IDs must be unique.')
  if (loosePorts?.some(port => !usedPorts.has(endpointKey({ portId: port.id })))) throw new Error('A loose assembly corner has no shared connection.')
  const data: AssemblyData = { definitions, instances, links, ...(loosePorts ? { loosePorts } : {}) }
  const rebuilt = rebuild({ ...project, assemblies: data }, data)
  const sameNumber = (a: number, b: number) => Math.abs(a - b) < 0.001
  for (const panel of rebuilt.panels) {
    const actual = project.panels.find(item => item.id === panel.id)
    if (!actual || ['width', 'height', 'thickness', 'holeSize', 'holeSpacing'].some(key => !sameNumber(actual[key as 'width'], panel[key as 'width']))
      || actual.position.some((number, i) => !sameNumber(number, panel.position[i])) || Math.abs(q(actual.rotation).dot(q(panel.rotation))) < 0.999999
      || ['color', 'material', 'pattern', 'visible', 'name'].some(key => actual[key as 'color'] !== panel[key as 'color'])) throw new Error('Assembly panels do not match their source and instance transforms.')
  }
  if (rebuilt.panels.length !== project.panels.length || rebuilt.connections.length !== project.connections.length
    || rebuilt.connections.some(connection => { const actual = project.connections.find(item => item.id === connection.id); return !actual || Object.entries(connection).some(([key, item]) => actual[key as keyof Connection] !== item) })) throw new Error('Assembly connectors do not match their corner connections.')
  return data
}
