import { Euler, Quaternion, Vector3 } from 'three'
import { resolvePanels } from './model'
import { getPhysicalConnectors } from './connector-selection'
import type { Connection, Panel, Project } from './types'

const EPSILON = 1e-6
const CONTACT_TOLERANCE = 1e-4
export type Frame = { panel: Panel; axes: Vector3[]; half: number[] }
export type Contact = { a: number; b: number; normal: Vector3; sign: number }
/** A complete structural joint, including support branches and joints whose
 * installed pieces have all been removed. Hardware visibility is separate. */
export interface StructuralJoint {
  readonly id: string
  readonly panelIds: readonly string[]
  readonly connectionIds: readonly string[]
  readonly supportConnectionIds: readonly string[]
}
export const structuralJointId = (connection: Pick<Connection, 'id'>) => connection.id.replace(/:\d+$/, '')

/** Preserve source order: movement's staged search and connector handle ordering
 * must not change when callers share these physical facts. No geometry scan or
 * installed-hardware collection is needed for joint-only callers. */
export function analyzeStructuralJoints(project: Project): readonly StructuralJoint[] {
  const joints = new Map<string, Connection[]>()
  for (const connection of project.connections) {
    const id = structuralJointId(connection)
    const members = joints.get(id)
    if (members) members.push(connection)
    else joints.set(id, [connection])
  }
  return Object.freeze([...joints].map(([id, connections]) => Object.freeze({ id,
    panelIds: Object.freeze([...new Set(connections.flatMap(connection => [connection.parentId, connection.childId]))]),
    connectionIds: Object.freeze(connections.map(connection => connection.id)),
    supportConnectionIds: Object.freeze(connections.filter(connection => connection.role === 'support').map(connection => connection.id)),
  })))
}

const position = (panel: Panel) => new Vector3(...panel.position)

export const frame = (panel: Panel): Frame => {
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  return { panel, axes: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(rotation)), half: [panel.width / 2, panel.height / 2, panel.thickness / 2] }
}
export const extent = (item: Frame, axis: Vector3) => item.axes.reduce((sum, own, index) => sum + Math.abs(own.dot(axis)) * item.half[index], 0)
export const coordinate = (item: Frame, axis: Vector3, side = 0) => position(item.panel).dot(axis) + side * extent(item, axis)

/** Existing surface contacts are implicit supports for the library's loose inserts. */
export function findContacts(frames: Frame[]): Contact[] {
  const contacts: Contact[] = []
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    const first = frames[a], second = frames[b]
    const separation = position(second.panel).sub(position(first.panel))
    for (const normal of first.axes) {
      if (!second.axes.some(axis => Math.abs(axis.dot(normal)) > 1 - EPSILON)) continue
      const distance = separation.dot(normal)
      if (Math.abs(Math.abs(distance) - extent(first, normal) - extent(second, normal)) > CONTACT_TOLERANCE) continue
      const tangents = [...first.axes, ...second.axes].filter(axis => Math.abs(axis.dot(normal)) < EPSILON)
      const hasArea = tangents.every(axis => Math.min(coordinate(first, axis, 1), coordinate(second, axis, 1))
        - Math.max(coordinate(first, axis, -1), coordinate(second, axis, -1)) > CONTACT_TOLERANCE)
      if (hasArea) { contacts.push({ a, b, normal, sign: Math.sign(distance) }); break }
    }
  }
  return contacts
}

/** Analyze contacts only after a caller's cheap eligibility checks. */
export function analyzeStructureContacts(project: Project, frames: Frame[]) {
  const outlineClosures = new Set(project.connections.filter(connection => connection.outlineEdge !== undefined).map(connection => connection.childId))
  const surfaceContacts = findContacts(frames)
  const contacts = surfaceContacts.filter(contact => !outlineClosures.has(frames[contact.a].panel.id) && !outlineClosures.has(frames[contact.b].panel.id))
  // Movement uses all contacts to detect when an outline requires its legacy
  // fallback; the resize compiler protects only contacts outside fitted outlines.
  return { contacts, surfaceContacts, outlineClosures }
}

/** Geometry consumed by the legacy compiler, in its original ordering. */
export function analyzeStructure(project: Project) {
  const panels = resolvePanels(project)
  const frames = panels.map(frame)
  return { panels, frames, ...analyzeStructureContacts(project, frames) }
}

/** Read-only, source-bound physical facts; semantic evidence/propagation comes in stage 2. */
export interface ResizeAnalysis {
  readonly source: Project
  readonly panels: readonly { readonly id: string; readonly width: number; readonly height: number; readonly thickness: number; readonly position: readonly number[]; readonly rotation: readonly number[] }[]
  readonly joints: readonly StructuralJoint[]
  readonly contacts: readonly { readonly panelIds: readonly string[]; readonly normal: readonly number[]; readonly protected: true }[]
  readonly installedConnectorIds: readonly string[]
  readonly ownership: readonly { readonly instanceId: string; readonly panelIds: readonly string[] }[]
  readonly outlinePanelIds: readonly string[]
}

/** Inspection is optional; the solver does not pay to collect hardware metadata per pointer sample. */
export function inspectResizeAnalysis(project: Project, geometry = analyzeStructure(project)): ResizeAnalysis {
  return Object.freeze({ source: project,
    panels: Object.freeze(geometry.panels.map(panel => Object.freeze({ id: panel.id, width: panel.width, height: panel.height, thickness: panel.thickness,
      position: Object.freeze([...panel.position]), rotation: Object.freeze([...panel.rotation]) }))),
    joints: analyzeStructuralJoints(project),
    contacts: Object.freeze(geometry.contacts.map(contact => Object.freeze({
      panelIds: Object.freeze([geometry.panels[contact.a].id, geometry.panels[contact.b].id]),
      normal: Object.freeze(contact.normal.toArray()), protected: true as const,
    }))),
    installedConnectorIds: Object.freeze(getPhysicalConnectors(project).map(piece => piece.id)),
    ownership: Object.freeze((project.assemblies?.instances ?? []).map(instance => Object.freeze({ instanceId: instance.id,
      panelIds: Object.freeze(Object.values(instance.panelIds)) }))),
    outlinePanelIds: Object.freeze([...geometry.outlineClosures]),
  })
}
