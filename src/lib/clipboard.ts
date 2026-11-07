import { connectorId, getPhysicalConnectors, getDefaultConnectorColor } from './connector-selection'
import { Euler, Quaternion, Vector3 } from 'three'
import { getAssemblyCopyPanelPlacement, getAssemblyAttachmentTargets, getAssemblyInstance, type AssemblyAttachmentTarget } from './assemblies'
import { attachPanel, createPanel, resolvePanels, validateProject } from './model'
import type { AssemblyDefinition, AssemblyInstance, AttachmentOptions, DesignConstraint, Panel, Project, Side, Vec3 } from './types'
import { copyDesignConstraints, designConstraintPanelIds } from './design-constraints'

type CopiedSelection = { kind: 'selection'; panels: Panel[]; connections: Project['connections']; connectorOverrides: Project['connectorOverrides'] }
const jointKey = (id: string) => id.replace(/:\d+$/, '')

export type CopiedItem = (CopiedSelection | { kind: 'panel'; panel: Panel } | { kind: 'assembly'; instance: AssemblyInstance; definition: AssemblyDefinition }) & { constraints?: DesignConstraint[] }

export function copySelection(project: Project, ids: string[], connectorIds: string[] = []): CopiedItem {
  const selected = new Set(ids)
  const wantedConnectors = new Set(connectorIds)
  const joints = new Set(getPhysicalConnectors(project).filter(piece => wantedConnectors.has(piece.id)).map(piece => jointKey(piece.connection.id)))
  for (const connection of project.connections) {
    if (joints.has(jointKey(connection.id))) { selected.add(connection.parentId); selected.add(connection.childId) }
  }
  ids = [...selected]
  const constraints = project.constraints?.filter(constraint => constraint.kind !== 'floor' && constraint.kind !== 'position' && designConstraintPanelIds(constraint).every(id => selected.has(id)))
  const rules = constraints?.length ? { constraints } : {}
  const instance = ids.length ? getAssemblyInstance(project, ids[0]) : undefined
  if (!connectorIds.length && instance && ids.length === Object.keys(instance.panelIds).length && Object.values(instance.panelIds).every(id => selected.has(id))) {
    return structuredClone({ kind: 'assembly', instance, definition: project.assemblies!.definitions.find(item => item.id === instance.definitionId)!, ...rules })
  }
  const panel = ids.length === 1 ? resolvePanels(project).find(item => item.id === ids[0]) : undefined
  if (panel) return structuredClone({ kind: 'panel', panel, ...rules })
  const panels = resolvePanels(project).filter(panel => selected.has(panel.id))
  if (panels.length) {
    // Omit an entire external joint rather than leave invalid T/cross branches.
    const external = new Set(project.connections.filter(connection => !selected.has(connection.parentId) || !selected.has(connection.childId)).map(connection => jointKey(connection.id)))
    const connections = project.connections.filter(connection => selected.has(connection.parentId) && selected.has(connection.childId) && !external.has(jointKey(connection.id)))
    const connectorOverrides: Project['connectorOverrides'] = {}
    for (const connection of connections) for (let index = 0; index < connection.count; index++) {
      const id = connectorId(connection.id, index)
      if (project.connectorOverrides?.[id]) connectorOverrides[id] = project.connectorOverrides[id]
    }
    return structuredClone({ kind: 'selection', panels, connections, connectorOverrides, ...rules })
  }
  throw new Error('Select panels, connectors, or an assembly to copy.')
}

