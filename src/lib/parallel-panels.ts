import { Euler, Quaternion, Vector3 } from 'three'
import { splitInteriorTJoints } from './auto-connect'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, validateProject } from './model'
import type { Panel, Project } from './types'

/** Find a centered cut shared by two aligned, separated panel faces. */
export function parallelPanelCut(panels: readonly Panel[]) {
  if (panels.length !== 2 || panels.some(panel => !panel.visible || panel.customOutline)) return undefined
  const [a, b] = panels
  const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const qa = rotation(a), qb = rotation(b)
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  if (!axes.every(axis => Math.abs(axis.clone().applyQuaternion(qa).dot(axis.clone().applyQuaternion(qb))) > 0.99999)) return undefined
  const delta = new Vector3(...b.position).sub(new Vector3(...a.position)).applyQuaternion(qa.clone().invert())
  if (Math.abs(delta.x) > 0.01 || Math.abs(delta.y) > 0.01 || Math.abs(delta.z) <= (a.thickness + b.thickness) / 2) return undefined
  if (Math.abs(a.width - b.width) > 0.01 || Math.abs(a.height - b.height) > 0.01) return undefined
  const dimension = a.width >= a.height ? 'width' : 'height'
  return { a, b, dimension, separation: Math.abs(delta.z), direction: Math.sign(delta.z), rotation: qa } as const
}

/** One atomic edit: add evenly spaced dividers, fit T joints, and remap outer joints. */
export function splitParallelPanels(project: Project, ids: readonly string[], count = 1) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Choose a positive whole number of splits.')
  const selectedIds = new Set(ids)
  const selected = resolvePanels(project).filter(panel => selectedIds.has(panel.id))
  if (selected.some(panel => panel.customOutline)) throw new Error('Remove custom outlines before splitting parallel panels.')
  const cut = parallelPanelCut(selected)
  if (!cut || selectedIds.size !== 2) throw new Error('Select two aligned parallel panels with matching dimensions.')
  if (ids.some(id => isPanelConnectedToAssembly(project, id))) throw new Error('Disassemble these panels before splitting them.')
  const { a, b, dimension, separation, direction, rotation } = cut
  if (selected.some(panel => panel.thickness < 18 || panel.thickness > 19)) throw new Error('T connectors need 18–19 mm panels.')
  const gap = 2 * CONNECTOR_PROFILES.t.seat
  const length = separation - gap
  const sectionLength = (a[dimension] - count * gap) / (count + 1)
  if (length < 40 || length > 4000 || sectionLength < 40) throw new Error('There is not enough room for the split panels and dividers.')
  if (project.panels.length + 3 * count > 200 || project.connections.length + 4 * count > 400) throw new Error('This split would exceed the project limit of 200 panels or 400 connections.')
  // Match the T connector pose: turn the cut axis toward the other panel.
  const tangent = dimension === 'width' ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const angle = direction * (dimension === 'width' ? -1 : 1) * Math.PI / 2
  const dividerRotation = new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromAxisAngle(tangent, angle)))
  const worldAxis = new Vector3(dimension === 'width' ? 1 : 0, dimension === 'height' ? 1 : 0, 0).applyQuaternion(rotation)
  const center = new Vector3(...a.position).add(new Vector3(...b.position)).multiplyScalar(0.5)
  const dividers = Array.from({ length: count }, (_, index) => createPanel({ ...a, id: crypto.randomUUID(), name: count === 1 ? 'Center divider' : `Divider ${index + 1}`, [dimension]: length,
    cornerRadius: 0, customOutline: undefined,
    position: center.clone().addScaledVector(worldAxis, -a[dimension] / 2 + sectionLength + gap / 2 + index * (sectionLength + gap)).toArray(),
    rotation: [dividerRotation.x || 0, dividerRotation.y || 0, dividerRotation.z || 0],
  }))
  const dividerIds = dividers.map(panel => panel.id)
  const result = splitInteriorTJoints({ ...project, panels: [...project.panels, ...dividers] }, [...ids, ...dividerIds])
  if (result.splits !== 2 * count) throw new Error('These panels cannot be split while keeping their existing joints aligned. Check connector clearance and corner radii.')
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(result.project).find(issue => !previous.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return { project: result.project, panelIds: [...ids, ...result.addedPanelIds, ...dividerIds], connectors: result.connectors }
}

/** Offer only counts whose complete edit fits the current panels and hardware. */
export function parallelPanelSplitCounts(project: Project, ids: readonly string[], onValid?: (count: number) => void) {
  const selected = new Set(ids)
  const cut = parallelPanelCut(resolvePanels(project).filter(panel => selected.has(panel.id)))
  if (!cut || ids.some(id => isPanelConnectedToAssembly(project, id))) return []
  const gap = 2 * CONNECTOR_PROFILES.t.seat
  const maximum = Math.min(Math.floor((cut.a[cut.dimension] - 40) / (40 + gap)),
    Math.floor((200 - project.panels.length) / 3), Math.floor((400 - project.connections.length) / 4))
  const counts: number[] = []
  for (let count = 1; count <= maximum; count++) {
    try { splitParallelPanels(project, ids, count); counts.push(count); onValid?.(count) } catch { /* This count cannot preserve clearance and existing joints. */ }
  }
  return counts
}
