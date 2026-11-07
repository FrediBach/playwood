import { parseSpaceConstraint, spaceClearances } from './space-constraint'
import { parseConstructionObjects } from './construction-objects'
import { getOutlineError, panelCornerRadius, panelOutlineCorners } from './panel-shape'
import { getPhysicalConnectors, parseConnectorId } from './connector-selection'
import { connectorDisplayColor, getConnectorMaterial } from './connector-options'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import type { AttachmentOptions, Connection, OutlinePoint, Panel, Project, RotationAxis, ValidationIssue, Vec3 } from './types'
import { parseNiceValues } from './nice-values'
import { CONNECTOR_PROFILES } from './connector-profile'
import { parseAssemblyData, releaseAssemblyLinksForPanels } from './assemblies'
import { parseCustomColors } from './custom-colors'
import { assertNoNewTrofastIssues, getTrofastInsertLocalBounds, MAX_TROFAST_INSERTS, validateTrofastInserts } from './trofast'
import { getTrofastColor, getTrofastItem } from './trofast-catalog'
import { copyDesignConstraints, describeDesignConstraint, designConstraintPanelIds, evaluateDesignConstraints, parseDesignConstraints } from './design-constraints'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { outlineConnectionAligned } from './outline-closures'

const MATERIAL_COLORS = { birch: '#d9bd8c', oak: '#b88b54', walnut: '#76523b', mdf: '#ae9677', osb: '#dfc391', nazena: '#607d97', painted: '#e8e7df' }
const uid = () => globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const vec = (v: Vec3) => new Vector3(...v)
const tuple = (v: Vector3): Vec3 => [v.x, v.y, v.z]
const quaternion = (p: Panel) => new Quaternion().setFromEuler(new Euler(...p.rotation, 'XYZ'))
const rotationTuple = (q: Quaternion): Vec3 => { const e = new Euler().setFromQuaternion(q, 'XYZ'); return [e.x || 0, e.y || 0, e.z || 0] }
const jointId = (c: Connection) => c.id.replace(/:\d+$/, '')

export function createPanel(overrides: Partial<Panel> = {}): Panel {
  const material = overrides.material ?? 'birch'
  return { id: uid(), name: 'New panel', width: 600, height: 360, thickness: 18, material,
    color: MATERIAL_COLORS[material], pattern: 'solid', position: [0, 400, 0], rotation: [0, 0, 0],
    visible: true, cornerRadius: 0, holeSize: 12, holeSpacing: 48, ...overrides,
    ...(overrides.customOutline ? { customOutline: overrides.customOutline.map(point => ({ ...point })) } : {}),
    ...(overrides.trofastInserts ? { trofastInserts: overrides.trofastInserts.map(insert => ({ ...insert })) } : {}) }
}

function seamInfo(parent: Panel, c: Pick<Connection, 'side' | 'offset' | 'inset'>) {
  const horizontalSeam = c.side === 'top' || c.side === 'bottom' || c.side === 'front' || c.side === 'back'
  const tangent = horizontalSeam ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
  const radial = c.side === 'left' ? new Vector3(-1, 0, 0)
    : c.side === 'right' ? new Vector3(1, 0, 0)
    : c.side === 'bottom' ? new Vector3(0, -1, 0) : new Vector3(0, 1, 0)
  const face = c.side === 'front' || c.side === 'back'
  const parentRadialLength = horizontalSeam ? parent.height : parent.width
  const edge = face ? new Vector3(0, c.inset, 0) : radial.clone().multiplyScalar(parentRadialLength / 2 - c.inset)
  edge.addScaledVector(tangent, c.offset)
  return { tangent, radial, edge, horizontalSeam, face,
    sign: c.side === 'bottom' || c.side === 'right' ? -1 : 1,
    front: c.side === 'back' ? -1 : 1,
    seamLength: horizontalSeam ? parent.width : parent.height }
}

function branchIndex(c: Connection) {
  if (c.type !== 't' && c.type !== 'cross') return 0
  return Number(c.id.match(/:(\d+)$/)?.[1] ?? 0)
}

function attachmentPose(parent: Panel, child: Panel, c: Connection): Pick<Panel, 'position' | 'rotation'> {
  const seam = seamInfo(parent, c)
  const branch = branchIndex(c)
  const flatBranch = (c.type === 't' && branch === 1) || (c.type === 'cross' && branch === 2)
  const profile = CONNECTOR_PROFILES[c.type]
  const angle = flatBranch ? 0 : profile.bend
  let direction = (c.flip ? -1 : 1) * seam.front
  if (c.type === 'cross' && branch === 1) direction *= -1
  const localRotation = new Quaternion().setFromAxisAngle(seam.tangent, seam.sign * direction * angle)
  const childRadial = seam.radial.clone().applyQuaternion(localRotation)
  const childLength = seam.horizontalSeam !== !!c.quarterTurn ? child.height : child.width
  const center = seam.edge.clone()
  // Place each panel's leading edge at its CAD shoulder, measured along its
  // own slot. Using a fixed orthogonal gap makes the 105°/150° panels miss
  // their slots and puts the continuation of a T/cross inside the body.
  center.addScaledVector(seam.radial, seam.face ? 0 : profile.seat)
  center.addScaledVector(childRadial, profile.seat + childLength / 2)
  const parentRotation = quaternion(parent)
  return {
    position: tuple(center.applyQuaternion(parentRotation).add(vec(parent.position))),
    rotation: rotationTuple(parentRotation.multiply(localRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), c.quarterTurn ? Math.PI / 2 : 0))),
  }
}

