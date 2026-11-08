import { Euler, Quaternion, Vector3 } from 'three'
import { getConnectorPlacements, getConnectorSeam, resolvePanels } from './model'
import { assertSelectionStretchClearance } from './selection-stretch-clearance'
import { panelSurfaceContacts, stretchPanelSelection, StructureEditError, type SelectionStretchEdge } from './structure-edit'
import type { Connection, Panel, Project, Vec3 } from './types'

export interface SelectionStretchPlan {
  id: string
  direction: Vec3
  position: Vec3
  /** Unselected boundary spans whose cuts may change. */
  panelIds: string[]
  blocked?: { reason: string; panelIds: string[]; connectionIds: string[] }
}

interface PreparedPlan {
  source: Project
  selection: string
  direction: Vec3
  edges: SelectionStretchEdge[]
  signature: string
}
interface BoundaryRelation { members: string[]; point: Vector3; tangent?: Vector3; normal?: Vector3 }

const prepared = new WeakMap<SelectionStretchPlan, PreparedPlan>()
const EPSILON = 1e-6
const selectionKey = (ids: readonly string[]) => JSON.stringify([...new Set(ids)].sort())
const signature = (plan: SelectionStretchPlan) => JSON.stringify([plan.id, plan.direction, plan.position, plan.panelIds])
const axesOf = (panel: Panel) => {
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(rotation))
}
const extent = (panel: Panel, axis: Vector3) => axesOf(panel).reduce((sum, own, index) =>
  sum + Math.abs(own.dot(axis)) * [panel.width, panel.height, panel.thickness][index] / 2, 0)

/** Recognize boundary spans from physical joints and implicit surface supports,
 * without names, world-axis assumptions, or saved feature metadata. Every
 * selected component must meet a stretching boundary; loose extra selections
 * cannot acquire a misleading handle through another selected component. */
