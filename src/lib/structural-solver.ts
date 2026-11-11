import type { InferredRelationship } from './resize-intent'

const EPSILON = 1e-6
export const LIMIT_MESSAGE = 'This move would exceed the panel size limits (40–4,000 mm). Try a smaller step.'
export const CONSTRAINT_MESSAGE = 'These panels cannot move in that direction while keeping their joints connected. Try another direction or select the whole assembly.'

/** Authority describes the existing compiler; it does not implement a new hierarchy. */
export interface RowProvenance {
  kind: 'joint' | 'protected-contact' | 'authored-rule' | 'stock-bound' | 'target' | 'anchor' | 'scope' | 'inferred' | 'placement-preference' | 'cut-preference'
  panelIds?: readonly string[]
  connectionId?: string
  ruleId?: string
  relationshipId?: string
}
export interface StructuralRow {
  entries: Map<number, number>
  value: number
  provenance: RowProvenance
  stockBound?: boolean
  inferred?: InferredRelationship
}
type Row = StructuralRow
export interface NumericalDiagnostic {
  /** A direction probe is an auxiliary system, not a feasibility certificate. */
  context?: 'bound-direction'
  termination: 'inconsistent-constant' | 'residual-check-failed' | 'bound-search-exhausted'
  iterations: number
  maxEqualityResidual: number
  maxBoundViolation: number
}
export class SolverConflict extends Error {
  constructor(public variables: number[], message = CONSTRAINT_MESSAGE, public diagnostic?: NumericalDiagnostic) { super(message) }
}

/**
 * Minimum weighted change subject to sparse, exact linear constraints. Rotations
 * and connector seats stay fixed, so this is a linear problem, including angled
 * connectors. Solve A W^-1 Aᵀ λ = b with conjugate gradients; redundant support
 * rows are harmless and do not require a dense cubic matrix decomposition.
 */
export function solve(rows: Row[], weights: number[], dual?: number[]): number[] {
  const size = weights.length
  const inverseScale = weights.map(weight => 1 / Math.sqrt(weight))
  const equations = rows.map((row, sourceIndex) => {
    const entries = [...row.entries].filter(([, value]) => Math.abs(value) > 1e-10)
      .map(([index, value]) => [index, value * inverseScale[index]] as const)
    const norm = Math.hypot(...entries.map(([, value]) => value))
    if (norm < 1e-10) {
      if (Math.abs(row.value) > EPSILON) throw new SolverConflict([...row.entries.keys()], CONSTRAINT_MESSAGE, { termination: [...row.entries.values()].every(value => value === 0) ? 'inconsistent-constant' : 'residual-check-failed', iterations: 0, maxEqualityResidual: Math.abs(row.value), maxBoundViolation: 0 })
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
  let iterations = 0
  for (let iteration = 0; error > threshold && iteration < Math.max(200, count * 6); iteration++) {
    iterations = iteration + 1
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
      Math.abs(rowValue(row, output) - row.value) > 1e-5).flatMap(row => [...row.entries.keys()]))], CONSTRAINT_MESSAGE, { termination: 'residual-check-failed', iterations, maxEqualityResidual: Math.max(...rows.map(row => Math.abs(rowValue(row, output) - row.value))), maxBoundViolation: 0 })
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
export function solveWithBounds(rows: Row[], bounds: Row[], weights: number[]): number[] {
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
          if (error instanceof SolverConflict && error.diagnostic) error.diagnostic = { ...error.diagnostic, context: 'bound-direction' }
          if (bound.stockBound && error instanceof SolverConflict) throw new SolverConflict(error.variables, LIMIT_MESSAGE, error.diagnostic)
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
    ? LIMIT_MESSAGE : CONSTRAINT_MESSAGE, { termination: 'bound-search-exhausted', iterations: 256,
      maxEqualityResidual: Math.max(0, ...rows.map(row => Math.abs(rowValue(row, output) - row.value))),
      maxBoundViolation: Math.max(0, ...bounds.map(bound => bound.value - rowValue(bound, output))) })
}