export function resolvePanels(project: Project): Panel[] {
  const panels = new Map(project.panels.map(p => [p.id, p]))
  const incoming = new Map(project.connections.filter(c => c.role !== 'support').map(c => [c.childId, c]))
  const resolved = new Map<string, Panel>()
  const active = new Set<string>()
  const resolve = (id: string): Panel | undefined => {
    const old = resolved.get(id)
    if (old) return old
    const p = panels.get(id)
    if (!p || active.has(id)) return p
    active.add(id)
    const c = incoming.get(id)
    const parent = c && resolve(c.parentId)
    const result = parent && c ? { ...p, ...attachmentPose(parent, p, c) } : p
    active.delete(id)
    resolved.set(id, result)
    return result
  }
  return project.panels.map(p => resolve(p.id)!)
}

export function attachPanel(project: Project, parentId: string, panel: Panel, options: AttachmentOptions): Project {
  if (!project.panels.some(p => p.id === parentId)) throw new Error('Choose an existing panel to attach to.')
  if (project.panels.some(p => p.id === panel.id)) throw new Error('The attached panel must have a unique ID.')
  const joint = uid()
  const branchCount = options.type === 'cross' ? 3 : options.type === 't' ? 2 : 1
  const children = Array.from({ length: branchCount }, (_, i) => i === 0 ? panel : createPanel({
    ...panel, id: uid(), name: `${panel.name} ${i + 1}`,
  }))
  const connections = children.map((p, i): Connection => ({
    ...options, id: `${joint}:${i}`, parentId, childId: p.id, count: i === 0 ? options.count : 0,
  }))
  const next = { ...project, panels: [...project.panels, ...children], connections: [...project.connections, ...connections] }
  return { ...next, panels: resolvePanels(next) }
}

export function detachPanel(project: Project, id: string): Project {
  project = releaseAssemblyLinksForPanels(project, [id])
  const incoming = project.connections.find(c => c.childId === id && c.role !== 'support')
  const incident = project.connections.filter(connection => connection.parentId === id || connection.childId === id)
  if (!incoming && incident.length && incident.every(connection => connection.role === 'support')) {
    const joints = new Set(incident.map(jointId))
    return { ...project, panels: resolvePanels(project), connections: project.connections.filter(connection => !joints.has(jointId(connection))) }
  }
  const affectedJoint = incoming && jointId(incoming)
  const detachedChildren = new Set([id, ...project.connections.filter(c => affectedJoint && jointId(c) === affectedJoint).map(c => c.childId)])
  const affectedSupports = new Set(project.connections.filter(c => c.role === 'support' && detachedChildren.has(c.childId)).map(jointId))
  return {
    ...project,
    panels: resolvePanels(project),
    connections: project.connections.filter(c =>
      (!affectedJoint || jointId(c) !== affectedJoint) && !affectedSupports.has(jointId(c))),
  }
}

export function attachExistingPanel(project: Project, parentId: string, childId: string, options: AttachmentOptions): Project {
  if (parentId === childId) throw new Error('A panel cannot attach to itself.')
  const incoming = new Map(project.connections.filter(c => c.role !== 'support').map(c => [c.childId, c.parentId]))
  const visited = new Set<string>()
  let ancestor: string | undefined = parentId
  while (ancestor) {
    if (ancestor === childId || visited.has(ancestor)) throw new Error('A panel cannot attach to one of its descendants.')
    visited.add(ancestor); ancestor = incoming.get(ancestor)
  }
  const detached = detachPanel(project, childId)
  const child = detached.panels.find(p => p.id === childId)
  if (!child) throw new Error('Choose an existing panel to attach.')
  return attachPanel({ ...detached, panels: detached.panels.filter(p => p.id !== childId) }, parentId, child, options)
}

/** Connector centers stay 20 mm inside the straight overlap to fit the 40 mm body. */
export function getConnectorSeam(connection: Connection, parent: Panel, child: Panel) {
  const seam = seamInfo(parent, connection)
  if (connection.outlineEdge !== undefined && child.customOutline?.[connection.outlineEdge]) {
    const corners = panelOutlineCorners(child), index = connection.outlineEdge
    const tangent = seam.tangent.clone().applyQuaternion(quaternion(parent))
    // Acute and concave fillets consume different amounts of each edge. Use
    // the same straight endpoints as the rendered/cut outline, not its radius.
    const along = [corners[index].exit, corners[(index + 1) % corners.length].entry].map(point =>
      new Vector3(point.x - child.width / 2, child.height / 2 - point.y, 0).applyQuaternion(quaternion(child))
        .add(vec(child.position)).sub(vec(parent.position)).dot(tangent))
    const radius = panelCornerRadius(parent)
    return { lower: Math.max(-seam.seamLength / 2 + radius, Math.min(...along)) + 20,
      upper: Math.min(seam.seamLength / 2 - radius, Math.max(...along)) - 20, tangent: tuple(tangent) }
  }
  const childSeamLength = seam.horizontalSeam !== !!connection.quarterTurn ? child.width : child.height
  const parentRadius = seam.face ? 0 : panelCornerRadius(parent)
  const childRadius = panelCornerRadius(child)
  const lower = Math.max(-seam.seamLength / 2 + parentRadius, connection.offset - childSeamLength / 2 + childRadius)
  const upper = Math.min(seam.seamLength / 2 - parentRadius, connection.offset + childSeamLength / 2 - childRadius)
  return { lower: lower + 20, upper: upper - 20, tangent: tuple(seam.tangent.clone().applyQuaternion(quaternion(parent))) }
}

