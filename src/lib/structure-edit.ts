import { Euler, Quaternion, Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import type { Connection, Panel, Project, Vec3 } from './types'

const EPSILON = 1e-6
const CONTACT_TOLERANCE = 1e-4
const LIMIT_MESSAGE = 'This move would exceed the panel size limits (40–4,000 mm). Try a smaller step.'
const CONSTRAINT_MESSAGE = 'These panels cannot move in that direction while keeping their joints connected. Try another direction or select the whole assembly.'

type Dimensions = Partial<Pick<Panel, 'width' | 'height'>>
type Row = { entries: Map<number, number>; value: number }
type Frame = { panel: Panel; axes: Vector3[]; half: number[] }
type Contact = { a: number; b: number; normal: Vector3; sign: number }
type Edit = { kind: 'move'; delta: Vec3 } | { kind: 'resize'; patch: Dimensions }

const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')
const position = (panel: Panel) => new Vector3(...panel.position)
const frame = (panel: Panel): Frame => {
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  return { panel, axes: [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(rotation)), half: [panel.width / 2, panel.height / 2, panel.thickness / 2] }
}
const extent = (item: Frame, axis: Vector3) => item.axes.reduce((sum, own, index) => sum + Math.abs(own.dot(axis)) * item.half[index], 0)
const coordinate = (item: Frame, axis: Vector3, side = 0) => position(item.panel).dot(axis) + side * extent(item, axis)

/** Existing surface contacts are implicit supports for the library's loose inserts. */
function findContacts(frames: Frame[]): Contact[] {
  const contacts: Contact[] = []
  for (let a = 0; a < frames.length; a++) for (let b = a + 1; b < frames.length; b++) {
    const first = frames[a], second = frames[b]
    const separation = position(second.panel).sub(position(first.panel))
    for (const normal of first.axes) {
      if (!second.axes.some(axis => Math.abs(axis.dot(normal)) > 1 - EPSILON)) continue
      const distance = separation.dot(normal)
      if (Math.abs(Math.abs(distance) - extent(first, normal) - extent(second, normal)) > CONTACT_TOLERANCE) continue
      const tangents = [...first.axes, ...second.axes].filter(axis => Math.abs(axis.dot(normal)) < EPSILON)
      const hasArea = tangents.every(axis => Math.min(coordinate(first, axis, 1), coordinate(second, axis, 1))
        - Math.max(coordinate(first, axis, -1), coordinate(second, axis, -1)) > CONTACT_TOLERANCE)
      if (hasArea) { contacts.push({ a, b, normal, sign: Math.sign(distance) }); break }
    }
  }
  return contacts
}

/**
 * Minimum weighted change subject to sparse, exact linear constraints. Rotations
 * and connector seats stay fixed, so this is a linear problem, including angled
 * connectors. Solve A W^-1 Aᵀ λ = b with conjugate gradients; redundant support
 * rows are harmless and do not require a dense cubic matrix decomposition.
 */
function solve(rows: Row[], weights: number[]): number[] {
  const size = weights.length
  const inverseScale = weights.map(weight => 1 / Math.sqrt(weight))
  const equations = rows.map(row => {
    const entries = [...row.entries].filter(([, value]) => Math.abs(value) > 1e-10)
      .map(([index, value]) => [index, value * inverseScale[index]] as const)
    const norm = Math.hypot(...entries.map(([, value]) => value))
    if (norm < 1e-10) {
      if (Math.abs(row.value) > EPSILON) throw new Error(CONSTRAINT_MESSAGE)
      return { entries: [], value: 0 }
    }
    return { entries: entries.map(([index, value]) => [index, value / norm] as const), value: row.value / norm }
  }).filter(row => row.entries.length)
  const count = equations.length
  const multiply = (values: Float64Array): Float64Array => {
    const temporary = new Float64Array(size)
    equations.forEach((row, i) => { for (const [index, coefficient] of row.entries) temporary[index] += coefficient * values[i] })
    const output = new Float64Array(count)
    equations.forEach((row, i) => { for (const [index, coefficient] of row.entries) output[i] += coefficient * temporary[index] })
    return output
  }
  const dot = (a: Float64Array, b: Float64Array) => a.reduce((sum, value, index) => sum + value * b[index], 0)
  const solution = new Float64Array(count)
  let residual = Float64Array.from(equations, row => row.value)
  let direction = residual.slice()
  let error = dot(residual, residual)
  const threshold = Math.max(1e-18, error * 1e-22)
  for (let iteration = 0; error > threshold && iteration < Math.max(200, count * 6); iteration++) {
    const product = multiply(direction)
    const denominator = dot(direction, product)
    if (!Number.isFinite(denominator) || denominator < 1e-24) break
    const alpha = error / denominator
    for (let i = 0; i < count; i++) { solution[i] += alpha * direction[i]; residual[i] -= alpha * product[i] }
    const nextError = dot(residual, residual)
    const beta = nextError / error
    for (let i = 0; i < count; i++) direction[i] = residual[i] + beta * direction[i]
    error = nextError
  }
  const output = Array<number>(size).fill(0)
  equations.forEach((row, i) => { for (const [index, coefficient] of row.entries) output[index] += coefficient * solution[i] * inverseScale[index] })
  if (output.some(value => !Number.isFinite(value)) || rows.some(row => Math.abs([...row.entries].reduce((sum, [index, value]) => sum + value * output[index], 0) - row.value) > 1e-5)) {
    throw new Error(CONSTRAINT_MESSAGE)
  }
  return output
}

function editComponent(project: Project, frames: Frame[], contacts: Contact[], ids: Set<string>, edit: Edit): Project {
  const indices = new Map(frames.map((item, index) => [item.panel.id, index]))
  const selected = frames.filter(item => ids.has(item.panel.id))
  if (!selected.length) return project
  if (edit.kind === 'move' && selected.length === frames.length) {
    return { ...project, panels: project.panels.map(panel => indices.has(panel.id) ? {
      ...panel, position: panel.position.map((value, axis) => value + edit.delta[axis]) as Vec3,
    } : panel) }
  }
  // Tangential changes are cheaper than moving a whole shelf/side out of its
  // plane. Dimensions are allowed to adapt while thickness remains physical.
  const weights = frames.flatMap(() => [1, 1, 64, 0.25, 0.25])
  const connections = project.connections.filter(connection => indices.has(connection.parentId) && indices.has(connection.childId))
  const offsetVariables = new Map<string, number>()
  for (const connection of connections) if (!offsetVariables.has(jointId(connection))) {
    offsetVariables.set(jointId(connection), weights.length)
    weights.push(4)
  }
  const rows: Row[] = []
  const row = (value = 0): Row => { const next = { entries: new Map<number, number>(), value }; rows.push(next); return next }
  const add = (target: Row, index: number, value: number) => target.entries.set(index, (target.entries.get(index) ?? 0) + value)
  const center = (target: Row, index: number, axis: Vector3, scale = 1) => {
    frames[index].axes.forEach((own, dimension) => add(target, index * 5 + dimension, own.dot(axis) * scale))
  }
  const edge = (target: Row, index: number, axis: Vector3, side: number, scale = 1) => {
    center(target, index, axis, scale)
    for (let dimension = 0; dimension < 2; dimension++) add(target, index * 5 + 3 + dimension, side * Math.abs(frames[index].axes[dimension].dot(axis)) * scale / 2)
  }
  const worldAxes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

  for (const connection of connections) {
    const parentIndex = indices.get(connection.parentId)!, childIndex = indices.get(connection.childId)!
    const parent = frames[parentIndex].panel, child = frames[childIndex].panel
    const expected = (p: Panel, c: Panel, offset: number) => position(resolvePanels({ version: 1, name: project.name,
      panels: [p, c], connections: [{ ...connection, role: undefined, offset }],
    })[1])
    const baseline = expected(parent, child, connection.offset)
    const changes = [
      expected({ ...parent, width: parent.width + 1 }, child, connection.offset).sub(baseline),
      expected({ ...parent, height: parent.height + 1 }, child, connection.offset).sub(baseline),
      expected(parent, { ...child, width: child.width + 1 }, connection.offset).sub(baseline),
      expected(parent, { ...child, height: child.height + 1 }, connection.offset).sub(baseline),
      expected(parent, child, connection.offset + 1).sub(baseline),
    ]
    worldAxes.forEach(axis => {
      const constraint = row()
      center(constraint, childIndex, axis)
      center(constraint, parentIndex, axis, -1)
      add(constraint, parentIndex * 5 + 3, -changes[0].dot(axis))
      add(constraint, parentIndex * 5 + 4, -changes[1].dot(axis))
      add(constraint, childIndex * 5 + 3, -changes[2].dot(axis))
      add(constraint, childIndex * 5 + 4, -changes[3].dot(axis))
      add(constraint, offsetVariables.get(jointId(connection))!, -changes[4].dot(axis))
    })
    if (edit.kind === 'resize') {
      const horizontal = ['top', 'bottom', 'front', 'back'].includes(connection.side)
      const dimension = horizontal ? 0 : 1
      const parentLength = dimension === 0 ? parent.width : parent.height
      const childLength = dimension === 0 ? child.width : child.height
      for (const side of [-1, 1]) if (Math.abs(side * parentLength / 2 - connection.offset - side * childLength / 2) < CONTACT_TOLERANCE) {
        const constraint = row()
        add(constraint, parentIndex * 5 + 3 + dimension, side / 2)
        add(constraint, childIndex * 5 + 3 + dimension, -side / 2)
        add(constraint, offsetVariables.get(jointId(connection))!, -1)
      }
    }
  }

  for (const contact of contacts) {
    const constraint = row()
    edge(constraint, contact.b, contact.normal, -contact.sign)
    edge(constraint, contact.a, contact.normal, contact.sign, -1)
    if (edit.kind === 'resize') {
      // Preserve flush insert edges as well as surface contact, so inserts
      // travel with the compartment when its width or depth is edited.
      for (const axis of frames[contact.a].axes.filter(axis => Math.abs(axis.dot(contact.normal)) < EPSILON)) {
        if (!frames[contact.b].axes.some(other => Math.abs(other.dot(axis)) > 1 - EPSILON)) continue
        for (const side of [-1, 1]) if (Math.abs(coordinate(frames[contact.a], axis, side) - coordinate(frames[contact.b], axis, side)) < CONTACT_TOLERANCE) {
          const flush = row()
          edge(flush, contact.a, axis, side)
          edge(flush, contact.b, axis, side, -1)
        }
      }
    }
  }

  // Loose inserts can have small fitting clearances, so touching surfaces
  // alone do not describe their compartment. Infer those existing fits from
  // two surrounding structural faces, without relying on panel names/types.
  const structural = new Set(connections.flatMap(connection => [connection.parentId, connection.childId]))
  frames.forEach((item, index) => {
    if (structural.has(item.panel.id) || (edit.kind === 'move' && ids.has(item.panel.id))) return
    item.axes.forEach((axis, dimension) => {
      const minimum = coordinate(item, axis, -1), maximum = coordinate(item, axis, 1)
      const centerAt = coordinate(item, axis)
      let lower: { index: number; coordinate: number } | undefined
      let upper: { index: number; coordinate: number } | undefined
      frames.forEach((other, otherIndex) => {
        if (!structural.has(other.panel.id) || Math.abs(other.axes[2].dot(axis)) < 1 - EPSILON) return
        if (item.axes.filter(own => Math.abs(own.dot(axis)) < EPSILON).some(tangent => Math.min(coordinate(item, tangent, 1), coordinate(other, tangent, 1))
          - Math.max(coordinate(item, tangent, -1), coordinate(other, tangent, -1)) <= CONTACT_TOLERANCE)) return
        const leftFace = coordinate(other, axis, 1), rightFace = coordinate(other, axis, -1)
        if (leftFace <= minimum + CONTACT_TOLERANCE && (!lower || leftFace > lower.coordinate)) lower = { index: otherIndex, coordinate: leftFace }
        if (rightFace >= maximum - CONTACT_TOLERANCE && (!upper || rightFace < upper.coordinate)) upper = { index: otherIndex, coordinate: rightFace }
      })
      if (lower && upper && upper.coordinate - lower.coordinate > EPSILON) {
        const opening = upper.coordinate - lower.coordinate
        if (dimension < 2 && (maximum - minimum) / opening > 0.8) {
          for (const [side, boundary] of [[-1, lower], [1, upper]] as const) {
            const constraint = row()
            edge(constraint, index, axis, side)
            edge(constraint, boundary.index, axis, -side, -1)
          }
        } else if (dimension === 2 && !contacts.some(contact => Math.abs(contact.normal.dot(axis)) > 1 - EPSILON
          && ((contact.a === index && structural.has(frames[contact.b].panel.id)) || (contact.b === index && structural.has(frames[contact.a].panel.id))))) {
          // Centered dividers stay centered; inset box sides retain their
          // small clearance. Other placements are already determined by the
          // insert's own contacts (several boxes may share one compartment).
          if (Math.abs(centerAt - (lower.coordinate + upper.coordinate) / 2) < CONTACT_TOLERANCE) {
            const constraint = row()
            center(constraint, index, axis)
            edge(constraint, lower.index, axis, 1, -0.5)
            edge(constraint, upper.index, axis, -1, -0.5)
          } else {
            const clearance = Math.max(item.panel.thickness, 10)
            for (const [side, boundary, gap] of [[-1, lower, minimum - lower.coordinate], [1, upper, upper.coordinate - maximum]] as const) {
              if (gap > clearance || gap > opening * 0.1) continue
              const constraint = row()
              edge(constraint, index, axis, side)
              edge(constraint, boundary.index, axis, -side, -1)
            }
          }
        }
        return
      }
      if (dimension === 2) return
      // Depth-inset inserts often have one supporting shelf and no front/back
      // walls. Preserve their small margins within that supporting surface.
      const supports = contacts.flatMap(contact => contact.a === index ? [{ contact, index: contact.b }] : contact.b === index ? [{ contact, index: contact.a }] : [])
        .filter(support => Math.abs(support.contact.normal.dot(axis)) < EPSILON)
        .filter(support => {
          const other = frames[support.index]
          const size = extent(other, axis) * 2
          return other.axes.some(own => Math.abs(own.dot(axis)) > 1 - EPSILON)
            && coordinate(other, axis, -1) <= minimum + CONTACT_TOLERANCE
            && coordinate(other, axis, 1) >= maximum - CONTACT_TOLERANCE
            && (maximum - minimum) / size > 0.8
        }).sort((a, b) => extent(frames[a.index], axis) - extent(frames[b.index], axis))
      if (supports.length) for (const side of [-1, 1]) {
        const constraint = row()
        edge(constraint, index, axis, side)
        edge(constraint, supports[0].index, axis, side, -1)
      }
    })
  })

  for (const item of selected) {
    const index = indices.get(item.panel.id)!
    for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      const target = row(edit.kind === 'resize' && edit.patch[field] !== undefined ? edit.patch[field]! - item.panel[field] : 0)
      add(target, index * 5 + 3 + dimension, 1)
    }
    if (edit.kind === 'move') worldAxes.forEach((axis, dimension) => center(row(edit.delta[dimension]), index, axis))
  }
  if (edit.kind === 'resize') {
    // Keep the selected panel's center (or selection centroid) stationary.
    for (const axis of worldAxes) {
      const constraint = row()
      selected.forEach(item => center(constraint, indices.get(item.panel.id)!, axis, 1 / selected.length))
    }
  } else {
    const axis = new Vector3(...edit.delta).normalize()
    const minimum = Math.min(...frames.map(item => coordinate(item, axis, -1)))
    const maximum = Math.max(...frames.map(item => coordinate(item, axis, 1)))
    const touchesMin = selected.some(item => Math.abs(coordinate(item, axis, -1) - minimum) < CONTACT_TOLERANCE)
    const touchesMax = selected.some(item => Math.abs(coordinate(item, axis, 1) - maximum) < CONTACT_TOLERANCE)
    // Move an outer boundary against its opposite boundary. Interior shelves
    // divide the existing opening, keeping both outside boundaries stationary.
    for (const [side, boundary, touched] of [[-1, minimum, touchesMin], [1, maximum, touchesMax]] as const) {
      if (touched && !(touchesMin && touchesMax)) continue
      frames.forEach((item, index) => {
        if (!ids.has(item.panel.id) && Math.abs(coordinate(item, axis, side) - boundary) < CONTACT_TOLERANCE) edge(row(), index, axis, side)
      })
    }
  }

  const changes = solve(rows, weights)
  const changedPanels = new Map(frames.map((item, index) => {
    const moved = position(item.panel)
    item.axes.forEach((axis, dimension) => moved.addScaledVector(axis, changes[index * 5 + dimension]))
    const width = item.panel.width + changes[index * 5 + 3], height = item.panel.height + changes[index * 5 + 4]
    if (width < 40 - EPSILON || width > 4000 + EPSILON || height < 40 - EPSILON || height > 4000 + EPSILON) throw new Error(LIMIT_MESSAGE)
    const clean = (value: number, previous: number) => Math.abs(value - previous) < EPSILON ? previous : Math.round(value * 1e8) / 1e8
    return [item.panel.id, { ...item.panel, width: clean(Math.min(4000, Math.max(40, width)), item.panel.width), height: clean(Math.min(4000, Math.max(40, height)), item.panel.height),
      position: moved.toArray().map((value, axis) => clean(value, item.panel.position[axis])) as Vec3 }] as const
  }))
  return { ...project,
    panels: project.panels.map(panel => changedPanels.get(panel.id) ?? panel),
    connections: project.connections.map(connection => {
      const variable = offsetVariables.get(jointId(connection))
      return variable === undefined || Math.abs(changes[variable]) < EPSILON ? connection : { ...connection, offset: Math.round((connection.offset + changes[variable]) * 1e8) / 1e8 }
    }),
  }
}

