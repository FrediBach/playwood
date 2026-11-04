import { Euler, Matrix3, Matrix4, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel } from './model'
import { getOutlineError } from './panel-shape'
import type { PanelHole } from './close-holes'
import type { Panel, Vec3 } from './types'

const tolerance = 0.1
const seat = CONNECTOR_PROFILES['90'].seat
const cornerGap = Math.max(...Object.values(CONNECTOR_PROFILES).map(profile => profile.seat)) + tolerance
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
const rotation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const cross = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x
type Rim = { panel: Panel; center: Vector2; tangent: Vector2; length: number; low: number; high: number }
type Edge = { a: number; b: number; rim: Rim }

/** Intersect the actual polygon prism with conservative rectangular obstacles.
 * Triangulation keeps an empty concave corner from blocking another opening.
 */
function obstructed(points: Vector2[], z: number, thickness: number, basis: Matrix4, obstacles: readonly Panel[]) {
  const normal = new Vector3(0, 0, 1).transformDirection(basis)
  const faces = ShapeUtils.triangulateShape(points, [])
  const vertices = points.map(point => new Vector3(point.x, point.y, z).applyMatrix4(basis))
  const min = new Vector3(Infinity, Infinity, Infinity), max = min.clone().negate()
  for (const vertex of vertices) for (const sign of [-1, 1]) {
    const corner = vertex.clone().addScaledVector(normal, sign * thickness / 2)
    min.min(corner); max.max(corner)
  }
  const broad = new OBB(min.clone().add(max).multiplyScalar(0.5), max.clone().sub(min).multiplyScalar(0.5))
  for (const obstacle of obstacles) {
    const turn = rotation(obstacle)
    const obstacleAxes = axes.map(axis => axis.clone().applyQuaternion(turn))
    const center = new Vector3(...obstacle.position), half = [obstacle.width / 2, obstacle.height / 2, obstacle.thickness / 2]
    const box = new OBB(center, new Vector3(...half as Vec3), new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(turn)))
    if (!broad.intersectsOBB(box)) continue
    for (const face of faces) {
      const triangle = face.map(index => vertices[index])
      const edges = triangle.map((point, index) => triangle[(index + 1) % 3].clone().sub(point).normalize())
      const directions = [normal, ...obstacleAxes, ...edges.map(edge => edge.clone().cross(normal)),
        ...[normal, ...edges].flatMap(edge => obstacleAxes.map(axis => edge.clone().cross(axis)))]
      const separated = directions.some(direction => {
        if (direction.lengthSq() < 1e-10) return false
        direction.normalize()
        const projected = triangle.map(point => point.dot(direction))
        const depth = Math.abs(normal.dot(direction)) * thickness / 2
        const reach = obstacleAxes.reduce((sum, axis, i) => sum + Math.abs(axis.dot(direction)) * half[i], 0)
        const middle = center.dot(direction)
        return Math.max(...projected) + depth < middle - reach - tolerance || Math.min(...projected) - depth > middle + reach + tolerance
      })
      if (!separated) return true
    }
  }
  return false
}

/** Walk the bounded faces of the rim's planar line arrangement. End extensions
 * only bridge the measured corner seats; missing sides never become hull edges.
 */