export function getConnectionAnchors(connection: Connection, parent: Panel, child: Panel): Vec3[] {
  const seam = seamInfo(parent, connection)
  const { lower, upper } = getConnectorSeam(connection, parent, child)
  const middle = (lower + upper) / 2
  const reach = Math.max(0, (upper - lower) / 2)
  const rotation = quaternion(parent)
  return Array.from({ length: connection.count }, (_, i) => {
    const along = connection.count === 1 ? middle : middle - reach + (2 * reach * i) / (connection.count - 1)
    const point = seam.edge.clone().addScaledVector(seam.tangent, along - connection.offset)
    if (!seam.face) point.addScaledVector(seam.radial, CONNECTOR_PROFILES[connection.type].seat)
    return tuple(point.applyQuaternion(rotation).add(vec(parent.position)))
  })
}

/** Rigid CAD instances, with positions in project millimeters. */
export function getConnectorPlacements(connection: Connection, parent: Panel, child: Panel): Pick<Panel, 'position' | 'rotation'>[] {
  const seam = seamInfo(parent, connection)
  const direction = (connection.flip ? -1 : 1) * seam.front
  // An outline T uses the rectangular rim as its stem; its two custom
  // children occupy the opposing straight slots instead of a flat branch.
  const outlineT = connection.type === 't' && connection.outlineEdge !== undefined
  const x = outlineT ? new Vector3(0, 0, direction) : seam.radial.clone().negate()
  const z = outlineT ? seam.radial.clone().negate() : new Vector3(0, 0, direction)
  const y = new Vector3().crossVectors(z, x)
  const local = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
  const rotation = rotationTuple(quaternion(parent).multiply(local))
  return getConnectionAnchors(connection, parent, child).map(position => ({ position, rotation }))
}

export function removePanel(project: Project, id: string): Project {
  project = releaseAssemblyLinksForPanels(project, [id])
  // Detach surviving panels at their current world position instead of deleting a whole assembly.
  const worldPanels = resolvePanels(project)
  const affectedJointIds = new Set(project.connections.filter(c => c.parentId === id || c.childId === id).map(jointId))
  // Removing supplemental hardware does not reposition its surviving members.
  // Only children released from a driving joint lose their other supports.
  const detachedChildren = new Set(project.connections.filter(c => affectedJointIds.has(jointId(c)) && c.role !== 'support').map(c => c.childId))
  const affectedSupports = new Set(project.connections.filter(c => c.role === 'support' && detachedChildren.has(c.childId)).map(jointId))
  return { ...project,
    panels: worldPanels.filter(p => p.id !== id),
    connections: project.connections.filter(c => !affectedJointIds.has(jointId(c)) && !affectedSupports.has(jointId(c))),
    ...(project.constraints ? { constraints: project.constraints.filter(constraint => !designConstraintPanelIds(constraint).includes(id)) } : {}),
  }
}

export function duplicatePanel(project: Project, id: string): Project {
  const panel = resolvePanels(project).find(p => p.id === id)
  if (!panel) return project
  const insertOffset = panel.trofastInserts?.length ? getProjectBounds(resolvePanels(project)).max[0] - getProjectBounds([panel]).min[0] + 100 : null
  const duplicate = createPanel({ ...panel, id: uid(), name: `${panel.name} copy`, position: insertOffset === null
    ? [panel.position[0] + 100, panel.position[1] + 100, panel.position[2] + 100]
    : [panel.position[0] + insertOffset, panel.position[1], panel.position[2]] })
  const constraints = copyDesignConstraints(project.constraints, new Map([[id, duplicate.id]]))
  return { ...project, panels: [...project.panels, duplicate], ...(constraints.length ? { constraints: [...project.constraints ?? [], ...constraints] } : {}) }
}

export function getProjectBounds(panels: Panel[]) {
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of panels) {
    const rotation = quaternion(p)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const corner = new Vector3(x * p.width / 2, y * p.height / 2, z * p.thickness / 2).applyQuaternion(rotation).add(vec(p.position))
      min.min(corner); max.max(corner)
    }
    for (const insert of p.trofastInserts ?? []) {
      const bounds = getTrofastInsertLocalBounds(p, insert)
      if (!bounds) continue
      for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).applyQuaternion(rotation).add(vec(p.position))
        min.min(corner); max.max(corner)
      }
    }
  }
  if (!panels.length) { min.set(0, 0, 0); max.set(0, 0, 0) }
  return { width: max.x - min.x, height: max.y - min.y, depth: max.z - min.z, min: tuple(min), max: tuple(max) }
}

/** Translate all panels and instance origins together; joints remain panel-local. */
export function moveProject(project: Project, delta: Vec3): Project {
  if (!delta.every(Number.isFinite)) throw new Error('Movement must be a finite distance.')
  if (!project.panels.length || delta.every(value => value === 0)) return project
  const move = (position: Vec3): Vec3 => tuple(vec(position).add(vec(delta)))
  return assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, { ...project,
    panels: resolvePanels(project).map(panel => ({ ...panel, position: move(panel.position) })),
    ...(project.assemblies ? { assemblies: { ...project.assemblies,
      instances: project.assemblies.instances.map(instance => ({ ...instance, position: move(instance.position) })),
    } } : {}),
  }))
}

