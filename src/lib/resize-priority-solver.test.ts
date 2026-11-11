import { expect, it } from 'vitest'
import { solveResizePriorities } from './resize-priority-solver'
import type { StructuralRow } from './structural-solver'
const row = (coefficients: number[], value = 0): StructuralRow => ({ entries: new Map(coefficients.map((n, i) => [i, n])), value, provenance: { kind: 'target' } })

it('preserves a whole optimal face for lower priorities, rather than freezing a point', () => {
  const result = solveResizePriorities([], [row([1, 0]), row([0, 1])], [1, 1], [
    { name: 'sum', rows: [row([1, 1], 10)] }, { name: 'place', rows: [row([1, 0], 8)] },
  ])
  expect(result.values[0]).toBeCloseTo(8, 5)
  expect(result.values[1]).toBeCloseTo(2, 5)
  expect(result.diagnostics.every(tier => tier.termination === 'optimal')).toBe(true)
})
it('retains nonzero optimal residuals and does not trade priorities for huge lower requests', () => {
  const result = solveResizePriorities([], [], [1], [
    { name: 'contradictory', rows: [row([1], 2), row([1], 4)] },
    { name: 'lower', rows: [row([1], 100000)] },
  ])
  expect(result.values[0]).toBeCloseTo(3, 5)
  expect(result.diagnostics[0].squaredError).toBeCloseTo(2, 5)
})
it('handles redundant equations and bound chains', () => {
  const result = solveResizePriorities([row([1, 1, 1], 12), row([2, 2, 2], 24)],
    [row([1, 0, 0], 1), row([-1, 1, 0], 2), row([0, -1, 1], 2)], [1, 1, 1], [
      { name: 'first', rows: [row([1, 0, 0], 10)] },
    ])
  result.values.forEach((n, i) => expect(n).toBeCloseTo([2, 4, 6][i], 5))
})

// Independent reference for two-dimensional box-constrained least squares:
// enumerate interior, four edges and four corners, then compare exact costs.
// No production elimination, active-set, or feasibility routine is used.
function reference(a: number[], b: number[], target: number[]) {
  const h00 = a[0] ** 2 + b[0] ** 2, h01 = a[0] * a[1] + b[0] * b[1], h11 = a[1] ** 2 + b[1] ** 2
  const g0 = a[0] * target[0] + b[0] * target[1], g1 = a[1] * target[0] + b[1] * target[1]
  const determinant = h00 * h11 - h01 * h01
  const clamp = (n: number) => Math.max(0, Math.min(10, n))
  const choices = [[0, 0], [0, 10], [10, 0], [10, 10],
    ...[0, 10].flatMap(x => [[x, clamp((g1 - h01 * x) / h11)], [clamp((g0 - h01 * x) / h00), x]])]
  if (Math.abs(determinant) > 1e-10) choices.push([(g0 * h11 - g1 * h01) / determinant, (g1 * h00 - g0 * h01) / determinant])
  const cost = ([x, y]: number[]) => (a[0] * x + a[1] * y - target[0]) ** 2 + (b[0] * x + b[1] * y - target[1]) ** 2
  return choices.filter(p => p.every(n => n >= 0 && n <= 10)).sort((p, q) => cost(p) - cost(q))[0]
}
it('matches an independent enumerated reference across active and slack bounds', () => {
  for (let i = 1; i <= 40; i++) {
    const a = [1, (i % 4) - 2], b = [(i % 3) - 1, 3], target = [i - 10, 30 - i]
    const expected = reference(a, b, target)
    const actual = solveResizePriorities([], [row([1, 0]), row([0, 1]), row([-1, 0], -10), row([0, -1], -10)], [1, 1], [
      { name: 'reference', rows: [row(a, target[0]), row(b, target[1])] },
    ]).values
    actual.forEach((n, j) => expect(n).toBeCloseTo(expected[j], 4))
  }
})
