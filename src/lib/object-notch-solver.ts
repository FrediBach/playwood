import { shellOrientations } from './object-shell-orientation'
import { Euler, Matrix4, Vector3 } from 'three'
import { connectClosingPanel, fitClosingConnectorClearance } from './closure-connectors'
import { getOutlineError } from './panel-shape'
import { partitionClosingOutline } from './rectangular-closures'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getPhysicalConnectors } from './connector-selection'
import { ConnectorClearanceError, fitAddedConnectorClearance, overlappingConnectorIds } from './connector-clearance'
import { createPanel, getProjectBounds, resolvePanels, validateProject } from './model'
import type { ObjectNotches } from './object-notches'
import type { Panel, Project, Vec3 } from './types'

type Point = [number, number]
interface Edge { start: Point; end: Point; inset: number; bare?: boolean }
interface Face { axis: number; plane: number; sign: number; edges: Edge[]; endCap: boolean }
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
    // Separate coplanar patches before tracing: cross arms can meet only at a
    // vertex on this plane while belonging to different faces of the shell.
    const patches: Map<string, number[]>[] = []
    const pending = new Map(cells)
    while (pending.size) {
      const first = pending.keys().next().value!, patch = new Map<string, number[]>(), queue = [first]
      for (let i = 0; i < queue.length; i++) {
        const key = queue[i], cell = pending.get(key)
        if (!cell) continue
        pending.delete(key); patch.set(key, cell)
        for (const [da, db] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const next = `${cell[u] + da},${cell[v] + db}`
          if (pending.has(next)) queue.push(next)
        }
      }
      patches.push(patch)
    }
    for (const cells of patches) {
      const edges = new Map<string, Edge>()
      const add = (cell: number[], a: Point, b: Point, otherAxis: number, direction: number) => {
        const neighbor = [...cell]; neighbor[otherAxis] += direction
        const key = a.join(',')
        if (edges.has(key)) throw new Error('Shell faces must leave simple, separate face boundaries.')
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
        if (!edge) throw new Error('The shell face is not a closed boundary.')
        loop.push(edge); edges.delete(key); key = edge.end.join(',')
      } while (key !== start)
      if (edges.size) throw new Error('Shell faces cannot contain holes.')
      // Keep collinear vertices only when their seating allowance changes.
      const corners = loop.filter((e, i) => {
        const prev = loop[(i + loop.length - 1) % loop.length]
        return e.inset !== prev.inset || (e.end[0] - e.start[0]) * (prev.end[1] - prev.start[1]) !== (e.end[1] - e.start[1]) * (prev.end[0] - prev.start[0])
      })
      const result = corners.map((e, i): Edge => ({ start: [planes[u][e.start[0]], planes[v][e.start[1]]], end: [planes[u][corners[(i + 1) % corners.length].start[0]], planes[v][corners[(i + 1) % corners.length].start[1]]], inset: e.inset }))
      if (result.length < 4 || result.length > 12) throw new Error('Shell faces support up to twelve edges.')
      const plane = planes[axis][d + Number(sign > 0)]
      const endCap = result.length === 4 && result.every(e => e.inset > CONNECTOR_PROFILES['90'].seat)
        && (Math.abs(plane - shape.bounds.min[axis]) < epsilon || Math.abs(plane - shape.bounds.max[axis]) < epsilon)
      faces.push({ axis, plane, sign, edges: result, endCap })
    }
  }
  return faces
}

function insetPoints(edges: Edge[]): Point[] {
  const lines = edges.map(e => {
    const dx = Math.sign(e.end[0] - e.start[0]), dy = Math.sign(e.end[1] - e.start[1])
    return { x: -dy, y: dx, value: -dy * e.start[0] + dx * e.start[1] + e.inset }
  })
  return lines.map((line, i): Point => {
    const prev = lines[(i + lines.length - 1) % lines.length], det = prev.x * line.y - line.x * prev.y
    if (!det) throw new Error('A face edge changes seating direction without a corner.')
    return [(prev.value * line.y - line.value * prev.y) / det, (prev.x * line.value - line.x * prev.value) / det]
  })
}

/** Retry narrow strips with bare butt seams at convex corners. The narrow
 * face reaches the outside plane; its neighbor stops one thickness short.
 * All other edges retain measured connector seats. */
