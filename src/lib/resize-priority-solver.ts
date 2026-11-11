import { solveWithBounds, SolverConflict, type StructuralRow } from './structural-solver'

const ALGEBRA_TOLERANCE = 1e-10
const FEASIBILITY_TOLERANCE = 1e-5
const STATIONARITY_TOLERANCE = 1e-6
export interface ResizePriorityTier { name: string; rows: StructuralRow[] }
export interface ResizePriorityDiagnostic {
  name: string
  elapsedMs?: number
  degreesOfFreedom?: number
  squaredError: number
  iterations: number
  activeBounds: number[]
  maxEqualityResidual: number
  maxBoundViolation: number
  termination: 'optimal'
}
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0)
const value = (row: StructuralRow, x: number[]) => [...row.entries].reduce((sum, [i, coefficient]) => sum + coefficient * x[i], 0)
const dense = (row: StructuralRow, size: number) => Array.from({ length: size }, (_, i) => row.entries.get(i) ?? 0)

/** Rank-revealing elimination. Free coordinates remain free (zero direction);
 * every returned solution is checked against the original system. */
function linearSolve(matrix: number[][], rhs: number[]): number[] {
  const columns = matrix[0]?.length ?? 0
  const a = matrix.map((row, i) => [...row, rhs[i]])
  const pivots: number[] = []
  let rank = 0
  for (let column = 0; column < columns && rank < a.length; column++) {
    let pivot = rank
    for (let i = rank + 1; i < a.length; i++) if (Math.abs(a[i][column]) > Math.abs(a[pivot][column])) pivot = i
    if (Math.abs(a[pivot][column]) < ALGEBRA_TOLERANCE) continue
    ;[a[rank], a[pivot]] = [a[pivot], a[rank]]
    const divisor = a[rank][column]
    for (let j = column; j <= columns; j++) a[rank][j] /= divisor
    for (let i = rank + 1; i < a.length; i++) {
      const factor = a[i][column]
      if (Math.abs(factor) < ALGEBRA_TOLERANCE) continue
      for (let j = column; j <= columns; j++) a[i][j] -= factor * a[rank][j]
    }
    pivots.push(column)
    rank++
  }
  const x = Array<number>(columns).fill(0)
  for (let i = rank - 1; i >= 0; i--) {
    const column = pivots[i]
    x[column] = a[i][columns]
    for (let j = column + 1; j < columns; j++) x[column] -= a[i][j] * x[j]
  }
  if (x.some(n => !Number.isFinite(n)) || matrix.some((row, i) => Math.abs(dot(row, x) - rhs[i]) > FEASIBILITY_TOLERANCE)) {
    throw new SolverConflict([], 'The resize priority solve did not converge reliably.', {
      termination: 'residual-check-failed', iterations: 0, maxEqualityResidual: Math.max(0, ...matrix.map((row, i) => Math.abs(dot(row, x) - rhs[i]))), maxBoundViolation: 0,
    })
  }
  return x
}

/** Independent normalized constraint normals avoid nonunique active multipliers.
 * Reorthogonalization handles the redundant joint/support equations in real builds. */
function independent(rows: number[][]): number[] {
  const basis: number[][] = [], indices: number[] = []
  rows.forEach((row, index) => {
    const norm = Math.hypot(...row)
    if (norm < ALGEBRA_TOLERANCE) return
    const candidate = row.map(n => n / norm)
    for (let pass = 0; pass < 2; pass++) for (const own of basis) {
      const projection = dot(candidate, own)
      own.forEach((n, i) => { candidate[i] -= n * projection })
    }
    const remaining = Math.hypot(...candidate)
    if (remaining < 1e-8) return
    basis.push(candidate.map(n => n / remaining))
    indices.push(index)
  })
  return indices
}