function rimFaces(rims: Rim[]): { points: Vector2[]; rims: Rim[][] }[] {
  const nodes: Vector2[] = [], onRim = rims.map(() => new Set<number>())
  for (let i = 0; i < rims.length; i++) for (let j = i + 1; j < rims.length; j++) {
    const a = rims[i], b = rims[j], determinant = cross(a.tangent, b.tangent)
    const delta = b.center.clone().sub(a.center)
    let point: Vector2
    if (Math.abs(determinant) < 1e-7) {
      // Inline panels at a T/cross joint share a polygon edge, even when the
      // panel branching away from the opening is outside the selection.
      if (Math.abs(cross(delta, a.tangent)) > tolerance) continue
      const distance = delta.dot(a.tangent), gap = Math.abs(distance) - (a.length + b.length) / 2
      if (gap < -tolerance || gap > 2 * cornerGap) continue
      point = a.center.clone().addScaledVector(a.tangent, Math.sign(distance) * (a.length / 2 + gap / 2))
    } else {
      const alongA = cross(delta, b.tangent) / determinant, alongB = cross(delta, a.tangent) / determinant
      if (Math.abs(alongA) > a.length / 2 + cornerGap || Math.abs(alongB) > b.length / 2 + cornerGap) continue
      point = a.center.clone().addScaledVector(a.tangent, alongA)
    }
    let index = nodes.findIndex(node => node.distanceTo(point) < tolerance)
    if (index < 0) { index = nodes.length; nodes.push(point) }
    onRim[i].add(index); onRim[j].add(index)
  }
  const edges = new Map<string, Edge | undefined>()
  rims.forEach((rim, i) => {
    const ordered = [...onRim[i]].sort((a, b) => nodes[a].dot(rim.tangent) - nodes[b].dot(rim.tangent))
    for (let j = 1; j < ordered.length; j++) {
      const a = ordered[j - 1], b = ordered[j], key = [Math.min(a, b), Math.max(a, b)].join(':')
      // Overlapping rim boards make this edge ambiguous.
      if (edges.has(key)) { edges.set(key, undefined); continue }
      edges.set(key, { a, b, rim })
    }
  })
  const outgoing = nodes.map(() => [] as Edge[])
  for (const edge of edges.values()) if (edge) { outgoing[edge.a].push(edge); outgoing[edge.b].push({ ...edge, a: edge.b, b: edge.a }) }
  outgoing.forEach((list, index) => list.sort((a, b) => Math.atan2(nodes[a.b].y - nodes[index].y, nodes[a.b].x - nodes[index].x)
    - Math.atan2(nodes[b.b].y - nodes[index].y, nodes[b.b].x - nodes[index].x)))
  const seen = new Set<string>(), result: { points: Vector2[]; rims: Rim[][] }[] = []
  for (const start of outgoing.flat()) {
    if (seen.has(`${start.a}:${start.b}`)) continue
    const loop: Edge[] = []
    let current = start
    do {
      const key = `${current.a}:${current.b}`
      if (seen.has(key)) break
      seen.add(key); loop.push(current)
      const next = outgoing[current.b], reverse = next.findIndex(edge => edge.b === current.a)
      current = next[(reverse + next.length - 1) % next.length]
    } while (current !== start && (current.a !== start.a || current.b !== start.b) && loop.length <= edges.size)
    if (current.a !== start.a || current.b !== start.b || loop.length < 3 || loop.length > edges.size || new Set(loop.map(edge => edge.a)).size !== loop.length) continue
    // One outline edge can be held by several inline rim panels.
    const corners = loop.filter((edge, index) => {
      const before = loop[(index + loop.length - 1) % loop.length]
      return Math.abs(cross(nodes[edge.b].clone().sub(nodes[edge.a]).normalize(), nodes[before.b].clone().sub(nodes[before.a]).normalize())) > 1e-7
    })
    if (corners.length < 3 || corners.length > 128) continue
    const points = corners.map(edge => nodes[edge.a])
    const area = points.reduce((sum, point, i) => sum + cross(point, points[(i + 1) % points.length]), 0)
    if (area > 1) result.push({ points, rims: corners.map((edge, i) => {
      const supporting: Rim[] = [], next = corners[(i + 1) % corners.length]
      for (let index = loop.indexOf(edge); loop[index] !== next || !supporting.length; index = (index + 1) % loop.length) supporting.push(loop[index].rim)
      return supporting
    }) })
  }
  return result
}

function inset(points: Vector2[], distances: number[]): Vector2[] | undefined {
  const lines = points.map((point, i) => {
    const tangent = points[(i + 1) % points.length].clone().sub(point).normalize()
    return { tangent, point: point.clone().addScaledVector(new Vector2(-tangent.y, tangent.x), distances[i]) }
  })
  const result: Vector2[] = []
  for (let i = 0; i < lines.length; i++) {
    const a = lines[(i + lines.length - 1) % lines.length], b = lines[i], determinant = cross(a.tangent, b.tangent)
    if (Math.abs(determinant) < 1e-7) return
    result.push(a.point.clone().addScaledVector(a.tangent, cross(b.point.clone().sub(a.point), b.tangent) / determinant))
  }
  if (result.some((point, i) => result[(i + 1) % result.length].clone().sub(point).dot(lines[i].tangent) < 1)) return
  return result
}

