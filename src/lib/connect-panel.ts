import { Box3, Euler, Matrix4, Quaternion, Triangle, Vector3 } from 'three'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, validateProject } from './model'
import { prepareJointUpgrade } from './prepare-joint-upgrade'
import { getConnectorGeometry } from './connector-geometry'
import type { Connection, Panel, Project } from './types'

const tolerance = 0.05
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const branchIndex = (connection: Connection) => Number(connection.id.match(/:(\d+)$/)?.[1] ?? 0)
const rotation = (panel: Pick<Panel, 'rotation'>) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
type Piece = ReturnType<typeof getPhysicalConnectors>[number]
interface Opening {
  piece: Piece
  branches: Connection[]
  branch: number
  position: Vector3
  edge: Vector3
  direction: Vector3
  tangent: Vector3
}

function openings(project: Project, panels: Panel[], piece: Piece): Opening[] {
  if (piece.type !== 't' && piece.type !== 'cross') return []
  const source = project.connections.filter(c => jointId(c) === jointId(piece.connection))
  if (!['90', 't', 'cross'].includes(piece.connection.type)) return []
  const members = panels.filter(p => source.some(c => c.parentId === p.id || c.childId === p.id))
  // The current shape solver only guarantees an accessible straight stock edge.
  if (members.some(p => !p.visible || p.customOutline || p.thickness < 18 || p.thickness > 19)
    || source.some(c => c.inset !== 0 || c.side === 'front' || c.side === 'back')) return []
  const rail = getConnectorRail(piece.connection, panels, project.connections)
  if (!rail || rail.upper < rail.lower - tolerance) return []
  const placement = rail.placements[piece.index]
  const frame = rotation(placement)
  const position = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
  const id = crypto.randomUUID()
  const branches = source.map((c): Connection => {
    let branch = branchIndex(c)
    if (c.type === 't' && piece.type === 'cross' && branch === 1) branch = 2
    if (c.type === 'cross' && piece.type === 't' && branch === 2) branch = 1
    return { ...c, id: `${id}:${branch}`, type: piece.type, color: piece.color, count: branch === 0 ? 1 : 0, role: 'support', partial: true }
  })
  // A type override is only usable if every already occupied slot still fits.
  if (validateProject({ ...project, panels: members, connections: branches }).some(issue => issue.severity === 'error')) return []
  const occupied = new Set(branches.map(branchIndex))
  const indices = piece.type === 't' ? [0, 1] : [0, 1, 2]
  return indices.filter(branch => !occupied.has(branch)).map(branch => {
    const direction = (piece.type === 'cross' && branch === 1 ? new Vector3(0, 0, -1) : new Vector3(-1, 0, 0)).applyQuaternion(frame)
    return { piece, branches, branch, position, direction,
      edge: position.clone().addScaledVector(direction, CONNECTOR_PROFILES[piece.type].seat),
      tangent: new Vector3(0, 1, 0).applyQuaternion(frame) }
  })
}

/** Fit a rectangle to the shoulders and full 40 mm grip of every opening.
 * Opposed openings determine the span. An unbounded edge extends 360 mm.
 */
