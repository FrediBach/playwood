import { Vector3 } from 'three'
import { analyzeStructure, coordinate, inspectResizeAnalysis, type Frame } from './resize-analysis'
import type { Project, Vec3 } from './types'
import type { ResizeShadowEquation } from './resize-shadow-contract'

const TOLERANCE = 1e-4
const PARALLEL = 1 - 1e-6
export interface ResizeEvidence {
  readonly id: string
  readonly detector: 'connected-seam' | 'opposing-faces' | 'support-margins' | 'structural-span'
  readonly panelIds: readonly string[]
  readonly jointIds: readonly string[]
  readonly axis: Vec3
  readonly residuals: readonly number[]
  readonly tolerance: number
  readonly strength: 'topological' | 'attached' | 'weak'
  readonly contrary: readonly string[]
  readonly alternatives: readonly string[]
  readonly equations: readonly ResizeShadowEquation[]
  readonly cuts: readonly string[]
}
export interface RigidResizeSection {
  readonly panelIds: readonly string[]
  readonly boundaryPanelIds: readonly string[]
  readonly boundaryJointIds: readonly string[]
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}
const cut = (item: Frame, axis: Vector3) => {
  const dimension = item.axes.slice(0, 2).findIndex(own => Math.abs(own.dot(axis)) > PARALLEL)
  return dimension < 0 ? [] : [`${item.panel.id}/${dimension === 0 ? 'width' : 'height'}`]
}
const orthogonal = (a: Frame, b: Frame) => a.axes.every(axis => b.axes.some(own => Math.abs(axis.dot(own)) > PARALLEL))
const reference = (id: string, a: Frame, b: Frame, axis: Vector3, aSide: -1 | 1, bSide: -1 | 1): ResizeShadowEquation => ({
  id, terms: [{ panelId: a.panel.id, axis: axis.toArray() as Vec3, side: aSide, scale: 1 },
    { panelId: b.panel.id, axis: axis.toArray() as Vec3, side: bSide, scale: -1 }],
})