/** Rotate the entire resolved assembly in world space, retaining its lowest panel height. */
export function rotateProject(project: Project, axis: RotationAxis, degrees: number): Project {
  if (!Number.isFinite(degrees)) throw new Error('Rotation must be a finite angle.')
  if (!project.panels.length || degrees % 360 === 0) return project
  const panels = resolvePanels(project)
  const bounds = getProjectBounds(panels)
  const center = vec(bounds.min).add(vec(bounds.max)).multiplyScalar(0.5)
  const direction = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
  const turn = new Quaternion().setFromAxisAngle(direction, (degrees % 360) * Math.PI / 180)
  const rotated = panels.map(panel => ({
    ...panel,
    position: tuple(vec(panel.position).sub(center).applyQuaternion(turn).add(center)),
    rotation: rotationTuple(turn.clone().multiply(quaternion(panel))),
  }))
  const lift = bounds.min[1] - getProjectBounds(rotated).min[1]
  const next = { ...project, ...(project.assemblies ? { assemblies: { ...project.assemblies, instances: project.assemblies.instances.map(instance => ({ ...instance,
    position: tuple(vec(instance.position).sub(center).applyQuaternion(turn).add(center).add(new Vector3(0, lift, 0))),
    rotation: rotationTuple(turn.clone().multiply(new Quaternion().setFromEuler(new Euler(...instance.rotation, 'XYZ')))),
  })) } } : {}), panels: rotated.map(panel => ({
    ...panel, position: [panel.position[0], panel.position[1] + lift, panel.position[2]] as Vec3,
  })) }
  // Connections remain in panel-local coordinates. Resolve once more so stored
  // child poses agree with the roots, including multi-branch and support joints.
  return assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, { ...next, panels: resolvePanels(next) }))
}

function panelObb(p: Panel) {
  return new OBB(vec(p.position), new Vector3(Math.max(0.1, p.width / 2 - 0.5), Math.max(0.1, p.height / 2 - 0.5), Math.max(0.1, p.thickness / 2 - 0.5)),
    new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion(p))))
}

function jointStructureIssues(connections: Connection[]): ValidationIssue[] {
  const groups = new Map<string, Connection[]>()
  for (const c of connections) { const id = jointId(c); groups.set(id, [...(groups.get(id) ?? []), c]) }
  const issues: ValidationIssue[] = []
  for (const [id, group] of groups) {
    const first = group[0]
    const expected = first.type === 't' ? 2 : first.type === 'cross' ? 3 : 1
    // Joint branches can have different centers along the shared edge.
    // Their physical clamps use the intersection of all branch spans.
    const inconsistent = group.some(c => c.parentId !== first.parentId || c.type !== first.type || c.role !== first.role || c.partial !== first.partial || c.side !== first.side || c.inset !== first.inset || c.flip !== first.flip || c.color !== first.color)
    const branchIndices = group.map(branchIndex).sort()
    const partial = first.partial === true && first.role === 'support' && expected > 1 && group.every(c => c.partial === true)
    const invalidIndices = branchIndices.some((index, i) => partial
      ? index < 0 || index >= expected || (i === 0 ? index !== 0 : index === branchIndices[i - 1])
      : index !== i)
    const invalidShared = expected > 1 && (invalidIndices || group.some(c => branchIndex(c) === 0 ? c.count < 1 : c.count !== 0))
    const invalidOutline = group.some(c => c.outlineEdge !== undefined) && (group.some(c => c.outlineEdge === undefined || c.partial)
      || (first.type !== '90' && first.type !== 't') || new Set(group.map(c => c.childId)).size !== group.length)
    if ((first.partial && !partial) || (partial ? group.length > expected : group.length !== expected) || inconsistent || invalidShared || invalidOutline || (expected === 1 && first.count < 1)) issues.push({
      id: `${id}-joint`, severity: 'error', message: `${first.type === 't' ? 'T' : first.type === 'cross' ? 'Cross' : `${first.type}°`} joint is incomplete or inconsistent. Detach it and reconnect the panels.`, panelIds: [...new Set(group.flatMap(c => [c.parentId, c.childId]))],
    })
  }
  return issues
}

