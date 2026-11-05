import { getConnectorMaterial } from './connector-options'
import { solveObjectPrism } from './object-prism-solver'
import { cuboidGridLayout, solveCuboidGrid } from './object-grid'
import { solveCuboidCompartments } from './object-compartments'
import { evaluateConstructionObjects, type ObjectSurface } from './object-geometry'
import { copyConstructionObjects } from './construction-objects'
import { solveCuboid } from './object-solver'
import { getPhysicalConnectors } from './connector-selection'
import { assertAddedHardwarePanelClearance, overlappingConnectorIds } from './connector-clearance'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { assertNoNewTrofastIssues } from './trofast'
import { getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import type { ConnectorMaterial, Material, Project, Vec3 } from './types'

export interface ObjectConversionOptions {
  /** Restrict newly generated panels; omitted preserves the default profile support. */
  rectangularOnly?: boolean;
  thickness: number;
  material: Material;
  color: string;
  finishCoverage: number;
  connectorColor: string;
  connectorMaterial: ConnectorMaterial;
}
export function objectConversionReason(project: Project, ids: readonly string[]): string | undefined {
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !project.constructionObjects?.roots.includes(id))) return 'Select complete top-level objects to convert.'
}

/** Separate roots retain compartment boundaries. Matching cuboid rows and rectangular grids share their dividing walls. */
function compartmentGroups(shapes: ObjectSurface[]) {
  const edgeContacts: [number, number][] = []
  const neighbors = shapes.map(() => [] as { index: number; axis: number }[])
  for (let a = 0; a < shapes.length; a++) for (let b = a + 1; b < shapes.length; b++) {
    const first = shapes[a].bounds!, second = shapes[b].bounds!
    const overlaps = [0, 1, 2].map(axis => Math.min(first.max[axis], second.max[axis]) - Math.max(first.min[axis], second.min[axis]))
    if (overlaps.some(value => value < -1e-6)) continue
    if (overlaps.every(value => value > 1e-6)) throw new Error('Selected object bounds overlap. Combine overlapping sources with a Boolean operation before converting.')
    const touching = overlaps.flatMap((value, axis) => Math.abs(value) <= 1e-6 ? [axis] : [])
    if (touching.length > 1) { edgeContacts.push([a, b]); continue }
    const axis = touching[0]
    if (touching.length !== 1 || !shapes[a].cuboid || !shapes[b].cuboid || [0, 1, 2].some(i => i !== axis && (Math.abs(first.min[i] - second.min[i]) > 1e-6 || Math.abs(first.max[i] - second.max[i]) > 1e-6))) throw new Error('Touching compartments need matching full cuboid faces. Separate them or combine them with a Boolean operation.')
    neighbors[a].push({ index: b, axis }); neighbors[b].push({ index: a, axis })
  }
  const visited = new Set<number>(), groups: { shapes: ObjectSurface[]; axis?: number; grid?: ReturnType<typeof cuboidGridLayout> }[] = []
  for (let start = 0; start < shapes.length; start++) {
    if (visited.has(start)) continue
    const queue = [start], indices: number[] = [], axes = new Set<number>()
    while (queue.length) {
      const index = queue.pop()!
      if (visited.has(index)) continue
      visited.add(index); indices.push(index)
      for (const neighbor of neighbors[index]) { axes.add(neighbor.axis); queue.push(neighbor.index) }
    }
    const axis = axes.values().next().value
    const members = indices.map(index => shapes[index])
    if (axis !== undefined) members.sort((a, b) => a.bounds!.min[axis] - b.bounds!.min[axis])
    const grid = axes.size > 1 ? cuboidGridLayout(members.map(shape => shape.bounds!)) : undefined
    groups.push({ shapes: members, axis, grid })
  }
  for (const [a, b] of edgeContacts) if (!groups.some(group => group.grid && group.shapes.includes(shapes[a]) && group.shapes.includes(shapes[b]))) throw new Error('Touching compartments need matching full cuboid faces or a complete rectangular grid. Edge/corner contacts alone cannot be converted.')
  return groups
}