/** Geometric facts are continuous measurements. Occupancy never mandates a fit. */
export function analyzeResizeEvidence(project: Project, selectedIds: readonly string[]) {
  const geometry = analyzeStructure(project)
  const physical = inspectResizeAnalysis(project, geometry)
  const frames = new Map(geometry.frames.map(item => [item.panel.id, item]))
  const evidence: ResizeEvidence[] = []
  const excluded = new Set(physical.outlinePanelIds)
  const joints = new Map(physical.joints.flatMap(joint => joint.connectionIds.map(id => [id, joint.id])))
  const seen = new Set<string>()
  for (const connection of project.connections) {
    const a = frames.get(connection.parentId)!, b = frames.get(connection.childId)!
    if (excluded.has(a.panel.id) || excluded.has(b.panel.id)) continue
    const dimension = ['top', 'bottom', 'front', 'back'].includes(connection.side) ? 0 : 1
    const axis = a.axes[dimension]
    if (!cut(b, axis).length) continue
    const joint = joints.get(connection.id)!
    // One piece of evidence per physical joint/member pair, regardless of support encoding.
    const id = JSON.stringify(['seam', joint, ...[a.panel.id, b.panel.id].sort()])
    if (seen.has(id)) continue
    seen.add(id)
    const residuals = [-1, 1].map(side => coordinate(a, axis, side) - coordinate(b, axis, side))
    evidence.push({ id, detector: 'connected-seam', panelIds: [a.panel.id, b.panel.id], jointIds: [joint],
      axis: axis.toArray() as Vec3, residuals, tolerance: TOLERANCE, strength: 'attached',
      contrary: ['A shared seam alone does not establish that the attached cut should grow.'],
      alternatives: ['preserve-cuts', 'negative-end', 'positive-end', 'fitted-clearances'],
      equations: ([-1, 1] as const).map(side => reference(`${id}/${side}`, a, b, axis, side, side)),
      cuts: [...cut(a, axis), ...cut(b, axis)] })
  }
  // A structural panel attached at opposite thickness faces is a real span,
  // unlike a terminal seam. These references also connect neighboring bays.
  for (const item of geometry.frames) {
    if (excluded.has(item.panel.id)) continue
    const neighborIds = new Set(physical.joints.filter(joint => joint.panelIds.includes(item.panel.id)).flatMap(joint => joint.panelIds.filter(id => id !== item.panel.id)))
    for (const axis of item.axes.slice(0, 2)) {
      const neighbors = [...neighborIds].map(id => frames.get(id)!).filter(other => !excluded.has(other.panel.id)
        && orthogonal(item, other) && Math.abs(other.axes[2].dot(axis)) > PARALLEL)
      const lower = neighbors.filter(other => coordinate(other, axis) < coordinate(item, axis) - TOLERANCE)
      const upper = neighbors.filter(other => coordinate(other, axis) > coordinate(item, axis) + TOLERANCE)
      if (!lower.length || !upper.length) continue
      if (lower.some(other => Math.abs(coordinate(other, axis, 1) - coordinate(lower[0], axis, 1)) > TOLERANCE)
        || upper.some(other => Math.abs(coordinate(other, axis, -1) - coordinate(upper[0], axis, -1)) > TOLERANCE)) continue
      const a = lower.sort((a, b) => a.panel.id.localeCompare(b.panel.id))[0], b = upper.sort((a, b) => a.panel.id.localeCompare(b.panel.id))[0]
      const id = JSON.stringify(['span', item.panel.id, a.panel.id, b.panel.id, ...cut(item, axis)])
      evidence.push({ id, detector: 'structural-span', panelIds: [item.panel.id, a.panel.id, b.panel.id], jointIds: [],
        axis: axis.toArray() as Vec3, residuals: [coordinate(item, axis, -1) - coordinate(a, axis, 1), coordinate(b, axis, -1) - coordinate(item, axis, 1)],
        tolerance: TOLERANCE, strength: 'topological', contrary: [], alternatives: ['preserve-cuts', 'fitted-clearances'],
        equations: [reference(`${id}/-1`, item, a, axis, -1, 1), reference(`${id}/1`, item, b, axis, 1, -1)], cuts: cut(item, axis) })
    }
  }
  // Orthogonal face tests in each panel's frame also handle rotated cabinets.
  // Require positive overlap in both tangents; oblique projected boxes are not openings.
  const structural = new Set(project.connections.flatMap(c => [c.parentId, c.childId]))
  for (const item of geometry.frames) {
    if (excluded.has(item.panel.id) || structural.has(item.panel.id)) continue
    for (const axis of item.axes.slice(0, 2)) {
      const tangents = item.axes.filter(own => Math.abs(own.dot(axis)) < 1e-6)
      const boundaries = geometry.frames.filter(other => other !== item && !excluded.has(other.panel.id)
        && structural.has(other.panel.id) && orthogonal(item, other) && Math.abs(other.axes[2].dot(axis)) > PARALLEL
        && tangents.every(tangent => Math.min(coordinate(item, tangent, 1), coordinate(other, tangent, 1))
          - Math.max(coordinate(item, tangent, -1), coordinate(other, tangent, -1)) > TOLERANCE))
      const lowers = boundaries.filter(other => coordinate(other, axis, 1) <= coordinate(item, axis, -1) + TOLERANCE)
        .sort((a, b) => coordinate(b, axis, 1) - coordinate(a, axis, 1))
      const uppers = boundaries.filter(other => coordinate(other, axis, -1) >= coordinate(item, axis, 1) - TOLERANCE)
        .sort((a, b) => coordinate(a, axis, -1) - coordinate(b, axis, -1))
      const lower = lowers[0], upper = uppers[0]
      // Coincident competing faces provide no unique boundary reference.
      if (lower && upper && !(lowers[1] && Math.abs(coordinate(lower, axis, 1) - coordinate(lowers[1], axis, 1)) < TOLERANCE)
        && !(uppers[1] && Math.abs(coordinate(upper, axis, -1) - coordinate(uppers[1], axis, -1)) < TOLERANCE)) {
        const id = JSON.stringify(['opening', item.panel.id, lower.panel.id, upper.panel.id, ...cut(item, axis)])
        const residuals = [coordinate(item, axis, -1) - coordinate(lower, axis, 1), coordinate(upper, axis, -1) - coordinate(item, axis, 1)]
        evidence.push({ id, detector: 'opposing-faces', panelIds: [item.panel.id, lower.panel.id, upper.panel.id], jointIds: [],
          axis: axis.toArray() as Vec3, residuals, tolerance: TOLERANCE, strength: 'topological',
          contrary: residuals.some(gap => gap > item.panel.thickness) ? ['Margins exceed one stock thickness; fit is uncertain.'] : [],
          alternatives: ['preserve-cuts', 'fitted-clearances'],
          equations: [reference(`${id}/-1`, item, lower, axis, -1, 1), reference(`${id}/1`, item, upper, axis, 1, -1)], cuts: cut(item, axis) })
        continue
      }
      const supports = geometry.contacts.flatMap(contact => contact.a === geometry.frames.indexOf(item) ? [geometry.frames[contact.b]]
        : contact.b === geometry.frames.indexOf(item) ? [geometry.frames[contact.a]] : [])
        .filter(other => orthogonal(item, other) && cut(other, axis).length
          && coordinate(other, axis, -1) <= coordinate(item, axis, -1) + TOLERANCE
          && coordinate(other, axis, 1) >= coordinate(item, axis, 1) - TOLERANCE)
      for (const other of supports) {
        const id = JSON.stringify(['support', item.panel.id, other.panel.id, ...cut(item, axis)])
        if (seen.has(id)) continue
        seen.add(id)
        evidence.push({ id, detector: 'support-margins', panelIds: [item.panel.id, other.panel.id], jointIds: [], axis: axis.toArray() as Vec3,
          residuals: [coordinate(item, axis, -1) - coordinate(other, axis, -1), coordinate(other, axis, 1) - coordinate(item, axis, 1)],
          tolerance: TOLERANCE, strength: 'weak', contrary: ['A supporting surface supplies no opposing walls.'],
          alternatives: ['preserve-cuts', 'fitted-clearances'],
          equations: ([-1, 1] as const).map(side => reference(`${id}/${side}`, item, other, axis, side, side)),
          cuts: [...cut(item, axis), ...cut(other, axis)] })
      }
    }
  }
  // Removing the target boundary exposes dependent sections independently of
  // driving direction. Structural spans define the core; remaining attached subgraphs are only
  // proposals. Every external joint/contact and common translation is tested.
  const selected = new Set([...selectedIds, ...evidence.filter(item => item.detector === 'structural-span').flatMap(item => item.panelIds)])
  const adjacency = new Map(geometry.panels.map(panel => [panel.id, new Set<string>()]))
  const relations = [...physical.joints.map(joint => ({ ids: joint.panelIds, id: joint.id })),
    ...physical.contacts.map(contact => ({ ids: contact.panelIds, id: `contact/${[...contact.panelIds].sort().join('/')}` }))]
  for (const relation of relations) for (const a of relation.ids) for (const b of relation.ids) {
    if (!selected.has(a) && !selected.has(b)) adjacency.get(a)!.add(b)
  }
  const visited = new Set<string>(), sections: RigidResizeSection[] = []
  for (const panel of geometry.panels) {
    if (selected.has(panel.id) || visited.has(panel.id) || excluded.has(panel.id)) continue
    const members = new Set([panel.id])
    for (const id of members) for (const neighbor of adjacency.get(id)!) if (!excluded.has(neighbor)) members.add(neighbor)
    members.forEach(id => visited.add(id))
    const boundary = relations.filter(relation => relation.ids.some(id => members.has(id)) && relation.ids.some(id => selected.has(id)))
    if (boundary.length >= 1) sections.push({ panelIds: [...members].sort(),
      boundaryPanelIds: [...new Set(boundary.flatMap(r => r.ids.filter(id => selected.has(id))))].sort(), boundaryJointIds: boundary.map(r => r.id) })
  }
  return Object.freeze({ physical, evidence: freeze(evidence.sort((a, b) => a.id.localeCompare(b.id))),
    sections: freeze(sections.sort((a, b) => a.panelIds.join().localeCompare(b.panelIds.join()))) })
}
export type ResizeEvidenceAnalysis = ReturnType<typeof analyzeResizeEvidence>
