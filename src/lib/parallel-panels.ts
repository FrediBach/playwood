import { Euler, Quaternion, Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, validateProject } from './model'
import type { Panel, Project } from './types'

/** Find a centered cut shared by two aligned, separated panel faces. */
export function parallelPanelCut(panels: readonly Panel[]) {
  if (panels.length !== 2 || panels.some(panel => !panel.visible)) return undefined
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

/** One atomic edit: add the divider, then fit both T joints and remap outer joints. */
export function splitParallelPanels(project: Project, ids: readonly string[]) {
  const selected = resolvePanels(project).filter(panel => ids.includes(panel.id))
  const cut = parallelPanelCut(selected)
  if (!cut || new Set(ids).size !== 2) throw new Error('Select two aligned parallel panels with matching dimensions.')
  if (ids.some(id => isPanelConnectedToAssembly(project, id))) throw new Error('Disassemble these panels before splitting them.')
  const { a, b, dimension, separation, direction, rotation } = cut
  if (selected.some(panel => panel.thickness < 18 || panel.thickness > 19)) throw new Error('T connectors need 18–19 mm panels.')
  const gap = 2 * CONNECTOR_PROFILES.t.seat
  const length = separation - gap
  if (length < 40 || length > 4000 || (a[dimension] - gap) / 2 < 40) throw new Error('There is not enough room for the split panels and center divider.')
  // Match the T connector pose: turn the cut axis toward the other panel.
  const tangent = dimension === 'width' ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const angle = direction * (dimension === 'width' ? -1 : 1) * Math.PI / 2
  const dividerRotation = new Euler().setFromQuaternion(rotation.clone().multiply(new Quaternion().setFromAxisAngle(tangent, angle)))
  const divider = createPanel({ ...a, id: crypto.randomUUID(), name: 'Center divider', [dimension]: length,
    cornerRadius: 0,
    position: new Vector3(...a.position).add(new Vector3(...b.position)).multiplyScalar(0.5).toArray(),
    rotation: [dividerRotation.x || 0, dividerRotation.y || 0, dividerRotation.z || 0],
  })
  const result = autoConnect({ ...project, panels: [...project.panels, divider] }, [...ids, divider.id])
  if (result.splits !== 2) throw new Error('These panels cannot be split while keeping their existing joints aligned. Check connector clearance and corner radii.')
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(result.project).find(issue => !previous.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return { project: result.project, panelIds: [...ids, ...result.addedPanelIds, divider.id], connectors: result.connectors }
}
