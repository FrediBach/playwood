import { expect, it } from 'vitest'
import { structuralContradiction } from './structural-consistency'
import type { StructuralRow } from './structural-solver'
const row = (entries: [number, number][], value: number): StructuralRow => ({ entries: new Map(entries), value, provenance: { kind: 'joint' } })

it('detects incompatible fixed cuts through shared spans', () => {
  const rows = [row([[0, 1], [1, -1]], 0), row([[1, .5], [2, -.5]], 0), row([[0, 1]], 8), row([[2, 1]], 0)]
  expect(structuralContradiction(rows, 1e6)?.variables).toEqual(expect.arrayContaining([0, 1, 2]))
  expect(structuralContradiction(rows.slice(0, -1), 1e6)).toBeUndefined()
})
it('includes original equation tolerances and tiny coefficients in its certificate', () => {
  expect(structuralContradiction([row([[0, 1]], 0), row([[0, 1]], 1.9e-5)], 1e6)).toBeUndefined()
  const rows = [row([[0, 1]], 0), row([[0, 1], [1, 1e-10]], 1e-4)]
  // x=0, y=1e6 satisfies both equations; dropping y must not reject it.
  expect(structuralContradiction(rows, 1e6)).toBeUndefined()
  expect(structuralContradiction(rows, 1)).toBeDefined()
})
it('falls through for unsupported coefficients and unbounded requests', () => {
  expect(structuralContradiction([row([[0, Math.sqrt(2)]], 0), row([[0, Math.sqrt(2)]], 8)], 1e6)).toBeUndefined()
  expect(structuralContradiction([row([[0, 1]], 0), row([[0, 1]], 8)], Infinity)).toBeUndefined()
})
it('never rejects generated feasible systems, including redundant rows and nonzero residuals', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const values = [seed * .125, -seed * .25, seed % 7]
    const rows = Array.from({ length: 12 }, (_, index) => {
      const entries: [number, number][] = values.map((_, variable) => [variable, ((seed + index * (variable + 1)) % 9 - 4) / 2])
      return row(entries, entries.reduce((sum, [variable, coefficient]) => sum + coefficient * values[variable], 0) + (index % 2 ? 9e-6 : -9e-6))
    })
    expect(structuralContradiction(rows, 1e6)).toBeUndefined()
  }
})