export function validateProject(project: Project, options: { trofastWorld?: boolean } = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = jointStructureIssues(project.connections)
  if (project.spaceConstraint?.enabled) for (const row of spaceClearances(project.spaceConstraint, resolvePanels(project))) {
    if (row.clearance < -0.1) issues.push({ id: `${row.panel.id}-space`, severity: 'error', message: `${row.panel.name} exceeds the build space.`, panelIds: [row.panel.id] })
  }
  const panels = resolvePanels(project)
  const byId = new Map(panels.map(p => [p.id, p]))
  const jointQuantities = new Map(project.connections.filter(c => c.count > 0).map(c => [jointId(c), c.count]))
  for (const p of panels) {
    const outlineError = p.customOutline === undefined ? null : getOutlineError(p.customOutline)
    if (outlineError) issues.push({ id: `${p.id}-outline`, severity: 'error', message: `${p.name}: ${outlineError}`, panelIds: [p.id] })
    if (p.pattern !== 'solid' && (p.holeSpacing < Math.max(15, p.holeSize + 5) || Math.floor(p.width / p.holeSpacing) * Math.floor(p.height / p.holeSpacing) > 5000)) {
      issues.push({ id: `${p.id}-pattern`, severity: 'error', message: `${p.name}: increase hole spacing. Leave 5 mm between holes and use at most 5,000 holes per panel.`, panelIds: [p.id] })
    }
  }
  for (const c of project.connections) {
    const parent = byId.get(c.parentId); const child = byId.get(c.childId)
    if (!parent || !child) {
      issues.push({ id: `${c.id}-missing`, severity: 'error', message: 'A connection refers to a missing panel.', panelIds: [c.parentId, c.childId] }); continue
    }
    const min = c.type === 't' || c.type === 'cross' ? 18 : 16
    if ([parent, child].some(p => p.thickness < min || p.thickness > 19)) issues.push({
      id: `${c.id}-thickness`, severity: 'error', message: `${c.type === 't' ? 'T' : c.type === 'cross' ? 'Cross' : `${c.type}°`} connectors need ${min}–19 mm panels.`, panelIds: [parent.id, child.id],
    })
    const seam = seamInfo(parent, c)
    const parentRadialLength = seam.horizontalSeam ? parent.height : parent.width
    const insetMin = seam.face ? -parent.height / 2 : 0
    const insetMax = seam.face ? parent.height / 2 : parentRadialLength
    if ((c.inset < insetMin || c.inset > insetMax) && c.count > 0) issues.push({ id: `${c.id}-inset`, severity: 'error', message: `The attachment is outside ${parent.name}. Keep inset between ${insetMin} and ${insetMax} mm.`, panelIds: [parent.id, child.id] })
    if (!seam.face && c.inset > 0 && c.inset < parentRadialLength && c.count > 0) issues.push({ id: `${c.id}-edge-access`, severity: 'error', message: `${parent.name} needs an exposed edge for this connector. Use a T joint with separate panels instead of an interior inset.`, panelIds: [parent.id, child.id] })
    const usableSeam = getConnectorSeam(c, parent, child)
    const overlap = usableSeam.upper - usableSeam.lower + 40
    const quantity = jointQuantities.get(jointId(c)) ?? 1
    if (overlap < quantity * 40) issues.push({ id: `${c.id}-overlap`, severity: 'error', message: `Not enough shared edge for ${quantity} connector${quantity > 1 ? 's' : ''}. Reduce the offset, corner radius, or connector count.`, panelIds: [parent.id, child.id] })
    if (seam.face && c.count > 0) issues.push({ id: `${c.id}-face`, severity: 'warning', message: 'This face attachment needs an accessible panel edge. Check clamp access before making.', panelIds: [parent.id, child.id] })
    if (c.outlineEdge !== undefined) {
      if (!outlineConnectionAligned(parent, child, c)) issues.push({ id: `${c.id}-alignment`, severity: 'error', message: `The support joint between ${parent.name} and ${child.name} no longer aligns with its outline edge. Restore the outline or detach the joint.`, panelIds: [parent.id, child.id] })
    } else if (c.role === 'support') {
      const expected = attachmentPose(parent, child, c)
      const positionError = vec(expected.position).distanceTo(vec(child.position))
      const expectedRotation = quaternion({ ...child, rotation: expected.rotation })
      const actualRotation = quaternion(child)
      // A rectangular panel occupies the same slot after a half-turn about any
      // local axis. Closed assemblies can reach it from opposite ends. Preserve
      // width/height correspondence: a quarter-turn is not interchangeable.
      const alignedAxes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].every(axis =>
        Math.abs(axis.clone().applyQuaternion(expectedRotation).dot(axis.clone().applyQuaternion(actualRotation))) > 0.9999)
      if (positionError > 1 || !alignedAxes) issues.push({ id: `${c.id}-alignment`, severity: 'error', message: `The support joint between ${parent.name} and ${child.name} no longer aligns. Restore the panel dimensions or detach and rebuild this joint.`, panelIds: [parent.id, child.id] })
    }
  }
  // Pairwise overlap alone is insufficient when supplemental T/cross branches
  // have different offsets: all slots must grip the same straight edge span.
  for (const first of project.connections.filter(c => c.count > 0 && (c.type === 't' || c.type === 'cross'))) {
    const parent = byId.get(first.parentId)
    if (!parent) continue
    const branches = project.connections.filter(c => jointId(c) === jointId(first))
    const seams = branches.flatMap(c => {
      const child = byId.get(c.childId)
      return child ? [getConnectorSeam(c, parent, child)] : []
    })
    if (seams.length !== branches.length) continue
    const span = Math.min(...seams.map(seam => seam.upper)) - Math.max(...seams.map(seam => seam.lower))
    if (span < (first.count - 1) * 40 - 1e-7) issues.push({ id: `${jointId(first)}-shared-overlap`, severity: 'error',
      message: `Not enough shared edge across all panels for ${first.count} connector${first.count > 1 ? 's' : ''}. Reduce the offsets, corner radii, or connector count.`,
      panelIds: [parent.id, ...branches.map(c => c.childId)] })
  }
  const boxes = panels.map(panelObb)
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    if (boxes[i].intersectsOBB(boxes[j])) issues.push({ id: `collision-${panels[i].id}-${panels[j].id}`, severity: 'warning', message: `${panels[i].name} overlaps ${panels[j].name}.`, panelIds: [panels[i].id, panels[j].id] })
  }
  for (const result of evaluateDesignConstraints(project.constraints, panels)) if (result.constraint.enabled && result.violation > 0) issues.push({
    id: `constraint-${result.constraint.id}`, severity: 'error', panelIds: designConstraintPanelIds(result.constraint),
    message: result.issue ?? `${describeDesignConstraint(result.constraint, panels)}. Current measurement: ${Number(result.actual.toFixed(2))} mm.`,
  })
  return [...issues, ...validateTrofastInserts(project, panels, options.trofastWorld !== false)]
}

