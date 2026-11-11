import { expect, it } from 'vitest'
import { solve, solveWithBounds, SolverConflict, type StructuralRow } from './structural-solver'

const row = (entries: [number, number][], value: number): StructuralRow => ({ entries: new Map(entries), value, provenance: { kind: 'target' } })

it('retains the weighted optimum and original-unit residual with redundant equations', () => {
  const rows = [row([[0, 1], [1, 1]], 10), row([[0, 1000], [1, 1000]], 10000)]
  const result = solve(rows, [1, 4])
  expect(result[0]).toBeCloseTo(8, 8)
  expect(result[1]).toBeCloseTo(2, 8)
  for (const equation of rows) expect(Math.abs([...equation.entries].reduce((sum, [index, value]) => sum + result[index] * value, 0) - equation.value)).toBeLessThan(1e-5)
})

it('activates the limiting bound without forcing a slack bound to equality', () => {
  const result = solveWithBounds([row([[0, 1], [1, 1]], 10)], [row([[0, -1]], -6), row([[1, 1]], 1)], [1, 4])
  expect(result[0]).toBeCloseTo(6, 7)
  expect(result[1]).toBeCloseTo(4, 7)
})

it('distinguishes an exact inconsistent constant from a discarded small coefficient', () => {
  for (const [coefficient, termination] of [[0, 'inconsistent-constant'], [1e-12, 'residual-check-failed']] as const) {
    try { solve([row([[0, coefficient]], 1)], [1]); throw new Error('Expected solver rejection') }
    catch (error) {
      expect(error).toBeInstanceOf(SolverConflict)
      expect((error as SolverConflict).diagnostic).toMatchObject({ termination, maxEqualityResidual: 1, iterations: 0 })
    }
  }
})

it('does not present a failed iterative residual check as a proof of infeasibility', () => {
  try { solve([row([[0, 1]], 1), row([[0, 1]], 2)], [1]); throw new Error('Expected solver rejection') }
  catch (error) {
    expect(error).toBeInstanceOf(SolverConflict)
    const diagnostic = (error as SolverConflict).diagnostic!
    expect(diagnostic.termination).toBe('residual-check-failed')
    expect(diagnostic.maxEqualityResidual).toBeGreaterThan(1e-5)
    expect(diagnostic.iterations).toBeGreaterThan(0)
  }
})


it('marks auxiliary bound-direction failures so they cannot certify the requested system', () => {
  try { solveWithBounds([], [row([[0, 0]], 1)], [1]); throw new Error('Expected solver rejection') }
  catch (error) {
    expect(error).toBeInstanceOf(SolverConflict)
    expect((error as SolverConflict).diagnostic).toMatchObject({ termination: 'inconsistent-constant', context: 'bound-direction' })
  }
})
