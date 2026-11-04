import { Euler, Quaternion, Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels, validateProject } from './model'
import { resizePanelEdge } from './structure-edit'
import type { Connection, Panel, Project, Side, Vec3 } from './types'

const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const sides: Side[] = ['left', 'right', 'top', 'bottom']
const MAX_ADJUSTMENT = 50
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')

function hardwarePositions(project: Project) {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  return new Map(getPhysicalConnectors(project).flatMap(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    return rail ? [[piece.id, new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))] as const] : []
  }))
}

export interface AutoConnectFit {
  result: ReturnType<typeof autoConnect> & { movedPanelIds: string[] }
  adjustment: {
    panelId: string; panelName: string; targetPanelId: string; targetPanelName: string
    dimension: 'width' | 'height'; before: number; after: number; distance: number
  }
}

/** Prepare one small, exact edge correction for explicit user confirmation.
 * The opposite edge, every other panel, and existing hardware stay fixed. */
export function getAutoConnectFit(project: Project, selectedIds: readonly string[] = []): AutoConnectFit | null {
  const panels = resolvePanels(project).filter(panel => panel.visible)
  const selected = new Set(selectedIds)
  const groups = new Map<string, Set<string>>()
  for (const connection of project.connections) {
    const key = jointId(connection)
    const members = groups.get(key) ?? new Set<string>()
    members.add(connection.parentId); members.add(connection.childId); groups.set(key, members)
  }
  const joined = (a: string, b: string) => [...groups.values()].some(members => members.has(a) && members.has(b))
  type Candidate = { parent: Panel; child: Panel; dimension: 'width' | 'height'; side: -1 | 1; distance: number }
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const child of panels) {
    if (child.customOutline || child.thickness < 16 || child.thickness > 19 || (selected.size && !selected.has(child.id))) continue
    for (const parent of panels) {
      if (child.id === parent.id || parent.thickness < 16 || parent.thickness > 19 || joined(parent.id, child.id)) continue
      if (selected.size > 1 && !selected.has(parent.id)) continue
      const relative = new Vector3(...child.position).sub(new Vector3(...parent.position))
      if (relative.length() > Math.hypot(parent.width, parent.height) / 2 + Math.hypot(child.width, child.height) / 2 + MAX_ADJUSTMENT + 40) continue
      for (const type of ['90', '105', '150'] as const) for (const seam of sides) for (const flip of [false, true]) for (const quarterTurn of [false, true]) {
        const connection: Connection = { id: 'fit:0', parentId: parent.id, childId: child.id, type, side: seam, flip, quarterTurn,
          offset: 0, inset: 0, count: 1, color: '#222222' }
        const expected = (panel: Panel) => {
          const delta = new Vector3(...panel.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
          return resolvePanels({ version: 1, name: '', panels: [parent, panel], connections: [{ ...connection, offset: seam === 'left' || seam === 'right' ? delta.y : delta.x }] })[1]
        }
        const baseline = expected(child)
        if (!axes.every(axis => Math.abs(axis.clone().applyQuaternion(rotation(baseline)).dot(axis.clone().applyQuaternion(rotation(child)))) > 0.99999)) continue
        const error = new Vector3(...baseline.position).sub(new Vector3(...child.position))
        if (error.length() <= 0.5 || error.length() > MAX_ADJUSTMENT + 0.05) continue
        for (const dimension of ['width', 'height'] as const) for (const side of [-1, 1] as const) {
          const displacement = axes[dimension === 'width' ? 0 : 1].clone().applyQuaternion(rotation(child)).multiplyScalar(side / 2)
          const trial = { ...child, [dimension]: child[dimension] + 1, position: new Vector3(...child.position).add(displacement).toArray() as Vec3 }
          const slope = new Vector3(...expected(trial).position).sub(new Vector3(...baseline.position)).sub(displacement)
          if (slope.lengthSq() < 1e-8) continue
          const distance = -error.dot(slope) / slope.lengthSq()
          if (Math.abs(distance) > MAX_ADJUSTMENT || Math.abs(distance) < 0.5 || error.clone().addScaledVector(slope, distance).length() > 0.05
            || child[dimension] + distance < 40 || child[dimension] + distance > 4000) continue
          const key = `${parent.id}/${child.id}/${dimension}/${side}/${distance.toFixed(5)}`
          if (seen.has(key)) continue
          seen.add(key); candidates.push({ parent, child, dimension, side, distance })
        }
      }
    }
  }
  candidates.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || a.child.width * a.child.height - b.child.width * b.child.height)
  const beforeIssues = new Set(validateProject(project).map(issue => issue.id))
  const hardware = hardwarePositions(project)
  for (const candidate of candidates) {
    try {
      const { parent, child, dimension, side, distance } = candidate
      const resized = resizePanelEdge(project, child.id, dimension, side, distance, true)
      if (validateProject(resized).some(issue => !beforeIssues.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))) continue
      const result = autoConnect(resized, selectedIds.length ? selectedIds : [parent.id, child.id])
      if (!result.joints || result.splits) continue
      const added = result.project.connections.filter(connection => !project.connections.some(old => old.id === connection.id))
      if (!added.some(connection => (connection.parentId === parent.id && connection.childId === child.id)
        || (connection.parentId === child.id && connection.childId === parent.id))) continue
      if (validateProject(result.project).some(issue => !beforeIssues.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))) continue
      const afterHardware = hardwarePositions(result.project)
      if ([...hardware].some(([id, position]) => !afterHardware.has(id) || afterHardware.get(id)!.distanceTo(position) > 1e-5)) continue
      return { result: { ...result, movedPanelIds: [] }, adjustment: { panelId: child.id, panelName: child.name, targetPanelId: parent.id, targetPanelName: parent.name,
        dimension, before: child[dimension], after: result.project.panels.find(panel => panel.id === child.id)![dimension], distance } }
    } catch {
      // A constrained edge, blocked clamp, or managed assembly is not a fit.
    }
  }
  return null
}
