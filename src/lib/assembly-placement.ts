import { Euler, Quaternion, Vector3 } from 'three'
import { disassembleAssembly } from './assemblies'
import { autoConnect } from './auto-connect'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { getConnectorPlacements, resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project, Vec3 } from './types'

const vector = (value: Vec3) => new Vector3(...value)
const rotation = (value: Vec3) => new Quaternion().setFromEuler(new Euler(...value))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const tolerance = 0.05

/** Compare occupied space, including equivalent half-turns and swapped local axes. */
export function samePanelPlacement(a: Panel, b: Panel): boolean {
  if (vector(a.position).distanceTo(vector(b.position)) > tolerance) return false
  const aRotation = rotation(a.rotation), bRotation = rotation(b.rotation)
  const aLengths = [a.width, a.height, a.thickness], bLengths = [b.width, b.height, b.thickness]
  const used = new Set<number>()
  return axes.every((axis, index) => {
    const world = axis.clone().applyQuaternion(aRotation)
    const match = axes.findIndex((other, otherIndex) => !used.has(otherIndex)
      && Math.abs(aLengths[index] - bLengths[otherIndex]) < tolerance
      && Math.abs(world.dot(other.clone().applyQuaternion(bRotation))) > 0.999999)
    if (match < 0) return false
    used.add(match)
    return true
  })
}

