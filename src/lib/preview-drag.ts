import { Euler, Quaternion, Vector3 } from 'three'
import { getAssemblyAttachmentTargets, materializeAssemblies } from './assemblies'
import { reconcileAssemblyPlacement, samePanelPlacement } from './assembly-placement'
import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getConnectorPlacements, resolvePanels, validateProject } from './model'
import type { Connection, ConnectorType, Project, Side, Vec3 } from './types'

const vector = (value: Vec3) => new Vector3(...value)
const rotation = (value: Vec3) => new Quaternion().setFromEuler(new Euler(...value))
const jointId = (id: string) => id.replace(/:\d+$/, '')
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

export interface PreviewDragSnap {
  label: string
  position: Vec3
  panelIds: string[]
  warning?: string
}

interface PanelTarget {
  connection: Connection
  expectedPosition: Vec3
  tangent: Vec3
  alignmentOffsets: number[]
}
interface AssemblyTarget { project: Project; delta: Vec3; snap: PreviewDragSnap }

export interface PreviewDragSession {
  original: Project
  project: Project
  movingIds: string[]
  instanceIds: string[]
  panelTargets: PanelTarget[]
  assemblyTargets: AssemblyTarget[]
  previousErrors: Set<string>
}

/** Prepare a rigid move without editing the persisted project or moving neighbors. */
export function preparePreviewDrag(original: Project, selectedIds: readonly string[]): PreviewDragSession | null {
  const wanted = new Set(selectedIds)
  const moving = original.panels.filter(panel => wanted.has(panel.id))
  if (!moving.some(panel => panel.visible)) return null
  const instances = original.assemblies?.instances ?? []
  // A source panel cannot be repositioned independently of its instance metadata.
  if (instances.some(instance => {
    const ids = Object.values(instance.panelIds)
    return ids.some(id => wanted.has(id)) && !ids.every(id => wanted.has(id))
  })) return null
  const movingInstances = instances.filter(instance => Object.values(instance.panelIds).every(id => wanted.has(id)))
  const instanceIds = movingInstances.map(instance => instance.id)
  const selectedInstances = new Set(instanceIds)
  let project: Project = { ...original, panels: resolvePanels(original) }
  if (project.assemblies) {
    const data = project.assemblies
    const movingEndpoint = (endpoint: typeof data.links[number]['a']) => endpoint.instanceId ? selectedInstances.has(endpoint.instanceId)
      : !!data.loosePorts?.some(port => port.id === endpoint.portId && [port.connection.parentId, port.connection.childId].some(id => wanted.has(id)))
    const partialLooseEndpoint = (endpoint: typeof data.links[number]['a']) => !endpoint.instanceId && !!data.loosePorts?.some(port => port.id === endpoint.portId
      && wanted.has(port.connection.parentId) !== wanted.has(port.connection.childId))
    const removed = data.links.filter(link => movingEndpoint(link.a) !== movingEndpoint(link.b) || partialLooseEndpoint(link.a) || partialLooseEndpoint(link.b))
    if (removed.length) {
      const removedIds = new Set(removed.map(link => link.id))
      project = materializeAssemblies({ ...project,
        connections: project.connections.filter(connection => !removed.some(link => connection.id.startsWith(`assembly-link/${link.id}:`))),
        assemblies: { ...data, links: data.links.filter(link => !removedIds.has(link.id)) },
      })
    }
  }
  // Remove complete hardware groups, including T/cross branches, at the boundary.
  const released = new Set(project.connections.filter(connection => wanted.has(connection.parentId) !== wanted.has(connection.childId)).map(connection => jointId(connection.id)))
  project = { ...project, panels: resolvePanels(project), connections: project.connections.filter(connection => !released.has(jointId(connection.id))) }
  const panels = resolvePanels(project)
  const orientations = new Map(panels.map(panel => [panel.id, rotation(panel.rotation)]))
  const normals = new Map(panels.map(panel => [panel.id, axes[2].clone().applyQuaternion(orientations.get(panel.id)!)]))
  const panelTargets: PanelTarget[] = []
  const sessionId = crypto.randomUUID()
  const types: ConnectorType[] = ['90', '105', '150']
  const sides: Side[] = ['left', 'right', 'top', 'bottom']
  for (const parent of panels) for (const child of panels) {
    if (wanted.has(parent.id) === wanted.has(child.id) || !parent.visible || !child.visible) continue
    if ([parent, child].some(panel => panel.thickness < 16 || panel.thickness > 19)) continue
    const actualRotation = orientations.get(child.id)!
    const parentRotation = orientations.get(parent.id)!
    const normalDot = Math.abs(normals.get(parent.id)!.dot(normals.get(child.id)!))
    const compatibleTypes = types.filter(type => Math.abs(normalDot - Math.abs(Math.cos(CONNECTOR_PROFILES[type].bend))) < 0.005)
    for (const type of compatibleTypes) for (const side of sides) for (const flip of [false, true]) {
      const connection: Connection = { id: `drag/${sessionId}/${panelTargets.length}:0`, parentId: parent.id, childId: child.id, type, side, flip,
        offset: 0, inset: 0, count: 2, color: DEFAULT_CONNECTOR_COLOR, role: 'support' }
      const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
      const expectedRotation = rotation(expected.rotation)
      if (!axes.every(axis => Math.abs(axis.clone().applyQuaternion(expectedRotation).dot(axis.clone().applyQuaternion(actualRotation))) > 0.99999)) continue
      const horizontal = side === 'top' || side === 'bottom'
      const edgeDifference = ((horizontal ? parent.width : parent.height) - (horizontal ? child.width : child.height)) / 2
      panelTargets.push({ connection, expectedPosition: expected.position,
        tangent: (horizontal ? axes[0] : axes[1]).clone().applyQuaternion(parentRotation).toArray(),
        alignmentOffsets: [0, edgeDifference, -edgeDifference],
      })
    }
  }
  const assemblyTargets: AssemblyTarget[] = []
  if (movingInstances.length === 1 && moving.length === Object.values(movingInstances[0].panelIds).length) {
    const data = project.assemblies!
    const source = data.instances.find(instance => instance.id === instanceIds[0])!
    const visiblePanels = new Set(panels.filter(panel => panel.visible).map(panel => panel.id))
    const visiblePorts = new Set(data.instances.flatMap(instance => {
      const definition = data.definitions.find(item => item.id === instance.definitionId)!
      return definition.ports.filter(port => {
        const connection = definition.connections.find(item => item.id === port.connectionId)!
        return [connection.parentId, connection.childId].every(id => visiblePanels.has(instance.panelIds[id]))
      }).map(port => `${instance.id}/${port.id}`)
    }))
    const existingLinks = new Set(data.links.map(link => link.id))
    for (const target of data.instances.filter(instance => instance.id !== source.id && Object.values(instance.panelIds).some(id => visiblePanels.has(id)))) {
      for (const candidate of getAssemblyAttachmentTargets(project, target.id, source.id)) {
        if (!candidate.project || !visiblePorts.has(candidate.anchorId ?? candidate.id)) continue
        // A placement may match several corners. Every newly shared corner must
        // use visible panels on both instances, including the moving instance.
        if (candidate.project.assemblies!.links.some(link => !existingLinks.has(link.id)
          && [link.a, link.b].some(endpoint => !visiblePorts.has(`${endpoint.instanceId}/${endpoint.portId}`)))) continue
        const placed = candidate.placement ?? candidate.project.assemblies!.instances.find(instance => instance.id === source.id)!
        if (Math.abs(rotation(source.rotation).dot(rotation(placed.rotation))) < 0.999999) continue
        assemblyTargets.push({ project: candidate.project, delta: vector(placed.position).sub(vector(source.position)).toArray(),
          snap: { label: `${target.name} · ${candidate.label}`, position: candidate.position, panelIds: candidate.panelIds ?? moving.map(panel => panel.id), warning: candidate.warning },
        })
      }
    }
  }
  const session: PreviewDragSession = { original, project, movingIds: moving.map(panel => panel.id), instanceIds, panelTargets, assemblyTargets,
    previousErrors: new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id)),
  }
  // Shared walls can be aligned by translation even when corner-frame matching
  // would rotate the source. Keep dragging rigid and fit the resulting T joints.
  if (movingInstances.length) {
    const tried: Vec3[] = []
    for (const source of panels.filter(panel => wanted.has(panel.id) && panel.visible)) {
      for (const target of panels.filter(panel => !wanted.has(panel.id) && panel.visible)) {
        if (!samePanelPlacement({ ...source, position: target.position }, target)) continue
        const delta = vector(target.position).sub(vector(source.position)).toArray() as Vec3
        if (tried.some(previous => vector(previous).distanceTo(vector(delta)) < 0.05)) continue
        tried.push(delta)
        try {
          const result = reconcileAssemblyPlacement(translate(session, delta), session.movingIds)
          if (!result.warning) continue
          assemblyTargets.push({ project: result.project, delta,
            snap: { label: `${target.name} · shared panel`, position: target.position, panelIds: result.panelIds, warning: result.warning } })
        } catch { /* An exact wall match can still leave other panels intersecting. */ }
      }
    }
  }
  return session
}

