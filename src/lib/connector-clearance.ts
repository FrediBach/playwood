import { Euler, Quaternion, Vector3 } from 'three'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
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
      if (Math.abs(distance) >= reach) return null
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
 * miss at perpendicular rails, without loading rendering meshes in the domain. */
export function fitAddedConnectorClearance(original: Project, candidate: Project): Project {
  const retained = new Set(getPhysicalConnectors(original).map(piece => piece.id))
  const pieces = getPhysicalConnectors(candidate)
  if (pieces.every(piece => retained.has(piece.id))) return candidate
  const panels = resolvePanels(candidate).map(panel => panel.visible ? panel : { ...panel, visible: true })
  const installed = pieces.map(piece => {
    const rail = getConnectorRail(piece.connection, panels, candidate.connections)
    if (!rail?.placements[piece.index]) throw new Error('An added connector has no usable shared edge.')
    const placement = rail.placements[piece.index]
    return { piece, rail, tangent: new Vector3(...rail.tangent),
      preferred: connectorSlide(rail, piece.index, candidate.connectorOverrides?.[piece.id]?.slide),
      bodies: bodies(piece.type, new Vector3(...placement.position), placement.rotation) }
  })
  const occupied = installed.filter(item => retained.has(item.piece.id)).flatMap(item => item.bodies.map(body => ({
    ...body, center: body.center.clone().addScaledVector(item.tangent, item.preferred),
  })))
  // Reserve the copied frame corners before fitting its perpendicular divider
  // seams. Stable ordering also keeps repeated previews deterministic.
  const added = installed.filter(item => !retained.has(item.piece.id))
    .sort((a, b) => Number(a.piece.connection.type !== '90') - Number(b.piece.connection.type !== '90'))
  let overrides = candidate.connectorOverrides
  for (const item of added) {
    const { piece, rail, tangent, preferred } = item
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
    const slide = intervals.map(([lower, upper]) => Math.max(lower, Math.min(upper, preferred)))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0]
    if (slide === undefined) throw new ConnectorClearanceError(piece.connection.id)
    if (Math.abs(slide - preferred) > EPSILON) overrides = { ...overrides,
      [piece.id]: { ...overrides?.[piece.id], slide } }
    occupied.push(...item.bodies.map(body => ({ ...body, center: body.center.clone().addScaledVector(tangent, slide) })))
  }
  return overrides === candidate.connectorOverrides ? candidate : { ...candidate, connectorOverrides: overrides }
}