export function prepareSelectionStretch(project: Project, ids: readonly string[]): SelectionStretchPlan[] {
  const selected = new Set(ids), panels = resolvePanels(project), byId = new Map(panels.map(panel => [panel.id, panel]))
  if (selected.size < 2 || selected.size === panels.length || [...selected].some(id => !byId.has(id))) return []
  const managed = new Set(project.assemblies?.instances.flatMap(instance => Object.values(instance.panelIds)))
  if ([...selected].some(id => managed.has(id) || byId.get(id)!.customOutline)) return []
  const joints = new Map<string, Connection[]>()
  for (const connection of project.connections) {
    const id = connection.id.replace(/:\d+$/, '')
    joints.set(id, [...joints.get(id) ?? [], connection])
  }
  const relations: BoundaryRelation[] = []
  for (const branches of joints.values()) {
    const members = [...new Set(branches.flatMap(connection => [connection.parentId, connection.childId]))]
    if (!members.some(id => selected.has(id)) || members.some(id => !byId.has(id))) continue
    const connection = branches.find(branch => branch.count > 0) ?? branches[0]
    if (branches.some(branch => branch.outlineEdge !== undefined)) return []
    const parent = byId.get(connection.parentId)!, child = byId.get(connection.childId)!
    const placement = getConnectorPlacements({ ...connection, count: 1 }, parent, child)[0]
    relations.push({ members, point: new Vector3(...placement.position), tangent: new Vector3(...getConnectorSeam(connection, parent, child).tangent) })
  }
  for (const contact of panelSurfaceContacts(project)) {
    if (!contact.panelIds.some(id => selected.has(id))) continue
    const selectedId = contact.panelIds.find(id => selected.has(id))!
    relations.push({ members: contact.panelIds, point: new Vector3(...byId.get(selectedId)!.position), normal: new Vector3(...contact.normal) })
  }
  const boundary = relations.filter(relation => relation.members.some(id => !selected.has(id)))
  if (!boundary.length) return []
  const roots = new Map([...selected].map(id => [id, id]))
  const root = (id: string): string => {
    let current = id
    while (roots.get(current) !== current) current = roots.get(current)!
    return current
  }
  for (const relation of relations) {
    const members = relation.members.filter(id => selected.has(id))
    for (const id of members.slice(1)) roots.set(root(id), root(members[0]))
  }
  const components = new Set([...selected].map(root))
  const boundaryIds = [...new Set(boundary.flatMap(relation => relation.members.filter(id => !selected.has(id))))]
  const axes: Vector3[] = []
  for (const id of boundaryIds) {
    const panel = byId.get(id)!
    if (managed.has(id) || panel.customOutline) continue
    for (const axis of axesOf(panel).slice(0, 2)) {
      if ((axis.toArray().find(value => Math.abs(value) > EPSILON) ?? 0) < 0) axis.negate()
      if (!axes.some(other => other.dot(axis) > 1 - EPSILON)) axes.push(axis)
    }
  }
  const selectedPanels = panels.filter(panel => selected.has(panel.id))
  const center = selectedPanels.reduce((sum, panel) => sum.add(new Vector3(...panel.position)), new Vector3()).multiplyScalar(1 / selectedPanels.length)
  const plans: SelectionStretchPlan[] = []
  for (const axis of axes) {
    const edges = new Map<string, SelectionStretchEdge>(), supported = new Set<string>()
    let incompatible = false
    for (const relation of boundary) {
      if ((relation.tangent && Math.abs(relation.tangent.dot(axis)) > EPSILON)
        || (relation.normal && Math.abs(relation.normal.dot(axis)) < 1 - EPSILON)) continue
      for (const id of relation.members.filter(id => !selected.has(id))) {
        const panel = byId.get(id)!
        if (managed.has(id) || panel.customOutline) continue
        const ownAxes = axesOf(panel), dimension = ownAxes.slice(0, 2).findIndex(own => Math.abs(own.dot(axis)) > 1 - EPSILON)
        if (dimension < 0) continue
        const cut = dimension === 0 ? 'width' : 'height'
        const coordinate = relation.point.clone().sub(new Vector3(...panel.position)).dot(ownAxes[dimension])
        // A cut-axis extension must pull an end. Sliding a joint along an
        // interior seam is not a boundary stretch, even when it can be solved.
        if (Math.abs(coordinate) < panel[cut] / 2 - 0.001) continue
        const side = (coordinate < 0 ? -1 : 1) as -1 | 1
        const existing = edges.get(id)
        if (existing && (existing.dimension !== cut || existing.side !== side)) incompatible = true
        edges.set(id, { panelId: id, dimension: cut, side })
        relation.members.filter(member => selected.has(member)).forEach(member => supported.add(root(member)))
      }
    }
    if (incompatible || !edges.size || [...components].some(component => !supported.has(component))) continue
    const edgeList = [...edges.values()].sort((a, b) => a.panelId.localeCompare(b.panelId))
    const pair: SelectionStretchPlan[] = []
    for (const sign of [1, -1]) {
      const direction = axis.clone().multiplyScalar(sign)
      const end = Math.max(...selectedPanels.map(panel => new Vector3(...panel.position).dot(direction) + extent(panel, direction)))
      const plan: SelectionStretchPlan = {
        id: `selection-stretch-${axis.toArray().map(value => Math.round(value * 1e6)).join('-')}-${sign > 0 ? 'positive' : 'negative'}`,
        direction: direction.toArray() as Vec3,
        position: center.clone().addScaledVector(direction, end - center.dot(direction)).toArray() as Vec3,
        panelIds: edgeList.map(edge => edge.panelId),
      }
      prepared.set(plan, { source: project, selection: selectionKey(ids), direction: [...plan.direction], edges: edgeList,
        signature: signature(plan) })
      pair.push(plan)
    }
    const errors: unknown[] = []
    let possible = false
    for (const distance of [1, -1]) {
      try { moveSelectionStretch(project, ids, pair[0], distance); possible = true; break }
      catch (error) { errors.push(error) }
    }
    if (!possible) {
      const diagnostics = errors.filter((error): error is StructureEditError => error instanceof StructureEditError)
      const blocked = { reason: errors[0] instanceof Error ? errors[0].message : 'These boundary panels cannot stretch while keeping the construction connected.',
        panelIds: [...new Set(diagnostics.flatMap(error => error.panelIds))],
        connectionIds: [...new Set(diagnostics.flatMap(error => error.connectionIds))] }
      pair.forEach(plan => { plan.blocked = blocked })
    }
    plans.push(...pair)
  }
  return plans
}