function fitRectangle(options: Opening[][], first: Opening, source: Panel) {
  const x = first.direction, y = first.tangent, normal = x.clone().cross(y).normalize()
  const origin = first.edge
  const chosen: Opening[] = []
  const bounds = [{ low: -Infinity, high: Infinity, requiredLow: Infinity, requiredHigh: -Infinity },
    { low: -Infinity, high: Infinity, requiredLow: Infinity, requiredHigh: -Infinity }]
  for (const choices of options) {
    const opening = choices.find(choice => Math.abs(choice.edge.clone().sub(origin).dot(normal)) < tolerance
      && Math.abs(choice.direction.dot(normal)) < 1e-6 && Math.abs(choice.tangent.dot(normal)) < 1e-6
      && Math.max(Math.abs(choice.direction.dot(x)), Math.abs(choice.direction.dot(y))) > 0.999999)
    if (!opening) return null
    const delta = opening.edge.clone().sub(origin)
    const coordinates = [delta.dot(x), delta.dot(y)]
    const axis = Math.abs(opening.direction.dot(x)) > 0.999999 ? 0 : 1
    const bound = bounds[axis]
    const key = opening.direction.dot(axis === 0 ? x : y) > 0 ? 'low' : 'high'
    if (Number.isFinite(bound[key]) && Math.abs(bound[key] - coordinates[axis]) > tolerance) return null
    bound[key] = coordinates[axis]
    const along = bounds[1 - axis]
    along.requiredLow = Math.min(along.requiredLow, coordinates[1 - axis] - 20)
    along.requiredHigh = Math.max(along.requiredHigh, coordinates[1 - axis] + 20)
    chosen.push(opening)
  }
  for (const bound of bounds) {
    if (!Number.isFinite(bound.low) && !Number.isFinite(bound.high)) {
      bound.low = bound.requiredLow; bound.high = bound.requiredHigh
    } else if (!Number.isFinite(bound.high)) bound.high = Math.max(bound.low + 360, bound.requiredHigh)
    else if (!Number.isFinite(bound.low)) bound.low = Math.min(bound.high - 360, bound.requiredLow)
    if (bound.high - bound.low < 40 - 1e-7 || bound.high - bound.low > 4000
      || bound.requiredLow < bound.low - tolerance || bound.requiredHigh > bound.high + tolerance) return null
  }
  const euler = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(x, y, normal))
  const panel = createPanel({ name: 'Connecting panel', material: source.material, color: source.color, thickness: source.thickness,
    ...(source.finishCoverage === undefined ? {} : { finishCoverage: source.finishCoverage }),
    width: Math.max(40, bounds[0].high - bounds[0].low), height: Math.max(40, bounds[1].high - bounds[1].low),
    position: origin.clone().addScaledVector(x, (bounds[0].low + bounds[0].high) / 2).addScaledVector(y, (bounds[1].low + bounds[1].high) / 2).toArray(),
    rotation: [euler.x, euler.y, euler.z] })
  return { panel, chosen }
}

function connectOpening(opening: Opening, panel: Panel, panels: Panel[]) {
  const first = opening.branches.find(c => branchIndex(c) === 0)!
  const parent = panels.find(p => p.id === first.parentId)!
  const delta = new Vector3(...panel.position).sub(new Vector3(...parent.position)).applyQuaternion(rotation(parent).invert())
  const horizontal = first.side === 'top' || first.side === 'bottom'
  const parentTangent = new Vector3(horizontal ? 1 : 0, horizontal ? 0 : 1, 0).applyQuaternion(rotation(parent))
  const panelX = new Vector3(1, 0, 0).applyQuaternion(rotation(panel))
  const widthAlongSeam = Math.abs(panelX.dot(parentTangent)) > 0.999999
  const connection: Connection = { ...first, id: `${jointId(first)}:${opening.branch}`, childId: panel.id, count: 0,
    offset: horizontal ? delta.x : delta.y, quarterTurn: horizontal !== widthAlongSeam }
  const branches = [...opening.branches, connection].sort((a, b) => branchIndex(a) - branchIndex(b))
  const rail = getConnectorRail(first, [...panels, panel], branches)
  if (!rail || rail.upper < rail.lower - tolerance) return null
  const displacement = opening.position.clone().sub(new Vector3(...rail.placements[0].position))
  const tangent = new Vector3(...rail.tangent)
  const slide = displacement.dot(tangent)
  if (displacement.addScaledVector(tangent, -slide).length() > tolerance
    || Math.abs(connectorSlide(rail, 0, slide) - slide) > tolerance) return null
  return { branches, id: connectorId(first.id, 0), slide }
}