/** One atomic candidate, retaining and hiding all sources without regeneration links. */
export function convertConstructionObject(source: Project, ids: readonly string[], options: ObjectConversionOptions) {
  const reason = objectConversionReason(source, ids)
  if (reason) throw new Error(reason)
  const selected = copyConstructionObjects(source, ids), selectedIds = new Set(ids)
  const evaluated = evaluateConstructionObjects({ ...selected, nodes: selected.nodes.map(node => selectedIds.has(node.id) ? { ...node, visible: true } : node) }, true)
  const sourceNames = new Map(selected.nodes.map(node => [node.id, node.name]))
  const names = new Map<string, string>()
  const shapes = evaluated.flatMap(shape => {
    const pieces = shape.solids?.length ? shape.solids : [shape]
    return pieces.map((piece, index) => {
      const id = JSON.stringify([shape.id, index])
      names.set(id, `${sourceNames.get(shape.id)}${pieces.length > 1 ? ` · Piece ${index + 1}` : ''}`)
      return { ...shape, ...piece, id }
    })
  })
  for (const shape of shapes) {
    if (!shape.bounds) throw new Error(`${names.get(shape.id)} has an empty result. Edit its Boolean operands before converting.`)
    if (!shape.cuboid && !shape.prism) throw new Error(`${names.get(shape.id)} is not a supported cuboid or common-depth profile with 6–12 edges. Cavities, tunnels, and changing-depth profiles are not supported yet.`)
  }
  const groups = compartmentGroups(shapes)
  const panelCount = groups.reduce((sum, group) => sum + (group.grid ? 6 * group.shapes.length - group.grid.sharedWalls : group.axis !== undefined ? 5 * group.shapes.length + 1 : group.shapes[0].prism ? group.shapes[0].prism!.outline.length + 2 : 6), 0)
  if (source.panels.length + panelCount > 200) throw new Error('Projects support up to 200 panels.')
  const connectionCount = groups.reduce((sum, group) => sum + (group.grid ? group.grid.connectionCount : group.axis !== undefined ? 12 * group.shapes.length : group.shapes[0].prism ? 3 * group.shapes[0].prism!.outline.length : 12), 0)
  if (source.connections.length + connectionCount > 400) throw new Error('Projects support up to 400 connections.')
  let generated: Project = { version: 1, name: 'Converted objects', panels: [], connections: [] }
  const compartments: { id: string; name: string; dimensions: Vec3; clearDimensions?: Vec3; sharedWall: boolean }[] = []
  for (const group of groups) {
    const shape = group.shapes[0], bounds = shape.bounds!
    const [width, height, depth] = bounds.max.map((v, axis) => v - bounds.min[axis])
    const shared = group.axis !== undefined
    const solved = group.grid ? solveCuboidGrid(group.shapes.map(shape => shape.bounds!), options.thickness) : shared ? solveCuboidCompartments(group.shapes.map(shape => shape.bounds!), group.axis!, options.thickness)
      : shape.prism ? solveObjectPrism(shape.prism, options.thickness, options.rectangularOnly) : solveCuboid({ width, height, depth, thickness: options.thickness })
    if (source.panels.length + generated.panels.length + solved.panels.length > 200) throw new Error('Projects support up to 200 panels.')
    if (source.connections.length + generated.connections.length + solved.connections.length > 400) throw new Error('Projects support up to 400 connections.')
    const delta: Vec3 = shared || shape.prism ? [0, 0, 0] : [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2]
    const name = group.shapes.map(shape => names.get(shape.id)).join(' + ').slice(0, 100)
    const next: Project = { ...generated,
      panels: [...generated.panels, ...solved.panels.map(panel => ({ ...panel, name: `${name} · ${panel.name}`, material: options.material, color: options.color, finishCoverage: options.finishCoverage,
        position: panel.position.map((v, axis) => v + delta[axis]) as Vec3 }))],
      connections: [...generated.connections, ...solved.connections.map(connection => ({ ...connection, color: options.connectorColor, material: getConnectorMaterial(connection.type, options.connectorMaterial) }))],
      connectorOverrides: { ...generated.connectorOverrides, ...solved.connectorOverrides },
    }
    assertAddedHardwarePanelClearance(generated, next)
    generated = next
    for (const [index, item] of group.shapes.entries()) {
      const sharedFaces = shared ? Number(index > 0) + Number(index < group.shapes.length - 1) : 0
      const dimensions = item.bounds!.max.map((value, axis) => value - item.bounds!.min[axis]) as Vec3
      compartments.push({ id: item.id, name: names.get(item.id)!, dimensions, sharedWall: shared,
        clearDimensions: item.cuboid ? dimensions.map((value, axis) => value - options.thickness * (2 - (group.grid ? group.grid.sharedFaces[index][axis] : axis === group.axis ? sharedFaces : 0) / 2)) as Vec3 : undefined })
    }
  }
  if (options.rectangularOnly && generated.panels.some(panel => panel.customOutline?.length)) throw new Error('This construction requires custom-shaped panels. Turn off Rectangular panels only or change the source shapes.')
  const panelIds = generated.panels.map(panel => panel.id), addedIds = new Set(panelIds)
  const candidate: Project = { ...source, panels: [...source.panels, ...generated.panels], connections: [...source.connections, ...generated.connections],
    connectorOverrides: { ...source.connectorOverrides, ...generated.connectorOverrides },
    constructionObjects: { ...source.constructionObjects!, nodes: source.constructionObjects!.nodes.map(node => selectedIds.has(node.id) ? { ...node, visible: false } : node) },
  }
  parseProject(candidate)
  const issue = validateProject(candidate).find(issue => issue.panelIds.some(id => addedIds.has(id)))
  if (issue) throw new Error(issue.message)
  const addedHardware = new Set(getPhysicalConnectors(generated).map(piece => piece.id))
  if ([...overlappingConnectorIds(candidate)].some(id => addedHardware.has(id))) throw new Error('The new connectors overlap other hardware. Separate the source objects and try again.')
  assertAddedHardwarePanelClearance(source, candidate)
  assertDesignConstraintEdit(source, candidate)
  assertNoNewTrofastIssues(source, candidate)
  const achieved = getProjectBounds(resolvePanels(generated))
  const min = [0, 1, 2].map(axis => Math.min(...shapes.map(shape => shape.bounds!.min[axis])))
  const max = [0, 1, 2].map(axis => Math.max(...shapes.map(shape => shape.bounds!.max[axis])))
  if (min.some((v, axis) => Math.abs(v - achieved.min[axis]) > 1e-5) || max.some((v, axis) => Math.abs(v - achieved.max[axis]) > 1e-5)) throw new Error('Conversion changed the requested outside dimensions.')
  return { project: candidate, panelIds, dimensions: max.map((value, axis) => value - min[axis]) as Vec3, hardwareCount: getPhysicalConnectors(generated).length, compartments, sharedWalls: groups.reduce((sum, group) => sum + (group.grid ? group.grid.sharedWalls : group.axis === undefined ? 0 : group.shapes.length - 1), 0) }
}
export type ObjectConversion = ReturnType<typeof convertConstructionObject>
