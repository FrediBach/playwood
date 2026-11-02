import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { isPanelConnectedToAssembly } from './assemblies'
import { samePanelPlacement } from './assembly-placement'
import { autoConnect } from './auto-connect'
import { findPanelHoles } from './close-holes'
import { CONNECTOR_PROFILES } from './connector-profile'
import { connectorId } from './connector-selection'
import { copyDesignConstraints, designConstraintPanelIds, MAX_DESIGN_CONSTRAINTS } from './design-constraints'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { gridPanelCut } from './grid-split'
import { resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project, Vec3 } from './types'

export interface StructureRepeatResult {
  project: Project
  distance: number
  limited: boolean
  count: number
  selectedPanelId: string
  reusedPanelIds: string[]
  reason?: string
}

export interface StructureRepeatSession {
  original: Project
  panelIds: string[]
  selectedPanelId: string
  pitch: number
  direction: Vec3
  source: Panel[]
  mode: 'shared-wall' | 'depth'
  separator?: Panel
  trailingId: string
  leadingId: string
  candidates: { project: Project; leadingId: string; selectedPanelId: string; panelIds: string[]; reusedPanelIds: string[] }[]
  blocked?: string
}

const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')

function jointMembers(project: Project) {
  const groups = new Map<string, Set<string>>()
  for (const connection of project.connections) {
    const id = jointId(connection), members = groups.get(id) ?? new Set<string>()
    members.add(connection.parentId); members.add(connection.childId); groups.set(id, members)
  }
  return [...groups.values()]
}

/** Equivalent quarter-turned stock may swap local cut axes without changing a cell. */
function repeatFrame(panels: Panel[]) {
  const normalized = panels.map((panel, index) => {
    const orientation = rotation(panel)
    const normal = axes[2].clone().applyQuaternion(orientation)
    const reference = panels.slice(0, index).find(other => Math.abs(normal.dot(axes[2].clone().applyQuaternion(rotation(other)))) > .99999)
    if (!reference || Math.abs(axes[0].clone().applyQuaternion(orientation).dot(axes[0].clone().applyQuaternion(rotation(reference)))) > .99999) return panel
    const turned = new Euler().setFromQuaternion(orientation.multiply(new Quaternion().setFromAxisAngle(axes[2], Math.PI / 2)))
    return { ...panel, width: panel.height, height: panel.width, rotation: [turned.x, turned.y, turned.z] as Vec3 }
  })
  const frame = gridPanelCut(normalized)
  if (!frame) return undefined
  const actual = new Map(panels.map(panel => [panel.id, panel]))
  return { ...frame, x: { ...frame.x, panels: frame.x.panels.map(panel => actual.get(panel.id)!) },
    y: { ...frame.y, panels: frame.y.panels.map(panel => actual.get(panel.id)!) } }
}

