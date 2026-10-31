import { Euler, Vector3 } from 'three'
import { resolvePanels } from './model'
import { getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import type { Panel, Project, Vec3 } from './types'

export interface SnapSettings { grid: boolean; geometry: boolean; spacing: number; tolerance: number }
export const DEFAULT_SNAP: SnapSettings = { grid: false, geometry: false, spacing: 50, tolerance: 10 }
export function readSnapSettings(): SnapSettings {
  try {
    const saved = JSON.parse(localStorage.getItem('playwood-snap') ?? '{}')
    return { grid: saved.grid === true, geometry: saved.geometry === true,
      spacing: Number.isFinite(saved.spacing) ? Math.max(1, Math.min(1000, saved.spacing)) : 50,
      tolerance: Number.isFinite(saved.tolerance) ? Math.max(1, Math.min(100, saved.tolerance)) : 10 }
  } catch { return DEFAULT_SNAP }
}
/** World-axis boundary planes, including rotated panel extents. */
export function panelSnapPoints(panel: Panel): Vec3[] {
  const corners: Vec3[] = []
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    corners.push(new Vector3(x * panel.width / 2, y * panel.height / 2, z * panel.thickness / 2)
      .applyEuler(new Euler(...panel.rotation)).add(new Vector3(...panel.position)).toArray())
  }
  return [corners.reduce((a, b) => a.map((v, i) => Math.min(v, b[i])) as Vec3),
    corners.reduce((a, b) => a.map((v, i) => Math.max(v, b[i])) as Vec3)]
}
export function snapTargets(project: Project, excludedPanels: readonly string[] = [], excludedConnectors: readonly string[] = [], connectors = false): Vec3[] {
  const panels = resolvePanels(project)
  if (!connectors) return panels.filter(p => p.visible && !excludedPanels.includes(p.id)).flatMap(panelSnapPoints)
  return getPhysicalConnectors(project).flatMap(piece => {
    if (excludedConnectors.includes(piece.id)) return []
    const rail = getConnectorRail(piece.connection, panels, project.connections)
    if (!rail) return []
    return [new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)).toArray() as Vec3]
  })
}
/** Snap along a constrained direction; never move a handle off its rail. */
export function snapDistance(origin: Vec3, direction: Vec3, distance: number, targets: Vec3[], settings: SnapSettings): number {
  if (!settings.grid && !settings.geometry) return distance
  let result = distance, best = Infinity
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-6) continue
    const coordinate = origin[axis] + direction[axis] * distance
    const values = settings.geometry ? targets.map(point => point[axis]) : []
    if (settings.grid) values.push(Math.round(coordinate / settings.spacing) * settings.spacing)
    for (const value of values) {
      const candidate = (value - origin[axis]) / direction[axis]
      const error = Math.abs(candidate - distance)
      if (error <= settings.tolerance && error < best) { best = error; result = candidate }
    }
  }
  return result
}
export function snapPanelDelta(panels: Panel[], ids: readonly string[], delta: Vec3, settings: SnapSettings, constrained = false): Vec3 {
  if (!settings.grid && !settings.geometry) return delta
  const sources = panels.filter(p => p.visible && ids.includes(p.id)).flatMap(panelSnapPoints)
  const targets = panels.filter(p => p.visible && !ids.includes(p.id)).flatMap(panelSnapPoints)
  if (constrained) {
    const vector = new Vector3(...delta), length = vector.length()
    if (length < 1e-6) return delta
    const direction = vector.normalize().toArray() as Vec3
    let distance = length, best = Infinity
    for (const source of sources) {
      const candidate = snapDistance(source, direction, length, targets, settings)
      const error = Math.abs(candidate - length)
      const exact = direction.some((component, axis) => {
        if (Math.abs(component) < 1e-6) return false
        const coordinate = source[axis] + component * length
        return (settings.grid && Math.abs(coordinate / settings.spacing - Math.round(coordinate / settings.spacing)) < 1e-8)
          || (settings.geometry && targets.some(point => Math.abs(point[axis] - coordinate) < 1e-8))
      })
      if ((error > 1e-8 || exact) && error < best && candidate > 0) { distance = candidate; best = error }
    }
    return vector.multiplyScalar(distance).toArray() as Vec3
  }
  return delta.map((amount, axis) => {
    if (Math.abs(amount) < 1e-6) return amount
    let result = amount, best = Infinity
    const direction = [0, 0, 0] as Vec3; direction[axis] = 1
    for (const source of sources) {
      const candidate = snapDistance(source, direction, amount, targets, settings)
      const error = Math.abs(candidate - amount)
      const coordinate = source[axis] + amount
      const exact = (settings.grid && Math.abs(coordinate / settings.spacing - Math.round(coordinate / settings.spacing)) < 1e-8)
        || (settings.geometry && targets.some(point => Math.abs(point[axis] - coordinate) < 1e-8))
      if ((error > 1e-8 || exact) && error < best) { best = error; result = candidate }
    }
    return result
  }) as Vec3
}