/** Bake the affected instances only when shared panels or hardware change their design. */
export function reconcileAssemblyPlacement(project: Project, movingIds: readonly string[]): { project: Project; warning?: string; panelIds: string[] } {
  const previousErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const moving = new Set(movingIds), panels = resolvePanels(project)
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const replacements = new Map<string, string>()
  const kept: Panel[] = []
  // Existing panels win, retaining their identifiers, finish and local axes.
  for (const panel of [...panels].sort((a, b) => Number(moving.has(a.id)) - Number(moving.has(b.id)))) {
    const duplicate = kept.find(other => (moving.has(panel.id) || moving.has(other.id)) && samePanelPlacement(panel, other))
    if (duplicate) replacements.set(panel.id, duplicate.id)
    else kept.push(panel)
  }
  const remap = (id: string) => replacements.get(id) ?? id
  const selected = new Set(movingIds.map(remap))
  const groups = new Map<string, Connection[]>()
  for (const connection of project.connections) groups.set(jointId(connection), [...groups.get(jointId(connection)) ?? [], connection])
  const touched = new Set<string>()
  const rebuild = new Set<string>()
  const discarded = new Set<string>()
  const centers = new Map<string, { position: Vector3; tangent: Vector3 }>()
  for (const [id, group] of groups) {
    if (group.some(connection => replacements.has(connection.parentId) || replacements.has(connection.childId))) touched.add(id)
    const connection = group.find(item => item.count > 0)
    const parent = connection && byId.get(connection.parentId), child = connection && byId.get(connection.childId)
    if (!connection || !parent || !child) continue
    const placement = getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0]
    centers.set(id, { position: vector(placement.position), tangent: axes[1].clone().applyQuaternion(rotation(placement.rotation)) })
  }
  const entries = [...centers]
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [aId, a] = entries[i], [bId, b] = entries[j]
    const members = [...groups.get(aId)!, ...groups.get(bId)!].flatMap(connection => [connection.parentId, connection.childId])
    if (!members.some(id => moving.has(id)) || a.position.distanceTo(b.position) > tolerance || Math.abs(a.tangent.dot(b.tangent)) < 0.999999) continue
    const aMembers = new Set(groups.get(aId)!.flatMap(connection => [remap(connection.parentId), remap(connection.childId)]))
    const bMembers = new Set(groups.get(bId)!.flatMap(connection => [remap(connection.parentId), remap(connection.childId)]))
    if (aMembers.size === bMembers.size && [...aMembers].every(id => bMembers.has(id))
      && groups.get(aId)![0].type === groups.get(bId)![0].type) {
      const aMoves = groups.get(aId)!.some(connection => moving.has(connection.parentId) || moving.has(connection.childId))
      discarded.add(aMoves ? aId : bId)
      continue
    }
    rebuild.add(aId); rebuild.add(bId)
  }
  // A duplicate may have opposite local axes. Refit that joint instead of
  // retaining coordinates that referred to the removed panel's orientation.
  for (const id of touched) {
    if (discarded.has(id)) continue
    const remapped = groups.get(id)!.map(connection => ({ ...connection, parentId: remap(connection.parentId), childId: remap(connection.childId), role: 'support' as const }))
    if (remapped.some(connection => connection.parentId === connection.childId)
      || validateProject({ ...project, panels: kept, connections: remapped }).some(issue => issue.severity === 'error')) rebuild.add(id)
  }
  const affectedIds = new Set([...replacements.keys()])
  for (const id of new Set([...touched, ...rebuild])) for (const connection of groups.get(id)!) {
    if (discarded.has(id)) continue
    affectedIds.add(connection.parentId); affectedIds.add(connection.childId)
  }
  const affectedInstances = (project.assemblies?.instances ?? []).filter(instance => Object.values(instance.panelIds).some(id => affectedIds.has(id)))
  let next = project
  for (const instance of affectedInstances) next = disassembleAssembly(next, instance.id)
  if (replacements.size || touched.size || rebuild.size || discarded.size) {
    next = { ...next, panels: panels.filter(panel => !replacements.has(panel.id)), connections: next.connections.filter(connection => !rebuild.has(jointId(connection)) && !discarded.has(jointId(connection))).map(connection =>
      touched.has(jointId(connection)) ? { ...connection, parentId: remap(connection.parentId), childId: remap(connection.childId), role: 'support' as const } : connection) }
  }
  if (rebuild.size) {
    const scope = new Set<string>()
    for (const id of rebuild) for (const connection of groups.get(id)!) { scope.add(remap(connection.parentId)); scope.add(remap(connection.childId)) }
    next = autoConnect(next, [...scope]).project
    const rebuiltGroups = new Map<string, Connection[]>()
    for (const connection of next.connections) rebuiltGroups.set(jointId(connection), [...rebuiltGroups.get(jointId(connection)) ?? [], connection])
    const currentPanels = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
    // Every occupied corner needs one complete joint embracing all its panels.
    // Connectivity through other corners cannot make an unsupported clamp fit.
    for (const id of rebuild) {
      const center = centers.get(id)
      const related = [...rebuild].filter(other => other === id || center && centers.has(other) && centers.get(other)!.position.distanceTo(center.position) < tolerance)
      const members = new Set(related.flatMap(other => groups.get(other)!.flatMap(connection => [remap(connection.parentId), remap(connection.childId)])))
      const replacement = [...rebuiltGroups.values()].find(group => {
        const memberIds = new Set(group.flatMap(connection => [connection.parentId, connection.childId]))
        if (![...members].every(member => memberIds.has(member))) return false
        if (!center) return true
        const connection = group[0], parent = currentPanels.get(connection.parentId), child = currentPanels.get(connection.childId)
        return parent && child && vector(getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0].position).distanceTo(center.position) < tolerance
      })
      if (!replacement) throw new Error('These overlapping connectors cannot form a compatible shared joint.')
      const original = related.map(other => groups.get(other)!).sort((a, b) => Number(a.some(connection => moving.has(connection.parentId) || moving.has(connection.childId)))
        - Number(b.some(connection => moving.has(connection.parentId) || moving.has(connection.childId))))[0][0]
      const color = original.color
      const replacementId = jointId(replacement[0])
      next = { ...next, connections: next.connections.map(connection => jointId(connection) === replacementId ? { ...connection, color } : connection) }
    }
  }
  const nextById = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
  const occupied: { position: Vector3; type: string; affected: boolean }[] = []
  let removedConnectors = 0
  const overrides = { ...next.connectorOverrides }
  for (const connector of getPhysicalConnectors(next).sort((a, b) => Number(moving.has(a.connection.parentId) || moving.has(a.connection.childId))
    - Number(moving.has(b.connection.parentId) || moving.has(b.connection.childId)))) {
    const parent = nextById.get(connector.connection.parentId), child = nextById.get(connector.connection.childId)
    if (!parent || !child) continue
    const position = vector(getConnectorPlacements(connector.connection, parent, child)[connector.index].position)
    const affected = [parent.id, child.id].some(id => selected.has(id) || affectedIds.has(id))
    if (occupied.some(other => (affected || other.affected) && other.type === connector.type && other.position.distanceTo(position) < tolerance)) {
      const id = connectorId(connector.connection.id, connector.index)
      overrides[id] = { ...overrides[id], removed: true }; removedConnectors++
    } else occupied.push({ position, type: connector.type, affected })
  }
  if (removedConnectors) next = { ...next, connectorOverrides: overrides }
  const issue = validateProject(next).find(item => item.severity === 'error' && (!previousErrors.has(item.id) || item.panelIds.some(id => selected.has(id) || affectedIds.has(id)))
    || item.id.startsWith('collision-') && item.panelIds.some(id => selected.has(id)))
  if (issue) throw new Error(issue.message)
  const changedHardware = rebuild.size > 0 || removedConnectors > 0
  const detail = replacements.size ? `Duplicate panels${changedHardware ? ' and overlapping connectors' : ''} are merged.`
    : changedHardware ? 'Overlapping connectors are merged.' : ''
  const warning = affectedInstances.length
    ? `Requires disassembly: ${affectedInstances.map(instance => instance.name).join(', ')}. ${detail}`.trim()
    : replacements.size || removedConnectors ? detail : undefined
  return { project: next, warning, panelIds: [...selected].filter(id => nextById.has(id)) }
}