export function findPolygonPanelHoles(selected: readonly Panel[], obstacles: readonly Panel[], options: { alignDepth?: boolean } = {}): PanelHole[] {
  const panels = selected.filter(panel => panel.visible && !panel.customOutline && !panel.trofastInserts?.length)
  if (panels.length < 3) return []
  const normals: Vector3[] = []
  for (const panel of panels) for (const axis of axes.slice(0, 2)) {
    const normal = axis.clone().applyQuaternion(rotation(panel))
    const dominant = normal.toArray().map(Math.abs).indexOf(Math.max(...normal.toArray().map(Math.abs)))
    if (normal.getComponent(dominant) < 0) normal.negate()
    if (!normals.some(other => other.dot(normal) > 0.99999)) normals.push(normal)
  }
  const result: PanelHole[] = []
  for (const normal of normals) {
    const u = (Math.abs(normal.x) < 0.9 ? axes[0] : axes[1]).clone().addScaledVector(normal, -normal.dot(Math.abs(normal.x) < 0.9 ? axes[0] : axes[1])).normalize()
    const v = normal.clone().cross(u), basis = new Matrix4().makeBasis(u, v, normal)
    const rims = panels.flatMap(panel => {
      const directions = axes.map(axis => axis.clone().applyQuaternion(rotation(panel)))
      const depthAxis = directions.slice(0, 2).findIndex(axis => Math.abs(axis.dot(normal)) > 0.99999)
      if (depthAxis < 0) return []
      const tangent = directions[1 - depthAxis], size = [panel.width, panel.height], center = new Vector3(...panel.position)
      return [{ panel, center: new Vector2(center.dot(u), center.dot(v)), tangent: new Vector2(tangent.dot(u), tangent.dot(v)),
        length: size[1 - depthAxis], low: center.dot(normal) - size[depthAxis] / 2, high: center.dot(normal) + size[depthAxis] / 2 }]
    })
    for (const sign of [-1, 1]) {
      const groups: Rim[][] = []
      if (options.alignDepth) groups.push(rims)
      else for (const rim of rims) {
        const end = sign < 0 ? rim.low : rim.high
        const group = groups.find(items => Math.abs((sign < 0 ? items[0].low : items[0].high) - end) < tolerance)
        if (group) group.push(rim); else groups.push([rim])
      }
      for (const group of groups.filter(items => items.length >= 3)) for (const face of rimFaces(group)) {
        const boundary = face.rims.flat(), thickness = Math.min(...boundary.map(rim => rim.panel.thickness))
        const ends = boundary.map(rim => sign < 0 ? rim.low : rim.high)
        const spread = Math.max(...ends) - Math.min(...ends)
        if (options.alignDepth && (spread <= tolerance || spread > 100 + tolerance)) continue
        // Keep the established four-board rectangular path, joint promotion,
        // and saved IDs. A split side needs one outline edge with several supports.
        const directions = face.points.map((point, i) => face.points[(i + 1) % face.points.length].clone().sub(point).normalize())
        if (!options.alignDepth && face.rims.every(rims => new Set(rims.map(rim => rim.panel.id)).size === 1)
          && directions.length === 4 && directions.every((direction, i) => Math.abs(direction.dot(directions[(i + 1) % 4])) < 1e-5)) continue
        if (boundary.some(rim => rim.high - rim.low < thickness + 1)) continue
        const points = inset(face.points, face.points.map(() => seat)), probe = inset(face.points, face.rims.map(rims => Math.max(...rims.map(rim => rim.panel.thickness / 2 + 1))))
        if (!points || !probe) continue
        const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x))
        const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y))
        const width = maxX - minX, height = maxY - minY
        if (width < 40 || width > 4000 || height < 40 || height > 4000) continue
        const customOutline = points.map(point => ({ x: (point.x - minX) / width, y: (maxY - point.y) / height }))
        if (getOutlineError(customOutline)) continue
        const end = sign < 0 ? Math.min(...ends) : Math.max(...ends), z = end + sign * seat
        // Uneven-depth candidates are only proposals. Check their complete
        // aligned project before the closing workflow offers them to the user.
        if (!options.alignDepth && (obstructed(points, z, thickness, basis, obstacles) || obstructed(probe, end - sign * (thickness / 2 + 1), thickness, basis, obstacles))) continue
        const direction = normal.clone().multiplyScalar(sign), dominant = direction.toArray().map(Math.abs).indexOf(Math.max(...direction.toArray().map(Math.abs)))
        const label = [['Left', 'Right'], ['Bottom', 'Top'], ['Back', 'Front']][dominant][direction.getComponent(dominant) > 0 ? 1 : 0]
        const boundaryIds = [...new Set(boundary.map(rim => rim.panel.id))].sort()
        const id = JSON.stringify([boundaryIds, 'polygon', normal.toArray().map(value => Number(value.toFixed(5))), sign])
        const euler = new Euler().setFromRotationMatrix(basis)
        const panel = createPanel({ ...boundary[0].panel, id: `closure:${id}`, name: `${label} panel`, width, height, thickness,
          pattern: 'solid', cornerRadius: 0, customOutline, trofastInserts: undefined, visible: true,
          position: new Vector3((minX + maxX) / 2, (minY + maxY) / 2, z).applyMatrix4(basis).toArray() as Vec3,
          rotation: [euler.x || 0, euler.y || 0, euler.z || 0] })
        result.push({ id, label, panel, boundaryIds, ...(options.alignDepth ? { alignment: { normal: normal.toArray() as Vec3, sign: sign as -1 | 1, adjustments: [] } } : {}) })
      }
    }
  }
  return result
}
