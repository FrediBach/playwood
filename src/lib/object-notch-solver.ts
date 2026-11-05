import { Euler, Matrix4, Vector3 } from 'three'
import { connectClosingPanel, fitClosingConnectorClearance } from './closure-connectors'
import { getOutlineError } from './panel-shape'
import { partitionClosingOutline } from './rectangular-closures'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { createPanel, getProjectBounds, resolvePanels, validateProject } from './model'
import type { ObjectNotches } from './object-notches'
import type { Panel, Project, Vec3 } from './types'

type Point = [number, number]
interface Edge { start: Point; end: Point; inset: number }
interface Face { axis: number; plane: number; sign: number; edges: Edge[] }
const epsilon = 1e-5

/** Extract simple face loops, preserving the convex/concave seat at each edge. */
function boundaryFaces(shape: ObjectNotches, thickness: number): Face[] {
  const { planes, occupied } = shape, sizes = planes.map(p => p.length - 1)
  const at = (c: number[]) => c.every((v, a) => v >= 0 && v < sizes[a]) && !!occupied[(c[0] * sizes[1] + c[1]) * sizes[2] + c[2]]
  const faces: Face[] = []
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) for (let d = 0; d < sizes[axis]; d++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, cells = new Map<string, number[]>()
    for (let a = 0; a < sizes[u]; a++) for (let b = 0; b < sizes[v]; b++) {
      const cell = [0, 0, 0]; cell[axis] = d; cell[u] = a; cell[v] = b
      const neighbor = [...cell]; neighbor[axis] += sign
      if (at(cell) && !at(neighbor)) cells.set(`${a},${b}`, cell)
    }
    const edges = new Map<string, Edge>()
    const add = (cell: number[], a: Point, b: Point, otherAxis: number, direction: number) => {
      const neighbor = [...cell]; neighbor[otherAxis] += direction
      const key = a.join(',')
      if (edges.has(key)) throw new Error('Corner cutouts must leave simple, separate face boundaries.')
      edges.set(key, { start: a, end: b, inset: CONNECTOR_PROFILES['90'].seat + (at(neighbor) ? -1 : 1) * thickness / 2 })
    }
    for (const cell of cells.values()) {
      const a = cell[u], b = cell[v]
      if (!cells.has(`${a},${b - 1}`)) add(cell, [a, b], [a + 1, b], v, -1)
      if (!cells.has(`${a + 1},${b}`)) add(cell, [a + 1, b], [a + 1, b + 1], u, 1)
      if (!cells.has(`${a},${b + 1}`)) add(cell, [a + 1, b + 1], [a, b + 1], v, 1)
      if (!cells.has(`${a - 1},${b}`)) add(cell, [a, b + 1], [a, b], u, -1)
    }
    if (!edges.size) continue
    const loop: Edge[] = [], start = edges.keys().next().value!
    let key = start
    do {
      const edge = edges.get(key)
      if (!edge) throw new Error('The cutout face is not a closed boundary.')
      loop.push(edge); edges.delete(key); key = edge.end.join(',')
    } while (key !== start)
    if (edges.size) throw new Error('Corner cutouts must leave one simple loop per face.')
    // Keep collinear vertices only when their seating allowance changes.
    const corners = loop.filter((e, i) => {
      const prev = loop[(i + loop.length - 1) % loop.length]
      return e.inset !== prev.inset || (e.end[0] - e.start[0]) * (prev.end[1] - prev.start[1]) !== (e.end[1] - e.start[1]) * (prev.end[0] - prev.start[0])
    })
    const result = corners.map((e, i): Edge => ({ start: [planes[u][e.start[0]], planes[v][e.start[1]]], end: [planes[u][corners[(i + 1) % corners.length].start[0]], planes[v][corners[(i + 1) % corners.length].start[1]]], inset: e.inset }))
    if (result.length < 4 || result.length > 12) throw new Error('Corner-cut faces support up to twelve edges.')
    faces.push({ axis, plane: planes[axis][d + Number(sign > 0)], sign, edges: result })
  }
  return faces
}

export function solveObjectNotches(shape: ObjectNotches, thickness: number): Project {
  if (!Number.isFinite(thickness) || thickness < 16 || thickness > 19) throw new Error('90° connectors require a panel thickness from 16 to 19 mm.')
  const faces = boundaryFaces(shape, thickness)
  let failure: unknown
  for (let orientation = 0; orientation < 8; orientation++) {
    try {
      const project = solveFaces(faces, thickness, orientation), bounds = getProjectBounds(resolvePanels(project))
      if ([0, 1, 2].some(a => Math.abs(bounds.min[a] - shape.bounds.min[a]) > epsilon || Math.abs(bounds.max[a] - shape.bounds.max[a]) > epsilon)) throw new Error('Corner-cut conversion changed the outside envelope.')
      return project
    } catch (error) { failure = error }
  }
  throw failure
}