/** All candidates start from the prepared source. A stale or altered plan
 * cannot redirect an edit to another selection or authorize additional cuts. */
export function moveSelectionStretch(project: Project, ids: readonly string[], plan: SelectionStretchPlan, distance: number): Project {
  if (!Number.isFinite(distance)) throw new Error('Panel movement must be a finite distance.')
  const record = prepared.get(plan)
  if (!record || record.source !== project || record.selection !== selectionKey(ids) || record.signature !== signature(plan)) {
    throw new Error('The project or selection changed. Select the panels again to prepare a current stretch.')
  }
  if (Math.abs(distance) < EPSILON) return project
  if (plan.blocked) throw new StructureEditError(plan.blocked.reason, plan.blocked.panelIds, plan.blocked.connectionIds)
  const moving = new Set([...ids, ...record.edges.map(edge => edge.panelId)])
  const outlineJoint = project.connections.find(connection => connection.outlineEdge !== undefined
    && (moving.has(connection.parentId) || moving.has(connection.childId)))
  if (outlineJoint) throw new StructureEditError('This stretch reaches a fitted outline panel. Resize its surrounding frame together instead.',
    [outlineJoint.parentId, outlineJoint.childId], [outlineJoint.id])
  const delta = new Vector3(...record.direction).multiplyScalar(distance).toArray() as Vec3
  const next = stretchPanelSelection(project, ids, record.edges, delta)
  const before = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  const selected = new Set(ids), spans = new Map(record.edges.map(edge => [edge.panelId, edge]))
  for (const panel of resolvePanels(next)) {
    const previous = before.get(panel.id)!
    if (panel.rotation.some((value, index) => Math.abs(value - previous.rotation[index]) > EPSILON)
      || panel.thickness !== previous.thickness) throw new Error('This stretch would change panel orientation or thickness.')
    const span = spans.get(panel.id)
    if (span) {
      const axis = axesOf(previous)[span.dimension === 'width' ? 0 : 1]
      const size = previous[span.dimension] + axis.dot(new Vector3(...delta)) * span.side
      const other = span.dimension === 'width' ? 'height' : 'width'
      if (new Vector3(...panel.position).distanceTo(new Vector3(...previous.position).addScaledVector(new Vector3(...delta), 0.5)) > 0.0001
        || Math.abs(panel[span.dimension] - size) > EPSILON || Math.abs(panel[other] - previous[other]) > EPSILON) {
        throw new StructureEditError('This stretch would move a boundary panel’s fixed end.', [panel.id])
      }
      continue
    }
    const target = new Vector3(...previous.position)
    if (selected.has(panel.id)) target.add(new Vector3(...delta))
    if (new Vector3(...panel.position).distanceTo(target) > 0.0001
      || Math.abs(panel.width - previous.width) > EPSILON || Math.abs(panel.height - previous.height) > EPSILON
      || JSON.stringify(panel.customOutline) !== JSON.stringify(previous.customOutline)) {
      throw new StructureEditError('This stretch would move or reshape panels outside its boundary.', [panel.id])
    }
  }
  if (project.assemblies?.instances.length) {
    // The ordinary-panel solver isolates managed instances. Retain contacts
    // with those stationary instances as part of this stricter stretch scope.
    const contacts = panelSurfaceContacts(next)
    for (const contact of panelSurfaceContacts(project)) {
      if (!contact.panelIds.some(id => moving.has(id))) continue
      if (!contacts.some(other => contact.panelIds.every(id => other.panelIds.includes(id))
        && Math.abs(new Vector3(...contact.normal).dot(new Vector3(...other.normal))) > 1 - EPSILON)) {
        throw new StructureEditError('This stretch would release an existing surface support.', contact.panelIds)
      }
    }
  }
  assertSelectionStretchClearance(project, next)
  return next
}