function hitsOtherHardware(project: Project, panels: Panel[], selected: Set<string>, panel: Panel) {
  // Check the supplied CAD surfaces, including hidden hardware. A bounding box
  // alone would incorrectly block a panel passing through an unused T slot.
  const visiblePanels = panels.map(p => ({ ...p, visible: true }))
  const inverse = new Matrix4().compose(new Vector3(...panel.position), rotation(panel), new Vector3(1, 1, 1)).invert()
  const half = new Vector3(panel.width / 2 - 0.05, panel.height / 2 - 0.05, panel.thickness / 2 - 0.05)
  const box = new Box3(half.clone().negate(), half)
  const triangle = new Triangle()
  return getPhysicalConnectors(project).filter(piece => !selected.has(piece.id)).some(piece => {
    const rail = getConnectorRail(piece.connection, visiblePanels, project.connections)
    if (!rail) return false
    const placement = rail.placements[piece.index]
    const position = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
    const transform = inverse.clone().multiply(new Matrix4().compose(position, rotation(placement), new Vector3(1000, 1000, 1000)))
    return getConnectorGeometry(piece.type).some(part => {
      if (!part.geometry.boundingBox!.clone().applyMatrix4(transform).intersectsBox(box)) return false
      const vertices = part.geometry.getAttribute('position')
      for (let i = 0; i < vertices.count; i += 3) {
        triangle.a.fromBufferAttribute(vertices, i).applyMatrix4(transform)
        triangle.b.fromBufferAttribute(vertices, i + 1).applyMatrix4(transform)
        triangle.c.fromBufferAttribute(vertices, i + 2).applyMatrix4(transform)
        if (box.intersectsTriangle(triangle)) return true
      }
      return false
    })
  })
}

/** Add one panel to all selected physical pieces, without moving existing parts.
 * Original layout constraints stay in place; the selected hardware is replaced
 * by one-piece support joints so unselected pieces retain their exact rails.
 */
export function connectSelectedConnectors(project: Project, ids: readonly string[]) {
  const wanted = new Set(ids)
  const pieces = getPhysicalConnectors(project).filter(piece => wanted.has(piece.id))
  if (pieces.length < 2 || pieces.length !== wanted.size) throw new Error('Select at least two existing connectors to connect with a panel.')
  if (project.panels.length >= 200) throw new Error('Projects support up to 200 panels.')
  const panels = resolvePanels(project)
  const options = pieces.map(piece => openings(project, panels, piece))
  if (options.some(choices => !choices.length)) throw new Error('Each selected connector needs a free, compatible opening. Use T or cross connectors on straight, visible 18–19 mm panel edges.')
  const previousErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  for (const first of options[0]) {
    const source = panels.find(p => p.id === first.piece.connection.parentId)!
    const fit = fitRectangle(options, first, source)
    if (!fit) continue
    if (fit.panel.position.some(value => Math.abs(value) > 100000) || hitsOtherHardware(project, panels, wanted, fit.panel)) continue
    const fitted = fit.chosen.map(opening => connectOpening(opening, fit.panel, panels))
    if (fitted.some(item => !item)) continue
    const addedConnections = fitted.flatMap(item => item!.branches)
    if (project.connections.length + addedConnections.length > 400) throw new Error('Projects support up to 400 connections. Remove unused joints first.')
    const replaced = project.connections.filter(c => pieces.some(piece => jointId(piece.connection) === jointId(c)))
    const baked = prepareJointUpgrade(project, replaced)
    const connectorOverrides = { ...baked.project.connectorOverrides }
    const remap = new Map<string, string>()
    pieces.forEach((piece, index) => {
      const item = fitted[index]!
      connectorOverrides[piece.id] = { ...connectorOverrides[piece.id], removed: true }
      connectorOverrides[item.id] = { slide: item.slide }
      remap.set(piece.id, item.id)
    })
    const next: Project = { ...baked.project, panels: [...baked.project.panels, fit.panel],
      connections: [...baked.project.connections, ...addedConnections], connectorOverrides,
      ...(project.connectorOrder ? { connectorOrder: project.connectorOrder.map(id => remap.get(id) ?? id) } : {}),
      ...(project.listGroups ? { listGroups: project.listGroups.map(group => group.kind === 'connectors'
        ? { ...group, itemIds: group.itemIds.map(id => remap.get(id) ?? id) } : group) } : {}) }
    if (validateProject(next).some(issue => (issue.severity === 'error' && !previousErrors.has(issue.id))
      || (issue.id.startsWith('collision-') && issue.panelIds.includes(fit.panel.id)))) continue
    return { project: next, panelId: fit.panel.id, disassembledNames: baked.disassembledNames }
  }
  throw new Error('No panel fits all selected openings. Check their alignment, spacing, and clearance from other panels.')
}

export function getConnectorPanelFit(project: Project, ids: readonly string[]) {
  try { return { result: connectSelectedConnectors(project, ids), reason: '' } }
  catch (error) { return { result: undefined, reason: error instanceof Error ? error.message : 'These connectors cannot hold a panel.' } }
}