function editStructure(project: Project, ids: readonly string[], edit: Edit): Project {
  const wanted = new Set(ids)
  const panels = resolvePanels(project)
  if (!panels.some(panel => wanted.has(panel.id))) return project
  const frames = panels.map(frame)
  const contacts = findContacts(frames)
  const indices = new Map(panels.map((panel, index) => [panel.id, index]))
  const groups = panels.map((_, index) => index)
  const root = (index: number): number => { while (groups[index] !== index) { groups[index] = groups[groups[index]]; index = groups[index] } return index }
  const join = (a: number, b: number) => { groups[root(a)] = root(b) }
  project.connections.forEach(connection => { const a = indices.get(connection.parentId), b = indices.get(connection.childId); if (a !== undefined && b !== undefined) join(a, b) })
  contacts.forEach(contact => join(contact.a, contact.b))
  const components = new Map<number, number[]>()
  panels.forEach((_, index) => { const key = root(index); components.set(key, [...components.get(key) ?? [], index]) })
  let next: Project = { ...project, panels }
  for (const component of components.values()) {
    if (!component.some(index => wanted.has(panels[index].id))) continue
    const local = new Map(component.map((index, localIndex) => [index, localIndex]))
    next = editComponent(next, component.map(index => frames[index]), contacts.filter(contact => local.has(contact.a) && local.has(contact.b))
      .map(contact => ({ ...contact, a: local.get(contact.a)!, b: local.get(contact.b)! })), wanted, edit)
  }
  next = { ...next, panels: resolvePanels(next) }
  if (next.panels.some(panel => panel.position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000))
    || next.connections.some(connection => !Number.isFinite(connection.offset) || Math.abs(connection.offset) > 10000)) throw new Error('This move would exceed the project placement limits. Try a smaller step.')
  const previousErrors = new Set(validateProject(project).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const newError = validateProject(next).find(issue => issue.severity === 'error' && !previousErrors.has(issue.id))
  if (newError) throw new Error(`Cannot keep this edit connected: ${newError.message}`)
  const nextFrames = next.panels.map(frame)
  for (const contact of contacts) {
    const first = nextFrames[contact.a], second = nextFrames[contact.b]
    if (Math.abs(coordinate(second, contact.normal, -contact.sign) - coordinate(first, contact.normal, contact.sign)) > CONTACT_TOLERANCE
      || [...first.axes, ...second.axes].filter(axis => Math.abs(axis.dot(contact.normal)) < EPSILON).some(axis => Math.min(coordinate(first, axis, 1), coordinate(second, axis, 1))
        - Math.max(coordinate(first, axis, -1), coordinate(second, axis, -1)) <= CONTACT_TOLERANCE)) {
      throw new Error('This move would leave an insert unsupported. Try a smaller step or move its supporting panels together.')
    }
  }
  return next
}

/** Move selected panels by an exact world-space displacement, adapting connected spans. */
export function movePanels(project: Project, ids: readonly string[], delta: Vec3): Project {
  if (delta.some(value => !Number.isFinite(value))) throw new Error('Panel movement must be a finite distance.')
  if (delta.every(value => Math.abs(value) < EPSILON)) return project
  return editStructure(project, ids, { kind: 'move', delta })
}

/** Resize a selection while keeping structural joints and existing inserts fitted. */
export function resizePanels(project: Project, ids: readonly string[], patch: Dimensions): Project {
  if (Object.values(patch).some(value => value !== undefined && (!Number.isFinite(value) || value < 40 || value > 4000))) throw new Error(LIMIT_MESSAGE)
  const wanted = new Set(ids)
  if (!project.panels.some(panel => wanted.has(panel.id) && (['width', 'height'] as const).some(field => patch[field] !== undefined && Math.abs(panel[field] - patch[field]!) > EPSILON))) return project
  return editStructure(project, ids, { kind: 'resize', patch })
}