function translate(session: PreviewDragSession, delta: Vec3): Project {
  if (!delta.every(Number.isFinite)) throw new Error('Movement must be finite.')
  const wanted = new Set(session.movingIds)
  const panels = session.project.panels.map(panel => wanted.has(panel.id) ? { ...panel, position: vector(panel.position).add(vector(delta)).toArray() } : panel)
  if (panels.some(panel => panel.position.some(value => Math.abs(value) > 100000))) throw new Error('This move exceeds the project placement limits.')
  const selectedInstances = new Set(session.instanceIds)
  return { ...session.project, panels,
    ...(session.project.assemblies ? { assemblies: { ...session.project.assemblies,
      instances: session.project.assemblies.instances.map(instance => selectedInstances.has(instance.id) ? { ...instance, position: vector(instance.position).add(vector(delta)).toArray() } : instance),
    } } : {}),
  }
}

/** Total translation from pointer-down, with a true world-space attachment radius. */
export function movePreviewDrag(session: PreviewDragSession, delta: Vec3, snapDistance = 30): { project: Project; snap: PreviewDragSnap | null } {
  const project = translate(session, delta)
  if (!Number.isFinite(snapDistance) || snapDistance <= 0) return { project, snap: null }
  const wanted = new Set(session.movingIds)
  const panels = resolvePanels(project)
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const options: { distance: number; target?: PanelTarget; offset?: number; correction?: Vec3; assembly?: AssemblyTarget }[] = []
  for (const assembly of session.assemblyTargets) {
    const distance = vector(assembly.delta).distanceTo(vector(delta))
    if (distance <= snapDistance) options.push({ distance, assembly })
  }
  for (const target of session.panelTargets) {
    const { connection } = target
    const parent = byId.get(connection.parentId)!, child = byId.get(connection.childId)!
    const tangent = vector(target.tangent)
    const along = vector(child.position).sub(vector(parent.position)).dot(tangent)
    const aligned = target.alignmentOffsets.reduce((best, offset) => Math.abs(offset - along) < Math.abs(best - along) ? offset : best)
    // Offer centered/flush edges when close; otherwise slide freely along the seam.
    const offset = Math.abs(aligned - along) <= snapDistance / 2 ? aligned : along
    const expected = vector(target.expectedPosition).add(wanted.has(parent.id) ? vector(delta) : new Vector3()).addScaledVector(tangent, offset)
    const correction = expected.sub(vector(child.position)).multiplyScalar(wanted.has(child.id) ? 1 : -1)
    const distance = correction.length()
    if (distance <= snapDistance) options.push({ distance, target, offset, correction: correction.toArray() })
  }
  options.sort((a, b) => Math.abs(a.distance - b.distance) > 1e-5 ? a.distance - b.distance
    : Number(!!b.assembly) - Number(!!a.assembly) || Number(!!a.assembly?.snap.warning) - Number(!!b.assembly?.snap.warning))
  for (const option of options) {
    if (option.assembly) return { project: option.assembly.project, snap: option.assembly.snap }
    const target = option.target!
    const next = translate(session, vector(delta).add(vector(option.correction!)).toArray())
    const nextPanels = resolvePanels(next)
    const nextById = new Map(nextPanels.map(panel => [panel.id, panel]))
    const parent = nextById.get(target.connection.parentId)!, child = nextById.get(target.connection.childId)!
    const connection = { ...target.connection, offset: option.offset! }
    const pair: Project = { version: 1, name: '', panels: [parent, child], connections: [connection] }
    if (validateProject(pair).some(issue => issue.id.endsWith('-overlap'))) connection.count = 1
    if (validateProject(pair).some(issue => issue.severity === 'error' || issue.id.startsWith('collision-'))) continue
    const placements = getConnectorPlacements(connection, parent, child)
    const occupied = next.connections.filter(item => item.count > 0).some(item => {
      const a = nextById.get(item.parentId), b = nextById.get(item.childId)
      return a && b && getConnectorPlacements(item, a, b).some(existing => placements.some(placed => vector(existing.position).distanceTo(vector(placed.position)) < 40))
    })
    const touchesAssembly = next.assemblies?.instances.some(instance => Object.values(instance.panelIds).some(id => wanted.has(id) || id === parent.id || id === child.id))
    if ((occupied && !touchesAssembly) || next.connections.length >= 400) continue
    let snapped = { ...next, connections: [...next.connections, connection] }
    let warning: string | undefined
    let panelIds = session.movingIds
    if (touchesAssembly) {
      try {
        const result = reconcileAssemblyPlacement(snapped, session.movingIds)
        snapped = result.project
        warning = result.warning
        panelIds = result.panelIds
      } catch { continue }
    }
    if (validateProject(snapped).some(issue => (issue.severity === 'error' && !session.previousErrors.has(issue.id))
      || (issue.id.startsWith('collision-') && issue.panelIds.some(id => wanted.has(id)) && issue.panelIds.some(id => !wanted.has(id))))) continue
    return { project: snapped, snap: { label: wanted.has(parent.id) ? child.name : parent.name,
      position: getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0].position, panelIds, warning } }
  }
  return { project, snap: null }
}