export function createStarterProject(template: 'shelf' | 'desk' | 'display' | 'blank' = 'shelf'): Project {
  const project: Project = { version: 1, name: template === 'desk' ? 'The everyday desk' : template === 'display' ? 'A place for ideas' : template === 'blank' ? 'Untitled project' : 'The everyday shelf', panels: [], connections: [] }
  if (template === 'blank') return project
  const base = createPanel({ name: template === 'desk' ? 'Desktop' : template === 'display' ? 'Display base' : 'Bottom shelf', width: template === 'desk' ? 1200 : template === 'display' ? 700 : 1100, height: template === 'desk' ? 600 : 360,
    position: [0, template === 'desk' ? 740 : 28, 0], rotation: [-Math.PI / 2, 0, 0] })
  let result: Project = { ...project, panels: [base] }
  const opts: AttachmentOptions = { side: 'left', type: '90', offset: 0, inset: 0, flip: template === 'desk', color: '#e75a35', count: 2 }
  const sideWidth = template === 'desk' ? 700 : template === 'display' ? 950 : 390
  const left = createPanel({ name: 'Left side', width: sideWidth, height: base.height })
  result = attachPanel(result, base.id, left, opts)
  if (template === 'display') {
    result = attachPanel(result, base.id, createPanel({ name: 'Pegboard', width: 700, height: 950, pattern: 'pegboard', holeSize: 12, holeSpacing: 48 }), { ...opts, side: 'top' })
    return result
  }
  const right = createPanel({ name: 'Right side', width: sideWidth, height: base.height })
  result = attachPanel(result, base.id, right, { ...opts, side: 'right' })
  if (template === 'shelf') {
    const top = createPanel({ name: 'Top shelf', width: 1100, height: 360 })
    const middle = createPanel({ name: 'Middle shelf', width: 1100, height: 360 })
    result = attachPanel(result, left.id, middle, { ...opts, type: 't', side: 'left' })
    const upperLeftId = result.connections.at(-1)!.childId
    // The T connects three separate edges. Its 35 mm inline gap replaces the
    // middle section of each former 780 mm side without moving the shelves.
    result = { ...result, panels: result.panels.map(panel => panel.id === upperLeftId ? { ...panel, name: 'Left upper side', width: 355 } : panel) }
    result = attachPanel(result, upperLeftId, top, { ...opts, side: 'left' })
    const upperRight = createPanel({ name: 'Right upper side', width: 355, height: 360 })
    // The top panel's local X points left, so its left edge is the right end
    // of the furniture. Driving this side from the top keeps a simple tree.
    result = attachPanel(result, top.id, upperRight, { ...opts, side: 'left' })
    const rightJoint = uid()
    result = { ...result, connections: [...result.connections,
      { ...opts, id: `${rightJoint}:0`, parentId: right.id, childId: middle.id, type: 't', side: 'right', role: 'support' },
      { ...opts, id: `${rightJoint}:1`, parentId: right.id, childId: upperRight.id, type: 't', side: 'right', count: 0, role: 'support' },
    ] }
    const order = [base.id, left.id, right.id, top.id, middle.id, upperLeftId, upperRight.id]
    result.panels = order.map(id => result.panels.find(panel => panel.id === id)!)
  }
  return result
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function numberIn(v: unknown, min: number, max: number, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid ${field}: expected ${min}–${max}.`)
  return v
}
function stringIn(v: unknown, field: string, max = 120): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`Invalid ${field}.`)
  return v
}
function enumIn<T extends string>(v: unknown, options: readonly T[], field: string): T {
  if (typeof v !== 'string' || !options.includes(v as T)) throw new Error(`Invalid ${field}.`)
  return v as T
}
function vectorIn(v: unknown, field: string, max: number): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`Invalid ${field}.`)
  return v.map(x => numberIn(x, -max, max, field)) as Vec3
}
function colorIn(v: unknown): string {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Colors must be six-digit hex values.')
  return v
}

export function parseProject(input: unknown): Project {
  if (!object(input) || input.version !== 1 || !Array.isArray(input.panels) || !Array.isArray(input.connections)) throw new Error('This is not a playwood. APP project (version 1).')
  if (input.panels.length > 200 || input.connections.length > 400) throw new Error('Projects support up to 200 panels and 400 connections.')
  const panels = input.panels.map((raw): Panel => {
    if (!object(raw)) throw new Error('Invalid panel.')
    const p: Panel = {
      id: stringIn(raw.id, 'panel ID'), name: stringIn(raw.name, 'panel name'),
      width: numberIn(raw.width, 40, 4000, 'panel width'), height: numberIn(raw.height, 40, 4000, 'panel height'), thickness: numberIn(raw.thickness, 3, 100, 'panel thickness'),
      material: enumIn(raw.material, ['birch', 'oak', 'walnut', 'mdf', 'osb', 'nazena', 'painted'], 'material'),
      color: colorIn(raw.color), pattern: enumIn(raw.pattern, ['solid', 'pegboard', 'slots'], 'panel pattern'),
      position: vectorIn(raw.position, 'position', 100000), rotation: vectorIn(raw.rotation, 'rotation', Math.PI * 100),
      cornerRadius: raw.cornerRadius === undefined ? 0 : numberIn(raw.cornerRadius, 0, 2000, 'corner radius'),
      visible: raw.visible === undefined ? true : raw.visible as boolean,
      holeSize: numberIn(raw.holeSize, 2, 200, 'hole size'), holeSpacing: numberIn(raw.holeSpacing, 10, 500, 'hole spacing'),
    }
    if (raw.wireframe !== undefined) {
      if (typeof raw.wireframe !== 'boolean') throw new Error('Invalid panel wireframe visibility.')
      p.wireframe = raw.wireframe
    }
    if (raw.finishCoverage !== undefined) p.finishCoverage = numberIn(raw.finishCoverage, 0, 1, 'finish coverage')
    if (raw.customOutline !== undefined) {
      const outlineError = getOutlineError(raw.customOutline)
      if (outlineError) throw new Error(`Invalid custom outline: ${outlineError}`)
      p.customOutline = (raw.customOutline as OutlinePoint[]).map(point => ({ x: point.x, y: point.y }))
    }
    if (raw.trofastInserts !== undefined) {
      if (!Array.isArray(raw.trofastInserts) || raw.trofastInserts.length > MAX_TROFAST_INSERTS) throw new Error('Invalid TROFAST inserts.')
      p.trofastInserts = raw.trofastInserts.map(value => {
        if (!object(value)) throw new Error('Invalid TROFAST insert.')
        const itemId = stringIn(value.itemId, 'TROFAST item'), item = getTrofastItem(itemId)
        const colorId = stringIn(value.colorId, 'TROFAST color')
        if (!item || !item.colors.includes(colorId)) throw new Error('Invalid TROFAST item or color.')
        if (value.face !== 1 && value.face !== -1) throw new Error('Invalid TROFAST mounting face.')
        if (value.quarterTurn !== undefined && typeof value.quarterTurn !== 'boolean') throw new Error('Invalid TROFAST orientation.')
        return { id: stringIn(value.id, 'TROFAST ID'), itemId, colorId, face: value.face,
          x: numberIn(value.x, -4000, 8000, 'TROFAST position X'), y: numberIn(value.y, -4000, 8000, 'TROFAST position Y'),
          ...(value.quarterTurn !== undefined ? { quarterTurn: value.quarterTurn } : {}) }
      })
      if (new Set(p.trofastInserts.map(insert => insert.id)).size !== p.trofastInserts.length) throw new Error('TROFAST insert IDs must be unique within a panel.')
    }
    if (typeof p.visible !== 'boolean') throw new Error('Invalid panel visibility.')
    if (p.holeSpacing < Math.max(15, p.holeSize + 5)) throw new Error('Hole spacing must be at least 15 mm and leave 5 mm of material between holes.')
    if (p.pattern !== 'solid' && Math.floor(p.width / p.holeSpacing) * Math.floor(p.height / p.holeSpacing) > 5000) throw new Error('Perforated panels support up to 5,000 holes. Increase hole spacing.')
    return p
  })
  const panelIds = new Set(panels.map(p => p.id))
  if (panelIds.size !== panels.length) throw new Error('Panel IDs must be unique.')
  const connections = input.connections.map((raw): Connection => {
    if (!object(raw)) throw new Error('Invalid connection.')
    const c: Connection = {
      id: stringIn(raw.id, 'connection ID'), parentId: stringIn(raw.parentId, 'parent ID'), childId: stringIn(raw.childId, 'child ID'),
      type: enumIn(raw.type, ['90', '105', '150', 't', 'cross'], 'connector type'), side: enumIn(raw.side, ['left', 'right', 'top', 'bottom', 'front', 'back'], 'attachment side'),
      offset: numberIn(raw.offset, -10000, 10000, 'offset'), inset: numberIn(raw.inset, -10000, 10000, 'inset'),
      flip: raw.flip as boolean, color: colorIn(raw.color), count: numberIn(raw.count, 0, 20, 'connector quantity'),
    }
    if (raw.role !== undefined) c.role = enumIn(raw.role, ['support'] as const, 'connection role')
    if (raw.material !== undefined) c.material = getConnectorMaterial(c.type, enumIn(raw.material, ['plastic', 'metal'] as const, 'connector material'))
    if (raw.quarterTurn !== undefined) {
      if (typeof raw.quarterTurn !== 'boolean') throw new Error('Invalid child panel orientation.')
      c.quarterTurn = raw.quarterTurn
    }
    if (raw.partial !== undefined) {
      if (typeof raw.partial !== 'boolean') throw new Error('Invalid partial joint.')
      c.partial = raw.partial
    }
    if (raw.outlineEdge !== undefined) {
      c.outlineEdge = numberIn(raw.outlineEdge, 0, 127, 'outline edge')
      const parent = panels.find(panel => panel.id === c.parentId), child = panels.find(panel => panel.id === c.childId)
      if (!Number.isInteger(c.outlineEdge) || !child?.customOutline?.[c.outlineEdge] || parent?.customOutline || c.role !== 'support' || (c.type !== '90' && c.type !== 't')
        || c.side === 'front' || c.side === 'back' || c.inset !== 0 || c.quarterTurn || c.partial) throw new Error('Invalid outline edge joint: use a supplemental 90° connector or complete T joint from a rectangular rim to existing outline edges.')
    }
    if (typeof c.flip !== 'boolean' || !Number.isInteger(c.count)) throw new Error('Invalid connector options.')
    if (!panelIds.has(c.parentId) || !panelIds.has(c.childId) || c.parentId === c.childId) throw new Error('Connections must link two different, existing panels.')
    return c
  })
  if (new Set(connections.map(c => c.id)).size !== connections.length) throw new Error('Connection IDs must be unique.')
  const drivingConnections = connections.filter(c => c.role !== 'support')
  if (new Set(drivingConnections.map(c => c.childId)).size !== drivingConnections.length) throw new Error('A panel cannot have more than one parent attachment.')
  const structureIssues = jointStructureIssues(connections)
  if (structureIssues.length) throw new Error(structureIssues[0].message)
  const parents = new Map(drivingConnections.map(c => [c.childId, c.parentId]))
  for (const id of panelIds) {
    const visited = new Set<string>(); let current: string | undefined = id
    while (current) { if (visited.has(current)) throw new Error('Circular attachments are not supported.'); visited.add(current); current = parents.get(current) }
  }
  const project: Project = { version: 1, name: stringIn(input.name, 'project name'), panels, connections }
  if (input.constructionObjects !== undefined) project.constructionObjects = parseConstructionObjects(input.constructionObjects)
  if (input.spaceConstraint !== undefined) project.spaceConstraint = parseSpaceConstraint(input.spaceConstraint)
  if (input.niceValues !== undefined) project.niceValues = parseNiceValues(input.niceValues)
  if (input.constraints !== undefined) project.constraints = parseDesignConstraints(input.constraints, panels)
  if (input.customColors !== undefined) project.customColors = parseCustomColors(input.customColors)
  if (input.assemblies !== undefined) project.assemblies = parseAssemblyData(input.assemblies, project)
  if (input.connectorOverrides !== undefined) {
    if (!object(input.connectorOverrides) || Object.keys(input.connectorOverrides).length > 8000) throw new Error('Invalid connector overrides.')
    project.connectorOverrides = Object.fromEntries(Object.entries(input.connectorOverrides).map(([id, raw]) => {
      const key = parseConnectorId(id)
      if (!object(raw)) throw new Error('Invalid connector override.')
      if (raw.removed !== undefined && typeof raw.removed !== 'boolean') throw new Error('Invalid connector removal.')
      const type = raw.type !== undefined ? enumIn(raw.type, ['90', '105', '150', 't', 'cross'] as const, 'connector type') : connections.find(c => c.id === key[0])?.type
      return [id, {
        ...(raw.color !== undefined ? { color: colorIn(raw.color) } : {}),
        ...(raw.type !== undefined ? { type } : {}),
        ...(raw.material !== undefined ? { material: getConnectorMaterial(type ?? '90', enumIn(raw.material, ['plastic', 'metal'] as const, 'connector material')) } : {}),
        ...(raw.removed !== undefined ? { removed: raw.removed as boolean } : {}),
        ...(raw.slide !== undefined ? { slide: numberIn(raw.slide, -10000, 10000, 'connector slide') } : {}),
      }]
    }))
  }
  if (input.listGroups !== undefined) {
    if (!Array.isArray(input.listGroups) || input.listGroups.length > 1000) throw new Error('Invalid list groups.')
    const groupIds = new Set<string>()
    const members = { panels: new Set<string>(), connectors: new Set<string>() }
    const validIds = { panels: panelIds, connectors: new Set(getPhysicalConnectors(project).map(connector => connector.id)) }
    project.listGroups = input.listGroups.map(raw => {
      if (!object(raw) || !Array.isArray(raw.itemIds) || raw.itemIds.length > 8000) throw new Error('Invalid list group.')
      const id = stringIn(raw.id, 'group ID')
      if (groupIds.has(id)) throw new Error('Group IDs must be unique.')
      groupIds.add(id)
      const kind = enumIn(raw.kind, ['panels', 'connectors'] as const, 'group kind')
      const itemIds = raw.itemIds.map(value => stringIn(value, 'group item ID', 1024)).filter(itemId => {
        // Deleted pieces may leave metadata behind; never resurrect or duplicate rows.
        if (!validIds[kind].has(itemId) || members[kind].has(itemId)) return false
        members[kind].add(itemId)
        return true
      })
      return { id, kind, name: stringIn(raw.name, 'group name').slice(0, 120), itemIds }
    })
  }
  if (input.connectorOrder !== undefined) {
    if (!Array.isArray(input.connectorOrder) || input.connectorOrder.length > 8000) throw new Error('Invalid connector order.')
    const valid = new Set(getPhysicalConnectors(project).map(connector => connector.id))
    project.connectorOrder = [...new Set(input.connectorOrder.map(value => stringIn(value, 'connector order ID', 1024)))].filter(id => valid.has(id))
  }
  return project
}

export function projectToCsv(project: Project): string {
  const cell = (value: string | number) => {
    const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value)
    return `"${safe.replaceAll('"', '""')}"`
  }
  const rows: (string | number)[][] = [['Item', 'Quantity', 'Width (mm)', 'Height (mm)', 'Thickness (mm)', 'Material', 'Color', 'Finish coverage (%)', 'Pattern', 'Hole size (mm)', 'Hole pitch (mm)', 'Corner radius (mm)', 'Custom outline points (mm, x/y from top left)', 'TROFAST details (mm; illustrative cutouts, measure actual item before cutting)']]
  for (const panel of project.panels) rows.push([panel.name, 1, panel.width, panel.height, panel.thickness, panel.material, panel.color, panel.material === 'painted' ? 100 : Math.round((panel.finishCoverage ?? 0) * 100), panel.pattern, panel.pattern === 'solid' ? '' : panel.holeSize, panel.pattern === 'solid' ? '' : panel.holeSpacing, panelCornerRadius(panel),
    panel.customOutline?.map(point => `${Number((point.x * panel.width).toFixed(3))}/${Number((point.y * panel.height).toFixed(3))}`).join('; ') ?? '',
    (panel.trofastInserts ?? []).map(insert => {
      const item = getTrofastItem(insert.itemId)
      return item ? `${item.name}: center ${insert.x}/${insert.y} from top left; approximate opening ${insert.quarterTurn ? item.cutoutDepth : item.cutoutWidth} x ${insert.quarterTurn ? item.cutoutWidth : item.cutoutDepth}; face ${insert.face}` : ''
    }).join('; ')])
  const connectors = new Map<string, number>()
  for (const c of getPhysicalConnectors(project)) { const key = `${c.type}|${c.material}|${connectorDisplayColor(c)}`; connectors.set(key, (connectors.get(key) ?? 0) + 1) }
  for (const [key, count] of connectors) { const [type, material, color] = key.split('|'); rows.push([`Playwood ${type === 't' ? 'T' : type === 'cross' ? 'Cross' : `${type}°`} connector`, count, '', '', '', material === 'metal' ? 'Cast metal' : 'Reinforced plastic', color, '', '', '', '', '', '', '']) }
  const purchased = new Map<string, number>()
  for (const panel of project.panels) for (const insert of panel.trofastInserts ?? []) {
    const key = `${insert.itemId}|${insert.colorId}`
    purchased.set(key, (purchased.get(key) ?? 0) + 1)
  }
  for (const [key, count] of purchased) {
    const [itemId, colorId] = key.split('|'), item = getTrofastItem(itemId), color = getTrofastColor(colorId)
    if (item && color) rows.push([`IKEA TROFAST ${item.name}`, count, '', '', '', item.kind === 'mesh' ? 'Powder-coated steel' : 'Polypropylene', color.name, '', '', '', '', '', '',
      `Purchased item ${item.productIds[colorId]}; outer W x D x H ${item.width} x ${item.depth} x ${item.height}`])
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}
