import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { createPanel, resolvePanels, validateProject } from './model'
import { addFittedPanelToAssembly, getAssemblyInstance } from './assemblies'
import { connectClosingPanel } from './closure-connectors'
import { CONNECTOR_PROFILES } from './connector-profile'
import type { Panel, Project, Vec3 } from './types'

const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const tolerance = 0.1
const clearance = 1
const quaternion = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const box = (panel: Panel) => new OBB(new Vector3(...panel.position), new Vector3(panel.width / 2, panel.height / 2, panel.thickness / 2), new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion(panel))))
export interface PanelHole { id: string; label: string; panel: Panel; boundaryIds: string[] }

/** Rectangular openings bounded by four orthogonal panels, in any world orientation.
 * Allow the measured connector seat at corners, but require all four edges.
 */
export function findPanelHoles(selected: readonly Panel[], obstacles: readonly Panel[] = selected): PanelHole[] {
  const visible = selected.filter(panel => panel.visible)
  if (visible.length < 4) return []
  // Prefer world axes for familiar labels; use the first panel's frame for rotated work.
  const aligned = (rotation: Quaternion) => axes.every(axis => Math.max(...axis.clone().applyQuaternion(rotation).toArray().map(Math.abs)) > 0.99999)
  const frame = visible.every(panel => aligned(quaternion(panel))) ? new Quaternion() : quaternion(visible[0])
  const inverse = frame.clone().invert()
  const bounds = visible.flatMap(panel => {
    const rotation = inverse.clone().multiply(quaternion(panel))
    if (!aligned(rotation)) return []
    const directions = axes.map(axis => axis.clone().applyQuaternion(rotation))
    const sizes = [panel.width, panel.height, panel.thickness]
    const center = new Vector3(...panel.position).applyQuaternion(inverse).toArray()
    const half = axes.map((_, i) => directions.reduce((sum, direction, j) => sum + Math.abs(direction.getComponent(i)) * sizes[j] / 2, 0))
    const normal = directions[2].toArray().map(Math.abs).indexOf(Math.max(...directions[2].toArray().map(Math.abs)))
    return [{ panel, normal, min: center.map((value, i) => value - half[i]), max: center.map((value, i) => value + half[i]) }]
  })
  const obstaclesBoxes = obstacles.map(box)
  const result = new Map<string, PanelHole>()
  for (let n = 0; n < 3; n++) {
    const [u, v] = [0, 1, 2].filter(axis => axis !== n)
    const us = bounds.filter(bound => bound.normal === u), vs = bounds.filter(bound => bound.normal === v)
    for (const left of us) for (const right of us) {
      const lowU = left.max[u], highU = right.min[u]
      if (highU - lowU < 42 || highU - lowU > 4002) continue
      for (const bottom of vs) for (const top of vs) {
        const lowV = bottom.max[v], highV = top.min[v]
        if (highV - lowV < 42 || highV - lowV > 4002) continue
        const edges = [left, right, bottom, top]
        // Real corner clamps leave a small gap between the ends of adjacent panels.
        const gap = CONNECTOR_PROFILES['90'].seat + tolerance
        if ([left, right].some(edge => edge.min[v] > lowV + gap || edge.max[v] < highV - gap)
          || [bottom, top].some(edge => edge.min[u] > lowU + gap || edge.max[u] < highU - gap)) continue
        for (const sign of [-1, 1]) {
          const ends = edges.map(edge => sign < 0 ? edge.min[n] : edge.max[n])
          if (Math.max(...ends) - Math.min(...ends) > tolerance) continue
          const thickness = Math.min(...edges.map(edge => edge.panel.thickness))
          if (edges.some(edge => edge.max[n] - edge.min[n] < thickness + clearance)) continue
          const center = [0, 0, 0]
          center[u] = (lowU + highU) / 2; center[v] = (lowV + highV) / 2
          center[n] = ends[0] - sign * (thickness / 2 + clearance)
          const normal = axes[u].clone().cross(axes[v])
          const rotation = new Euler().setFromQuaternion(frame.clone().multiply(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(axes[u], axes[v], normal))))
          const direction = axes[n].clone().multiplyScalar(sign).applyQuaternion(frame)
          const dominant = direction.toArray().map(Math.abs).indexOf(Math.max(...direction.toArray().map(Math.abs)))
          const label = [['Left', 'Right'], ['Bottom', 'Top'], ['Back', 'Front']][dominant][direction.getComponent(dominant) > 0 ? 1 : 0]
          const boundaryIds = edges.map(edge => edge.panel.id).sort()
          const id = JSON.stringify([boundaryIds, n, sign])
          const panel = createPanel({ ...edges[0].panel, id: `closure:${id}`, name: `${label} panel`, width: highU - lowU - 2 * clearance, height: highV - lowV - 2 * clearance,
            thickness, pattern: 'solid', cornerRadius: 0, visible: true,
            position: new Vector3(...center as Vec3).applyQuaternion(frame).toArray(), rotation: [rotation.x || 0, rotation.y || 0, rotation.z || 0] })
          const probe = box(panel)
          const seat = CONNECTOR_PROFILES['90'].seat
          panel.width = highU - lowU + (left.panel.thickness + right.panel.thickness) / 2 - 2 * seat
          panel.height = highV - lowV + (bottom.panel.thickness + top.panel.thickness) / 2 - 2 * seat
          center[u] = (lowU - left.panel.thickness / 2 + highU + right.panel.thickness / 2) / 2
          center[v] = (lowV - bottom.panel.thickness / 2 + highV + top.panel.thickness / 2) / 2
          center[n] = ends[0] + sign * seat
          panel.position = new Vector3(...center as Vec3).applyQuaternion(frame).toArray()
          if (panel.width < 40 || panel.height < 40 || panel.width > 4000 || panel.height > 4000) continue
          const candidate = box(panel)
          // This also rules out larger rectangles spanning a compartment divider,
          // already closed faces, and obstructions outside the selection.
          if (obstaclesBoxes.some(obstacle => candidate.intersectsOBB(obstacle) || probe.intersectsOBB(obstacle))) continue
          result.set(id, { id, label, panel, boundaryIds })
        }
      }
    }
  }
  const holes = [...result.values()].sort((a, b) => a.label.localeCompare(b.label) || a.panel.position[1] - b.panel.position[1] || a.panel.position[0] - b.panel.position[0])
  const counts = new Map<string, number>()
  return holes.map(hole => {
    const count = (counts.get(hole.label) ?? 0) + 1; counts.set(hole.label, count)
    return holes.filter(other => other.label === hole.label).length > 1 ? { ...hole, label: `${hole.label} ${count}` } : hole
  })
}

export function closePanelHole(project: Project, selectedIds: readonly string[], holeId: string) {
  const panels = resolvePanels(project)
  const hole = findPanelHoles(panels.filter(panel => selectedIds.includes(panel.id)), panels).find(item => item.id === holeId)
  if (!hole) throw new Error('This opening is no longer available. Select its surrounding panels again.')
  if (project.panels.length >= 200) throw new Error('Projects support up to 200 panels.')
  const panel = { ...hole.panel, id: crypto.randomUUID(), name: `${hole.label} panel` }
  const owners = selectedIds.map(id => getAssemblyInstance(project, id))
  const instance = owners[0] && owners.every(owner => owner?.id === owners[0]?.id) ? owners[0] : undefined
  if (!instance && owners.some(Boolean)) throw new Error('Select one complete assembly or separate panels to close an opening.')
  const next = instance ? addFittedPanelToAssembly(project, instance.id, panel, hole.boundaryIds) : connectClosingPanel(project, panel, hole.boundaryIds)
  const problem = validateProject(next).find(issue => issue.panelIds.includes(panel.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))
  if (problem) throw new Error(problem.message)
  return { project: next, panelId: panel.id, label: hole.label, instanceId: instance?.id }
}