function relieveNarrowCuts(faces: Face[], thickness: number, orientation: number): Face[] {
  const result = faces.map(f => ({ ...f, edges: f.edges.map(e => ({ ...e })) }))
  const worldEdge = (f: Face, e: Edge) => [e.start, e.end].map(p => {
    const point = [0, 0, 0]; point[f.axis] = f.plane; point[(f.axis + 1) % 3] = p[0]; point[(f.axis + 2) % 3] = p[1]; return point
  })
  for (const [fi, face] of faces.entries()) {
    const points = insetPoints(face.edges), low = [0, 1].map(a => Math.min(...points.map(p => p[a]))), high = [0, 1].map(a => Math.max(...points.map(p => p[a])))
    const template = createPanel({ width: high[0] - low[0], height: high[1] - low[1], customOutline: points.map(p => ({ x: (p[0] - low[0]) / (high[0] - low[0]), y: (p[1] - low[1]) / (high[1] - low[1]) })) })
    for (const rect of partitionClosingOutline(template, !!(orientation & (1 << face.axis)))) for (const a of [0, 1]) {
      const lo = (a ? rect.y : rect.x) + low[a], hi = (a ? rect.bottom : rect.right) + low[a]
      let cut = hi - lo
      if (cut >= 40) continue
      for (const [ei, edge] of face.edges.entries()) {
        // Keep extra seats on shaped faces once a strip fits; rectangular
        // end caps can instead meet both ends without corner hardware.
        if (cut >= 40 && face.edges.length > 4) break
        const p = points[ei], q = points[(ei + 1) % points.length]
        if (edge.inset < CONNECTOR_PROFILES['90'].seat || Math.abs(p[a] - q[a]) > epsilon
          || Math.min(Math.abs(p[a] - lo), Math.abs(p[a] - hi)) > epsilon) continue
        const tangent = 1 - a, rlo = (a ? rect.x : rect.y) + low[tangent], rhi = (a ? rect.right : rect.bottom) + low[tangent]
        if (Math.min(rhi, Math.max(p[tangent], q[tangent])) - Math.max(rlo, Math.min(p[tangent], q[tangent])) <= epsilon) continue
        const ends = worldEdge(face, edge)
        for (const [fj, other] of faces.entries()) for (const [ej, mate] of other.edges.entries()) {
          if (other.axis === face.axis || mate.inset < CONNECTOR_PROFILES['90'].seat) continue
          const match = worldEdge(other, mate)
          if (!ends.every(point => match.some(next => point.every((v, axis) => Math.abs(v - next[axis]) < epsilon)))) continue
          const own = result[fi].edges[ei], opposite = result[fj].edges[ej]
          if (own.bare || opposite.bare) { cut += edge.inset - own.inset; continue }
          cut += own.inset
          own.inset = 0; own.bare = true
          opposite.inset = thickness; opposite.bare = true
        }
      }
    }
  }
  return result
}

export function solveObjectShell(shape: ObjectNotches, thickness: number, rectangularOnly = true): Project {
  try { return solveAlignedShell(shape, thickness, rectangularOnly) }
  catch (original) {
    if (!Number.isFinite(thickness) || thickness < 16 || thickness > 19) throw original
    for (const { shape: oriented, restore } of shellOrientations(shape)) {
      try { return restore(solveAlignedShell(oriented, thickness, rectangularOnly)) }
      catch { /* Try another exact frame before rejecting the construction. */ }
    }
    throw original
  }
}

function solveAlignedShell(shape: ObjectNotches, thickness: number, rectangularOnly: boolean): Project {
  if (!Number.isFinite(thickness) || thickness < 16 || thickness > 19) throw new Error('90° connectors require a panel thickness from 16 to 19 mm.')
  const faces = boundaryFaces(shape, thickness)
  if (faces.length > 80) throw new Error('Too many shell face pieces.')
  let failure: unknown
  // Prefer two neighbors; only convex outer caps may use one as a fallback.
  for (const allowEndCaps of [false, true]) for (const customAxes of rectangularOnly ? [0] : [0, 1, 2, 4, 3, 5, 6, 7]) for (const relieve of [false, true]) for (let orientation = 0; orientation < 8; orientation++) {
    try {
      const project = solveFaces(relieve ? relieveNarrowCuts(faces, thickness, orientation) : faces, thickness, orientation, customAxes, allowEndCaps), bounds = getProjectBounds(resolvePanels(project))
      if ([0, 1, 2].some(a => Math.abs(bounds.min[a] - shape.bounds.min[a]) > epsilon || Math.abs(bounds.max[a] - shape.bounds.max[a]) > epsilon)) throw new Error('Shell conversion changed the outside envelope.')
      return project
    } catch (error) { failure = error }
  }
  if (rectangularOnly) throw new Error(`${failure instanceof Error ? failure.message : 'Cannot fit the shell.'} Try turning off Rectangular panels only to allow fitted outline faces.`)
  throw failure
}

