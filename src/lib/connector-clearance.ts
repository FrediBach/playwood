import { Euler, Quaternion, Vector3 } from 'three'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import { assertNoNewTrofastIssues } from './trofast'
import type { ConnectorType, Project, Vec3 } from './types'

interface Body {
  center: Vector3
  axes: Vector3[]
  halfSize: Vec3
}

const EPSILON = 1e-7
const CLEARANCE = 0.1

export class ConnectorClearanceError extends Error {
  constructor(readonly connectionId: string) {
    super('There is not enough room to place the added connectors without overlapping hardware.')
    this.name = 'ConnectorClearanceError'
  }
}

function bodies(type: ConnectorType, position: Vector3, rotation: Vec3): Body[] {
  const orientation = new Quaternion().setFromEuler(new Euler(...rotation))
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
    .map(axis => axis.applyQuaternion(orientation))
  return CONNECTOR_LOCAL_BOUNDS[type].map(({ min, max }) => ({
    center: new Vector3(...min).add(new Vector3(...max)).multiplyScalar(.5).applyQuaternion(orientation).add(position),
    axes, halfSize: max.map((value, axis) => (value - min[axis]) / 2) as Vec3,
  }))
}

/** Sweep one CAD-part envelope along a rail. Separating-axis inequalities give
 * the entire forbidden slide interval, including arbitrarily rotated seams. */
function blockedInterval(moving: Body, fixed: Body, tangent: Vector3): [number, number] | null {
  const axes = [...moving.axes, ...fixed.axes,
    ...moving.axes.flatMap(a => fixed.axes.map(b => new Vector3().crossVectors(a, b)))]
  const delta = fixed.center.clone().sub(moving.center)
  let lower = -Infinity, upper = Infinity
  for (const raw of axes) {
    if (raw.lengthSq() < EPSILON) continue
    const axis = raw.clone().normalize()
    const reach = moving.axes.reduce((sum, basis, i) => sum + Math.abs(axis.dot(basis)) * moving.halfSize[i], 0)
      + fixed.axes.reduce((sum, basis, i) => sum + Math.abs(axis.dot(basis)) * fixed.halfSize[i], 0) + CLEARANCE
    const distance = delta.dot(axis), speed = tangent.dot(axis)
    if (Math.abs(speed) < EPSILON) {
      // Fitted pieces can sit exactly at the clearance boundary. Use the same
      // tolerance as the moving-axis interval check when rechecking that pose.
      if (Math.abs(distance) >= reach - EPSILON) return null
      continue
    }
    const a = (distance - reach) / speed, b = (distance + reach) / speed
    lower = Math.max(lower, Math.min(a, b))
    upper = Math.min(upper, Math.max(a, b))
    if (lower >= upper) return null
  }
  return [lower, upper]
}

/** Fit only newly installed hardware after a construction operation.
 * Retained pieces are fixed obstacles; no geometry or existing overrides move.
 * Conservative CAD-part envelopes avoid the interleaving that center distances
 * miss at perpendicular rails, without loading rendering meshes in the domain.
 * Optional orders reuse the repair search: narrow rails, reverse, or either end. */
export function fitAddedConnectorClearance(original: Project, candidate: Project, order: 0 | 1 | 2 | 3 | 4 = 0): Project {
  const retained = new Set(getPhysicalConnectors(original).map(piece => piece.id))
  return fitConnectorClearance(candidate, new Set(getPhysicalConnectors(candidate).filter(piece => !retained.has(piece.id)).map(piece => piece.id)), order)
}

function installedBodies(candidate: Project) {
  const panels = resolvePanels(candidate).map(panel => ({ ...panel, visible: true }))
  return getPhysicalConnectors(candidate).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, candidate.connections)
    if (!rail?.placements[piece.index]) throw new Error('A connector has no usable shared edge.')
    const placement = rail.placements[piece.index]
    return { piece, rail, tangent: new Vector3(...rail.tangent),
      preferred: connectorSlide(rail, piece.index, candidate.connectorOverrides?.[piece.id]?.slide),
      bodies: bodies(piece.type, new Vector3(...placement.position), placement.rotation) }
  })
}

export function overlappingConnectorIds(project: Project): Set<string> {
  const installed = installedBodies(project).map(item => ({ ...item,
    bodies: item.bodies.map(body => ({ ...body, center: body.center.clone().addScaledVector(item.tangent, item.preferred) })) }))
  const result = new Set<string>()
  installed.forEach((item, index) => {
    for (const other of installed.slice(index + 1)) {
      if (item.bodies.some(a => other.bodies.some(b => {
        const interval = blockedInterval(a, b, item.tangent)
        return interval && interval[0] < -EPSILON && interval[1] > EPSILON
      }))) { result.add(item.piece.id); result.add(other.piece.id) }
    }
  })
  return result
}