function minimize(rows: StructuralRow[], bounds: StructuralRow[], objective: StructuralRow[], start: number[], name: string) {
  const size = start.length, x = [...start]
  const equalities = rows.map(row => dense(row, size))
  const equalityBasis = independent(equalities).map(index => equalities[index])
  const boundRows = bounds.map(row => dense(row, size))
  const active = new Set<number>()
  const hessian = Array.from({ length: size }, () => Array<number>(size).fill(0))
  for (const row of objective) for (const [i, a] of row.entries) for (const [j, b] of row.entries) hessian[i][j] += a * b
  for (let iteration = 0; iteration < 512; iteration++) {
    const ids = [...active]
    const all = [...equalityBasis, ...ids.map(i => boundRows[i])]
    const chosen = independent(all)
    const normals = chosen.map(i => all[i])
    const retained = new Set(chosen.filter(i => i >= equalityBasis.length).map(i => ids[i - equalityBasis.length]))
    for (const id of active) if (!retained.has(id)) active.delete(id)
    const activeIds = [...active]
    const gradient = Array<number>(size).fill(0)
    for (const row of objective) {
      const residual = value(row, x) - row.value
      for (const [i, coefficient] of row.entries) gradient[i] += coefficient * residual
    }
    const kkt = hessian.map((row, i) => [...row, ...normals.map(normal => normal[i])])
    normals.forEach(normal => kkt.push([...normal, ...normals.map(() => 0)]))
    const solution = linearSolve(kkt, [...gradient.map(n => -n), ...normals.map(() => 0)])
    const direction = solution.slice(0, size)
    if (Math.hypot(...direction) <= STATIONARITY_TOLERANCE) {
      // Bounds are A*x >= b, so KKT equality multipliers must be nonpositive.
      let release: number | undefined, largest = STATIONARITY_TOLERANCE
      activeIds.forEach((id, i) => {
        const multiplier = solution[size + equalityBasis.length + i]
        if (multiplier > largest) { largest = multiplier; release = id }
      })
      if (release !== undefined) { active.delete(release); continue }
      const maxEqualityResidual = Math.max(0, ...rows.map(row => Math.abs(value(row, x) - row.value)))
      const maxBoundViolation = Math.max(0, ...bounds.map(row => row.value - value(row, x)))
      if (maxEqualityResidual > FEASIBILITY_TOLERANCE || maxBoundViolation > FEASIBILITY_TOLERANCE) break
      return { values: x, diagnostic: { name, squaredError: objective.reduce((sum, row) => sum + (value(row, x) - row.value) ** 2, 0),
        iterations: iteration + 1, activeBounds: [...active], maxEqualityResidual, maxBoundViolation, termination: 'optimal' as const } }
    }
    let step = 1, blocker: number | undefined
    bounds.forEach((bound, i) => {
      if (active.has(i)) return
      const travel = dot(boundRows[i], direction)
      if (travel >= -ALGEBRA_TOLERANCE) return
      const allowed = Math.max(0, (value(bound, x) - bound.value) / -travel)
      if (allowed < step) { step = allowed; blocker = i }
    })
    direction.forEach((n, i) => { x[i] += step * n })
    if (blocker !== undefined) active.add(blocker)
  }
  throw new SolverConflict([], 'The resize priority solve reached its iteration limit.', {
    termination: 'bound-search-exhausted', iterations: 512,
    maxEqualityResidual: Math.max(0, ...rows.map(row => Math.abs(value(row, x) - row.value))),
    maxBoundViolation: Math.max(0, ...bounds.map(row => row.value - value(row, x))),
  })
}

/** Solve only in the remaining degrees of freedom. Most furniture variables
 * are fixed by joints/cuts; a dense KKT system over all of them is unnecessary. */