/** Recognize one existing compartment along any of its three orthogonal axes. */
export function prepareStructureRepeat(project: Project, panelId: string, direction: Vec3): StructureRepeatSession {
  const panels = resolvePanels(project), selected = panels.find(panel => panel.id === panelId)
  if (!selected || !selected.visible) throw new Error('Select a visible panel to repeat its compartment.')
  if (isPanelConnectedToAssembly(project, panelId)) throw new Error('Disassemble and disconnect linked assemblies before repeating a compartment.')
  if (selected.customOutline || selected.trofastInserts?.length) throw new Error('Repeat needs rectangular panels without TROFAST inserts.')
  const axis = new Vector3(...direction)
  if (!axis.toArray().every(Number.isFinite) || axis.lengthSq() < 1e-10) throw new Error('Pull an arrow along the compartment to repeat it.')
  axis.normalize()
  const members = jointMembers(project)
  const nearby = new Set([panelId])
  // Every side of a connected four-panel cell is at most two joints away.
  // Restrict the opening search before its pair enumeration, even in large builds.
  for (let step = 0; step < 2; step++) {
    const previous = new Set(nearby)
    for (const group of members) if ([...group].some(id => previous.has(id))) group.forEach(id => nearby.add(id))
  }
  if (nearby.size < 4) throw new Error('Connect all four corners before repeating this compartment.')
  const inverse = rotation(selected).invert()
  const aligned = panels.filter(panel => {
    if (!nearby.has(panel.id)) return false
    const relative = inverse.clone().multiply(rotation(panel))
    return axes.every(basis => Math.max(...basis.clone().applyQuaternion(relative).toArray().map(Math.abs)) > .99999)
  })
  const frames = new Map<string, NonNullable<ReturnType<typeof gridPanelCut>>>()
  for (const hole of findPanelHoles(aligned, panels)) {
    if (!hole.boundaryIds.includes(panelId)) continue
    const source = hole.boundaryIds.map(id => panels.find(panel => panel.id === id)!)
    const frame = repeatFrame(source)
    if (!frame) continue
    const across = [frame.x, frame.y].find(pair => Math.abs(pair.axis.dot(axis)) > .99999)
    if (!across && Math.abs(frame.x.axis.clone().cross(frame.y.axis).dot(axis)) < .99999) continue
    // A normal pull repeats the compartment behind its selected outside face.
    if (across?.panels.some(panel => panel.id === panelId)
      && across.panels.some(panel => new Vector3(...panel.position).sub(new Vector3(...selected.position)).dot(axis) > .01)) continue
    frames.set(JSON.stringify(hole.boundaryIds), frame)
  }
  if (!frames.size) throw new Error('This direction needs one complete rectangular compartment behind the pulled face. Pull outward along its width, height, or depth.')
  if (frames.size > 1) throw new Error('This panel borders more than one compartment. Select an outside panel to choose which one to repeat.')
  const frame = [...frames.values()][0]
  const source = [...frame.x.panels, ...frame.y.panels]
  if (source.some(panel => isPanelConnectedToAssembly(project, panel.id))) throw new Error('Disassemble and disconnect linked assemblies before repeating a compartment.')
  if (source.some(panel => panel.customOutline || panel.trofastInserts?.length)) throw new Error('Repeat needs rectangular panels without TROFAST inserts.')
  if (source.some(panel => panel.thickness < 18 || panel.thickness > 19)) throw new Error('Repeating compartments needs 18–19 mm panels for T connectors.')
  if (frame.x.panels.some(a => frame.y.panels.some(b => !members.some(group => group.has(a.id) && group.has(b.id))))) {
    throw new Error('Connect all four corners before repeating this compartment.')
  }
  const depthAxis = frame.x.axis.clone().cross(frame.y.axis).normalize()
  const sourceRotation = rotation(source[0])
  const sizes = [source[0].width, source[0].height, source[0].thickness]
  const depth = axes.reduce((length, basis, index) => length + Math.abs(basis.clone().applyQuaternion(sourceRotation).dot(depthAxis)) * sizes[index], 0)
  const minimumThickness = Math.min(...source.map(panel => panel.thickness))
  const across = [frame.x, frame.y].find(pair => Math.abs(pair.axis.dot(axis)) > .99999)
  const mode = across ? 'shared-wall' : 'depth'
  const pitch = across?.span ?? depth + 2 * CONNECTOR_PROFILES['90'].seat
  const faceTemplates = mode === 'depth' ? findPanelHoles(source, source) : []
  const separator = faceTemplates.find(hole => new Vector3(...hole.panel.position).sub(frame.center).dot(axis) > .01)?.panel
  const trailingFace = faceTemplates.find(hole => new Vector3(...hole.panel.position).sub(frame.center).dot(axis) < -.01)?.panel
  if (mode === 'depth' && (!separator || !trailingFace)) throw new Error('This compartment cannot fit a divider between repeated depth sections.')
  // Recognize a prior repeat from its geometry and complete shared joints, so
  // continuation works after reload without adding a saved feature flag.
  const trailingDivider = trailingFace && panels.find(panel => !source.some(item => item.id === panel.id) && samePanelPlacement(panel, trailingFace)
    && source.every(rim => {
      const prior = panels.find(candidate => candidate.id !== rim.id && samePanelPlacement(candidate,
        { ...rim, position: new Vector3(...rim.position).addScaledVector(axis, -pitch).toArray() }))
      return prior && members.some(group => group.has(panel.id) && group.has(rim.id) && group.has(prior.id))
    }))
  // An exact outgoing face is the divider this depth repeat needs, so reuse it.
  // Other closing faces remain unsupported instead of being omitted from copies.
  const leadingDivider = separator && panels.find(panel => !source.some(item => item.id === panel.id) && samePanelPlacement(panel, separator))
  const interior = new OBB(frame.center.clone(), new Vector3((frame.x.span - minimumThickness) / 2 - .5,
    (frame.y.span - minimumThickness) / 2 - .5, depth / 2 + 2 * CONNECTOR_PROFILES['90'].seat),
  new Matrix3().setFromMatrix4(new Matrix4().makeBasis(frame.x.axis, frame.y.axis, depthAxis)))
  const sourceIds = new Set(source.map(panel => panel.id))
  if (panels.some(panel => !sourceIds.has(panel.id) && panel.id !== trailingDivider?.id && panel.id !== leadingDivider?.id && interior.intersectsOBB(new OBB(new Vector3(...panel.position),
    new Vector3(panel.width / 2, panel.height / 2, panel.thickness / 2), new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(rotation(panel))))))) {
    throw new Error('Repeat currently supports open, empty rectangular compartments. Remove internal panels and closing faces before repeating.')
  }
  const ordered = across && [...across.panels].sort((a, b) => new Vector3(...a.position).dot(axis) - new Vector3(...b.position).dot(axis))
  const leadingId = ordered?.[1].id ?? panelId
  const panelIds = source.map(panel => panel.id)
  return { original: project, panelIds, selectedPanelId: panelId, pitch, direction: axis.toArray(), source, mode, separator,
    trailingId: ordered?.[0].id ?? panelId, leadingId, candidates: [{ project, leadingId, selectedPanelId: panelId, panelIds, reusedPanelIds: [] }] }
}