export function getPasteTargets(project: Project, ids: string[], copied: CopiedItem, preservePanelName = false): AssemblyAttachmentTarget[] {
  if (!ids.length) throw new Error('Select a target panel or assembly, then paste.')
  if (copied.kind === 'selection') return getSelectionPasteTargets(project, ids, copied)
  const defaultColor = getDefaultConnectorColor(project)
  const selected = new Set(ids)
  const owner = ids.length ? getAssemblyInstance(project, ids[0]) : undefined
  const instance = owner && ids.length === Object.keys(owner.panelIds).length && Object.values(owner.panelIds).every(id => selected.has(id)) ? owner : undefined
  if (!instance && ids.length !== 1) throw new Error('Select a target panel or assembly, then paste.')
  let base = project
  if (copied.kind === 'assembly') {
    const data = project.assemblies ?? { definitions: [], instances: [], links: [] }
    // Keep copies linked to an existing design; restore the copied design if its source was removed.
    base = { ...project, assemblies: { ...data, definitions: data.definitions.some(item => item.id === copied.definition.id) ? data.definitions : [...data.definitions, copied.definition] } }
    if (instance) return getAssemblyAttachmentTargets(base, instance.id, undefined, copied.instance, copied.constraints ?? [])
  }
  const parents = resolvePanels(project).filter(panel => selected.has(panel.id))
  const oldErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const child = copied.kind === 'panel' ? createPanel({ ...copied.panel, id: crypto.randomUUID(), name: preservePanelName ? copied.panel.name : `${copied.panel.name} copy`, visible: true }) : undefined
  const edges: { side: Side; position: (panel: Panel) => Vec3 }[] = [
    { side: 'left', position: p => [-p.width / 2, 0, 0] },
    { side: 'right', position: p => [p.width / 2, 0, 0] },
    { side: 'top', position: p => [0, p.height / 2, 0] },
    { side: 'bottom', position: p => [0, -p.height / 2, 0] },
  ]
  const targets: AssemblyAttachmentTarget[] = parents.flatMap(parent => edges.flatMap(edge => [false, true].map(flip => {
    const rotation = new Quaternion().setFromEuler(new Euler(...parent.rotation))
    const local = edge.position(parent)
    local[2] = (flip ? -1 : 1) * 35
    const position = new Vector3(...local).applyQuaternion(rotation).add(new Vector3(...parent.position)).toArray() as Vec3
    const id = `${parent.id}/${edge.side}/${flip}`
    const label = `${instance ? `${parent.name} · ` : ''}${edge.side}${flip ? ' · reverse' : ''}`
    const options: AttachmentOptions = { side: edge.side, flip, type: '90', offset: 0, inset: 0, color: defaultColor, count: 2 }
    try {
      const constraints = copied.kind === 'panel' ? copyDesignConstraints(copied.constraints, new Map([[copied.panel.id, child!.id]])) : []
      const placement = copied.kind === 'assembly' ? getAssemblyCopyPanelPlacement(base, copied.instance, parent.id, options, copied.constraints ?? [])
        : { project: attachPanel(constraints.length ? { ...base, constraints: [...base.constraints ?? [], ...constraints] } : base, parent.id, child!, options) }
      const next = placement.project
      const newIds = new Set(next.panels.filter(panel => !project.panels.some(old => old.id === panel.id)).map(panel => panel.id))
      const issue = validateProject(next).find(item => item.severity === 'error' && !oldErrors.has(item.id) || item.id.startsWith('collision-') && item.panelIds.some(panelId => newIds.has(panelId)))
      if (issue) throw new Error(issue.message)
      if (next.panels.length > 200 || next.connections.length > 400) throw new Error('Projects support up to 200 panels and 400 connections.')
      return { id, label, position, ...placement }
    } catch (error) { return { id, label, position, error: error instanceof Error ? error.message : 'This copy cannot fit here.' } }
  })))
  return targets.sort((a, b) => Number(!!a.warning) - Number(!!b.warning))
}