function solveFaces(faces: Face[], thickness: number, orientation: number, customAxes: number, allowEndCaps: boolean): Project {
  const pieces: { panel: Panel; face: Face; min: Vec3; max: Vec3; boundary: { axis: number; coordinate: number; tangent: number; lo: number; hi: number; bare?: boolean }[] }[] = []
  for (const [fi, face] of faces.entries()) {
    const { axis, edges } = face, u = (axis + 1) % 3, v = (axis + 2) % 3
    const points = insetPoints(edges)
    if (points.some((p, i) => {
      const next = points[(i + 1) % points.length], e = edges[i]
      return (next[0] - p[0]) * (e.end[0] - e.start[0]) + (next[1] - p[1]) * (e.end[1] - e.start[1]) <= 0
    })) throw new Error('Shell faces leave insufficient panel cuts after connector clearances.')
    const low = [0, 1].map(a => Math.min(...points.map(p => p[a]))), high = [0, 1].map(a => Math.max(...points.map(p => p[a])))
    const template = createPanel({ width: high[0] - low[0], height: high[1] - low[1], customOutline: points.map(p => ({ x: (p[0] - low[0]) / (high[0] - low[0]), y: (p[1] - low[1]) / (high[1] - low[1]) })) })
    const outlineError = getOutlineError(template.customOutline)
    if (outlineError) throw new Error(`Shell cuts leave an invalid closing face: ${outlineError}`)
    const rotation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().setComponent(u, 1), new Vector3().setComponent(v, 1), new Vector3().setComponent(axis, 1)))
    const custom = !!(customAxes & (1 << axis)) && edges.length > 4
    const cuts = custom ? [{ x: 0, y: 0, right: template.width, bottom: template.height }] : partitionClosingOutline(template, !!(orientation & (1 << axis)))
    for (const [ri, rect] of cuts.entries()) {
      const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0]
      min[u] = rect.x + low[0]; max[u] = rect.right + low[0]; min[v] = rect.y + low[1]; max[v] = rect.bottom + low[1]
      min[axis] = max[axis] = face.plane - face.sign * thickness / 2
      const width = max[u] - min[u], height = max[v] - min[v]
      if ([width, height].some(n => !Number.isFinite(n) || n < 40 || n > 4000)) throw new Error(`Shell face ${fi + 1} needs a ${width.toFixed(1)} × ${height.toFixed(1)} mm cut after connector clearance. Panel cuts must be between 40 and 4000 mm. Widen the narrow source sections or reduce the cutout.`)
      const boundary = points.flatMap((p, i) => {
        const end = points[(i + 1) % points.length], alongU = Math.abs(end[1] - p[1]) < epsilon
        const normal = alongU ? v : u, tangent = alongU ? u : v, coordinate = p[alongU ? 1 : 0]
        const lo = Math.max(min[tangent], Math.min(p[alongU ? 0 : 1], end[alongU ? 0 : 1]))
        const hi = Math.min(max[tangent], Math.max(p[alongU ? 0 : 1], end[alongU ? 0 : 1]))
        return hi - lo > epsilon && (custom || Math.abs(min[normal] - coordinate) < epsilon || Math.abs(max[normal] - coordinate) < epsilon)
          ? [{ axis: normal, coordinate, tangent, lo, hi, bare: edges[i].bare }] : []
      })
      pieces.push({ face, min, max, boundary, panel: createPanel({ name: `Shell face ${fi + 1}.${ri + 1}`, width, height, thickness, customOutline: custom ? template.customOutline!.map(p => ({ x: p.x, y: 1 - p.y })) : undefined, position: min.map((n, a) => (n + max[a]) / 2) as Vec3, rotation: [rotation.x, rotation.y, rotation.z] }) })
    }
  }
  if (pieces.length > 80) throw new Error('Too many shell face pieces.')
  // Butt-seam layouts require a connected hardware graph with two neighbors
  // per board, rather than a clamp on every short boundary segment.
  const selectiveJoints = faces.some(f => f.edges.some(e => e.bare))
  const pieceIndex = new Map(pieces.map((piece, index) => [piece.panel.id, index]))
  const neighbors = pieces.map(() => [] as number[]), seat = CONNECTOR_PROFILES['90'].seat
  for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
    const p = pieces[a], q = pieces[b], x = p.face.axis, y = q.face.axis
    // Outline joints require a rectangular parent. Fitted faces on different
    // axes must connect through the surrounding rectangular boards.
    if (x === y || (p.panel.customOutline && q.panel.customOutline)) continue
    if (!p.boundary.some(e => !e.bare && e.axis === y && Math.abs(Math.abs(e.coordinate - q.min[y]) - seat) < epsilon
      && q.boundary.some(f => !f.bare && f.axis === x && Math.abs(Math.abs(f.coordinate - p.min[x]) - seat) < epsilon
        && Math.min(e.hi, f.hi) - Math.max(e.lo, f.lo) >= 40))) continue
    neighbors[a].push(b); neighbors[b].push(a)
  }
  for (const [i, piece] of pieces.entries()) for (const edge of piece.boundary) {
    if (selectiveJoints) continue
    if (!neighbors[i].some(j => {
      const other = pieces[j]
      return other.face.axis === edge.axis && Math.abs(Math.abs(other.min[edge.axis] - edge.coordinate) - seat) < epsilon
        && Math.min(edge.hi, other.max[edge.tangent]) - Math.max(edge.lo, other.min[edge.tangent]) >= 40
    })) throw new Error('Cannot attach every boundary segment of the shell faces.')
  }
  const connected = new Set([0]), queue = [0]
  for (let i = 0; i < queue.length; i++) for (const j of neighbors[queue[i]]) if (!connected.has(j)) { connected.add(j); queue.push(j) }
  if (connected.size !== pieces.length) throw new Error('The shell must form one connected construction.')
  const minimumNeighbors = pieces.map(p => allowEndCaps && p.face.endCap ? 1 : 2)
  if (neighbors.some((n, i) => n.length < minimumNeighbors[i])) throw new Error('Every shell piece needs connectors to surrounding faces.')
  const empty: Project = { version: 1, name: 'Object shell', panels: [], connections: [] }
  let project = empty
  for (let i = 0; i < pieces.length; i++) project = connectClosingPanel(project, pieces[i].panel, neighbors[i].filter(j => j < i).map(j => pieces[j].panel.id), { fitClearance: false })
  try { project = fitClosingConnectorClearance(empty, project) }
  catch {
    // A previously placed two-clamp joint can block a later short rail.
    // Retry the complete layout with one clamp per required edge.
    project = { ...project, connections: project.connections.map(c => ({ ...c, count: c.count ? 1 : 0 })) }
    for (;;) {
      try { project = fitClosingConnectorClearance(empty, project); break }
      catch (error) {
        let reordered: Project | undefined
        for (const order of [1, 2, 3, 4] as const) {
          try { reordered = fitAddedConnectorClearance(empty, project, order); break } catch { /* Try another rail order. */ }
        }
        if (reordered) { project = reordered; break }
        if (!selectiveJoints || !(error instanceof ConnectorClearanceError)) throw error
        // Drop a redundant blocked joint or a neighboring blocker only if
        // support counts and the connected assembly are preserved.
        const blocked = project.connections.find(c => c.id === error.connectionId)
        if (!blocked) throw error
        const candidates = project.connections.filter(c => c.type === '90' && [c.parentId, c.childId].some(id => id === blocked.parentId || id === blocked.childId))
          .sort((a, b) => Number(b === blocked) - Number(a === blocked))
        let removed = false
        for (const joint of candidates) {
          const a = pieceIndex.get(joint.parentId), b = pieceIndex.get(joint.childId)
          if (a === undefined || b === undefined) continue
          if (neighbors[a].length <= minimumNeighbors[a] || neighbors[b].length <= minimumNeighbors[b]) continue
          const retained = neighbors.map((ns, i) => ns.filter(j => !(i === a && j === b || i === b && j === a)))
          const seen = new Set([0]), pending = [0]
          for (let k = 0; k < pending.length; k++) for (const j of retained[pending[k]]) if (!seen.has(j)) { seen.add(j); pending.push(j) }
          if (seen.size !== pieces.length) continue
          neighbors[a] = retained[a]; neighbors[b] = retained[b]
          project = { ...project, connections: project.connections.filter(c => !([c.parentId, c.childId].includes(joint.parentId) && [c.parentId, c.childId].includes(joint.childId))) }
          removed = true; break
        }
        if (!removed) throw error
      }
    }
  }
  const hardware = getPhysicalConnectors(project)
  if (neighbors.some((ns, i) => ns.some(j => !hardware.some(({ connection: c }) => c.type === '90' && [c.parentId, c.childId].includes(pieces[i].panel.id) && [c.parentId, c.childId].includes(pieces[j].panel.id))))) throw new Error('Cannot fit every shell face joint.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('Shell hardware does not have enough clearance.')
  return project
}
