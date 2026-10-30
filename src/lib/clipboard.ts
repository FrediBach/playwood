import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { Euler, Quaternion, Vector3 } from 'three'
import { getAssemblyCopyPanelPlacement, getAssemblyAttachmentTargets, getAssemblyInstance, type AssemblyAttachmentTarget } from './assemblies'
import { attachPanel, createPanel, resolvePanels, validateProject } from './model'
import type { AssemblyDefinition, AssemblyInstance, AttachmentOptions, Panel, Project, Side, Vec3 } from './types'

export type CopiedItem = { kind: 'panel'; panel: Panel } | { kind: 'assembly'; instance: AssemblyInstance; definition: AssemblyDefinition }

export function copySelection(project: Project, ids: string[]): CopiedItem {
  const selected = new Set(ids)
  const instance = ids.length ? getAssemblyInstance(project, ids[0]) : undefined
  if (instance && ids.length === Object.keys(instance.panelIds).length && Object.values(instance.panelIds).every(id => selected.has(id))) {
    return structuredClone({ kind: 'assembly', instance, definition: project.assemblies!.definitions.find(item => item.id === instance.definitionId)! })
  }
  const panel = ids.length === 1 ? resolvePanels(project).find(item => item.id === ids[0]) : undefined
  if (panel) return structuredClone({ kind: 'panel', panel })
  throw new Error('Select one panel or one assembly to copy.')
}

export function getPasteTargets(project: Project, ids: string[], copied: CopiedItem, preservePanelName = false): AssemblyAttachmentTarget[] {
  const selected = new Set(ids)
  const owner = ids.length ? getAssemblyInstance(project, ids[0]) : undefined
  const instance = owner && ids.length === Object.keys(owner.panelIds).length && Object.values(owner.panelIds).every(id => selected.has(id)) ? owner : undefined
  if (!instance && ids.length !== 1) throw new Error('Select a target panel or assembly, then paste.')
  let base = project
  if (copied.kind === 'assembly') {
    const data = project.assemblies ?? { definitions: [], instances: [], links: [] }
    // Keep copies linked to an existing design; restore the copied design if its source was removed.
    base = { ...project, assemblies: { ...data, definitions: data.definitions.some(item => item.id === copied.definition.id) ? data.definitions : [...data.definitions, copied.definition] } }
    if (instance) return getAssemblyAttachmentTargets(base, instance.id, undefined, copied.instance)
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
    const options: AttachmentOptions = { side: edge.side, flip, type: '90', offset: 0, inset: 0, color: DEFAULT_CONNECTOR_COLOR, count: 2 }
    try {
      const placement = copied.kind === 'assembly' ? getAssemblyCopyPanelPlacement(base, copied.instance, parent.id, options) : { project: attachPanel(base, parent.id, child!, options) }
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
