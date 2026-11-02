import { Euler, Quaternion, Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { isPanelConnectedToAssembly } from './assemblies'
import { designConstraintLimits, designConstraintPanelIds, describeDesignConstraint, evaluateDesignConstraints } from './design-constraints'
import type { Connection, ConstraintReference, Panel, Project, Vec3 } from './types'

const EPSILON = 1e-6
const CONTACT_TOLERANCE = 1e-4
const LIMIT_MESSAGE = 'This move would exceed the panel size limits (40–4,000 mm). Try a smaller step.'
const CONSTRAINT_MESSAGE = 'These panels cannot move in that direction while keeping their joints connected. Try another direction or select the whole assembly.'

type Dimensions = Partial<Pick<Panel, 'width' | 'height'>>
type PanelDimensions = Partial<Pick<Panel, 'width' | 'height' | 'thickness'>>
type Row = { entries: Map<number, number>; value: number }
type Frame = { panel: Panel; axes: Vector3[]; half: number[] }
type Contact = { a: number; b: number; normal: Vector3; sign: number }
type Edit = { kind: 'move'; delta: Vec3; releaseContacts?: boolean } | { kind: 'resize'; patch: Dimensions; patches?: Record<string, PanelDimensions>; centerDelta?: Vec3; local?: boolean } | { kind: 'reconcile'; anchorPanelId?: string; ruleId?: string }
/** Assembly sources have their own origin; world floor/orientation checks run after materialization. */
interface ValidationContext { trofastWorld?: boolean }

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
function solve(rows: Row[], weights: number[], dual?: number[]): number[] {
  const size = weights.length
  const inverseScale = weights.map(weight => 1 / Math.sqrt(weight))
  const equations = rows.map((row, sourceIndex) => {
    const entries = [...row.entries].filter(([, value]) => Math.abs(value) > 1e-10)
      .map(([index, value]) => [index, value * inverseScale[index]] as const)
    const norm = Math.hypot(...entries.map(([, value]) => value))
    if (norm < 1e-10) {
      if (Math.abs(row.value) > EPSILON) throw new Error(CONSTRAINT_MESSAGE)
      return { entries: [], value: 0, sourceIndex, norm: 1 }
    }
    return { entries: entries.map(([index, value]) => [index, value / norm] as const), value: row.value / norm, sourceIndex, norm }
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
  if (dual) {
    dual.length = rows.length
    dual.fill(0)
    equations.forEach((row, index) => { dual[row.sourceIndex] = solution[index] / row.norm })
  }
  return output
}

const rowValue = (row: Row, values: number[]) => [...row.entries].reduce((sum, [index, coefficient]) => sum + coefficient * values[index], 0)

/** Dual coordinate projections enforce lower bounds without making slack bounds
 * equalities. A multiplier can return to zero, releasing a previously active
 * bound. Directions preserve every hard equality and are computed lazily. */
function solveWithBounds(rows: Row[], bounds: Row[], weights: number[]): number[] {
  const output = solve(rows, weights)
  if (!bounds.length) return output
  const directions = new Map<number, number[]>()
  const multipliers = bounds.map(() => 0)
  const homogeneous = rows.map(row => ({ ...row, value: 0 }))
  for (let iteration = 0; iteration < 256; iteration++) {
    let largestChange = 0
    for (const [index, bound] of bounds.entries()) {
      const deficit = bound.value - rowValue(bound, output)
      const next = Math.max(0, multipliers[index] + deficit)
      const change = next - multipliers[index]
      if (Math.abs(change) < 1e-8) continue
      let direction = directions.get(index)
      if (!direction) {
        direction = solve([...homogeneous, { ...bound, value: 1 }], weights)
        directions.set(index, direction)
      }
      multipliers[index] = next
      direction.forEach((value, variable) => { output[variable] += change * value })
      largestChange = Math.max(largestChange, Math.abs(change))
    }
    // Once projections identify the active set, solve it together. The dual
    // signs certify that none of these bounds should release; this avoids slow
    // one-neighbor-at-a-time convergence through long chains of minimum gaps.
    if (iteration % 8 === 0 && multipliers.some(value => value > 1e-8)) {
      const active = new Set(bounds.flatMap((_, index) => multipliers[index] > 1e-8 ? [index] : []))
      try {
        for (let expansion = 0; expansion <= bounds.length; expansion++) {
          const activeIndices = [...active]
          const dual: number[] = []
          const candidate = solve([...rows, ...activeIndices.map(index => bounds[index])], weights, dual)
          const negative = activeIndices.filter((_, index) => dual[rows.length + index] < -1e-7)
          if (negative.length) { negative.forEach(index => active.delete(index)); continue }
          const violated = bounds.flatMap((bound, index) => rowValue(bound, candidate) < bound.value - 1e-5 && !active.has(index) ? [index] : [])
          if (!violated.length) return candidate
          violated.forEach(index => active.add(index))
        }
      } catch { /* Keep projecting: a redundant or incompatible active set can release. */ }
    }
    if (largestChange < 1e-7 && output.every(Number.isFinite)
      && rows.every(row => Math.abs(rowValue(row, output) - row.value) <= 1e-5)
      && bounds.every(bound => rowValue(bound, output) >= bound.value - 1e-5)) return output
  }
  throw new Error(CONSTRAINT_MESSAGE)
}

function editComponent(project: Project, frames: Frame[], contacts: Contact[], ids: Set<string>, edit: Edit): Project {
  const indices = new Map(frames.map((item, index) => [item.panel.id, index]))
  const selected = frames.filter(item => ids.has(item.panel.id))
  if (!selected.length) return project
  const constraints = (project.constraints ?? []).filter(rule => rule.enabled && designConstraintPanelIds(rule).every(id => indices.has(id)))
  if (edit.kind === 'move' && selected.length === frames.length && !constraints.length) {
    return { ...project, panels: project.panels.map(panel => indices.has(panel.id) ? {
      ...panel, position: panel.position.map((value, axis) => value + edit.delta[axis]) as Vec3,
    } : panel) }
  }
  // Tangential changes are cheaper than moving a whole shelf/side out of its
  // plane. Dimensions are allowed to adapt while thickness remains physical.
  const weights = frames.flatMap(() => [1, 1, 64, 0.25, 0.25])
  const connections = project.connections.filter(connection => indices.has(connection.parentId) && indices.has(connection.childId))
  // Independent edge pulls may shift one branch center along a shared T/cross
  // joint without shifting the other branches or the physical hardware.
  const offsetKey = (connection: Connection) => edit.kind === 'resize' && edit.local ? connection.id : jointId(connection)
  const offsetVariables = new Map<string, number>()
  for (const connection of connections) if (!offsetVariables.has(offsetKey(connection))) {
    offsetVariables.set(offsetKey(connection), weights.length)
    weights.push(4)
  }
  const rows: Row[] = []
  const preferences = new Set<Row>()
  const bounds: Row[] = []
  const thicknessChange = (index: number) => edit.kind === 'resize'
    ? (edit.patches?.[frames[index].panel.id]?.thickness ?? frames[index].panel.thickness) - frames[index].panel.thickness : 0
  const row = (value = 0): Row => { const next = { entries: new Map<number, number>(), value }; rows.push(next); return next }
  const preference = (value = 0): Row => { const next = row(value); preferences.add(next); return next }
  const add = (target: Row, index: number, value: number) => target.entries.set(index, (target.entries.get(index) ?? 0) + value)
  const center = (target: Row, index: number, axis: Vector3, scale = 1) => {
    frames[index].axes.forEach((own, dimension) => add(target, index * 5 + dimension, own.dot(axis) * scale))
  }
  const edge = (target: Row, index: number, axis: Vector3, side: number, scale = 1) => {
    center(target, index, axis, scale)
    for (let dimension = 0; dimension < 2; dimension++) add(target, index * 5 + 3 + dimension, side * Math.abs(frames[index].axes[dimension].dot(axis)) * scale / 2)
    // Thickness is a prescribed physical input, never a free solver variable.
    target.value -= side * Math.abs(frames[index].axes[2].dot(axis)) * scale * thicknessChange(index) / 2
  }
  const worldAxes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const referenceSide = (reference: ConstraintReference) => reference === 'min' ? -1 : reference === 'max' ? 1 : 0
  const controlledDimensions = new Set(constraints.flatMap(rule => rule.kind === 'dimension' || rule.kind === 'equal-dimension'
    ? designConstraintPanelIds(rule).map(id => `${id}/${rule.dimension}`) : []))
  for (const evaluation of evaluateDesignConstraints(constraints, frames.map(item => item.panel))) {
    const rule = evaluation.constraint
    if (evaluation.issue) throw new Error(evaluation.issue)
    // Build the change in the measured quantity once. Edge contributions also
    // subtract prescribed thickness changes from the right-hand side.
    const target = row(-evaluation.actual)
    if (rule.kind === 'floor') {
      edge(target, indices.get(rule.panelId)!, worldAxes[1], referenceSide(rule.reference))
    } else if (rule.kind === 'dimension') {
      add(target, indices.get(rule.panelId)! * 5 + (rule.dimension === 'width' ? 3 : 4), 1)
    } else if (rule.kind === 'equal-dimension') {
      add(target, indices.get(rule.panelIds[1])! * 5 + (rule.dimension === 'width' ? 3 : 4), 1)
      add(target, indices.get(rule.panelIds[0])! * 5 + (rule.dimension === 'width' ? 3 : 4), -1)
    } else if (rule.kind === 'level') {
      edge(target, indices.get(rule.panelIds[1])!, worldAxes[1], referenceSide(rule.references[1]))
      edge(target, indices.get(rule.panelIds[0])!, worldAxes[1], referenceSide(rule.references[0]), -1)
    } else {
      const axis = worldAxes[['x', 'y', 'z'].indexOf(rule.axis)]
      edge(target, indices.get(rule.panelIds[1])!, axis, -1)
      edge(target, indices.get(rule.panelIds[0])!, axis, 1, -1)
    }
    const limits = designConstraintLimits(rule)
    if (limits.min !== undefined && limits.min === limits.max) target.value += limits.min
    else {
      rows.pop()
      if (limits.min !== undefined) bounds.push({ entries: target.entries, value: target.value + limits.min })
      if (limits.max !== undefined) bounds.push({ entries: new Map([...target.entries].map(([index, value]) => [index, -value])), value: -target.value - limits.max })
    }
  }
  // A relation between loose panels should move its peer, not make that panel
  // thinner/shorter merely because resizing has a lower objective weight.
  const physicallySupported = new Set(connections.flatMap(connection => [connection.parentId, connection.childId]))
  const constrainedPanelIds = new Set(constraints.flatMap(designConstraintPanelIds))
  contacts.forEach(contact => { physicallySupported.add(frames[contact.a].panel.id); physicallySupported.add(frames[contact.b].panel.id) })
  for (const [index, item] of frames.entries()) {
    if (!constraints.length) continue
    for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      const preservesOwnSize = edit.kind === 'reconcile' ? constrainedPanelIds.has(item.panel.id)
        : !physicallySupported.has(item.panel.id) && !ids.has(item.panel.id)
      if (preservesOwnSize && !controlledDimensions.has(`${item.panel.id}/${field}`)) add(row(), index * 5 + 3 + dimension, 1)
      // Bounds belong in the same solve, so another feasible placement can be
      // found instead of rejecting an unconstrained optimum beyond stock limits.
      bounds.push({ entries: new Map([[index * 5 + 3 + dimension, 1]]), value: 40 - item.panel[field] },
        { entries: new Map([[index * 5 + 3 + dimension, -1]]), value: item.panel[field] - 4000 })
    }
  }

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
    const thicknessShift = expected({ ...parent, thickness: parent.thickness + thicknessChange(parentIndex) },
      { ...child, thickness: child.thickness + thicknessChange(childIndex) }, connection.offset).sub(baseline)
    worldAxes.forEach(axis => {
      const constraint = row(thicknessShift.dot(axis))
      center(constraint, childIndex, axis)
      center(constraint, parentIndex, axis, -1)
      add(constraint, parentIndex * 5 + 3, -changes[0].dot(axis))
      add(constraint, parentIndex * 5 + 4, -changes[1].dot(axis))
      add(constraint, childIndex * 5 + 3, -changes[2].dot(axis))
      add(constraint, childIndex * 5 + 4, -changes[3].dot(axis))
      add(constraint, offsetVariables.get(offsetKey(connection))!, -changes[4].dot(axis))
    })
    if (edit.kind === 'resize' && !edit.local) {
      const horizontal = ['top', 'bottom', 'front', 'back'].includes(connection.side)
      const dimension = horizontal ? 0 : 1
      const childDimension = connection.quarterTurn ? 1 - dimension : dimension
      const parentLength = dimension === 0 ? parent.width : parent.height
      const childLength = childDimension === 0 ? child.width : child.height
      const overlap = Math.min(parentLength / 2, connection.offset + childLength / 2)
        - Math.max(-parentLength / 2, connection.offset - childLength / 2)
      // Preserve both existing end setbacks along the joint, even for inset
      // or previously edited panels. These rows constrain changes, so unequal
      // lengths retain their difference rather than being snapped flush.
      // Only preserving exactly flush ends lets a resize dissipate into joint
      // sliding and progressively different depths across the structure.
      // A joint covering half an edge or less can instead be one of several
      // split supports (e.g. two legs under a desktop); its spans must remain
      // independent, retaining only ends that were already flush.
      const spansJoint = overlap > Math.max(parentLength, childLength) / 2 + CONTACT_TOLERANCE
      for (const side of [-1, 1]) if (spansJoint || Math.abs(side * parentLength / 2 - connection.offset - side * childLength / 2) < CONTACT_TOLERANCE) {
        const constraint = row()
        add(constraint, parentIndex * 5 + 3 + dimension, side / 2)
        add(constraint, childIndex * 5 + 3 + childDimension, -side / 2)
        add(constraint, offsetVariables.get(offsetKey(connection))!, -1)
      }
    }
  }

  for (const contact of contacts) {
    const constraint = row()
    edge(constraint, contact.b, contact.normal, -contact.sign)
    edge(constraint, contact.a, contact.normal, contact.sign, -1)
    if (edit.kind === 'resize' && !edit.local) {
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
    if ((edit.kind === 'resize' && edit.local) || structural.has(item.panel.id) || (edit.kind === 'move' && ids.has(item.panel.id))) return
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
    if (edit.kind === 'reconcile') continue
    const index = indices.get(item.panel.id)!
    for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      const patch = edit.kind === 'resize' ? edit.patches?.[item.panel.id] ?? edit.patch : undefined
      // A parameter can drive any mixture of local panel axes. Keep every
      // bound value exact in the same solve, including unchanged controls.
      if (edit.kind === 'resize' && edit.patches && patch?.[field] === undefined) continue
      const target = row(patch?.[field] !== undefined ? patch[field]! - item.panel[field] : 0)
      add(target, index * 5 + 3 + dimension, 1)
    }
    if (edit.kind === 'move') worldAxes.forEach((axis, dimension) => center(row(edit.delta[dimension]), index, axis))
  }
  if (edit.kind === 'resize') {
    // An edge pull shifts the center by half the growth to anchor its opposite
    // edge. Numeric dimension edits keep the selected center stationary.
    for (const [dimension, axis] of worldAxes.entries()) {
      const constraint = (edit.centerDelta || edit.local ? row : preference)(edit.centerDelta?.[dimension] ?? 0)
      selected.forEach(item => center(constraint, indices.get(item.panel.id)!, axis, 1 / selected.length))
    }
  } else if (edit.kind === 'move') {
    const axis = new Vector3(...edit.delta).normalize()
    const physicalRoots = frames.map((_, index) => index)
    const physicalRoot = (index: number): number => { while (physicalRoots[index] !== index) { physicalRoots[index] = physicalRoots[physicalRoots[index]]; index = physicalRoots[index] } return index }
    for (const connection of connections) physicalRoots[physicalRoot(indices.get(connection.parentId)!)] = physicalRoot(indices.get(connection.childId)!)
    for (const contact of contacts) physicalRoots[physicalRoot(contact.a)] = physicalRoot(contact.b)
    const physicalGroups = new Map<number, number[]>()
    frames.forEach((_, index) => { const key = constraints.length ? physicalRoot(index) : 0; physicalGroups.set(key, [...physicalGroups.get(key) ?? [], index]) })
    // Move an outer boundary against its opposite boundary. Interior shelves
    // divide the existing opening, keeping both outside boundaries stationary.
    // A rule joins solve groups, but does not make their separate physical
    // structures into one opening with an artificial fixed outside boundary.
    for (const group of physicalGroups.values()) {
      const moving = group.filter(index => ids.has(frames[index].panel.id))
      if (!moving.length) continue
      const minimum = Math.min(...group.map(index => coordinate(frames[index], axis, -1)))
      const maximum = Math.max(...group.map(index => coordinate(frames[index], axis, 1)))
      const touchesMin = moving.some(index => Math.abs(coordinate(frames[index], axis, -1) - minimum) < CONTACT_TOLERANCE)
      const touchesMax = moving.some(index => Math.abs(coordinate(frames[index], axis, 1) - maximum) < CONTACT_TOLERANCE)
      for (const [side, boundary, touched] of [[-1, minimum, touchesMin], [1, maximum, touchesMax]] as const) {
        if (touched && !(touchesMin && touchesMax)) continue
        for (const index of group) {
          const item = frames[index]
          if (!ids.has(item.panel.id) && Math.abs(coordinate(item, axis, side) - boundary) < CONTACT_TOLERANCE) edge(preference(), index, axis, side)
        }
      }
    }
  } else {
    // A first/reference panel gives a new relationship a predictable direction.
    // A user-selected reference is fixed; only inferred anchors may yield.
    for (const rule of constraints) {
      const anchored = edit.anchorPanelId && designConstraintPanelIds(rule).includes(edit.anchorPanelId)
        && (!edit.ruleId || rule.id === edit.ruleId)
      const anchorRow = anchored ? row : preference
      if (rule.kind === 'equal-dimension') {
        const id = rule.panelIds.includes(edit.anchorPanelId ?? '') ? edit.anchorPanelId! : rule.panelIds[0]
        add(anchorRow(), indices.get(id)! * 5 + (rule.dimension === 'width' ? 3 : 4), 1)
      } else if (rule.kind === 'level' || rule.kind === 'gap') {
        const id = rule.panelIds.includes(edit.anchorPanelId ?? '') ? edit.anchorPanelId! : rule.panelIds[0]
        worldAxes.forEach(axis => center(anchorRow(), indices.get(id)!, axis))
      } else if (rule.kind === 'floor') {
        for (const axis of [worldAxes[0], worldAxes[2]]) center(preference(), indices.get(rule.panelId)!, axis)
      }
    }
  }

  if (edit.kind === 'resize' && edit.local) frames.forEach((item, index) => {
    if (ids.has(item.panel.id)) return
    for (let variable = 0; variable < 5; variable++) add(row(), index * 5 + variable, 1)
  })

  let changes: number[]
  try {
    try { changes = constraints.length ? solveWithBounds(rows, bounds, weights) : solve(rows, weights) }
    catch (error) {
      if (!constraints.length || !preferences.size) throw error
      // Explicit design intent outranks automatic center/exterior anchoring.
      // Joints, supported contacts, gesture targets and local-edit locks remain.
      changes = solveWithBounds(rows.filter(row => !preferences.has(row)), bounds, weights)
    }
  } catch (error) {
    if (!constraints.length) throw error
    throw new Error(`This edit cannot keep the design rules and joints satisfied. ${constraints.slice(0, 3).map(rule => describeDesignConstraint(rule, frames.map(item => item.panel))).join('; ')}. Edit or pause a rule first.`)
  }
  const changedPanels = new Map(frames.map((item, index) => {
    const moved = position(item.panel)
    item.axes.forEach((axis, dimension) => moved.addScaledVector(axis, changes[index * 5 + dimension]))
    const width = item.panel.width + changes[index * 5 + 3], height = item.panel.height + changes[index * 5 + 4]
    if (width < 40 - EPSILON || width > 4000 + EPSILON || height < 40 - EPSILON || height > 4000 + EPSILON) throw new Error(LIMIT_MESSAGE)
    const clean = (value: number, previous: number) => Math.abs(value - previous) < EPSILON ? previous : Math.round(value * 1e8) / 1e8
    return [item.panel.id, { ...item.panel, thickness: item.panel.thickness + thicknessChange(index), width: clean(Math.min(4000, Math.max(40, width)), item.panel.width), height: clean(Math.min(4000, Math.max(40, height)), item.panel.height),
      position: moved.toArray().map((value, axis) => clean(value, item.panel.position[axis])) as Vec3 }] as const
  }))
  return { ...project,
    panels: project.panels.map(panel => changedPanels.get(panel.id) ?? panel),
    connections: project.connections.map(connection => {
      const variable = offsetVariables.get(offsetKey(connection))
      return variable === undefined || Math.abs(changes[variable]) < EPSILON ? connection : { ...connection, offset: Math.round((connection.offset + changes[variable]) * 1e8) / 1e8 }
    }),
  }
}

function editStructure(project: Project, ids: readonly string[], edit: Edit, validation: ValidationContext = {}): Project {
  const wanted = new Set(ids)
  if (project.assemblies?.instances.length) {
    const managed = new Set(project.assemblies.instances.flatMap(instance => Object.values(instance.panelIds)))
    if ([...wanted].some(id => managed.has(id))) throw new Error('Edit the assembly source to change its panels, or move the assembly as a whole.')
    if ([...wanted].some(id => isPanelConnectedToAssembly(project, id))) throw new Error('Disconnect this panel from neighboring assemblies before changing its dimensions or position.')
    // Instances are rigid objects. Incidental surface contacts must never let
    // the loose-panel solver deform their materialized, linked source panels.
    const looseConnections = project.connections.filter(connection => !managed.has(connection.parentId) && !managed.has(connection.childId))
    const boundary = new Set(project.panels.filter(panel => !managed.has(panel.id) && isPanelConnectedToAssembly(project, panel.id)).map(panel => panel.id))
    const affected = new Set(wanted)
    const relations = [...project.connections.map(connection => [connection.parentId, connection.childId]),
      ...(project.constraints ?? []).filter(rule => rule.enabled).map(designConstraintPanelIds)]
    for (let changed = true; changed;) {
      changed = false
      for (const relation of relations) if (relation.some(id => affected.has(id))) for (const id of relation) {
        if (!affected.has(id)) { affected.add(id); changed = true }
      }
    }
    if ([...affected].some(id => managed.has(id) || boundary.has(id))) throw new Error('This design rule reaches a linked assembly. Edit its shared values or disassemble it before adjusting these panels.')
    const loose: Project = { version: 1, name: project.name, connectorOverrides: project.connectorOverrides, panels: project.panels.filter(panel => !managed.has(panel.id) && !boundary.has(panel.id)),
      connections: looseConnections.filter(connection => !boundary.has(connection.parentId) && !boundary.has(connection.childId)),
      constraints: project.constraints?.filter(rule => designConstraintPanelIds(rule).every(id => !managed.has(id) && !boundary.has(id))) }
    const edited = editStructure(loose, ids, edit, validation)
    const byId = new Map(edited.panels.map(panel => [panel.id, panel]))
    const connectionById = new Map(edited.connections.map(connection => [connection.id, connection]))
    return { ...project, connectorOverrides: edited.connectorOverrides, panels: project.panels.map(panel => byId.get(panel.id) ?? panel), connections: project.connections.map(connection => connectionById.get(connection.id) ?? connection) }
  }
  const panels = resolvePanels(project)
  if (!panels.some(panel => wanted.has(panel.id))) return project
  const frames = panels.map(frame)
  const contacts = findContacts(frames).filter(contact => edit.kind !== 'move' || !edit.releaseContacts
    || wanted.has(frames[contact.a].panel.id) === wanted.has(frames[contact.b].panel.id))
  const indices = new Map(panels.map((panel, index) => [panel.id, index]))
  const groups = panels.map((_, index) => index)
  const root = (index: number): number => { while (groups[index] !== index) { groups[index] = groups[groups[index]]; index = groups[index] } return index }
  const join = (a: number, b: number) => { groups[root(a)] = root(b) }
  project.connections.forEach(connection => { const a = indices.get(connection.parentId), b = indices.get(connection.childId); if (a !== undefined && b !== undefined) join(a, b) })
  contacts.forEach(contact => join(contact.a, contact.b))
  for (const rule of project.constraints ?? []) {
    if (!rule.enabled) continue
    const [first, ...rest] = designConstraintPanelIds(rule).map(id => indices.get(id))
    if (first !== undefined) for (const index of rest) if (index !== undefined) join(first, index)
  }
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
  if (edit.kind === 'resize' && edit.local) {
    const overrides = { ...project.connectorOverrides }
    const connectionsById = new Map(next.connections.map(connection => [connection.id, connection]))
    for (const piece of getPhysicalConnectors(project)) {
      const before = getConnectorRail(piece.connection, panels, project.connections)
      const connection = connectionsById.get(piece.connection.id)!
      const after = getConnectorRail(connection, next.panels, next.connections)
      if (!before || !after) continue
      const original = new Vector3(...before.placements[piece.index].position).addScaledVector(new Vector3(...before.tangent),
        connectorSlide(before, piece.index, project.connectorOverrides?.[piece.id]?.slide))
      const delta = original.clone().sub(new Vector3(...after.placements[piece.index].position))
      const slide = delta.dot(new Vector3(...after.tangent))
      const actual = new Vector3(...after.placements[piece.index].position).addScaledVector(new Vector3(...after.tangent), connectorSlide(after, piece.index, slide))
      if (actual.distanceTo(original) > EPSILON) throw new Error('This resize would move a connector.')
      if (Math.abs(slide - (overrides[piece.id]?.slide ?? 0)) > EPSILON) overrides[piece.id] = { ...overrides[piece.id], slide }
    }
    next = { ...next, connectorOverrides: Object.keys(overrides).length ? overrides : project.connectorOverrides }
  }
  const previousErrors = new Set(validateProject(project, validation).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const newError = validateProject(next, validation).find(issue => issue.severity === 'error' && !previousErrors.has(issue.id))
  if (newError) throw new Error(`Cannot keep this edit connected: ${newError.message}`)
  const affectedRoots = new Set([...wanted].flatMap(id => indices.has(id) ? [root(indices.get(id)!)] : []))
  const violatedRule = evaluateDesignConstraints(next.constraints, next.panels).find(result => result.constraint.enabled && result.violation > 0
    && designConstraintPanelIds(result.constraint).some(id => indices.has(id) && affectedRoots.has(root(indices.get(id)!))))
  if (violatedRule) throw new Error(`Cannot satisfy this design rule: ${describeDesignConstraint(violatedRule.constraint, next.panels)}.`)
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

/** Apply new or re-enabled rules as one immutable structural edit. The anchor
 * panel is the reference when bringing a pair's values into agreement. */
export function reconcileDesignConstraints(project: Project, anchorPanelId?: string, ruleId?: string): Project {
  const evaluations = evaluateDesignConstraints(project.constraints, resolvePanels(project)).filter(result => result.constraint.enabled
    && (!ruleId || result.constraint.id === ruleId))
  const invalid = evaluations.find(result => result.issue)
  if (invalid) throw new Error(invalid.issue)
  const changed = evaluations.filter(result => result.violation > 0)
  if (!changed.length) return project
  const ids = [...new Set(changed.flatMap(result => designConstraintPanelIds(result.constraint)))]
  const next = editStructure(project, ids, { kind: 'reconcile', anchorPanelId, ruleId })
  const remaining = evaluateDesignConstraints(next.constraints, resolvePanels(next)).find(result => result.constraint.enabled && result.violation > 0
    && (!ruleId || result.constraint.id === ruleId))
  if (remaining) throw new Error(`Cannot satisfy this design rule: ${describeDesignConstraint(remaining.constraint, next.panels)}.`)
  return next
}

/** Move selected panels by an exact world-space displacement, adapting connected spans. */
export function movePanels(project: Project, ids: readonly string[], delta: Vec3, options: { releaseContacts?: boolean } = {}): Project {
  if (delta.some(value => !Number.isFinite(value))) throw new Error('Panel movement must be a finite distance.')
  if (delta.every(value => Math.abs(value) < EPSILON)) return project
  return editStructure(project, ids, { kind: 'move', delta, releaseContacts: options.releaseContacts })
}

/** Resize a selection while keeping structural joints and existing inserts fitted. */
export function resizePanels(project: Project, ids: readonly string[], patch: Dimensions, validation: ValidationContext = {}): Project {
  if (Object.values(patch).some(value => value !== undefined && (!Number.isFinite(value) || value < 40 || value > 4000))) throw new Error(LIMIT_MESSAGE)
  const wanted = new Set(ids)
  if (!project.panels.some(panel => wanted.has(panel.id) && (['width', 'height'] as const).some(field => patch[field] !== undefined && Math.abs(panel[field] - patch[field]!) > EPSILON))) return project
  return editStructure(project, ids, { kind: 'resize', patch }, validation)
}

/** Pull one panel edge, anchoring its opposite edge. Local edits also fix other panels and hardware. */
export function resizePanelEdge(project: Project, id: string, dimension: 'width' | 'height', side: -1 | 1, distance: number, local = false): Project {
  if (!Number.isFinite(distance)) throw new Error('Panel movement must be a finite distance.')
  if (Math.abs(distance) < EPSILON) return project
  const panel = resolvePanels(project).find(panel => panel.id === id)
  if (!panel) return project
  const size = panel[dimension] + distance
  if (size < 40 || size > 4000) throw new Error(LIMIT_MESSAGE)
  const axis = frame(panel).axes[dimension === 'width' ? 0 : 1]
  return editStructure(project, [id], { kind: 'resize', patch: { [dimension]: size }, local,
    centerDelta: axis.multiplyScalar(side * distance / 2).toArray() as Vec3 })
}

/** Simultaneous independent targets, used by assembly instance parameters. */
export function resizePanelDimensions(project: Project, patches: Record<string, PanelDimensions>, validation: ValidationContext = {}): Project {
  for (const patch of Object.values(patches)) for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < (field === 'thickness' ? 3 : 40) || value > (field === 'thickness' ? 100 : 4000)) {
      throw new Error(field === 'thickness' ? 'Panel thickness must be between 3 and 100 mm.' : LIMIT_MESSAGE)
    }
  }
  const ids = Object.keys(patches)
  if (ids.some(id => !project.panels.some(panel => panel.id === id))) throw new Error('A configurable dimension refers to a missing panel.')
  const ownPatches: Record<string, PanelDimensions> = Object.assign(Object.create(null), patches)
  if (!project.panels.some(panel => (['width', 'height', 'thickness'] as const).some(field => ownPatches[panel.id]?.[field] !== undefined && Math.abs(panel[field] - ownPatches[panel.id][field]!) > EPSILON))) return project
  return editStructure(project, ids, { kind: 'resize', patch: {}, patches: ownPatches }, validation)
}
