import { Euler, Quaternion, Vector3 } from 'three'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getOutlineError } from './panel-shape'
import type { Connection, Panel, Vec3 } from './types'

const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const tolerance = 0.1

export function outlineWorldPoints(panel: Panel): Vector3[] {
  const turn = rotation(panel), center = new Vector3(...panel.position)
  return (panel.customOutline ?? []).map(point => new Vector3((point.x - 0.5) * panel.width, (0.5 - point.y) * panel.height, 0).applyQuaternion(turn).add(center))
}

/** A rim's outward edge and the two CAD shoulders, in world millimeters. */
export function outlineJointFrame(parent: Panel, connection: Connection) {
  const horizontal = connection.side === 'top' || connection.side === 'bottom'
  const turn = rotation(parent)
  const tangent = new Vector3(horizontal ? 1 : 0, horizontal ? 0 : 1, 0).applyQuaternion(turn)
  const normal = new Vector3(connection.side === 'left' ? -1 : connection.side === 'right' ? 1 : 0,
    connection.side === 'bottom' ? -1 : connection.side === 'top' ? 1 : 0, 0).applyQuaternion(turn)
  const opposite = connection.type === 't' && Number(connection.id.match(/:(\d+)$/)?.[1] ?? 0) === 1
  const inward = new Vector3(0, 0, (connection.flip ? -1 : 1) * (opposite ? -1 : 1)).applyQuaternion(turn)
  const seat = CONNECTOR_PROFILES[connection.type].seat
  const point = new Vector3(...parent.position).addScaledVector(normal, (horizontal ? parent.height : parent.width) / 2 + seat).addScaledVector(inward, seat)
  return { point, tangent, normal, inward, length: horizontal ? parent.width : parent.height }
}

export function outlineConnectionAligned(parent: Panel, child: Panel, connection: Connection): boolean {
  const index = connection.outlineEdge, points = outlineWorldPoints(child)
  if (index === undefined || !Number.isInteger(index) || index < 0 || index >= points.length
    || connection.role !== 'support' || (connection.type !== '90' && connection.type !== 't') || parent.customOutline
    || connection.side === 'front' || connection.side === 'back' || connection.inset !== 0 || connection.quarterTurn || connection.partial) return false
  const { point, tangent, normal, inward } = outlineJointFrame(parent, connection)
  const first = points[index], last = points[(index + 1) % points.length]
  const edge = last.clone().sub(first)
  if (edge.length() < tolerance || Math.abs(edge.normalize().dot(tangent)) < 0.99999) return false
  if ([first, last].some(vertex => {
    const delta = vertex.clone().sub(point)
    return Math.abs(delta.dot(normal)) > tolerance || Math.abs(delta.dot(inward)) > tolerance
  })) return false
  const childNormal = new Vector3(0, 0, 1).applyQuaternion(rotation(child))
  if (Math.abs(childNormal.dot(normal)) < 0.99999) return false
  const area = child.customOutline!.reduce((sum, vertex, i, outline) => sum + vertex.x * outline[(i + 1) % outline.length].y - vertex.y * outline[(i + 1) % outline.length].x, 0)
  // Normalized outline Y runs downward; reverse its winding for local XY.
  return childNormal.cross(edge).multiplyScalar(-Math.sign(area)).dot(inward) > 0.99999
}

/** Rebuild fully constrained infills after the surrounding ordinary panels solve.
 * Edge indices retain their identity; no saved world frame or duplicate IDs needed.
 */
export function refitOutlineClosures(panels: readonly Panel[], connections: readonly Connection[]): Panel[] {
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  return panels.map(panel => {
    const joints = connections.filter(connection => connection.childId === panel.id && connection.outlineEdge !== undefined)
    const outline = panel.customOutline
    if (!outline || new Set(joints.map(connection => connection.outlineEdge)).size !== outline.length) return panel
    const inverse = rotation(panel).invert(), origin = new Vector3(...panel.position)
    const lines = outline.map((_, index) => {
      const joint = joints.find(connection => connection.outlineEdge === index)!
      const parent = byId.get(joint.parentId)
      if (!parent) throw new Error('A fitted outline is missing a surrounding panel.')
      const frame = outlineJointFrame(parent, joint)
      const point = frame.point.sub(origin).applyQuaternion(inverse)
      const inward = frame.inward.applyQuaternion(inverse), normal = frame.normal.applyQuaternion(inverse)
      if (Math.abs(normal.z) < 0.99999 || Math.abs(inward.z) > 1e-5) throw new Error('The surrounding edges must stay in one plane to reshape the fitted outline.')
      return { x: inward.x, y: inward.y, value: inward.dot(point), z: point.z }
    })
    if (Math.max(...lines.map(line => line.z)) - Math.min(...lines.map(line => line.z)) > tolerance) throw new Error('The surrounding edges must stay in one plane to reshape the fitted outline.')
    const points = lines.map((line, i) => {
      const previous = lines[(i + lines.length - 1) % lines.length]
      const determinant = previous.x * line.y - line.x * previous.y
      if (Math.abs(determinant) < 1e-7) throw new Error('The fitted outline needs distinct adjoining edges.')
      return { x: (previous.value * line.y - line.value * previous.y) / determinant, y: (previous.x * line.value - line.x * previous.value) / determinant }
    })
    const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
    const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y))
    const width = maxX - minX, height = maxY - minY
    if (![width, height].every(value => Number.isFinite(value) && value >= 40 - 1e-5 && value <= 4000 + 1e-5)) throw new Error('The fitted outline would exceed the panel size limits (40–4,000 mm).')
    const customOutline = points.map(point => ({ x: (point.x - minX) / width, y: (maxY - point.y) / height }))
    const error = getOutlineError(customOutline)
    if (error) throw new Error(`Cannot reshape the fitted outline: ${error}`)
    const position = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, lines[0].z).applyQuaternion(rotation(panel)).add(origin).toArray() as Vec3
    const result = { ...panel, width, height, position, customOutline }
    if (!joints.every(joint => outlineConnectionAligned(byId.get(joint.parentId)!, result, joint))) throw new Error('The fitted outline would turn outside its surrounding edges.')
    return result
  })
}
