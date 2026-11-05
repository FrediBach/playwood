import { autoConnect } from './auto-connect'
import { solveCuboid } from './object-solver'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import type { ObjectBounds } from './object-geometry'
import type { Project, Vec3 } from './types'

/** A straight row of cuboids sharing complete faces. Each divider is centered
 * on its shared face; each compartment gives up half its thickness, preserving the outer envelope. */
export function solveCuboidCompartments(bounds: readonly ObjectBounds[], axis: number, thickness: number): Project {
  if (bounds.length < 2 || !Number.isInteger(axis) || axis < 0 || axis > 2) throw new Error('Select a straight row of at least two cuboids.')
  if (bounds.length * 12 > 400) throw new Error('Projects support up to 400 connections.')
  if (!Number.isFinite(thickness) || thickness < 18 || thickness > 19) throw new Error('Shared compartment walls require 18–19 mm stock for T connectors.')
  const ordered = [...bounds].sort((a, b) => a.min[axis] - b.min[axis])
  if (ordered.some((item, index) => (index > 0 && Math.abs(ordered[index - 1].max[axis] - item.min[axis]) > 1e-6)
    || [0, 1, 2].some(i => i !== axis && (Math.abs(ordered[0].min[i] - item.min[i]) > 1e-6 || Math.abs(ordered[0].max[i] - item.max[i]) > 1e-6)))) throw new Error('Shared compartments need a straight row of matching full faces.')
  const cubes = ordered.map((bounds, index) => {
    const min = [...bounds.min] as Vec3, max = [...bounds.max] as Vec3
    if (index < ordered.length - 1) max[axis] += thickness / 2
    if (index > 0) min[axis] -= thickness / 2
    const [width, height, depth] = max.map((value, i) => value - min[i])
    const cube = solveCuboid({ width, height, depth, thickness })
    const delta = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
    return { ...cube, panels: cube.panels.map(panel => ({ ...panel, position: panel.position.map((value, i) => value + delta[i]) as Vec3 })) }
  })
  const removed = new Map<string, string>(), dividerIds = new Set<string>()
  for (let i = 1; i < cubes.length; i++) {
    const divider = cubes[i - 1].panels[axis * 2 + 1]
    removed.set(cubes[i].panels[axis * 2].id, divider.id); dividerIds.add(divider.id)
  }
  const remap = (id: string) => removed.get(id) ?? id
  const required = cubes.flatMap(cube => cube.connections.map(c => [remap(c.parentId), remap(c.childId)]))
  const panels = cubes.flatMap(cube => cube.panels.filter(panel => !removed.has(panel.id))).map(panel => dividerIds.has(panel.id) ? { ...panel, name: 'Shared divider' } : panel)
  const project = autoConnect({ version: 1, name: 'Shared compartments', panels, connections: [] }).project
  const hardware = getPhysicalConnectors(project)
  const groups = hardware.map(piece => {
    const id = piece.connection.id.replace(/:\d+$/, '')
    return { type: piece.type, members: new Set(project.connections.filter(c => c.id.replace(/:\d+$/, '') === id).flatMap(c => [c.parentId, c.childId])), id }
  })
  if (required.some(pair => !groups.some(group => pair.every(id => group.members.has(id))))) throw new Error('Cannot fit every required compartment joint.')
  for (const dividerId of dividerIds) {
    const joints = groups.filter(group => group.type === 't' && group.members.has(dividerId) && group.members.size === 3)
    if (new Set(joints.map(group => group.id)).size !== 4) throw new Error('Every shared wall needs four complete T joints.')
  }
  if (project.panels.length !== 5 * cubes.length + 1) throw new Error('The compartment row has an unexpected panel layout.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('The shared-wall hardware does not have enough clearance.')
  const actual = getProjectBounds(resolvePanels(project))
  if ([0, 1, 2].some(i => Math.abs(actual.min[i] - Math.min(...bounds.map(b => b.min[i]))) > 1e-5 || Math.abs(actual.max[i] - Math.max(...bounds.map(b => b.max[i]))) > 1e-5)) throw new Error('Shared-wall conversion changed the outside envelope.')
  return project
}
