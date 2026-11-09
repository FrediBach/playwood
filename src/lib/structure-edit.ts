import { assertDesignConstraintEdit } from './design-constraint-edits'
import { Euler, Quaternion, Vector3 } from 'three'
import { resolvePanels, validateProject } from './model'
import { connectorSlide, getConnectorRail, rescaleConnectorSlides } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { isPanelConnectedToAssembly } from './assemblies'
import { designConstraintLimits, designConstraintCoordinate, designConstraintPanelIds, describeDesignConstraint, evaluateDesignConstraints } from './design-constraints'
import { refitOutlineClosures } from './outline-closures'
import { assertNoNewTrofastIssues } from './trofast'
import type { Connection, ConstraintReference, Panel, Project, Vec3 } from './types'

const EPSILON = 1e-6
const CONTACT_TOLERANCE = 1e-4
const LIMIT_MESSAGE = 'This move would exceed the panel size limits (40–4,000 mm). Try a smaller step.'
const CONSTRAINT_MESSAGE = 'These panels cannot move in that direction while keeping their joints connected. Try another direction or select the whole assembly.'

export interface InferredRelationship {
  id: string
  kind: 'setback' | 'alignment' | 'compartment-fit'
  description: string
  panelIds: string[]
}

/** Transient diagnostics for rejected edits; never part of a saved project. */
export class StructureEditError extends Error {
  constructor(message: string, public panelIds: string[], public connectionIds: string[] = [], public inferredRelationships: InferredRelationship[] = []) { super(message) }
}
class SolverConflict extends Error {
  constructor(public variables: number[], message = CONSTRAINT_MESSAGE) { super(message) }
}

type Dimensions = Partial<Pick<Panel, 'width' | 'height'>>
type PanelDimensions = Partial<Pick<Panel, 'width' | 'height' | 'thickness'>>
type Row = { entries: Map<number, number>; value: number; stockBound?: boolean; inferred?: InferredRelationship }
type Frame = { panel: Panel; axes: Vector3[]; half: number[] }
type Contact = { a: number; b: number; normal: Vector3; sign: number }
export interface SelectionStretchEdge { panelId: string; dimension: 'width' | 'height'; side: -1 | 1 }
type MovementScope = { panelIds: Set<string>; reference: number; preserveCuts?: Set<string> }
type Edit = { kind: 'move'; delta: Vec3; deltas?: Record<string, Vec3>; releaseContacts?: boolean; scope?: MovementScope; stretch?: readonly SelectionStretchEdge[] } | { kind: 'resize'; relaxedRelationship?: string; patch: Dimensions; patches?: Record<string, PanelDimensions>; centerDelta?: Vec3; centerDeltas?: Record<string, Vec3>; local?: boolean; refitOutlinePanelIds?: readonly string[] } | { kind: 'reconcile'; anchorPanelId?: string; ruleId?: string } | { kind: 'fit'; connection: Connection }
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

