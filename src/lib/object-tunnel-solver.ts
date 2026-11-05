import { Euler, Matrix4, Vector3 } from 'three'
import { solveCuboid } from './object-solver'
import { connectClosingPanel } from './closure-connectors'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getPhysicalConnectors } from './connector-selection'
import { assertAddedHardwarePanelClearance, overlappingConnectorIds } from './connector-clearance'
import { createPanel, getProjectBounds, resolvePanels, validateProject } from './model'
import type { ObjectRecess, ObjectTunnel } from './object-tunnel'
import type { ObjectBounds } from './object-geometry'
import type { Project, Vec3 } from './types'

/** A rectangular tunnel uses two four-panel rims and four rectangular pieces per closing face. */
export function solveObjectTunnel(tunnel: ObjectTunnel, thickness: number): Project {
  return solveRectangularOpening(tunnel, thickness)
}

export function solveObjectRecess(recess: ObjectRecess, thickness: number): Project {
  if (recess.entry !== 0 && recess.entry !== 1) throw new Error('Choose one entry face for the rectangular recess.')
  return solveRectangularOpening(recess, thickness, recess.entry)
}

function solveRectangularOpening(tunnel: ObjectTunnel, thickness: number, entry?: 0 | 1): Project {
  const { axis, outer, opening } = tunnel, u = (axis + 1) % 3, v = (axis + 2) % 3
  if (![0, 1, 2].includes(axis) || [0, 1, 2].some(i => !Number.isFinite(outer.min[i] + outer.max[i] + opening.min[i] + opening.max[i]) || outer.max[i] <= outer.min[i] || opening.max[i] <= opening.min[i]
    || (i === axis ? entry === undefined ? opening.min[i] !== outer.min[i] || opening.max[i] !== outer.max[i]
      : entry === 0 ? opening.min[i] !== outer.min[i] || opening.max[i] >= outer.max[i] : opening.max[i] !== outer.max[i] || opening.min[i] <= outer.min[i]
      : opening.min[i] <= outer.min[i] || opening.max[i] >= outer.max[i]))) throw new Error('A rectangular opening must match its entry face and stay strictly inside the other faces (or exit through the opposite face for a through-opening).')
  const seat = CONNECTOR_PROFILES['90'].seat
  const frame = (bounds: ObjectBounds, inner: boolean) => {
    const min = bounds.min.map((value, i) => value - (inner && (i !== axis || entry === 1) ? thickness : 0))
    const max = bounds.max.map((value, i) => value + (inner && (i !== axis || entry === 0) ? thickness : 0))
    const [width, height, depth] = max.map((value, i) => value - min[i])
    const cube = solveCuboid({ width, height, depth, thickness })
    const delta = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
    const removed = new Set(cube.panels.filter((_, index) => Math.floor(index / 2) === axis && (entry === undefined || index % 2 === entry)).map(p => p.id))
    const panels = resolvePanels(cube).filter(p => !removed.has(p.id)).map(p => ({ ...p, name: `${inner ? entry === undefined ? 'Tunnel' : 'Recess' : 'Outer'} ${p.name}`, position: p.position.map((value, i) => value + delta[i]) as Vec3 }))
    const connections = cube.connections.filter(c => !removed.has(c.parentId) && !removed.has(c.childId))
    const retained = new Set(getPhysicalConnectors({ connections }).map(piece => piece.id))
    const connectorOverrides = Object.fromEntries(Object.entries(cube.connectorOverrides ?? {}).filter(([id]) => retained.has(id)))
    return { ...cube, panels, connections, connectorOverrides, faces: cube.panels.map(p => p.id) }
  }
  const outside = frame(outer, false), inside = frame(opening, true)
  let project: Project = { version: 1, name: entry === undefined ? 'Rectangular tunnel' : 'Rectangular recess', panels: [...outside.panels, ...inside.panels], connections: [...outside.connections, ...inside.connections], connectorOverrides: { ...outside.connectorOverrides, ...inside.connectorOverrides } }
  assertAddedHardwarePanelClearance(outside, project)
  const required: [string, string][] = project.connections.map(c => [c.parentId, c.childId])
  const rotation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().setComponent(u, 1), new Vector3().setComponent(v, 1), new Vector3().setComponent(axis, 1)))
  const lowU = outer.min[u] + thickness / 2 + seat, highU = outer.max[u] - thickness / 2 - seat
  const lowV = outer.min[v] + thickness / 2 + seat, highV = outer.max[v] - thickness / 2 - seat
  const holeLowU = opening.min[u] - thickness / 2 - seat, holeHighU = opening.max[u] + thickness / 2 + seat
  const holeLowV = opening.min[v] - thickness / 2 - seat, holeHighV = opening.max[v] + thickness / 2 + seat
  const rectangles = [
    { min: [lowU, lowV], max: [holeLowU, highV], walls: [outside.faces[u * 2], outside.faces[v * 2], outside.faces[v * 2 + 1], inside.faces[u * 2]] },
    { min: [holeHighU, lowV], max: [highU, highV], walls: [outside.faces[u * 2 + 1], outside.faces[v * 2], outside.faces[v * 2 + 1], inside.faces[u * 2 + 1]] },
    { min: [holeLowU, lowV], max: [holeHighU, holeLowV], walls: [outside.faces[v * 2], inside.faces[v * 2]] },
    { min: [holeLowU, holeHighV], max: [holeHighU, highV], walls: [outside.faces[v * 2 + 1], inside.faces[v * 2 + 1]] },
  ]
  for (const face of entry === undefined ? [0, 1] : [entry]) for (const [index, rect] of rectangles.entries()) {
    const width = rect.max[0] - rect.min[0], height = rect.max[1] - rect.min[1]
    if ([width, height].some(value => !Number.isFinite(value) || value < 40 || value > 4000)) throw new Error('The opening leaves insufficient closing-panel cuts after connector clearances.')
    const position: Vec3 = [0, 0, 0]
    position[u] = (rect.min[0] + rect.max[0]) / 2; position[v] = (rect.min[1] + rect.max[1]) / 2
    position[axis] = face ? outer.max[axis] - thickness / 2 : outer.min[axis] + thickness / 2
    const panel = createPanel({ name: `${entry === undefined ? 'Tunnel' : 'Recess'} closing face ${face + 1}.${index + 1}`, width, height, thickness, position, rotation: [rotation.x, rotation.y, rotation.z] })
    project = connectClosingPanel(project, panel, rect.walls)
    required.push(...rect.walls.map(id => [id, panel.id] as [string, string]))
  }
  const hardware = getPhysicalConnectors(project)
  if (required.some(([a, b]) => !hardware.some(({ connection: c }) => c.type === '90' && (c.parentId === a && c.childId === b || c.parentId === b && c.childId === a)))) throw new Error('Cannot fit every opening wall and closing-piece joint.')
  if (project.panels.length !== (entry === undefined ? 16 : 14) || project.connections.length !== (entry === undefined ? 32 : 28)) throw new Error('The opening construction is incomplete.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('The opening hardware does not have enough clearance.')
  const actual = getProjectBounds(resolvePanels(project))
  if ([0, 1, 2].some(i => Math.abs(actual.min[i] - outer.min[i]) > 1e-5 || Math.abs(actual.max[i] - outer.max[i]) > 1e-5)) throw new Error('Opening conversion changed the outside envelope.')
  return project
}
