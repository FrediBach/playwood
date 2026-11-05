import { autoConnect } from './auto-connect'
import { solveCuboid } from './object-solver'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import type { ObjectBounds } from './object-geometry'
import type { Project, Vec3 } from './types'

/** Complete rectangular grids with one common depth; no partial faces or missing cells. */
export function cuboidGridLayout(bounds: readonly ObjectBounds[]) {
  const planes = [0, 1, 2].map(axis => [...new Set(bounds.flatMap(b => [b.min[axis], b.max[axis]]))].sort((a, b) => a - b))
  const sizes = planes.map(p => p.length - 1), axes = sizes.flatMap((size, axis) => size > 1 ? [axis] : [])
  if (axes.length !== 2 || sizes.reduce((n, size) => n * size, 1) !== bounds.length) throw new Error('Touching compartments need a complete rectangular grid or a straight row.')
  const cells = bounds.map(b => b.min.map((value, axis) => planes[axis].indexOf(value)))
  if (new Set(cells.map(cell => cell.join(','))).size !== bounds.length || bounds.some((b, i) => b.max.some((value, axis) => planes[axis][cells[i][axis] + 1] !== value))) throw new Error('Grid compartments need aligned matching full faces.')
  const sharedFaces = cells.map(cell => cell.map((value, axis) => Number(value > 0) + Number(value < sizes[axis] - 1)))
  const sharedWalls = sharedFaces.reduce((total, faces) => total + faces.reduce((sum, n) => sum + n, 0), 0) / 2
  const crossings = axes.reduce((n, axis) => n * (sizes[axis] - 1), 1)
  return { planes, sizes, axes, cells, sharedFaces, sharedWalls, crossings, connectionCount: 12 * bounds.length - crossings }
}

export function solveCuboidGrid(bounds: readonly ObjectBounds[], thickness: number): Project {
  const layout = cuboidGridLayout(bounds)
  if (layout.connectionCount > 400) throw new Error('Projects support up to 400 connections.')
  if (!Number.isFinite(thickness) || thickness < 18 || thickness > 19) throw new Error('Shared compartment walls require 18–19 mm stock for T and cross connectors.')
  const cubes = bounds.map((b, i) => {
    const min = b.min.map((value, axis) => value - (layout.cells[i][axis] > 0 ? thickness / 2 : 0))
    const max = b.max.map((value, axis) => value + (layout.cells[i][axis] < layout.sizes[axis] - 1 ? thickness / 2 : 0))
    const [width, height, depth] = max.map((value, axis) => value - min[axis])
    const cube = solveCuboid({ width, height, depth, thickness })
    const delta = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
    return { ...cube, panels: cube.panels.map(panel => ({ ...panel, position: panel.position.map((value, axis) => value + delta[axis]) as Vec3 })) }
  })
  const removed = new Map<string, string>(), dividers = new Set<string>()
  for (let i = 0; i < cubes.length; i++) for (const axis of layout.axes) {
    const next = layout.cells.findIndex(cell => cell.every((value, a) => value === layout.cells[i][a] + Number(a === axis)))
    if (next < 0) continue
    const divider = cubes[i].panels[axis * 2 + 1]
    removed.set(cubes[next].panels[axis * 2].id, divider.id); dividers.add(divider.id)
  }
  const remap = (id: string) => removed.get(id) ?? id
  const required = cubes.flatMap(cube => cube.connections.map(c => [remap(c.parentId), remap(c.childId)]))
  const panels = cubes.flatMap(cube => cube.panels.filter(panel => !removed.has(panel.id))).map(panel => dividers.has(panel.id) ? { ...panel, name: 'Shared divider' } : panel)
  const project = autoConnect({ version: 1, name: 'Grid compartments', panels, connections: [] }).project
  const hardware = getPhysicalConnectors(project)
  const groups = hardware.map(piece => {
    const id = piece.connection.id.replace(/:\d+$/, '')
    return { id, type: piece.type, members: new Set(project.connections.filter(c => c.id.replace(/:\d+$/, '') === id).flatMap(c => [c.parentId, c.childId])) }
  })
  if (required.some(pair => !groups.some(group => pair.every(id => group.members.has(id))))) throw new Error('Cannot fit every required grid compartment joint.')
  const frameIds = new Set(cubes.flatMap(cube => layout.axes.flatMap(axis => [remap(cube.panels[axis * 2].id), remap(cube.panels[axis * 2 + 1].id)])))
  const frameGroups = groups.filter(g => [...g.members].every(id => frameIds.has(id)))
  if (new Set(frameGroups.filter(g => g.type === 'cross' && g.members.size === 4).map(g => g.id)).size !== layout.crossings) throw new Error('Every grid intersection needs a complete cross joint.')
  const boundaryJoints = 2 * layout.axes.reduce((n, axis) => n + layout.sizes[axis] - 1, 0)
  if (new Set(frameGroups.filter(g => g.type === 't' && g.members.size === 3).map(g => g.id)).size !== boundaryJoints) throw new Error('The grid boundary needs complete T joints.')
  if (project.connections.length !== layout.connectionCount) throw new Error('The grid has an unexpected joint layout.')
  if (project.panels.length !== 6 * cubes.length - layout.sharedWalls) throw new Error('The grid has an unexpected panel layout.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('The grid hardware does not have enough clearance.')
  const actual = getProjectBounds(resolvePanels(project))
  if ([0, 1, 2].some(axis => Math.abs(actual.min[axis] - layout.planes[axis][0]) > 1e-5 || Math.abs(actual.max[axis] - layout.planes[axis].at(-1)!) > 1e-5)) throw new Error('Grid conversion changed the outside envelope.')
  return project
}
