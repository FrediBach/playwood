import { Euler, Quaternion, Vector3 } from 'three'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project } from './types'

const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const samePose = (a: Panel, b: Panel) => new Vector3(...a.position).distanceTo(new Vector3(...b.position)) < 0.000001
  && 1 - Math.abs(new Quaternion().setFromEuler(new Euler(...a.rotation)).dot(new Quaternion().setFromEuler(new Euler(...b.rotation)))) < 0.000001

function upperSection(panel: Panel, width: number) {
  const { id: _id, ...properties } = panel
  return createPanel({ ...properties, name: `${panel.name.slice(0, 112)} (upper)`, width })
}

/**
 * Repair only the former five-panel shelf topology. The caller can put this
 * immutable edit into normal undo history; unrelated and incompatible projects
 * retain their original reference. Existing identities, finishes and shelf
 * positions survive, with two side sections added around the actual T bodies.
 */
export function repairLegacyShelf(project: Project): Project {
  const connections = project.connections
  if (project.panels.length !== 5 || connections.length !== 6
    || connections.some(c => c.type !== '90' || c.offset !== 0 || c.flip || c.count < 1)
    || new Set(connections.map(jointId)).size !== connections.length) return project

  const driving = connections.filter(c => c.role !== 'support')
  const supports = connections.filter(c => c.role === 'support')
  if (driving.length !== 4 || supports.length !== 2) return project
  const roots = project.panels.filter(panel => !driving.some(c => c.childId === panel.id))
  if (roots.length !== 1) return project
  const base = roots[0]
  const leftBase = driving.find(c => c.parentId === base.id && c.side === 'left' && c.inset === 0)
  const rightBase = driving.find(c => c.parentId === base.id && c.side === 'right' && c.inset === 0)
  if (!leftBase || !rightBase) return project
  const left = project.panels.find(panel => panel.id === leftBase.childId)
  const right = project.panels.find(panel => panel.id === rightBase.childId)
  if (!left || !right || left.id === right.id) return project
  const topConnection = driving.find(c => c.parentId === left.id && c.side === 'left' && c.inset === 0)
  const middleConnection = driving.find(c => c.parentId === left.id && c.side === 'left' && c.inset > 0 && c.inset < left.width)
  if (!topConnection || !middleConnection) return project
  const top = project.panels.find(panel => panel.id === topConnection.childId)
  const middle = project.panels.find(panel => panel.id === middleConnection.childId)
  if (!top || !middle || new Set([base.id, left.id, right.id, top.id, middle.id]).size !== 5) return project
  if (Math.abs(base.width - top.width) > 0.000001 || Math.abs(base.width - middle.width) > 0.000001
    || Math.abs(left.width - right.width) > 0.000001) return project
  const rightTop = supports.find(c => c.parentId === right.id && c.childId === top.id && c.side === 'right' && c.inset === 0)
  const rightMiddle = supports.find(c => c.parentId === right.id && c.childId === middle.id && c.side === 'right' && c.inset === middleConnection.inset)
  if (!rightTop || !rightMiddle) return project
  // Existing standalone IDs without a suffix also become branch zero. Other
  // explicit suffixes cannot be retained as a valid T primary connection.
  if ([middleConnection, rightMiddle].some(c => /:\d+$/.test(c.id) && !c.id.endsWith(':0'))) return project

  const gap = CONNECTOR_PROFILES.t.seat * 2
  const lowerLeftWidth = left.width - middleConnection.inset
  const lowerRightWidth = right.width - rightMiddle.inset
  const upperLeftWidth = middleConnection.inset - gap
  const upperRightWidth = rightMiddle.inset - gap
  if ([lowerLeftWidth, lowerRightWidth, upperLeftWidth, upperRightWidth].some(width => width < 40)) return project
  // Interior-edge access is the defect being repaired. Other errors, including
  // misaligned supports or incompatible thickness, must not be silently edited.
  if (validateProject(project).some(issue => issue.severity === 'error' && !issue.id.endsWith('-edge-access'))) return project

  const before = resolvePanels(project)
  const upperLeft = upperSection(left, upperLeftWidth)
  const upperRight = upperSection(right, upperRightWidth)
  const leftT: Connection = { ...middleConnection, type: 't', inset: 0 }
  const rightT: Connection = { ...rightMiddle, type: 't', inset: 0 }
  const next: Project = {
    ...project,
    panels: [...project.panels.map(panel => panel.id === left.id ? { ...panel, width: lowerLeftWidth }
      : panel.id === right.id ? { ...panel, width: lowerRightWidth } : panel), upperLeft, upperRight],
    connections: [...connections.map(connection => {
      if (connection.id === middleConnection.id) return leftT
      if (connection.id === rightMiddle.id) return rightT
      if (connection.id === topConnection.id) return { ...connection, parentId: upperLeft.id }
      if (connection.id === rightTop.id) {
        const { role: _role, ...options } = connection
        return { ...options, parentId: top.id, childId: upperRight.id, side: 'left' as const }
      }
      return connection
    }),
    { ...leftT, id: `${jointId(leftT)}:1`, childId: upperLeft.id, count: 0 },
    { ...rightT, id: `${jointId(rightT)}:1`, childId: upperRight.id, count: 0 }],
  }
  next.panels = resolvePanels(next)
  if (validateProject(next).some(issue => issue.severity === 'error')) return project
  // Require exact shelf placement, even when a legacy support fell within the
  // validator's looser alignment tolerance.
  if ([base, top, middle].some(panel => !samePose(before.find(p => p.id === panel.id)!, next.panels.find(p => p.id === panel.id)!))) return project
  for (const [original, upper, lowerWidth, upperWidth, direction] of [
    [left, upperLeft, lowerLeftWidth, upperLeftWidth, -1],
    [right, upperRight, lowerRightWidth, upperRightWidth, 1],
  ] as const) {
    const old = before.find(panel => panel.id === original.id)!
    const inward = new Vector3(direction, 0, 0).applyEuler(new Euler(...old.rotation))
    const lowerPosition = new Vector3(...old.position).addScaledVector(inward, -(old.width - lowerWidth) / 2)
    const upperPosition = new Vector3(...old.position).addScaledVector(inward, (old.width - upperWidth) / 2)
    if (!samePose({ ...old, position: lowerPosition.toArray() }, next.panels.find(panel => panel.id === old.id)!)
      || !samePose({ ...old, position: upperPosition.toArray() }, next.panels.find(panel => panel.id === upper.id)!)) return project
  }
  return next
}