/** Check cross-boundary hardware/stock collisions without treating a clamp's own boards as obstacles. */
export function assertAddedHardwarePanelClearance(original: Project, candidate: Project): void {
  const existingPanels = new Set(original.panels.map(panel => panel.id))
  const existingHardware = new Set(getPhysicalConnectors(original).map(piece => piece.id))
  const panels = resolvePanels(candidate).map(panel => {
    const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
    return { panel, body: { center: new Vector3(...panel.position),
      axes: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(rotation)),
      halfSize: [panel.width / 2, panel.height / 2, panel.thickness / 2] as Vec3 } }
  })
  for (const item of installedBodies(candidate)) {
    const retained = existingHardware.has(item.piece.id)
    for (const { panel, body } of panels) {
      if (retained === existingPanels.has(panel.id)) continue
      if (item.bodies.some(part => blockedInterval({ ...part, center: part.center.clone().addScaledVector(item.tangent, item.preferred) }, body, new Vector3()))) {
        throw new Error(`Connector hardware overlaps ${panel.name}. Move the source box and try again.`)
      }
    }
  }
}

/** Only selected overlapping pieces may move. Retry alternate packing orders;
 * failure is atomic, and existing unselected overlaps do not block the repair. */
export function separateOverlappingConnectors(project: Project, ids: readonly string[]): Project {
  const overlaps = overlappingConnectorIds(project)
  const movable = new Set(ids.filter(id => overlaps.has(id)))
  if (!movable.size) return project
  for (const order of [0, 1, 2, 3, 4]) {
    try { return assertNoNewTrofastIssues(project, fitConnectorClearance(project, movable, order)) }
    catch { /* Try narrow rails first, then reverse, before leaving the source intact. */ }
  }
  throw new Error('Could not find room to separate all selected overlapping connectors. Select more neighboring connectors or make more space along the joints.')
}

function fitConnectorClearance(candidate: Project, movable: Set<string>, order = 0): Project {
  if (!movable.size) return candidate
  const installed = installedBodies(candidate)
  const occupied = installed.filter(item => !movable.has(item.piece.id)).flatMap(item => item.bodies.map(body => ({
    ...body, center: body.center.clone().addScaledVector(item.tangent, item.preferred),
  })))
  // Reserve the copied frame corners before fitting its perpendicular divider
  // seams. Stable ordering also keeps repeated previews deterministic.
  const added = installed.filter(item => movable.has(item.piece.id))
    .sort((a, b) => Number(a.piece.connection.type !== '90') - Number(b.piece.connection.type !== '90'))
  if (order === 1) added.sort((a, b) => (a.rail.upper - a.rail.lower) - (b.rail.upper - b.rail.lower))
  if (order === 2) added.reverse()
  let overrides = candidate.connectorOverrides
  for (const item of added) {
    const { piece, rail, tangent, preferred } = item
    if (rail.upper < rail.lower - EPSILON) throw new ConnectorClearanceError(piece.connection.id)
    let intervals: [number, number][] = [[rail.lower - rail.along[piece.index], rail.upper - rail.along[piece.index]]]
    for (const body of item.bodies) for (const other of occupied) {
      const blocked = blockedInterval(body, other, tangent)
      if (!blocked) continue
      intervals = intervals.flatMap(([lower, upper]): [number, number][] => {
        if (blocked[1] <= lower || blocked[0] >= upper) return [[lower, upper]]
        return [...(blocked[0] >= lower ? [[lower, blocked[0]] as [number, number]] : []),
          ...(blocked[1] <= upper ? [[blocked[1], upper] as [number, number]] : [])]
      })
    }
    const slide = intervals.map(([lower, upper]) => order === 3 ? lower : order === 4 ? upper : Math.max(lower, Math.min(upper, preferred)))
      .sort((a, b) => order === 3 ? a - b : order === 4 ? b - a : Math.abs(a - preferred) - Math.abs(b - preferred))[0]
    if (slide === undefined) throw new ConnectorClearanceError(piece.connection.id)
    if (Math.abs(slide - preferred) > EPSILON) overrides = { ...overrides,
      [piece.id]: { ...overrides?.[piece.id], slide } }
    occupied.push(...item.bodies.map(body => ({ ...body, center: body.center.clone().addScaledVector(tangent, slide) })))
  }
  return overrides === candidate.connectorOverrides ? candidate : { ...candidate, connectorOverrides: overrides }
}
