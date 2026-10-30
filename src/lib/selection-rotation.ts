import { Euler, Quaternion, Vector3 } from 'three'
import { getProjectBounds, resolvePanels } from './model'
import type { Panel, Project, RotationAxis, Vec3 } from './types'

/** Turn a complete selection rigidly around its center in world space. */
export function rotateSelection(project: Project, selectedIds: readonly string[], axis: RotationAxis, degrees = 90): Project {
  if (!Number.isFinite(degrees)) throw new Error('Rotation must be a finite angle.')
  if (!selectedIds.length || degrees % 360 === 0) return project
  const wanted = new Set(selectedIds)
  const selected = resolvePanels(project).filter(panel => wanted.has(panel.id))
  if (!selected.length) return project
  for (const instance of project.assemblies?.instances ?? []) {
    const ids = Object.values(instance.panelIds)
    if (ids.some(id => wanted.has(id)) && !ids.every(id => wanted.has(id))) {
      throw new Error('Select the whole assembly to rotate it, or disassemble it to edit its panels separately.')
    }
  }
  if (project.connections.some(connection => wanted.has(connection.parentId) !== wanted.has(connection.childId))) {
    throw new Error('Select all connected panels and assemblies to rotate them together, or detach the selection first.')
  }
  const bounds = getProjectBounds(selected)
  const center = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5)
  const direction = new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
  const turn = new Quaternion().setFromAxisAngle(direction, (degrees % 360) * Math.PI / 180)
  const rotate = <T extends Pick<Panel, 'position' | 'rotation'>>(item: T): T => {
    const position = new Vector3(...item.position).sub(center).applyQuaternion(turn).add(center).toArray() as Vec3
    if (position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) {
      throw new Error('This rotation would exceed the project placement limits. Move the selection closer to the origin first.')
    }
    const orientation = turn.clone().multiply(new Quaternion().setFromEuler(new Euler(...item.rotation)))
    const angles = new Euler().setFromQuaternion(orientation)
    return { ...item, position, rotation: [angles.x || 0, angles.y || 0, angles.z || 0] as Vec3 }
  }
  const rotated = new Map(selected.map(panel => [panel.id, rotate(panel)]))
  const next: Project = { ...project,
    panels: project.panels.map(panel => rotated.get(panel.id) ?? panel),
    ...(project.assemblies ? { assemblies: { ...project.assemblies,
      instances: project.assemblies.instances.map(instance => Object.values(instance.panelIds).some(id => wanted.has(id)) ? rotate(instance) : instance),
    } } : {}),
  }
  // Keep stored driving-child poses in agreement with their roots while
  // preserving every unselected panel exactly as it was.
  const resolved = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
  return { ...next, panels: next.panels.map(panel => wanted.has(panel.id) ? resolved.get(panel.id)! : panel) }
}