/** Offer every selected target, keeping whole-instance corner joins where possible. */
export function getInsertionTargets(project: Project, ids: string[], copied: CopiedItem): AssemblyAttachmentTarget[] {
  const selected = new Set(ids)
  const handled = new Set<string>()
  return ids.flatMap(id => {
    if (handled.has(id)) return []
    const owner = getAssemblyInstance(project, id)
    const members = owner ? Object.values(owner.panelIds) : []
    if (copied.kind === 'assembly' && owner && members.every(member => selected.has(member))) {
      members.forEach(member => handled.add(member))
      const corners = getPasteTargets(project, members, copied)
      if (corners.some(target => target.project)) return corners.map(target => ({ ...target, label: `${owner.name} · ${target.label}` }))
      // Angled modules may have no cross-compatible corners; offer their panel edges.
      return members.flatMap(member => getPasteTargets(project, [member], copied).map(target => ({ ...target, label: `${owner.name} · ${project.panels.find(panel => panel.id === member)?.name} · ${target.label}` })))
    }
    handled.add(id)
    return getPasteTargets(project, [id], copied, true).map(target => ({ ...target, label: `${project.panels.find(panel => panel.id === id)?.name} · ${target.label}` }))
  })
}

/** Attach any copied panel as an anchor, moving the complete snapshot rigidly with it. */
function getSelectionPasteTargets(project: Project, ids: string[], copied: CopiedSelection & { constraints?: DesignConstraint[] }): AssemblyAttachmentTarget[] {
  const oldErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  return copied.panels.flatMap(anchor => getInsertionTargets(project, ids, { kind: 'panel', panel: anchor }).map(target => {
    const id = `${anchor.id}/${target.id}`, label = `${anchor.name} → ${target.label}`
    if (!target.project) return { ...target, id, label }
    try {
      const base = target.project
      const placed = resolvePanels(base).find(panel => !project.panels.some(original => original.id === panel.id))!
      const panelMap = new Map(copied.panels.map(panel => [panel.id, panel.id === anchor.id ? placed.id : crypto.randomUUID()]))
      const rotation = new Quaternion().setFromEuler(new Euler(...placed.rotation))
        .multiply(new Quaternion().setFromEuler(new Euler(...anchor.rotation)).invert())
      const panels = copied.panels.map(panel => ({ ...panel, id: panelMap.get(panel.id)!, name: `${panel.name} copy`, visible: true,
        position: new Vector3(...panel.position).sub(new Vector3(...anchor.position)).applyQuaternion(rotation).add(new Vector3(...placed.position)).toArray() as Vec3,
        rotation: new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation)))).toArray().slice(0, 3) as Vec3,
      }))
      const joints = new Map(copied.connections.map(connection => [jointKey(connection.id), crypto.randomUUID()]))
      const connectionMap = new Map(copied.connections.map(connection => [connection.id, `${joints.get(jointKey(connection.id))}:${connection.id.match(/:(\d+)$/)?.[1] ?? 0}`]))
      const connections = copied.connections.map(connection => ({ ...connection, id: connectionMap.get(connection.id)!, parentId: panelMap.get(connection.parentId)!, childId: panelMap.get(connection.childId)!, role: 'support' as const }))
      const connectorOverrides = { ...base.connectorOverrides }
      for (const connection of copied.connections) for (let index = 0; index < connection.count; index++) {
        const override = copied.connectorOverrides?.[connectorId(connection.id, index)]
        if (override) connectorOverrides[connectorId(connectionMap.get(connection.id)!, index)] = { ...override }
      }
      const constraints = copyDesignConstraints(copied.constraints, panelMap)
      const next: Project = { ...base, panels: [...project.panels, ...panels], connections: [...base.connections, ...connections],
        ...(Object.keys(connectorOverrides).length ? { connectorOverrides } : {}),
        ...(constraints.length ? { constraints: [...base.constraints ?? [], ...constraints] } : {}),
      }
      if (next.panels.length > 200 || next.connections.length > 400) throw new Error('Projects support up to 200 panels and 400 connections.')
      const added = new Set(panelMap.values())
      const issue = validateProject(next).find(issue => issue.severity === 'error' && !oldErrors.has(issue.id) || issue.id.startsWith('collision-') && issue.panelIds.some(id => added.has(id)))
      if (issue) throw new Error(issue.message)
      return { ...target, id, label, project: next }
    } catch (error) {
      return { id, label, position: target.position, error: error instanceof Error ? error.message : 'This selection cannot fit here.' }
    }
  }))
}
