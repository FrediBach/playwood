import { restoreRemovedConnectors } from './restore-connectors'
import { Euler, Quaternion, Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { isPanelConnectedToAssembly } from './assemblies'
import { CONNECTOR_PROFILES } from './connector-profile'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { resolvePanels, validateProject } from './model'
import { movePanels } from './structure-edit'
import type { Connection, Panel, Project, Side, Vec3 } from './types'

const SNAP_DISTANCE = 100
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))

/** Explicit auto-connect may translate loose panels. Internal geometry callers
 * keep using autoConnect, which never moves panels to find a joint. */
export function autoConnectNearby(source: Project, selectedIds: readonly string[] = []) {
  const restored = restoreRemovedConnectors(source, selectedIds)
  let result = { ...autoConnect(restored.project, selectedIds), movedPanelIds: [] as string[] }
  result.connectors += restored.connectors
  result.joints += restored.joints
  const selected = new Set(selectedIds)
  for (;;) {
    const project = result.project
    const panels = resolvePanels(project)
    const scope = new Set([...selected, ...(selected.size > 1 ? result.addedPanelIds : [])])
    const joined = new Set(project.connections.flatMap(connection => [connection.parentId, connection.childId]))
    const candidates: { id: string; targetId: string; delta: Vec3; distance: number }[] = []
    const seen = new Set<string>()
    for (const child of panels) {
      if (!child.visible || joined.has(child.id) || (selected.size && !selected.has(child.id)) || isPanelConnectedToAssembly(project, child.id)) continue
      for (const parent of panels) {
        if (!parent.visible || parent.id === child.id || (scope.size > 1 && !scope.has(parent.id))) continue
        if ([parent, child].some(panel => panel.thickness < 16 || panel.thickness > 19)) continue
        const local = new Vector3(...child.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
        if (local.length() > Math.hypot(parent.width, parent.height) / 2 + Math.hypot(child.width, child.height) / 2 + SNAP_DISTANCE + 40) continue
        const targets: { panel: Panel; type: '90' | '105' | '150' | 't'; side: Side }[] = []
        for (const side of ['left', 'right', 'top', 'bottom'] as const) {
          for (const type of ['90', '105', '150'] as const) targets.push({ panel: parent, type, side })
        }
        // A virtual half of an upright/shelf gives the exact T seat at the
        // desired interior seam. autoConnect performs the real validated split.
        if (!parent.customOutline && !parent.trofastInserts?.length && parent.thickness >= 18 && child.thickness >= 18) {
          for (const dimension of ['width', 'height'] as const) {
            const axis = dimension === 'width' ? 0 : 1
            const cut = local.getComponent(axis), seat = CONNECTOR_PROFILES.t.seat
            const length = parent[dimension] / 2 + cut - seat
            if (length < 40 || parent[dimension] / 2 - cut - seat < 40) continue
            targets.push({ type: 't', side: dimension === 'width' ? 'right' : 'top', panel: {
              ...parent, [dimension]: length,
              position: new Vector3(...parent.position).add(axes[axis].clone().applyQuaternion(rotation(parent)).multiplyScalar((length - parent[dimension]) / 2)).toArray(),
            } })
          }
        }
        for (const target of targets) for (const flip of [false, true]) for (const quarterTurn of [false, true]) {
          const relative = new Vector3(...child.position).sub(new Vector3(...target.panel.position)).applyQuaternion(rotation(target.panel).invert())
          const connection: Connection = { id: 'nearby:0', parentId: parent.id, childId: child.id, type: target.type,
            side: target.side, flip, quarterTurn, offset: target.side === 'left' || target.side === 'right' ? relative.y : relative.x,
            inset: 0, count: 2, color: '#222222' }
          const expected = resolvePanels({ version: 1, name: '', panels: [target.panel, child], connections: [connection] })[1]
          if (!axes.every(axis => Math.abs(axis.clone().applyQuaternion(rotation(expected)).dot(axis.clone().applyQuaternion(rotation(child)))) > 0.99999)) continue
          const delta = new Vector3(...expected.position).sub(new Vector3(...child.position))
          const distance = delta.length()
          if (distance <= 0.5 || distance > SNAP_DISTANCE) continue
          const key = `${child.id}/${parent.id}/${delta.toArray().map(value => value.toFixed(5)).join('/')}`
          if (seen.has(key)) continue
          seen.add(key)
          candidates.push({ id: child.id, targetId: parent.id, delta: delta.toArray(), distance })
        }
      }
    }
    candidates.sort((a, b) => a.distance - b.distance)
    const previousIssues = new Set(validateProject(project).map(issue => issue.id))
    let accepted = false
    for (const candidate of candidates) {
      try {
        const moved = movePanels(project, [candidate.id], candidate.delta, { releaseContacts: true })
        const after = resolvePanels(moved)
        if (panels.some(panel => panel.id !== candidate.id && JSON.stringify(after.find(item => item.id === panel.id)) !== JSON.stringify(panel))) continue
        const fitted = autoConnect(moved, scope.size ? [...scope] : [candidate.id, candidate.targetId])
        if (!fitted.joints || !fitted.project.connections.some(connection => connection.parentId === candidate.id || connection.childId === candidate.id)) continue
        if (validateProject(fitted.project).some(issue => !previousIssues.has(issue.id) && (issue.severity === 'error' || issue.id.startsWith('collision-')))) continue
        assertDesignConstraintEdit(project, fitted.project)
        result = { ...fitted, joints: result.joints + fitted.joints, connectors: result.connectors + fitted.connectors,
          upgrades: result.upgrades + fitted.upgrades, splits: result.splits + fitted.splits,
          addedPanelIds: [...result.addedPanelIds, ...fitted.addedPanelIds],
          disassembledNames: [...new Set([...result.disassembledNames, ...fitted.disassembledNames])],
          movedPanelIds: [...result.movedPanelIds, candidate.id] }
        accepted = true
        break
      } catch { /* A blocked move or fit leaves the current construction intact. */ }
    }
    if (!accepted) return result
  }
}