function solveFaces(faces: Face[], thickness: number, orientation: number): Project {
  const pieces: { panel: Panel; face: Face; min: Vec3; max: Vec3; boundary: { axis: number; coordinate: number; tangent: number; lo: number; hi: number }[] }[] = []
  for (const [fi, face] of faces.entries()) {
    const { axis, edges } = face, u = (axis + 1) % 3, v = (axis + 2) % 3
    const lines = edges.map(e => {
      const dx = Math.sign(e.end[0] - e.start[0]), dy = Math.sign(e.end[1] - e.start[1])
      return { x: -dy, y: dx, value: -dy * e.start[0] + dx * e.start[1] + e.inset }
    })
    const points = lines.map((line, i): Point => {
      const prev = lines[(i + lines.length - 1) % lines.length], det = prev.x * line.y - line.x * prev.y
      if (!det) throw new Error('A face edge changes seating direction without a corner.')
      return [(prev.value * line.y - line.value * prev.y) / det, (prev.x * line.value - line.x * prev.value) / det]
    })
    if (points.some((p, i) => {
      const next = points[(i + 1) % points.length], e = edges[i]
      return (next[0] - p[0]) * (e.end[0] - e.start[0]) + (next[1] - p[1]) * (e.end[1] - e.start[1]) <= 0
    })) throw new Error('Corner cutouts leave insufficient panel cuts after connector clearances.')
    const low = [0, 1].map(a => Math.min(...points.map(p => p[a]))), high = [0, 1].map(a => Math.max(...points.map(p => p[a])))
    const template = createPanel({ width: high[0] - low[0], height: high[1] - low[1], customOutline: points.map(p => ({ x: (p[0] - low[0]) / (high[0] - low[0]), y: (p[1] - low[1]) / (high[1] - low[1]) })) })
    const outlineError = getOutlineError(template.customOutline)
    if (outlineError) throw new Error(`Corner cuts leave an invalid closing face: ${outlineError}`)
    const rotation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().setComponent(u, 1), new Vector3().setComponent(v, 1), new Vector3().setComponent(axis, 1)))
    for (const [ri, rect] of partitionClosingOutline(template, !!(orientation & (1 << axis))).entries()) {
      const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0]
      min[u] = rect.x + low[0]; max[u] = rect.right + low[0]; min[v] = rect.y + low[1]; max[v] = rect.bottom + low[1]
      min[axis] = max[axis] = face.plane - face.sign * thickness / 2
      const width = max[u] - min[u], height = max[v] - min[v]
      if ([width, height].some(n => !Number.isFinite(n) || n < 40 || n > 4000)) throw new Error('Corner cutouts require rectangular cuts between 40 and 4000 mm.')
      const boundary = points.flatMap((p, i) => {
        const end = points[(i + 1) % points.length], alongU = Math.abs(end[1] - p[1]) < epsilon
        const normal = alongU ? v : u, tangent = alongU ? u : v, coordinate = p[alongU ? 1 : 0]
        const lo = Math.max(min[tangent], Math.min(p[alongU ? 0 : 1], end[alongU ? 0 : 1]))
        const hi = Math.min(max[tangent], Math.max(p[alongU ? 0 : 1], end[alongU ? 0 : 1]))
        return hi - lo > epsilon && (Math.abs(min[normal] - coordinate) < epsilon || Math.abs(max[normal] - coordinate) < epsilon)
          ? [{ axis: normal, coordinate, tangent, lo, hi }] : []
      })
      pieces.push({ face, min, max, boundary, panel: createPanel({ name: `Corner-cut face ${fi + 1}.${ri + 1}`, width, height, thickness, position: min.map((n, a) => (n + max[a]) / 2) as Vec3, rotation: [rotation.x, rotation.y, rotation.z] }) })
    }
  }
  if (pieces.length > 80) throw new Error('Too many corner-cut face pieces.')
  const neighbors = pieces.map(() => [] as number[]), seat = CONNECTOR_PROFILES['90'].seat
  for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
    const p = pieces[a], q = pieces[b], x = p.face.axis, y = q.face.axis
    if (x === y) continue
    const z = 3 - x - y
    const near = (lo: number, hi: number, plane: number) => Math.abs(Math.abs(lo - plane) - seat) < epsilon || Math.abs(Math.abs(hi - plane) - seat) < epsilon
    if (!near(p.min[y], p.max[y], q.min[y]) || !near(q.min[x], q.max[x], p.min[x]) || Math.min(p.max[z], q.max[z]) - Math.max(p.min[z], q.min[z]) < 40) continue
    neighbors[a].push(b); neighbors[b].push(a)
  }
  for (const [i, piece] of pieces.entries()) for (const edge of piece.boundary) {
    if (!neighbors[i].some(j => {
      const other = pieces[j]
      return other.face.axis === edge.axis && Math.abs(Math.abs(other.min[edge.axis] - edge.coordinate) - seat) < epsilon
        && Math.min(edge.hi, other.max[edge.tangent]) - Math.max(edge.lo, other.min[edge.tangent]) >= 40
    })) throw new Error('Cannot attach every boundary segment of the corner-cut faces.')
  }
  const connected = new Set([0]), queue = [0]
  for (let i = 0; i < queue.length; i++) for (const j of neighbors[queue[i]]) if (!connected.has(j)) { connected.add(j); queue.push(j) }
  if (connected.size !== pieces.length) throw new Error('The corner-cut shell must form one connected construction.')
  if (neighbors.some(n => n.length < 2)) throw new Error('Every corner-cut piece needs connectors to at least two surrounding faces.')
  const empty: Project = { version: 1, name: 'Corner-cut shell', panels: [], connections: [] }
  let project = empty
  for (let i = 0; i < pieces.length; i++) project = connectClosingPanel(project, pieces[i].panel, neighbors[i].filter(j => j < i).map(j => pieces[j].panel.id), { fitClearance: false })
  try { project = fitClosingConnectorClearance(empty, project) }
  catch {
    // A previously placed two-clamp joint can block a later short rail.
    // Retry the complete layout with one clamp per required edge.
    project = fitClosingConnectorClearance(empty, { ...project, connections: project.connections.map(c => ({ ...c, count: c.count ? 1 : 0 })) })
  }
  const hardware = getPhysicalConnectors(project)
  if (neighbors.some((ns, i) => ns.some(j => !hardware.some(({ connection: c }) => c.type === '90' && [c.parentId, c.childId].includes(pieces[i].panel.id) && [c.parentId, c.childId].includes(pieces[j].panel.id))))) throw new Error('Cannot fit every corner-cut face joint.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('Corner-cut hardware does not have enough clearance.')
  return project
}