export type ResizeNumericalCache = Map<string, number[][]>
function nullSpace(rows: StructuralRow[], size: number, cache?: ResizeNumericalCache): number[][] {
  const key = cache ? JSON.stringify([size, rows.map(row => [...row.entries])]) : undefined
  const cached = key && cache?.get(key)
  if (cached) return cached
  const basis: number[][] = []
  const append = (candidate: number[], target: number[][]) => {
    for (let pass = 0; pass < 2; pass++) for (const group of [basis, target]) for (const own of group) {
      let projection = 0
      for (let i = 0; i < size; i++) projection += candidate[i] * own[i]
      for (let i = 0; i < size; i++) candidate[i] -= own[i] * projection
    }
    const norm = Math.hypot(...candidate)
    if (norm > 1e-8) target.push(candidate.map(n => n / norm))
  }
  for (const row of rows) {
    const vector = dense(row, size), norm = Math.hypot(...vector)
    if (norm < ALGEBRA_TOLERANCE) continue
    const added: number[][] = []
    append(vector.map(n => n / norm), added)
    basis.push(...added)
  }
  const freedom: number[][] = []
  for (let i = 0; i < size; i++) append(Array.from({ length: size }, (_, j) => i === j ? 1 : 0), freedom)
  if (cache && key) {
    if (cache.size >= 32) cache.delete(cache.keys().next().value!)
    cache.set(key, freedom)
  }
  return freedom
}
function minimizeReduced(rows: StructuralRow[], bounds: StructuralRow[], objective: StructuralRow[], start: number[], name: string, freedom: number[][], cache?: ResizeNumericalCache) {
  const started = performance.now()
  const reduce = (row: StructuralRow): StructuralRow => ({ ...row,
    entries: new Map(freedom.map((vector, i) => [i, [...row.entries].reduce((sum, [j, coefficient]) => sum + coefficient * vector[j], 0)])),
    value: row.value - value(row, start),
  })
  const reduced = freedom.length ? minimize([], bounds.map(reduce), objective.map(reduce), freedom.map(() => 0), name) : undefined
  const values = start.map((n, i) => n + freedom.reduce((sum, vector, j) => sum + vector[i] * reduced!.values[j], 0))
  const maxEqualityResidual = Math.max(0, ...rows.map(row => Math.abs(value(row, values) - row.value)))
  const maxBoundViolation = Math.max(0, ...bounds.map(row => row.value - value(row, values)))
  if (maxEqualityResidual > FEASIBILITY_TOLERANCE || maxBoundViolation > FEASIBILITY_TOLERANCE) throw new SolverConflict([], 'The resize priority residual check failed.', {
    termination: 'residual-check-failed', iterations: reduced?.diagnostic.iterations ?? 0, maxEqualityResidual, maxBoundViolation,
  })
  const remaining = nullSpace(objective.map(reduce), freedom.length, cache)
  const nextFreedom = remaining.map(vector => start.map((_, i) => vector.reduce((sum, n, j) => sum + n * freedom[j][i], 0)))
  return { values, freedom: nextFreedom, diagnostic: { name, elapsedMs: performance.now() - started, degreesOfFreedom: freedom.length, squaredError: objective.reduce((sum, row) => sum + (value(row, values) - row.value) ** 2, 0),
    iterations: reduced?.diagnostic.iterations ?? 0, activeBounds: reduced?.diagnostic.activeBounds ?? [], maxEqualityResidual, maxBoundViolation, termination: 'optimal' as const } }
}

/** True lexicographic quadratic priorities, with no large weight ratios.
 * For a convex feasible set the optimal least-squares residual VECTOR is unique:
 * two different optimal residuals would have a strictly better midpoint. Thus
 * retaining each achieved row value preserves the entire optimal face, not an
 * arbitrary geometry from the previous tier. Lower tiers keep its null space.
 */
export function solveResizePriorities(rows: StructuralRow[], bounds: StructuralRow[], weights: number[], tiers: ResizePriorityTier[],
  beforeSolve: () => void = () => {}, cache?: ResizeNumericalCache) {
  beforeSolve()
  let values = solveWithBounds(rows, bounds, weights)
  let freedom = nullSpace(rows, weights.length, cache)
  const retained = [...rows], diagnostics: ResizePriorityDiagnostic[] = []
  const displacement: ResizePriorityTier = { name: 'displacement', rows: weights.map((weight, index) => ({
    entries: new Map([[index, Math.sqrt(weight)]]), value: 0, provenance: { kind: 'placement-preference' },
  })) }
  for (const tier of [...tiers, displacement]) {
    if (!tier.rows.length) continue
    beforeSolve()
    const result = minimizeReduced(retained, bounds, tier.rows, values, tier.name, freedom, cache)
    values = result.values
    freedom = result.freedom
    diagnostics.push(result.diagnostic)
    retained.push(...tier.rows.map(row => ({ ...row, value: value(row, values) })))
  }
  return { values, diagnostics }
}
