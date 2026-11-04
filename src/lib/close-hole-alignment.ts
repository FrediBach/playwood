import { Euler, Quaternion, Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import { outlineJointFrame } from './outline-closures'
import { resizePanelEdges } from './structure-edit'
import type { Project, Vec3 } from './types'

export interface HoleEdgeAdjustment {
  panelId: string; panelName: string; dimension: 'width' | 'height'; side: -1 | 1;
  before: number; after: number; distance: number;
}

/** A closure may extend nearby rim ends to one common face. These adjustments
 * are presented before acceptance, and the caller commits the entire fit once.
 */
export function prepareHoleEdgeAlignment(project: Project, boundaryIds: readonly string[], normal: Vec3, sign: -1 | 1) {
  const direction = new Vector3(...normal)
  if (!normal.every(Number.isFinite) || direction.lengthSq() < 1e-10 || (sign !== -1 && sign !== 1)) throw new Error('Choose a valid opening face.')
  direction.normalize()
  const outward = direction.clone().multiplyScalar(sign)
  const panels = resolvePanels(project), byId = new Map(panels.map(panel => [panel.id, panel]))
  const rimIds = new Set(boundaryIds), refitIds = new Set<string>()
  const edgeJoints = project.connections.filter(connection => connection.outlineEdge !== undefined)
  // When a shared rim already carries a closing panel on this face, all its
  // supporting edges must reach the new plane together, including neighboring
  // fillers reached through another shared rim.
  for (let expanded = true; expanded;) {
    expanded = false
    for (const joint of edgeJoints) {
      if (!rimIds.has(joint.parentId) || refitIds.has(joint.childId)) continue
      const parent = byId.get(joint.parentId), child = byId.get(joint.childId)
      if (!parent || !child || outlineJointFrame(parent, joint).normal.dot(outward) < 0.99999) continue
      const supports = edgeJoints.filter(connection => connection.childId === child.id)
      if (!child.customOutline || new Set(supports.map(connection => connection.outlineEdge)).size !== child.customOutline.length) {
        throw new Error('Detach the partly supported closing panel before aligning this rim.')
      }
      if (supports.some(connection => !byId.has(connection.parentId) || outlineJointFrame(byId.get(connection.parentId)!, connection).normal.dot(outward) < 0.99999)) {
        throw new Error('The fitted panel cannot follow this opening face.')
      }
      refitIds.add(child.id)
      for (const support of supports) if (!rimIds.has(support.parentId)) { rimIds.add(support.parentId); expanded = true }
    }
  }
  const rim = [...rimIds].map(id => {
    const panel = byId.get(id)
    if (!panel || panel.customOutline || panel.trofastInserts?.length) throw new Error('Align ordinary rectangular rim panels only.')
    const turn = new Quaternion().setFromEuler(new Euler(...panel.rotation))
    const axes = [new Vector3(1, 0, 0).applyQuaternion(turn), new Vector3(0, 1, 0).applyQuaternion(turn)]
    const index = axes.findIndex(axis => Math.abs(axis.dot(direction)) > 0.99999)
    if (index < 0) throw new Error('The surrounding panels must share a depth direction.')
    const dimension = (index === 0 ? 'width' : 'height') as 'width' | 'height'
    return { panel, dimension, side: (Math.sign(axes[index].dot(direction)) * sign) as -1 | 1,
      end: new Vector3(...panel.position).dot(outward) + panel[dimension] / 2 }
  })
  if (!rim.length) throw new Error('Select the panels surrounding this opening.')
  const target = Math.max(...rim.map(edge => edge.end))
  const adjustments: HoleEdgeAdjustment[] = rim.flatMap(({ panel, dimension, side, end }) => {
    const distance = target - end
    if (distance <= 0.1) return []
    if (distance > 100 + 1e-6) throw new Error('These rim edges need more than 100 mm of depth adjustment. Align them before closing the opening.')
    return [{ panelId: panel.id, panelName: panel.name, dimension, side, before: panel[dimension], after: panel[dimension] + distance, distance }]
  })
  const aligned = resizePanelEdges(project, adjustments, [...refitIds])
  // Do not turn collisions introduced by these extensions into the baseline
  // used by the following closure operation's validation comparison.
  const previous = new Set(validateProject(project).map(issue => issue.id))
  const problem = validateProject(aligned).find(issue => !previous.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(`Cannot align this opening: ${problem.message}`)
  return { project: aligned, adjustments, boundaryIds: [...rimIds] }
}