/** The same implicit surface supports used by structural edits. */
export function panelSurfaceContacts(project: Project): { panelIds: [string, string]; normal: Vec3 }[] {
  const frames = resolvePanels(project).map(frame)
  const outlines = new Set(project.connections.filter(connection => connection.outlineEdge !== undefined).map(connection => connection.childId))
  return findContacts(frames).filter(contact => !outlines.has(frames[contact.a].panel.id) && !outlines.has(frames[contact.b].panel.id))
    .map(contact => ({ panelIds: [frames[contact.a].panel.id, frames[contact.b].panel.id], normal: contact.normal.toArray() as Vec3 }))
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
      if (Math.abs(row.value) > EPSILON) throw new SolverConflict([...row.entries.keys()])
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
  // Keep the best iterate: tiny imported rotation/offset drift can make a
  // redundant closed loop diverge after it already reached a usable solution.
  let bestError = error
  let bestSolution = solution.slice()
  const threshold = Math.max(1e-18, error * 1e-22)
  for (let iteration = 0; error > threshold && iteration < Math.max(200, count * 6); iteration++) {
    const product = multiply(direction)
    const denominator = dot(direction, product)
    if (!Number.isFinite(denominator) || denominator < 1e-24) break
    const alpha = error / denominator
    for (let i = 0; i < count; i++) { solution[i] += alpha * direction[i]; residual[i] -= alpha * product[i] }
    const nextError = dot(residual, residual)
    if (nextError < bestError) { bestError = nextError; bestSolution = solution.slice() }
    const beta = nextError / error
    for (let i = 0; i < count; i++) direction[i] = residual[i] + beta * direction[i]
    error = nextError
  }
  const result = () => {
    const output = Array<number>(size).fill(0)
    equations.forEach((row, i) => { for (const [index, coefficient] of row.entries) output[index] += coefficient * solution[i] * inverseScale[index] })
    return output
  }
  const valid = (output: number[]) => output.every(Number.isFinite) && rows.every(row =>
    Math.abs([...row.entries].reduce((sum, [index, value]) => sum + value * output[index], 0) - row.value) <= 1e-5)
  let output = result()
  if (!valid(output)) {
    solution.set(bestSolution)
    output = result()
    // The fallback must satisfy the same original equations and tolerance.
    if (!valid(output)) throw new SolverConflict([...new Set(rows.filter(row =>
      Math.abs(rowValue(row, output) - row.value) > 1e-5).flatMap(row => [...row.entries.keys()]))])
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
        try { direction = solve([...homogeneous, { ...bound, value: 1 }], weights) }
        catch (error) {
          if (bound.stockBound && error instanceof SolverConflict) throw new SolverConflict(error.variables, LIMIT_MESSAGE)
          throw error
        }
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
  throw new SolverConflict([...new Set([
    ...rows.filter(row => Math.abs(rowValue(row, output) - row.value) > 1e-5),
    ...bounds.filter(bound => rowValue(bound, output) < bound.value - 1e-5),
  ].flatMap(row => [...row.entries.keys()]))], bounds.some(bound => bound.stockBound && rowValue(bound, output) < bound.value - 1e-5)
    ? LIMIT_MESSAGE : CONSTRAINT_MESSAGE)
}

function editComponent(project: Project, frames: Frame[], contacts: Contact[], ids: Set<string>, edit: Edit): Project {
  const indices = new Map(frames.map((item, index) => [item.panel.id, index]))
  const selected = frames.filter(item => ids.has(item.panel.id))
  if (!selected.length) return project
  const constraints = (project.constraints ?? []).filter(rule => rule.enabled && designConstraintPanelIds(rule).every(id => indices.has(id)))
  if (edit.kind === 'move' && !edit.deltas && selected.length === frames.length && !constraints.length) {
    return { ...project, panels: project.panels.map(panel => indices.has(panel.id) ? {
      ...panel, position: panel.position.map((value, axis) => value + edit.delta[axis]) as Vec3,
    } : panel) }
  }
  // Tangential changes are cheaper than moving a whole shelf/side out of its
  // plane. Dimensions are allowed to adapt while thickness remains physical.
  const weights = frames.flatMap(() => [1, 1, 64, 0.25, 0.25])
  const connections = [...project.connections, ...(edit.kind === 'fit' ? [edit.connection] : [])].filter(connection => indices.has(connection.parentId) && indices.has(connection.childId))
  // Two retained seam ends transmit a cut change; one end transmits only
  // placement. Track those dimension groups separately from physical joints.
  const cutGroups = frames.flatMap((_, index) => [index * 2, index * 2 + 1])
  const cutRoot = (index: number): number => {
    while (cutGroups[index] !== index) { cutGroups[index] = cutGroups[cutGroups[index]]; index = cutGroups[index] }
    return index
  }
  const radialCuts = new Set<number>()
  const joinedPanels = new Set<number>()
  contacts.forEach(contact => { radialCuts.add(contact.a * 2); radialCuts.add(contact.a * 2 + 1); radialCuts.add(contact.b * 2); radialCuts.add(contact.b * 2 + 1) })
  const seamFits = new Map(connections.map(connection => {
    const dimension = ['top', 'bottom', 'front', 'back'].includes(connection.side) ? 0 : 1
    const childDimension = connection.quarterTurn ? 1 - dimension : dimension
    const parent = frames[indices.get(connection.parentId)!].panel, child = frames[indices.get(connection.childId)!].panel
    const parentLength = dimension === 0 ? parent.width : parent.height
    const childLength = childDimension === 0 ? child.width : child.height
    const overlap = Math.min(parentLength / 2, connection.offset + childLength / 2)
      - Math.max(-parentLength / 2, connection.offset - childLength / 2)
    // Preserve modest setbacks on substantially shared seams. A shallow
    // branch on a deeper panel retains its near end, but a far overhang
    // larger than two thirds of the shared seam is not an inferred fit.
    const spansJoint = overlap > Math.max(parentLength, childLength) / 2 + CONTACT_TOLERANCE
    const retainedEnds = [-1, 1].filter(side => {
      const setback = Math.abs(side * parentLength / 2 - connection.offset - side * childLength / 2)
      return setback < CONTACT_TOLERANCE || (spansJoint && overlap > setback * 1.5 + CONTACT_TOLERANCE)
    })
    return [connection.id, { dimension, childDimension, retainedEnds }] as const
  }))
  // Movement and independent edge pulls may shift one branch center along a
  // shared T/cross joint without dragging the other branches along its seam.
  // A partial-depth branch also needs its own offset to follow its near end
  // without imposing the full-depth branch's cut on the shorter panel.
  const offsetKey = (connection: Connection) => (edit.kind === 'move' || (edit.kind === 'resize' && edit.local) || edit.kind === 'fit'
    || (seamFits.get(connection.id)?.retainedEnds.length ?? 2) < 2) ? connection.id : jointId(connection)
  const offsetVariables = new Map<string, number>()
  for (const connection of connections) if (!offsetVariables.has(offsetKey(connection))) {
    offsetVariables.set(offsetKey(connection), weights.length)
    weights.push(4)
  }
  const rows: Row[] = []
  const preferences = new Set<Row>()
  const cutPreferences = new Set<Row>()
  const interiorPreferences = new Set<Row>()
  const boundaryPreferences: { rows: Set<Row>; distance: number }[] = []
  const bounds: Row[] = []
  const thicknessChange = (index: number) => edit.kind === 'resize'
    ? (edit.patches?.[frames[index].panel.id]?.thickness ?? frames[index].panel.thickness) - frames[index].panel.thickness : 0
  const row = (value = 0): Row => { const next = { entries: new Map<number, number>(), value }; rows.push(next); return next }
  const inferred = (kind: InferredRelationship['kind'], key: unknown[], a: number, b: number, detail: string): Row => {
    const first = frames[a].panel, second = frames[b].panel
    const relationship: InferredRelationship = { id: JSON.stringify([kind, first.id, second.id, ...key]), kind,
      description: `${first.name} / ${second.name}: ${detail}`, panelIds: [first.id, second.id] }
    const next: Row = { entries: new Map(), value: 0, inferred: relationship }
    if (edit.kind !== 'resize' || edit.relaxedRelationship !== relationship.id) rows.push(next)
    return next
  }
  const edgeName = (dimension: number, side: number) => dimension === 2 ? `${side < 0 ? 'negative' : 'positive'} thickness face` : `${dimension === 0 ? (side < 0 ? 'left' : 'right') : (side < 0 ? 'bottom' : 'top')} cut edge`
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
  const physicallySupported = new Set(connections.flatMap(connection => [connection.parentId, connection.childId]))
  contacts.forEach(contact => { physicallySupported.add(frames[contact.a].panel.id); physicallySupported.add(frames[contact.b].panel.id) })
  const controlledDimensions = new Set<string>()
  for (const evaluation of evaluateDesignConstraints(constraints, frames.map(item => item.panel))) {
    const rule = evaluation.constraint
    if (evaluation.issue) throw new Error(evaluation.issue)
    const limits = designConstraintLimits(rule)
    // A permitted interval alone does not authorize recutting a loose peer.
    // Exact dimensions and matching cuts do; reconciliation also needs to
    // repair violated dimension limits and adapt physically supported spans.
    if (rule.kind === 'equal-dimension' || (rule.kind === 'dimension'
      && ((limits.min !== undefined && limits.min === limits.max)
        || (edit.kind === 'reconcile' && (evaluation.violation > 0 || physicallySupported.has(rule.panelId)))))) {
      designConstraintPanelIds(rule).forEach((id, index) => {
        const dimension = rule.kind === 'equal-dimension' && index === 1 ? rule.secondDimension ?? rule.dimension : rule.dimension
        controlledDimensions.add(`${id}/${dimension}`)
      })
    }
    // Build the change in the measured quantity once. Edge contributions also
    // subtract prescribed thickness changes from the right-hand side.
    const target = row(-evaluation.actual)
    if (rule.kind === 'position') {
      edge(target, indices.get(rule.panelId)!, worldAxes[['x', 'y', 'z'].indexOf(rule.axis)], referenceSide(rule.reference))
    } else if (rule.kind === 'setback') {
      const axis = worldAxes[['x', 'y', 'z'].indexOf(rule.axis)]
      edge(target, indices.get(rule.panelIds[1])!, axis, referenceSide(rule.references[1]))
      edge(target, indices.get(rule.panelIds[0])!, axis, referenceSide(rule.references[0]), -1)
    } else if (rule.kind === 'floor') {
      edge(target, indices.get(rule.panelId)!, worldAxes[1], referenceSide(rule.reference))
    } else if (rule.kind === 'dimension') {
      add(target, indices.get(rule.panelId)! * 5 + (rule.dimension === 'width' ? 3 : 4), 1)
    } else if (rule.kind === 'equal-dimension') {
      add(target, indices.get(rule.panelIds[1])! * 5 + ((rule.secondDimension ?? rule.dimension) === 'width' ? 3 : 4), 1)
      add(target, indices.get(rule.panelIds[0])! * 5 + (rule.dimension === 'width' ? 3 : 4), -1)
    } else if (rule.kind === 'opening-ratio') {
      const axis = worldAxes[['x', 'y', 'z'].indexOf(rule.axis)]
      for (const [start, factor] of [[0, -rule.ratio], [2, 1]]) {
        const a = indices.get(rule.panelIds[start])!, b = indices.get(rule.panelIds[start + 1])!
        edge(target, b, axis, -1, factor)
        edge(target, a, axis, 1, -factor)
        const gap = designConstraintCoordinate(frames[b].panel, 'min', rule.axis) - designConstraintCoordinate(frames[a].panel, 'max', rule.axis)
        const nonnegative = { entries: new Map<number, number>(), value: -gap }
        edge(nonnegative, b, axis, -1)
        edge(nonnegative, a, axis, 1, -1)
        bounds.push(nonnegative)
      }
    } else if (rule.kind === 'level') {
      edge(target, indices.get(rule.panelIds[1])!, worldAxes[1], referenceSide(rule.references[1]))
      edge(target, indices.get(rule.panelIds[0])!, worldAxes[1], referenceSide(rule.references[0]), -1)
    } else {
      const axis = worldAxes[['x', 'y', 'z'].indexOf(rule.axis)]
      edge(target, indices.get(rule.panelIds[1])!, axis, -1)
      edge(target, indices.get(rule.panelIds[0])!, axis, 1, -1)
    }
    if (limits.min !== undefined && limits.min === limits.max) target.value += limits.min
    else {
      rows.pop()
      if (limits.min !== undefined) bounds.push({ entries: target.entries, value: target.value + limits.min })
      if (limits.max !== undefined) bounds.push({ entries: new Map([...target.entries].map(([index, value]) => [index, -value])), value: -target.value - limits.max })
    }
  }
  // A relation between loose panels should move its peer, not make that panel
  // thinner/shorter merely because resizing has a lower objective weight.
  const constrainedPanelIds = new Set(constraints.flatMap(designConstraintPanelIds))
  for (const [index, item] of frames.entries()) {
    for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      const preservesOwnSize = edit.kind === 'reconcile' ? constrainedPanelIds.has(item.panel.id)
        : !physicallySupported.has(item.panel.id) && !ids.has(item.panel.id)
      if (constraints.length && preservesOwnSize && !controlledDimensions.has(`${item.panel.id}/${field}`)) add(row(), index * 5 + 3 + dimension, 1)
      // Bounds belong in the same solve, so another feasible placement can be
      // found instead of rejecting an unconstrained optimum beyond stock limits.
      bounds.push({ entries: new Map([[index * 5 + 3 + dimension, 1]]), value: 40 - item.panel[field], stockBound: true },
        { entries: new Map([[index * 5 + 3 + dimension, -1]]), value: item.panel[field] - 4000, stockBound: true })
    }
  }

  const movementAxis = edit.kind === 'move' && !edit.deltas && !edit.scope && selected.length === 1
    ? new Vector3(...edit.delta).normalize() : undefined
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
      const constraint = row(thicknessShift.dot(axis) + (edit.kind === 'fit' && connection.id === edit.connection.id ? baseline.clone().sub(position(child)).dot(axis) : 0))
      center(constraint, childIndex, axis)
      center(constraint, parentIndex, axis, -1)
      add(constraint, parentIndex * 5 + 3, -changes[0].dot(axis))
      add(constraint, parentIndex * 5 + 4, -changes[1].dot(axis))
      add(constraint, childIndex * 5 + 3, -changes[2].dot(axis))
      add(constraint, childIndex * 5 + 4, -changes[3].dot(axis))
      add(constraint, offsetVariables.get(offsetKey(connection))!, -changes[4].dot(axis))
    })
    // Moving a boundary with a connected-resize arrow also changes spans
    // along its normal. Keep their joint-end alignments just as for a cut
    // resize; otherwise each support can slide and acquire a different cut.
    const seamDimension = ['top', 'bottom', 'front', 'back'].includes(connection.side) ? 0 : 1
    const childSeamDimension = connection.quarterTurn ? 1 - seamDimension : seamDimension
    joinedPanels.add(parentIndex)
    joinedPanels.add(childIndex)
    radialCuts.add(parentIndex * 2 + 1 - seamDimension)
    radialCuts.add(childIndex * 2 + 1 - childSeamDimension)
    const movingSpan = movementAxis && Math.abs(selected[0].axes[2].dot(movementAxis)) > 1 - EPSILON
      && Math.abs(frames[parentIndex].axes[seamDimension].dot(movementAxis)) > 1 - EPSILON
    if ((edit.kind === 'resize' && !edit.local) || movingSpan) {
      const { dimension, childDimension, retainedEnds } = seamFits.get(connection.id)!
      if (retainedEnds.length === 2) cutGroups[cutRoot(parentIndex * 2 + dimension)] = cutRoot(childIndex * 2 + childDimension)
      for (const side of retainedEnds) {
        const constraint = inferred('setback', [connection.id, side], parentIndex, childIndex,
          `preserve setback at the parent’s ${edgeName(dimension, side)}`)
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
          const dimension = frames[contact.a].axes.indexOf(axis)
          const flush = inferred('alignment', [dimension, side], contact.a, contact.b,
            `keep the ${edgeName(dimension, side)} aligned`)
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
            const constraint = inferred('compartment-fit', [dimension, side], index, boundary.index,
              `preserve clearance at the ${edgeName(dimension, side)}`)
            edge(constraint, index, axis, side)
            edge(constraint, boundary.index, axis, -side, -1)
          }
        } else if (dimension === 2 && !contacts.some(contact => Math.abs(contact.normal.dot(axis)) > 1 - EPSILON
          && ((contact.a === index && structural.has(frames[contact.b].panel.id)) || (contact.b === index && structural.has(frames[contact.a].panel.id))))) {
          // Centered dividers stay centered; inset box sides retain their
          // small clearance. Other placements are already determined by the
          // insert's own contacts (several boxes may share one compartment).
          if (Math.abs(centerAt - (lower.coordinate + upper.coordinate) / 2) < CONTACT_TOLERANCE) {
            const constraint = inferred('compartment-fit', [dimension, 'center', upper.index], index, lower.index,
              `keep centered between ${frames[lower.index].panel.name} and ${frames[upper.index].panel.name}`)
            center(constraint, index, axis)
            edge(constraint, lower.index, axis, 1, -0.5)
            edge(constraint, upper.index, axis, -1, -0.5)
          } else {
            const clearance = Math.max(item.panel.thickness, 10)
            for (const [side, boundary, gap] of [[-1, lower, minimum - lower.coordinate], [1, upper, upper.coordinate - maximum]] as const) {
              if (gap > clearance || gap > opening * 0.1) continue
              const constraint = inferred('compartment-fit', [dimension, side], index, boundary.index,
                `preserve clearance at the ${side < 0 ? 'negative' : 'positive'} thickness face`)
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
        const constraint = inferred('compartment-fit', [dimension, side, 'support'], index, supports[0].index,
          `preserve margin at the ${edgeName(dimension, side)}`)
        edge(constraint, index, axis, side)
        edge(constraint, supports[0].index, axis, side, -1)
      }
    })
  })

  if (edit.kind === 'resize' || edit.kind === 'move') {
    // Translating an angled appendage is preferable to recutting it merely
    // to reduce the weighted translation cost. Likewise, a cut used only as
    // a seam length should change only when the requested cut reaches it
    // through paired end alignments. Real radial spans and authored cut
    // rules remain free; necessary exceptions are solved below.
    const requestedAxes = selected.flatMap(item => {
      if (edit.kind === 'move') {
        const delta = new Vector3(...(edit.deltas?.[item.panel.id] ?? edit.delta))
        return delta.lengthSq() > EPSILON * EPSILON ? [delta.normalize()] : []
      }
      const patch = edit.patches?.[item.panel.id] ?? edit.patch
      return (['width', 'height'] as const).flatMap((dimension, index) => patch[dimension] !== undefined
        && Math.abs(patch[dimension]! - item.panel[dimension]) > EPSILON ? [item.axes[index]] : [])
    })
    const requestedCuts = new Set(selected.flatMap(item => {
      if (edit.kind !== 'resize') return []
      const patch = edit.patches?.[item.panel.id] ?? edit.patch
      return (['width', 'height'] as const).flatMap((dimension, index) => patch[dimension] !== undefined
        && Math.abs(patch[dimension]! - item.panel[dimension]) > EPSILON ? [cutRoot(indices.get(item.panel.id)! * 2 + index)] : [])
    }))
    for (const [index, item] of frames.entries()) for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      if (ids.has(item.panel.id) || controlledDimensions.has(`${item.panel.id}/${field}`)) continue
      // Rule-related loose peers already have hard cut-preservation rows.
      if (constraints.length && !physicallySupported.has(item.panel.id)) continue
      const transverse = requestedAxes.length && requestedAxes.every(axis => Math.abs(axis.dot(item.axes[dimension])) < 1 - EPSILON)
      const independentSeam = edit.kind === 'resize' && joinedPanels.has(index) && !radialCuts.has(index * 2 + dimension)
        && !requestedCuts.has(cutRoot(index * 2 + dimension))
      if (transverse || independentSeam) {
        const preserve = row()
        cutPreferences.add(preserve)
        add(preserve, index * 5 + 3 + dimension, 1)
      }
    }
  }

  for (const item of selected) {
    if (edit.kind === 'reconcile' || edit.kind === 'fit') continue
    const index = indices.get(item.panel.id)!
    for (const [dimension, field] of (['width', 'height'] as const).entries()) {
      const patch = edit.kind === 'resize' ? edit.patches?.[item.panel.id] ?? edit.patch : undefined
      // A parameter can drive any mixture of local panel axes. Keep every
      // bound value exact in the same solve, including unchanged controls.
      if (edit.kind === 'resize' && edit.patches && patch?.[field] === undefined) continue
      const target = row(patch?.[field] !== undefined ? patch[field]! - item.panel[field] : 0)
      add(target, index * 5 + 3 + dimension, 1)
    }
    if (edit.kind === 'move') worldAxes.forEach((axis, dimension) => center(row((edit.deltas?.[item.panel.id] ?? edit.delta)[dimension]), index, axis))
  }
  if (edit.kind === 'resize') {
    // An edge pull shifts the center by half the growth to anchor its opposite
    // edge. Numeric dimension edits keep the selected center stationary.
    if (edit.centerDeltas) for (const item of selected) {
      for (const [dimension, axis] of worldAxes.entries()) center(row(edit.centerDeltas[item.panel.id]?.[dimension] ?? 0), indices.get(item.panel.id)!, axis)
    } else for (const [dimension, axis] of worldAxes.entries()) {
        const constraint = (edit.centerDelta || edit.local ? row : preference)(edit.centerDelta?.[dimension] ?? 0)
        selected.forEach(item => center(constraint, indices.get(item.panel.id)!, axis, 1 / selected.length))
      }
  } else if (edit.kind === 'move' && edit.stretch) {
    // A selection stretch has an explicit boundary. Neither saved rules nor
    // inferred preferences may recut or move anything beyond that boundary.
    const spans = new Map(edit.stretch.map(edge => [edge.panelId, edge]))
    const delta = new Vector3(...edit.delta)
    for (const [index, item] of frames.entries()) {
      if (ids.has(item.panel.id)) continue
      const span = spans.get(item.panel.id)
      const dimension = span?.dimension === 'width' ? 0 : 1
      for (let variable = 0; variable < 5; variable++) {
        const value = !span ? 0 : variable === dimension ? item.axes[dimension].dot(delta) / 2
          : variable === 3 + dimension ? item.axes[dimension].dot(delta) * span.side : 0
        add(row(value), index * 5 + variable, 1)
      }
    }
  } else if (edit.kind === 'move' && edit.scope) {
    const axis = new Vector3(...edit.delta).normalize()
    for (const [index, item] of frames.entries()) {
      if (!edit.scope.panelIds.has(item.panel.id)) {
        for (let variable = 0; variable < 5; variable++) add(row(), index * 5 + variable, 1)
        continue
      }
      if (ids.has(item.panel.id)) continue
      // A compartment boundary travels along the requested normal without
      // recutting. Only spans along that axis may change their length.
      item.axes.forEach((own, dimension) => {
        if (Math.abs(own.dot(axis)) < 1 - EPSILON) {
          add(row(), index * 5 + dimension, 1)
          if (dimension < 2) add(row(), index * 5 + 3 + dimension, 1)
        }
      })
      if (edit.scope.preserveCuts?.has(item.panel.id)) {
        for (let dimension = 0; dimension < 2; dimension++) if (Math.abs(item.axes[dimension].dot(axis)) > 1 - EPSILON) add(row(), index * 5 + 3 + dimension, 1)
      }
      // The opposite outside face is the deliberate placement reference,
      // including continuous back/side panels spanning several compartments.
      if (Math.abs(coordinate(item, axis, -1) - edit.scope.reference) < CONTACT_TOLERANCE) edge(row(), index, axis, -1)
    }
  } else if (edit.kind === 'move') {
    const direction = edit.deltas ? selected.map(item => edit.deltas![item.panel.id]).find(delta => delta?.some(value => Math.abs(value) > EPSILON)) ?? edit.delta : edit.delta
    const axis = new Vector3(...direction).normalize()
    // Anchor priority describes the construction, not the sign of the gesture.
    if ((axis.toArray().find(value => Math.abs(value) > EPSILON) ?? 0) < 0) axis.negate()
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
      const level = moving.reduce((sum, index) => sum + coordinate(frames[index], axis), 0) / moving.length
      const ends = new Map([-1, 1].map(side => [side, {
        rows: new Set<Row>(), distance: Math.abs((side === -1 ? minimum : maximum) - level),
      }]))
      boundaryPreferences.push(...ends.values())
      const touchesMin = moving.some(index => Math.abs(coordinate(frames[index], axis, -1) - minimum) < CONTACT_TOLERANCE)
      const touchesMax = moving.some(index => Math.abs(coordinate(frames[index], axis, 1) - maximum) < CONTACT_TOLERANCE)
      if (edit.kind === 'move' && moving.length === 1 && !touchesMin && !touchesMax
        && Math.abs(frames[moving[0]].axes[2].dot(axis)) > 1 - EPSILON) {
        // An interior shelf divides local spans, even when feet and upper
        // compartments do not coincide with the component's outermost bounds.
        // Keep each neighbor's far edge; continuous panels spanning the shelf
        // keep both edges. Branch offsets may slide independently along them.
        const level = coordinate(frames[moving[0]], axis)
        for (const index of group) {
          if (ids.has(frames[index].panel.id)) continue
          // An oblique projected corner is not a compartment boundary along
          // this movement axis; attached sloping trays must be able to follow.
          if (!frames[index].axes.some(own => Math.abs(own.dot(axis)) > 1 - EPSILON)) continue
          for (const side of [-1, 1]) {
            if (side * (coordinate(frames[index], axis, side) - level) > CONTACT_TOLERANCE) {
              const anchor = preference()
              interiorPreferences.add(anchor)
              // Include staggered feet/ends, but not internal sections with a
              // separate panel wholly beyond their far edge.
              const hasPanelBeyond = group.some(other => side * (coordinate(frames[other], axis, -side)
                - coordinate(frames[index], axis, side)) > CONTACT_TOLERANCE)
              if (!hasPanelBeyond) ends.get(side)!.rows.add(anchor)
              edge(anchor, index, axis, side)
            }
          }
        }
      }
      for (const [side, boundary, touched] of [[-1, minimum, touchesMin], [1, maximum, touchesMax]] as const) {
        if (touched && !(touchesMin && touchesMax)) continue
        for (const index of group) {
          const item = frames[index]
          if (!ids.has(item.panel.id) && Math.abs(coordinate(item, axis, side) - boundary) < CONTACT_TOLERANCE) {
            const anchor = preference()
            ends.get(side)!.rows.add(anchor)
            edge(anchor, index, axis, side)
          }
        }
      }
    }
  } else if (edit.kind === 'reconcile') {
    // A first/reference panel gives a new relationship a predictable direction.
    // A user-selected reference is fixed; only inferred anchors may yield.
    for (const rule of constraints) {
      const anchored = edit.anchorPanelId && designConstraintPanelIds(rule).includes(edit.anchorPanelId)
        && (!edit.ruleId || rule.id === edit.ruleId)
      const anchorRow = anchored ? row : preference
      if (rule.kind === 'equal-dimension') {
        const id = rule.panelIds.includes(edit.anchorPanelId ?? '') ? edit.anchorPanelId! : rule.panelIds[0]
        const dimension = id === rule.panelIds[1] ? rule.secondDimension ?? rule.dimension : rule.dimension
        add(anchorRow(), indices.get(id)! * 5 + (dimension === 'width' ? 3 : 4), 1)
      } else if (rule.kind === 'level' || rule.kind === 'gap' || rule.kind === 'opening-ratio' || rule.kind === 'setback') {
        const id = rule.panelIds.includes(edit.anchorPanelId ?? '') ? edit.anchorPanelId! : rule.panelIds[0]
        worldAxes.forEach(axis => center(anchorRow(), indices.get(id)!, axis))
      } else if (rule.kind === 'position') {
        worldAxes.forEach((axis, index) => { if (index !== ['x', 'y', 'z'].indexOf(rule.axis)) center(preference(), indices.get(rule.panelId)!, axis) })
      } else if (rule.kind === 'floor') {
        for (const axis of [worldAxes[0], worldAxes[2]]) center(preference(), indices.get(rule.panelId)!, axis)
      }
    }
  }

  if ((edit.kind === 'resize' && edit.local) || edit.kind === 'fit') frames.forEach((item, index) => {
    if (ids.has(item.panel.id)) return
    for (let variable = 0; variable < 5; variable++) add(row(), index * 5 + variable, 1)
  })

  if (edit.kind === 'fit') {
    const horizontal = ['top', 'bottom'].includes(edit.connection.side)
    const parentDimension = horizontal ? 0 : 1
    for (const [id, dimension] of [[edit.connection.parentId, parentDimension], [edit.connection.childId, edit.connection.quarterTurn ? 1 - parentDimension : parentDimension]] as const) {
      add(row(), indices.get(id)! * 5 + 3 + dimension, 1)
    }
  }

  const solveChanges = (rows: Row[]): number[] => {
    let changes: number[]
    try {
      try { changes = solveWithBounds(rows, bounds, weights) }
      catch (error) {
        if (!interiorPreferences.size) throw error
        // Shared grid boundaries may have to move with the selected shelf.
        // Relax only local anchors before the established outer-boundary solve.
        const outerRows = rows.filter(row => !interiorPreferences.has(row))
        changes = solveWithBounds(outerRows, bounds, weights)
      }
    }
    catch (error) {
      if ((edit.kind === 'move' && (edit.scope || edit.stretch)) || !constraints.length || !preferences.size) throw error
      // Explicit design intent outranks automatic center/exterior anchoring.
      // Joints, supported contacts, gesture targets and local-edit locks remain.
      const hardRows = rows.filter(row => !preferences.has(row))
      const groups = boundaryPreferences.filter(group => group.rows.size).sort((a, b) => b.distance - a.distance)
      try {
        if (!groups.length) throw error
        changes = solveWithBounds([...hardRows, ...groups.flatMap(group => [...group.rows])], bounds, weights)
      } catch {
        changes = solveWithBounds(hardRows, bounds, weights)
        // Keep feasible boundary groups, farthest from the selected panels first.
        // A rule may force one end to follow the selection; that must not release
        // the other end too. Every trial retains hard rules and stock bounds.
        const retained = [...hardRows]
        for (const group of groups) {
          const candidate = [...retained, ...group.rows]
          try {
            const anchored = solveWithBounds(candidate, bounds, weights)
            retained.push(...group.rows)
            changes = anchored
          } catch { /* This boundary must yield to the edit and its hard rules. */ }
        }
      }
    }

    return changes
  }
  let changes: number[]
  try {
    try { changes = solveChanges(rows) }
    catch (error) {
      if (!cutPreferences.size) throw error
      // Necessary spans may yield to joints and authored rules; preserving
      // unrelated cuts takes priority over incidental placement preferences.
      const retained = rows.filter(row => !cutPreferences.has(row))
      changes = solveChanges(retained)
      for (const preserve of cutPreferences) {
        try {
          const candidate = solveChanges([...retained, preserve])
          retained.push(preserve)
          changes = candidate
        } catch { /* Only cuts required by the edit and its rules may yield. */ }
      }
    }
  } catch (error) {
    const panelIds = error instanceof SolverConflict
      ? [...new Set(error.variables.flatMap(variable => frames[Math.floor(variable / 5)]
        ? [frames[Math.floor(variable / 5)].panel.id]
        : connections.filter(connection => offsetVariables.get(offsetKey(connection)) === variable).flatMap(connection => [connection.parentId, connection.childId])))]
      : [...new Set(constraints.flatMap(designConstraintPanelIds))]
    const message = constraints.length
      ? `This edit cannot keep the design rules and joints satisfied. ${constraints.slice(0, 3).map(rule => describeDesignConstraint(rule, frames.map(item => item.panel))).join('; ')}. Edit or pause a rule first.`
      : error instanceof Error ? error.message : CONSTRAINT_MESSAGE
    const affectedPanelIds = new Set(panelIds)
    throw new StructureEditError(message, panelIds, project.connections.filter(connection =>
      affectedPanelIds.has(connection.parentId) && affectedPanelIds.has(connection.childId)).map(connection => connection.id),
      rows.flatMap(row => row.inferred ? [row.inferred] : []))
  }
  const changedPanels = new Map(frames.map((item, index) => {
    if (edit.kind === 'move' && edit.stretch) {
      const span = edit.stretch.find(edge => edge.panelId === item.panel.id)
      if (!ids.has(item.panel.id) && !span) return [item.panel.id, item.panel] as const
      const delta = new Vector3(...edit.delta)
      if (ids.has(item.panel.id)) return [item.panel.id, { ...item.panel, position: position(item.panel).add(delta).toArray() as Vec3 }] as const
      const dimension = span!.dimension === 'width' ? 0 : 1
      return [item.panel.id, { ...item.panel, [span!.dimension]: item.panel[span!.dimension] + item.axes[dimension].dot(delta) * span!.side,
        position: position(item.panel).addScaledVector(delta, 0.5).toArray() as Vec3 }] as const
    }
    // Scope locks prescribe exact zero changes. Avoid recutting frozen panels
    // by a few microns of iterative-solver residual; final joint checks remain.
    if (edit.kind === 'move' && edit.scope && !edit.scope.panelIds.has(item.panel.id)) return [item.panel.id, item.panel] as const
    if (edit.kind === 'move' && edit.scope) {
      const axis = new Vector3(...edit.delta).normalize()
      item.axes.forEach((own, dimension) => {
        if (ids.has(item.panel.id)) changes[index * 5 + dimension] = own.dot(new Vector3(...edit.delta))
        else if (Math.abs(own.dot(axis)) < 1 - EPSILON) changes[index * 5 + dimension] = 0
        if (dimension < 2 && (ids.has(item.panel.id) || Math.abs(own.dot(axis)) < 1 - EPSILON || edit.scope!.preserveCuts?.has(item.panel.id))) changes[index * 5 + 3 + dimension] = 0
      })
    }
    const moved = position(item.panel)
    item.axes.forEach((axis, dimension) => moved.addScaledVector(axis, changes[index * 5 + dimension]))
    const width = item.panel.width + changes[index * 5 + 3], height = item.panel.height + changes[index * 5 + 4]
    if (width < 40 - EPSILON || width > 4000 + EPSILON || height < 40 - EPSILON || height > 4000 + EPSILON) throw new StructureEditError(LIMIT_MESSAGE, [item.panel.id])
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
    if ([...wanted].some(id => managed.has(id))) throw new StructureEditError('Edit the assembly source to change its panels, or move the assembly as a whole.', [...wanted])
    if ([...wanted].some(id => isPanelConnectedToAssembly(project, id))) throw new StructureEditError('Disconnect this panel from neighboring assemblies before changing its dimensions or position.', [...wanted], project.connections.filter(connection => wanted.has(connection.parentId) || wanted.has(connection.childId)).map(connection => connection.id))
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
    const loose: Project = { version: 1, name: project.name, spaceConstraint: project.spaceConstraint, connectorOverrides: project.connectorOverrides, panels: project.panels.filter(panel => !managed.has(panel.id) && !boundary.has(panel.id)),
      connections: looseConnections.filter(connection => !boundary.has(connection.parentId) && !boundary.has(connection.childId)),
      constraints: project.constraints?.filter(rule => designConstraintPanelIds(rule).every(id => !managed.has(id) && !boundary.has(id))) }
    const edited = editStructure(loose, ids, edit, validation)
    const byId = new Map(edited.panels.map(panel => [panel.id, panel]))
    const connectionById = new Map(edited.connections.map(connection => [connection.id, connection]))
    return { ...project, connectorOverrides: edited.connectorOverrides, panels: project.panels.map(panel => byId.get(panel.id) ?? panel), connections: project.connections.map(connection => connectionById.get(connection.id) ?? connection) }
  }
  const panels = resolvePanels(project)
  if (!panels.some(panel => wanted.has(panel.id))) return project
  // A fitted polygon follows its surrounding edge planes. Its rectangular
  // stock bounds are neither physical contacts nor independent solver spans.
  const outlineClosures = new Set(project.connections.filter(connection => connection.outlineEdge !== undefined).map(connection => connection.childId))
  const frames = panels.map(frame)
  const contacts = findContacts(frames).filter(contact => !outlineClosures.has(frames[contact.a].panel.id) && !outlineClosures.has(frames[contact.b].panel.id))
    .filter(contact => edit.kind !== 'move' || !edit.releaseContacts
      || wanted.has(frames[contact.a].panel.id) === wanted.has(frames[contact.b].panel.id))
  const indices = new Map(panels.map((panel, index) => [panel.id, index]))
  const groups = panels.map((_, index) => index)
  const root = (index: number): number => { while (groups[index] !== index) { groups[index] = groups[groups[index]]; index = groups[index] } return index }
  const join = (a: number, b: number) => { groups[root(a)] = root(b) }
  project.connections.forEach(connection => { const a = indices.get(connection.parentId), b = indices.get(connection.childId); if (a !== undefined && b !== undefined) join(a, b) })
  if (edit.kind === 'fit') join(indices.get(edit.connection.parentId)!, indices.get(edit.connection.childId)!)
  contacts.forEach(contact => join(contact.a, contact.b))
  for (const rule of project.constraints ?? []) {
    if (!rule.enabled) continue
    const [first, ...rest] = designConstraintPanelIds(rule).map(id => indices.get(id))
    if (first !== undefined) for (const index of rest) if (index !== undefined) join(first, index)
  }
  const components = new Map<number, number[]>()
  panels.forEach((_, index) => { const key = root(index); components.set(key, [...components.get(key) ?? [], index]) })
  const affectedOutlineClosures = new Set<string>()
  let next: Project = { ...project, panels }
  for (const component of components.values()) {
    if (!component.some(index => wanted.has(panels[index].id))) continue
    component.forEach(index => { if (outlineClosures.has(panels[index].id)) affectedOutlineClosures.add(panels[index].id) })
    const independent = component.filter(index => !outlineClosures.has(panels[index].id))
    const local = new Map(independent.map((index, localIndex) => [index, localIndex]))
    next = editComponent(next, independent.map(index => frames[index]), contacts.filter(contact => local.has(contact.a) && local.has(contact.b))
      .map(contact => ({ ...contact, a: local.get(contact.a)!, b: local.get(contact.b)! })), wanted, edit)
  }
  if (edit.kind === 'resize' && edit.patches) next = { ...next, panels: next.panels.map(panel => affectedOutlineClosures.has(panel.id)
    && edit.patches?.[panel.id]?.thickness !== undefined ? { ...panel, thickness: edit.patches[panel.id].thickness! } : panel) }
  next = { ...next, panels: refitOutlineClosures(resolvePanels(next), next.connections.filter(connection => connection.outlineEdge === undefined
    || affectedOutlineClosures.has(connection.childId))) }
  const refitOutlinePanelIds = new Set(edit.kind === 'resize' ? edit.refitOutlinePanelIds : undefined)
  for (const panel of next.panels) {
    if (!affectedOutlineClosures.has(panel.id)) continue
    const original = panels[indices.get(panel.id)!]
    const sizeChanged = Math.abs(panel.width - original.width) > EPSILON || Math.abs(panel.height - original.height) > EPSILON
    const poseChanged = position(panel).distanceTo(position(original)) > EPSILON
    const outlineChanged = panel.customOutline?.some((point, index) => Math.abs(point.x - (original.customOutline?.[index]?.x ?? Infinity)) > EPSILON
      || Math.abs(point.y - (original.customOutline?.[index]?.y ?? Infinity)) > EPSILON) ?? false
    if (edit.kind === 'resize' && edit.local && !wanted.has(panel.id) && !refitOutlinePanelIds.has(panel.id) && (sizeChanged || poseChanged || outlineChanged)) {
      throw new StructureEditError('This resize would reshape a fitted outline panel. Resize the connected structure instead of only this panel edge.', [panel.id])
    }
    if (!wanted.has(panel.id)) continue
    const patch: PanelDimensions | undefined = edit.kind === 'resize' ? edit.patches?.[panel.id] ?? edit.patch : undefined
    const missesMove = edit.kind === 'move' && (sizeChanged || outlineChanged
      || position(panel).distanceTo(position(original).add(new Vector3(...(edit.deltas?.[panel.id] ?? edit.delta)))) > EPSILON)
    const missesResize = patch && (['width', 'height', 'thickness'] as const).some(dimension => patch[dimension] !== undefined
      && Math.abs(panel[dimension] - patch[dimension]!) > EPSILON)
    if (missesMove || missesResize) throw new StructureEditError('This fitted outline follows its surrounding panels. Edit those panels together, or detach the outline panel first.', [panel.id])
  }
  if (next.panels.some(panel => panel.position.some(value => !Number.isFinite(value) || Math.abs(value) > 100000))
    || next.connections.some(connection => !Number.isFinite(connection.offset) || Math.abs(connection.offset) > 10000)) throw new Error('This move would exceed the project placement limits. Try a smaller step.')
  if ((edit.kind === 'resize' && edit.local) || edit.kind === 'fit') {
    const overrides = { ...project.connectorOverrides }
    const connectionsById = new Map(next.connections.map(connection => [connection.id, connection]))
    for (const piece of getPhysicalConnectors(project)) {
      // A reviewed rim alignment carries the existing fitted cap and its
      // hardware to the new face; ordinary structural hardware stays fixed.
      if (edit.kind === 'resize' && piece.connection.outlineEdge !== undefined
        && refitOutlinePanelIds.has(piece.connection.childId)) continue
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
  if ((edit.kind === 'resize' && !edit.local) || (edit.kind === 'move' && edit.stretch)) next = rescaleConnectorSlides(project, next, panels, next.panels)
  const previousErrors = new Set(validateProject(project, validation).filter(issue => issue.severity === 'error').map(issue => issue.id))
  const newError = validateProject(next, validation).find(issue => issue.severity === 'error' && !previousErrors.has(issue.id))
  if (newError) {
    const affectedPanelIds = new Set(newError.panelIds)
    throw new StructureEditError(`Cannot keep this edit connected: ${newError.message}`, newError.panelIds, next.connections.filter(connection => affectedPanelIds.has(connection.parentId) && affectedPanelIds.has(connection.childId)).map(connection => connection.id))
  }
  const affectedRoots = new Set([...wanted].flatMap(id => indices.has(id) ? [root(indices.get(id)!)] : []))
  const violatedRule = evaluateDesignConstraints(next.constraints, next.panels).find(result => result.constraint.enabled && result.violation > 0
    && designConstraintPanelIds(result.constraint).some(id => indices.has(id) && affectedRoots.has(root(indices.get(id)!))))
  if (violatedRule) throw new StructureEditError(`Cannot satisfy this design rule: ${describeDesignConstraint(violatedRule.constraint, next.panels)}.`, designConstraintPanelIds(violatedRule.constraint))
  const nextFrames = next.panels.map(frame)
  for (const contact of contacts) {
    const first = nextFrames[contact.a], second = nextFrames[contact.b]
    if (Math.abs(coordinate(second, contact.normal, -contact.sign) - coordinate(first, contact.normal, contact.sign)) > CONTACT_TOLERANCE
      || [...first.axes, ...second.axes].filter(axis => Math.abs(axis.dot(contact.normal)) < EPSILON).some(axis => Math.min(coordinate(first, axis, 1), coordinate(second, axis, 1))
        - Math.max(coordinate(first, axis, -1), coordinate(second, axis, -1)) <= CONTACT_TOLERANCE)) {
      throw new StructureEditError('This move would leave an insert unsupported. Try a smaller step or move its supporting panels together.', [first.panel.id, second.panel.id])
    }
  }
  return assertDesignConstraintEdit(project, next)
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
  return assertDesignConstraintEdit(project, next)
}

/** Move selected panels by an exact world-space displacement, adapting connected spans. */
export function movePanels(project: Project, ids: readonly string[], delta: Vec3, options: { releaseContacts?: boolean } = {}): Project {
  if (delta.some(value => !Number.isFinite(value))) throw new Error('Panel movement must be a finite distance.')
  if (delta.every(value => Math.abs(value) < EPSILON)) return project
  return editStructure(project, ids, { kind: 'move', delta, releaseContacts: options.releaseContacts })
}

/** Translate a rigid selection while extending only prescribed boundary ends.
 * Every opposite end and every other panel is a hard lock in the joint solve.
 * Discovery and continuous clearance checks belong to selection-stretch.ts. */
export function stretchPanelSelection(project: Project, ids: readonly string[], edges: readonly SelectionStretchEdge[], delta: Vec3): Project {
  if (delta.some(value => !Number.isFinite(value))) throw new Error('Panel movement must be a finite distance.')
  if (delta.every(value => Math.abs(value) < EPSILON)) return project
  const selected = new Set(ids), panels = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  if (new Set(edges.map(edge => edge.panelId)).size !== edges.length) throw new Error('Stretch each boundary panel once.')
  if (!edges.length || !selected.size || [...selected].some(id => !panels.has(id))) throw new Error('The stretch selection is no longer available.')
  const direction = new Vector3(...delta).normalize()
  for (const edge of edges) {
    const panel = panels.get(edge.panelId)
    if (!panel || selected.has(edge.panelId) || panel.customOutline || (edge.side !== -1 && edge.side !== 1)) throw new Error('Choose rectangular panels at the selection boundary.')
    const axis = frame(panel).axes[edge.dimension === 'width' ? 0 : 1]
    if (Math.abs(axis.dot(direction)) < 1 - EPSILON) throw new Error('The stretch direction must follow each boundary panel cut.')
    const size = panel[edge.dimension] + axis.dot(new Vector3(...delta)) * edge.side
    if (size < 40 || size > 4000) throw new StructureEditError(LIMIT_MESSAGE, [panel.id])
  }
  return assertNoNewTrofastIssues(project, editStructure(project, ids, { kind: 'move', delta, stretch: edges }))
}

export interface MovementAlternative {
  label: string
  project: Project
  changes: { before: Panel; after: Panel }[]
  outsideSize: { before: number; after: number }
}
export interface MovementReview { source: Project; delta: Vec3; alternatives: MovementAlternative[] }
export class MovementReviewRequired extends Error {
  constructor(public review: MovementReview) { super('This move needs changes beyond the adjacent spans. Review the affected construction first.') }
}

/** Interactive interior-panel movement: enlarge the affected region only after
 * review. Other operations retain movePanels' established solver policy.
 */
export function movePanelsWithReview(project: Project, ids: readonly string[], delta: Vec3): Project {
  if (ids.length !== 1 || delta.some(value => !Number.isFinite(value)) || Math.hypot(...delta) < EPSILON) return movePanels(project, ids, delta)
  const frames = resolvePanels(project).map(frame)
  const frameById = new Map(frames.map(item => [item.panel.id, item]))
  const selected = frameById.get(ids[0])
  const axis = new Vector3(...delta).normalize()
  if (!selected || Math.abs(selected.axes[2].dot(axis)) < 1 - EPSILON) return movePanels(project, ids, delta)
  const neighbors = new Map(frames.map(item => [item.panel.id, new Set<string>()]))
  const join = (a: string, b: string) => { neighbors.get(a)?.add(b); neighbors.get(b)?.add(a) }
  const joints = new Map<string, Set<string>>()
  for (const connection of project.connections) {
    const key = jointId(connection), members = joints.get(key) ?? new Set<string>()
    members.add(connection.parentId); members.add(connection.childId); joints.set(key, members)
  }
  for (const members of joints.values()) for (const a of members) for (const b of members) if (a !== b) join(a, b)
  for (const contact of findContacts(frames)) join(frames[contact.a].panel.id, frames[contact.b].panel.id)
  const connected = new Set(ids)
  for (const id of connected) for (const neighbor of neighbors.get(id) ?? []) connected.add(neighbor)
  const component = frames.filter(item => connected.has(item.panel.id))
  // Do not infer compartment stages across oblique cuts, fitted outlines,
  // managed assemblies, or authored relationships to another construction.
  if (component.some(item => item.panel.customOutline || isPanelConnectedToAssembly(project, item.panel.id)
    || !item.axes.every(own => selected.axes.some(other => Math.abs(own.dot(other)) > 1 - EPSILON)))
    || project.constraints?.some(rule => rule.enabled && designConstraintPanelIds(rule).some(id => connected.has(id))
      && designConstraintPanelIds(rule).some(id => !connected.has(id)))) return movePanels(project, ids, delta)
  const reference = Math.min(...component.map(item => coordinate(item, axis, -1)))
  const outside = Math.max(...component.map(item => coordinate(item, axis, 1)))
  const level = coordinate(selected, axis)
  if (coordinate(selected, axis, -1) <= reference + CONTACT_TOLERANCE
    || coordinate(selected, axis, 1) >= outside - CONTACT_TOLERANCE) return movePanels(project, ids, delta)
  const crossesLevel = (item: Frame) => coordinate(item, axis, -1) < level - CONTACT_TOLERANCE && coordinate(item, axis, 1) > level + CONTACT_TOLERANCE
  const allowed = new Set([ids[0], ...neighbors.get(ids[0]) ?? []])
  for (const item of component) if (item !== selected && crossesLevel(item)) allowed.delete(item.panel.id)
  const previousCollisions = new Set(validateProject(project).filter(issue => issue.id.startsWith('collision-')).map(issue => issue.id))
  const attempt = (panelIds: Set<string>, preserveCuts?: Set<string>) => {
    const next = assertNoNewTrofastIssues(project, editStructure(project, ids, { kind: 'move', delta, scope: { panelIds, reference, preserveCuts } }))
    const collision = validateProject(next).find(issue => issue.id.startsWith('collision-') && !previousCollisions.has(issue.id))
    if (collision) throw new StructureEditError(`This move would introduce an overlap: ${collision.message}`, collision.panelIds)
    const resolved = resolvePanels(next)
    const actual = resolved.find(panel => panel.id === selected.panel.id)!
    if (position(actual).distanceTo(position(selected.panel).add(new Vector3(...delta))) > CONTACT_TOLERANCE) {
      throw new Error('This construction cannot reach the requested movement while retaining its joints.')
    }
    const actualReference = Math.min(...resolved.filter(panel => connected.has(panel.id)).map(panel => coordinate(frame(panel), axis, -1)))
    if (Math.abs(actualReference - reference) > CONTACT_TOLERANCE) throw new Error('This move would shift the opposite outside face.')
    // Refitted geometry must respect scope too, not just the linear variables.
    for (const panel of resolved) {
      if (panelIds.has(panel.id)) continue
      const before = frameById.get(panel.id)!.panel
      if (Math.abs(before.width - panel.width) > EPSILON || Math.abs(before.height - panel.height) > EPSILON
        || position(before).distanceTo(position(panel)) > EPSILON) throw new Error('This move would change a panel outside the reviewed region.')
    }
    return next
  }
  let localError: unknown
  try { return attempt(allowed) } catch (error) { localError = error }
  const boundaries = component.filter(item => item !== selected && Math.abs(item.axes[2].dot(axis)) > 1 - EPSILON
    && coordinate(item, axis) >= level - CONTACT_TOLERANCE).sort((a, b) => coordinate(a, axis) - coordinate(b, axis))
  const layers: Frame[][] = []
  for (const item of boundaries) {
    const last = layers.at(-1)
    if (last && Math.abs(coordinate(last[0], axis) - coordinate(item, axis)) < CONTACT_TOLERANCE) last.push(item)
    else layers.push([item])
  }
  const alternatives: MovementAlternative[] = []
  const addAlternative = (next: Project, label: string) => {
    const resolved = resolvePanels(next)
    const changes = resolved.flatMap(after => {
      const before = frameById.get(after.id)!.panel
      return Math.abs(before.width - after.width) > EPSILON || Math.abs(before.height - after.height) > EPSILON
        || position(before).distanceTo(position(after)) > EPSILON ? [{ before, after }] : []
    })
    const afterOutside = Math.max(...resolved.filter(panel => connected.has(panel.id)).map(panel => coordinate(frame(panel), axis, 1)))
    if (alternatives.some(option => JSON.stringify(option.project.panels) === JSON.stringify(next.panels))) return
    alternatives.push({ project: next, label, changes, outsideSize: { before: outside - reference, after: afterOutside - reference } })
  }
  // Stop at the nearest feasible compartment expansion. A separate final
  // option can release the outer boundary while retaining the opposite face.
  for (const layer of layers.slice(0, 8)) {
    if (layer.some(item => coordinate(item, axis, 1) >= outside - CONTACT_TOLERANCE)) break
    for (const item of layer) {
      allowed.add(item.panel.id)
      for (const neighbor of neighbors.get(item.panel.id) ?? []) {
        const other = frameById.get(neighbor)!
        if (!crossesLevel(other) && coordinate(other, axis) >= level - CONTACT_TOLERANCE) allowed.add(neighbor)
      }
    }
    try { addAlternative(attempt(allowed), `Include neighboring boundary: ${layer.map(item => item.panel.name).join(', ')}`); break }
    catch { /* Try the next parallel boundary, keeping more distant panels fixed. */ }
  }
  const expanded = new Set(component.filter(item => coordinate(item, axis) >= level - CONTACT_TOLERANCE || crossesLevel(item)).map(item => item.panel.id))
  for (const id of neighbors.get(ids[0]) ?? []) expanded.add(id)
  try {
    const next = attempt(expanded, new Set(component.filter(item => coordinate(item, axis, -1) > level + CONTACT_TOLERANCE).map(item => item.panel.id)))
    addAlternative(next, 'Move the outer boundary; preserve cuts ahead of the selected panel')
  } catch { /* Authored requirements, stock, contacts and build space remain hard. */ }
  if (!alternatives.length) throw localError
  throw new MovementReviewRequired({ source: project, delta, alternatives })
}

export function acceptMovementAlternative(current: Project, review: MovementReview, index: number): Project {
  if (current !== review.source) throw new Error('The project changed. Try the move again to review current alternatives.')
  const alternative = review.alternatives[index]
  if (!alternative) throw new Error('Choose a movement alternative.')
  return alternative.project
}

/** Solve independent center targets together, preserving selected cut dimensions. */
export function movePanelsToPositions(project: Project, targets: Record<string, Vec3>): Project {
  const panels = resolvePanels(project)
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  const centerDeltas: Record<string, Vec3> = Object.create(null)
  for (const [id, target] of Object.entries(targets)) {
    const panel = byId.get(id)
    if (!panel) throw new Error('A placement target refers to a missing panel.')
    if (target.some(value => !Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error('This move would exceed the project placement limits.')
    centerDeltas[id] = target.map((value, axis) => value - panel.position[axis]) as Vec3
  }
  if (!Object.values(centerDeltas).some(delta => delta.some(value => Math.abs(value) > EPSILON))) return project
  // Unchanged boundary targets are checked below, rather than adding redundant
  // zero-motion equations to imperfectly aligned imported joint loops.
  const movingIds = Object.keys(targets).filter(id => centerDeltas[id].some(value => Math.abs(value) > EPSILON))
  const next = editStructure(project, movingIds, { kind: 'move', delta: [0, 0, 0], deltas: centerDeltas })
  // Fitted outlines are refitted after the solve; they must still meet all targets.
  for (const panel of resolvePanels(next)) {
    if (!Object.hasOwn(targets, panel.id)) continue
    const original = byId.get(panel.id)!
    if (position(panel).distanceTo(new Vector3(...targets[panel.id])) > 0.001
      || Math.abs(panel.width - original.width) > EPSILON || Math.abs(panel.height - original.height) > EPSILON) {
      throw new Error('These panels cannot reach the requested spacing while keeping their shapes and joints. Detach them first.')
    }
  }
  return next
}

/** Resize a selection while keeping structural joints and existing inserts fitted. */
export function resizePanels(project: Project, ids: readonly string[], patch: Dimensions, validation: ValidationContext = {}): Project {
  if (Object.values(patch).some(value => value !== undefined && (!Number.isFinite(value) || value < 40 || value > 4000))) throw new Error(LIMIT_MESSAGE)
  const wanted = new Set(ids)
  if (!project.panels.some(panel => wanted.has(panel.id) && (['width', 'height'] as const).some(field => patch[field] !== undefined && Math.abs(panel[field] - patch[field]!) > EPSILON))) return project
  return editStructure(project, ids, { kind: 'resize', patch }, validation)
}

export interface ResizeAlternative {
  relaxed: InferredRelationship
  project: Project
  changes: { before: Panel; after: Panel }[]
}
export interface ResizeReview { source: Project; requestedDimensions: Dimensions; alternatives: ResizeAlternative[] }

/** Explicit review only: ordinary resizing never silently drops an inferred fit.
 * Search a bounded set of single-relationship alternatives after a failed solve.
 */
export function getResizeAlternatives(project: Project, ids: readonly string[], patch: Dimensions): ResizeReview | null {
  let relationships: InferredRelationship[]
  try { resizePanels(project, ids, patch); return null }
  catch (error) {
    if (!(error instanceof StructureEditError) || !error.inferredRelationships.length) return null
    relationships = error.inferredRelationships
  }
  const previous = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  const collisions = new Set(validateProject(project).filter(issue => issue.id.startsWith('collision-')).map(issue => issue.id))
  const alternatives: ResizeAlternative[] = []
  // Prefer relationships incident to the requested cut. Never loosen several
  // relationships together, or offer unvalidated partial solver output.
  const requestedIds = new Set(ids)
  const ordered = [...relationships].sort((a, b) => Number(b.panelIds.some(id => requestedIds.has(id))) - Number(a.panelIds.some(id => requestedIds.has(id))))
  for (const relaxed of ordered.slice(0, 16)) {
    try {
      const next = assertNoNewTrofastIssues(project, editStructure(project, ids, { kind: 'resize', patch, relaxedRelationship: relaxed.id }))
      if (validateProject(next).some(issue => issue.id.startsWith('collision-') && !collisions.has(issue.id))) continue
      const changes = resolvePanels(next).flatMap(after => {
        const before = previous.get(after.id)!
        return Math.abs(before.width - after.width) > EPSILON || Math.abs(before.height - after.height) > EPSILON
          || position(before).distanceTo(position(after)) > EPSILON || JSON.stringify(before.customOutline) !== JSON.stringify(after.customOutline)
          ? [{ before, after }] : []
      })
      alternatives.push({ relaxed, project: next, changes })
      if (alternatives.length === 4) break
    } catch { /* A released inference cannot override physical or authored requirements. */ }
  }
  return alternatives.length ? { source: project, requestedDimensions: { ...patch }, alternatives } : null
}

export function acceptResizeAlternative(current: Project, review: ResizeReview, index: number): Project {
  if (current !== review.source) throw new Error('The project changed. Try the resize again to review current alternatives.')
  const alternative = review.alternatives[index]
  if (!alternative) throw new Error('Choose a resize alternative.')
  return alternative.project
}

/** Pull one panel edge, anchoring its opposite edge. Local edits also fix other panels and hardware. */
export function resizePanelEdge(project: Project, id: string, dimension: 'width' | 'height', side: -1 | 1, distance: number, local = false): Project {
  if (!Number.isFinite(distance)) throw new Error('Panel movement must be a finite distance.')
  if (Math.abs(distance) < EPSILON) return project
  const panel = resolvePanels(project).find(panel => panel.id === id)
  if (!panel) return project
  const size = panel[dimension] + distance
  if (size < 40 || size > 4000) throw new StructureEditError(LIMIT_MESSAGE, [panel.id])
  const axis = frame(panel).axes[dimension === 'width' ? 0 : 1]
  return editStructure(project, [id], { kind: 'resize', patch: { [dimension]: size }, local,
    centerDelta: axis.multiplyScalar(side * distance / 2).toArray() as Vec3 })
}

export interface PanelEdgeResize { panelId: string; dimension: 'width' | 'height'; side: -1 | 1; distance: number }

/** Extend several reviewed rim edges atomically while anchoring their opposite
 * edges. Explicit dependent caps may follow; all other panels and hardware stay.
 */
export function resizePanelEdges(project: Project, edges: readonly PanelEdgeResize[], refitOutlinePanelIds: readonly string[] = []): Project {
  const panels = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  if (new Set(edges.map(edge => edge.panelId)).size !== edges.length) throw new Error('Adjust each panel edge once.')
  const patches: Record<string, PanelDimensions> = Object.create(null), centerDeltas: Record<string, Vec3> = Object.create(null)
  for (const edge of edges) {
    if (!Number.isFinite(edge.distance) || (edge.side !== -1 && edge.side !== 1)) throw new Error('Panel movement must be a finite distance.')
    const panel = panels.get(edge.panelId)
    if (!panel) throw new Error('A rim panel is no longer available.')
    const size = panel[edge.dimension] + edge.distance
    if (size < 40 || size > 4000) throw new Error(LIMIT_MESSAGE)
    if (Math.abs(edge.distance) < EPSILON) continue
    patches[panel.id] = { width: panel.width, height: panel.height, [edge.dimension]: size }
    centerDeltas[panel.id] = frame(panel).axes[edge.dimension === 'width' ? 0 : 1].multiplyScalar(edge.side * edge.distance / 2).toArray() as Vec3
  }
  if (!Object.keys(patches).length) return project
  return editStructure(project, Object.keys(patches), { kind: 'resize', patch: {}, patches, centerDeltas, local: true, refitOutlinePanelIds })
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

/** Close a compatible seam by solving both radial lengths together. Other
 * panels, rotations, thicknesses and installed hardware remain fixed. The
 * proposed connection is a solve constraint only; hardware fitting follows. */
export function fitPanelPair(project: Project, connection: Connection): Project {
  const ids = [connection.parentId, connection.childId]
  if (ids[0] === ids[1] || ids.some(id => !project.panels.some(panel => panel.id === id))) throw new Error('Choose two different panels to fit.')
  if (project.panels.some(panel => ids.includes(panel.id) && (panel.customOutline || !panel.visible))) throw new Error('Fit visible rectangular panels only.')
  const target = { ...connection, id: `fit/${crypto.randomUUID()}:0` }
  const next = editStructure(project, ids, { kind: 'fit', connection: target })
  const fitted = resolvePanels(next)
  const parent = fitted.find(panel => panel.id === connection.parentId)!
  const child = fitted.find(panel => panel.id === connection.childId)!
  const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...target, role: undefined }] })[1]
  if (position(expected).distanceTo(position(child)) > 1e-5 || frame(expected).axes.some((axis, index) => Math.abs(axis.dot(frame(child).axes[index])) < 0.99999)) {
    throw new Error('These panel edges cannot meet at this connector angle.')
  }
  const before = new Map(resolvePanels(project).map(panel => [panel.id, panel]))
  for (const panel of resolvePanels(next)) {
    const original = before.get(panel.id)!
    if (Math.abs(panel.width - original.width) > 100 || Math.abs(panel.height - original.height) > 100
      || position(panel).distanceTo(position(original)) > 100) throw new Error('This fit needs an adjustment greater than 100 mm.')
  }
  return next
}