function assertReusablePanel(project: Project, existing: Panel, template: Panel) {
  if (isPanelConnectedToAssembly(project, existing.id)) throw new Error('This destination belongs to or connects to a linked assembly. Disassemble and disconnect it before repeating here.')
  const radius = (panel: Panel) => Math.min(panel.cornerRadius ?? 0, panel.width / 2, panel.height / 2)
  const parallelWidth = Math.abs(axes[0].clone().applyQuaternion(rotation(existing)).dot(axes[0].clone().applyQuaternion(rotation(template)))) > .99999
  if (existing.customOutline || existing.trofastInserts?.length || existing.pattern !== template.pattern
    || Math.abs(radius(existing) - radius(template)) > .01
    || existing.pattern !== 'solid' && (existing.holeSize !== template.holeSize || existing.holeSpacing !== template.holeSpacing)
    || existing.pattern === 'slots' && !parallelWidth) {
    throw new Error('An existing panel matches this position but has a different outline or surface. Repeat can only reuse matching panel shapes.')
  }
}

function addCompartment(session: StructureRepeatSession, count: number) {
  const previous = session.candidates[count - 1]
  const project = previous.project
  const depth = session.mode === 'depth'
  const world = resolvePanels(project)
  const added: Panel[] = []
  const reused = new Set(previous.reusedPanelIds)
  const place = (template: Panel) => {
    const matches = world.filter(panel => samePanelPlacement(panel, template))
    if (matches.length > 1) throw new Error('More than one existing panel occupies this repeated position. Remove the duplicate before repeating here.')
    if (matches.length) {
      assertReusablePanel(project, matches[0], template)
      reused.add(matches[0].id)
      return matches[0]
    }
    const panel = { ...template, id: crypto.randomUUID() }
    added.push(panel)
    return panel
  }
  const ids = new Map<string, string>(depth ? [] : [[session.trailingId, previous.leadingId]])
  for (const panel of session.source.filter(item => depth || item.id !== session.trailingId)) {
    const placed = place({ ...panel, name: `${panel.name.slice(0, 108)} (repeat ${count})`,
      position: new Vector3(...panel.position).addScaledVector(new Vector3(...session.direction), count * session.pitch).toArray() })
    ids.set(panel.id, placed.id)
  }
  const separator = depth ? place({ ...session.separator!, name: `Depth divider ${count}`,
    position: new Vector3(...session.separator!.position).addScaledVector(new Vector3(...session.direction), (count - 1) * session.pitch).toArray() }) : undefined
  if (project.panels.length + added.length > 200) throw new Error('Repeating further would exceed the project limit of 200 panels.')
  const scope = [...ids.values(), ...(separator ? [separator.id, ...previous.panelIds] : [])]
  // Hidden panels still occupy their physical slots. Restore visibility after
  // fitting so reuse never changes an existing panel's presentation or record.
  const fitting = { ...project, panels: [...project.panels, ...added].map(panel => panel.visible ? panel : { ...panel, visible: true }) }
  const connected = autoConnect(fitting, scope)
  if (connected.disassembledNames.length || connected.splits || connected.project.panels.length !== project.panels.length + added.length) {
    throw new Error('This repeat would change a neighboring construction. Choose an unobstructed outside edge.')
  }
  const visibility = new Map(project.panels.map(panel => [panel.id, panel.visible]))
  let next = !added.length && !connected.joints ? project : { ...connected.project,
    panels: connected.project.panels.map(panel => visibility.get(panel.id) === false ? { ...panel, visible: false } : panel) }
  const members = jointMembers(next)
  if (separator && session.source.some((panel, index) => !members.some(group => group.has(separator.id)
    && group.has(previous.panelIds[index]) && group.has(ids.get(panel.id)!)))) {
    throw new Error('There is not enough clearance to connect all four divider edges between these compartments.')
  }
  const sourceNormals = new Map(session.source.map(panel => [panel.id, new Vector3(0, 0, 1).applyQuaternion(rotation(panel))]))
  for (const a of session.source) for (const b of session.source) {
    if (Math.abs(sourceNormals.get(a.id)!.dot(sourceNormals.get(b.id)!)) > .001) continue
    if (!members.some(group => group.has(ids.get(a.id)!) && group.has(ids.get(b.id)!))) {
      throw new Error('There is not enough clearance to fit all connectors for another compartment.')
    }
  }
  // Outside corners are translated copies, including their individual hardware.
  // Shared joints keep autoConnect's refit and compatible-finish upgrade behavior.
  const reverse = new Map([...ids].map(([source, target]) => [target, source]))
  const oldConnections = new Set(project.connections.map(connection => connection.id))
  const addedIds = new Set(added.map(panel => panel.id))
  const overrides = { ...next.connectorOverrides }
  next = { ...next, connections: next.connections.map(connection => {
    if (oldConnections.has(connection.id) || connection.type !== '90' || !addedIds.has(connection.parentId) || !addedIds.has(connection.childId)) return connection
    const a = reverse.get(connection.parentId), b = reverse.get(connection.childId)
    const original = session.original.connections.find(item => item.type === '90'
      && (item.parentId === a && item.childId === b || item.parentId === b && item.childId === a))
    if (!original) return connection
    for (const key of Object.keys(overrides)) if (JSON.parse(key)[0] === connection.id) delete overrides[key]
    for (let index = 0; index < original.count; index++) {
      const override = session.original.connectorOverrides?.[connectorId(original.id, index)]
      if (override) overrides[connectorId(connection.id, index)] = { ...override }
    }
    return { ...original, id: connection.id, parentId: ids.get(original.parentId)!, childId: ids.get(original.childId)!, role: 'support' }
  }) }
  if (next.connectorOverrides || Object.keys(overrides).length) next = { ...next, connectorOverrides: overrides }
  // Existing-only destinations keep their own rules. A rule involving a new
  // piece follows the source, with local dimension references remapped on reuse.
  const rules = copyDesignConstraints(session.original.constraints?.filter(rule =>
    designConstraintPanelIds(rule).some(id => addedIds.has(ids.get(id)!))), ids)
  const targets = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
  const dimension = (id: string, value: 'width' | 'height') => {
    const source = session.source.find(panel => panel.id === reverse.get(id))!
    const target = targets.get(id)!
    const basis = axes[value === 'width' ? 0 : 1].clone().applyQuaternion(rotation(source))
    return Math.abs(basis.dot(axes[0].clone().applyQuaternion(rotation(target)))) > .99999 ? 'width' : 'height'
  }
  for (const rule of rules) {
    if (rule.kind === 'dimension') rule.dimension = dimension(rule.panelId, rule.dimension)
    if (rule.kind === 'equal-dimension') {
      const dimensions = rule.panelIds.map(id => dimension(id, rule.dimension))
      if (dimensions[0] !== dimensions[1]) throw new Error('A copied equal-dimension constraint would compare different local axes on an existing panel. Adjust that rule before repeating here.')
      rule.dimension = dimensions[0]
    }
  }
  if ((next.constraints?.length ?? 0) + rules.length > MAX_DESIGN_CONSTRAINTS) throw new Error('This repeat would exceed the project limit for design constraints.')
  if (rules.length) next = { ...next, constraints: [...next.constraints ?? [], ...rules] }
  const resolved = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
  if (resolvePanels(project).some(panel => !resolved.has(panel.id) || !samePanelPlacement(panel, resolved.get(panel.id)!))) {
    throw new Error('This repeat cannot keep the existing panels in place.')
  }
  if (next.connections.length > 400) throw new Error('Repeating further would exceed the project limit of 400 connections.')
  const previousIssues = new Set(validateProject(project).map(issue => issue.id))
  const issue = validateProject(next).find(item => !previousIssues.has(item.id) && (item.severity === 'error' || item.id.startsWith('collision-')))
  if (issue) throw new Error(issue.message)
  next = assertDesignConstraintEdit(project, next)
  if (!added.length && !connected.joints && !rules.length) next = project
  return { project: next, leadingId: ids.get(session.leadingId)!, selectedPanelId: ids.get(session.selectedPanelId)!,
    panelIds: session.source.map(panel => ids.get(panel.id)!), reusedPanelIds: [...reused] }
}

/** Whole-cell previews always derive from the initial snapshot; retraction only removes preview additions. */
export function moveStructureRepeat(session: StructureRepeatSession, distance: number): StructureRepeatResult {
  const requested = Number.isFinite(distance) ? Math.max(0, Math.round(distance / session.pitch)) : 0
  const bounded = Math.min(requested, 200)
  while (session.candidates.length <= bounded && !session.blocked) {
    try { session.candidates.push(addCompartment(session, session.candidates.length)) }
    catch (error) { session.blocked = error instanceof Error ? error.message : 'Another compartment cannot fit here.' }
  }
  const count = Math.min(bounded, session.candidates.length - 1)
  return { project: session.candidates[count].project, selectedPanelId: session.candidates[count].selectedPanelId,
    reusedPanelIds: session.candidates[count].reusedPanelIds,
    distance: count * session.pitch, limited: count < requested, count,
    ...(count < requested ? { reason: session.blocked ?? 'Repeat supports up to 200 compartments in one pull.' } : {}) }
}
