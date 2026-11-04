import { Euler, Matrix4, Vector3 } from 'three'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { assertNoNewTrofastIssues } from './trofast'
import type { Connection, Panel, Project, RotationAxis, Vec3 } from './types'

// Reflect local Z as well as the world axis to retain a proper rotation.
// The panel's XY cut shape stays unchanged; its front and back exchange roles.
function mirrorPose<T extends Pick<Panel, 'position' | 'rotation'>>(item: T, axis: RotationAxis, center: Vec3): T {
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const position: Vec3 = [...item.position]
  position[index] = 2 * center[index] - position[index]
  if (position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) {
    throw new Error('This mirror would exceed the project placement limits. Move the selection closer to the origin first.')
  }
  const reflection = new Matrix4().makeScale(axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1, axis === 'z' ? -1 : 1)
  const matrix = reflection.multiply(new Matrix4().makeRotationFromEuler(new Euler(...item.rotation))).multiply(new Matrix4().makeScale(1, 1, -1))
  const angles = new Euler().setFromRotationMatrix(matrix)
  return { ...item, position, rotation: [angles.x || 0, angles.y || 0, angles.z || 0] }
}

function mirrorPanel(panel: Panel, axis: RotationAxis, center: Vec3): Panel {
  return { ...mirrorPose(panel, axis, center), ...(panel.trofastInserts ? {
    trofastInserts: panel.trofastInserts.map(insert => ({ ...insert, face: insert.face === 1 ? -1 : 1 })),
  } : {}) }
}

function mirrorConnection(connection: Connection): Connection {
  return { ...connection,
    side: connection.side === 'front' ? 'back' : connection.side === 'back' ? 'front' : connection.side,
    flip: connection.side === 'front' || connection.side === 'back' ? connection.flip : !connection.flip,
  }
}

/** Reflect a complete selection through its bounding-box center on a world axis. */
export function mirrorSelection(project: Project, selectedIds: readonly string[], axis: RotationAxis): Project {
  const wanted = new Set(selectedIds)
  const selected = resolvePanels(project).filter(panel => wanted.has(panel.id))
  if (!selected.length) return project
  for (const instance of project.assemblies?.instances ?? []) {
    const ids = Object.values(instance.panelIds)
    if (ids.some(id => wanted.has(id)) && !ids.every(id => wanted.has(id))) {
      throw new Error('Select the whole assembly to mirror it, or disassemble it to edit its panels separately.')
    }
  }
  if (project.connections.some(connection => wanted.has(connection.parentId) !== wanted.has(connection.childId))) {
    throw new Error('Select all connected panels and assemblies to mirror them together, or detach the selection first.')
  }
  const bounds = getProjectBounds(selected)
  const center = new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5).toArray() as Vec3
  const mirrored = new Map(selected.map(panel => [panel.id, mirrorPanel(panel, axis, center)]))
  let next: Project = { ...project,
    panels: project.panels.map(panel => mirrored.get(panel.id) ?? panel),
    connections: project.connections.map(connection => wanted.has(connection.parentId) ? mirrorConnection(connection) : connection),
  }
  if (project.assemblies) {
    const definitions = [...project.assemblies.definitions]
    const copies = new Map<string, string>()
    const instances = project.assemblies.instances.map(instance => {
      if (!Object.values(instance.panelIds).some(id => wanted.has(id))) return instance
      let definitionId = copies.get(instance.definitionId)
      if (!definitionId) {
        const source = definitions.find(definition => definition.id === instance.definitionId)!
        definitionId = crypto.randomUUID()
        copies.set(source.id, definitionId)
        definitions.push({ ...source, id: definitionId, name: `${source.name.slice(0, 110)} mirrored`,
          panels: source.panels.map(panel => mirrorPanel(panel, 'z', [0, 0, 0])),
          connections: source.connections.map(mirrorConnection),
        })
      }
      return { ...mirrorPose(instance, axis, center), definitionId }
    })
    next = { ...next, assemblies: { ...project.assemblies, definitions, instances,
      ...(project.assemblies.loosePorts ? { loosePorts: project.assemblies.loosePorts.map(port => wanted.has(port.connection.parentId) ? { ...port, connection: mirrorConnection(port.connection) } : port) } : {}),
    } }
  }
  const resolved = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
  next = { ...next, panels: next.panels.map(panel => wanted.has(panel.id) ? resolved.get(panel.id)! : panel) }
  const oldIssues = new Set(validateProject(project).map(issue => issue.id))
  const issue = validateProject(next).find(issue => !oldIssues.has(issue.id))
  if (issue) throw new Error(issue.message)
  return assertDesignConstraintEdit(project, assertNoNewTrofastIssues(project, next))
}
