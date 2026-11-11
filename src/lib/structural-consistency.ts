import type { StructuralRow } from './structural-solver'

const simple = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1024 && Number.isInteger(value * 1024)
type IntervalRow = { entries: Map<number, number>; lower: number; upper: number }

/** Cheap rejection certificate for bounded structural edits. Use only exactly
 * representable dyadic coefficients; other rows fall through to the solver.
 * RHS intervals include the solver residual tolerance, discarded coefficients
 * at the caller's variable bound, and outward floating-point padding. */
export function structuralContradiction(rows: readonly StructuralRow[], maximumMagnitude: number): { variables: number[]; residual: number } | undefined {
  if (rows.length > 512 || !Number.isFinite(maximumMagnitude) || maximumMagnitude <= 0) return
  const basis = new Map<number, IntervalRow>()
  const variables = new Set<number>()
  for (const row of rows) {
    const entries = new Map<number, number>()
    let tolerance = 1e-5
    let usable = Number.isFinite(row.value)
    for (const [index, coefficient] of row.entries) {
      if (Math.abs(coefficient) <= 1e-10) tolerance += Math.abs(coefficient) * maximumMagnitude
      else if (!simple(coefficient)) { usable = false; break }
      else entries.set(index, coefficient)
    }
    if (!usable || !entries.size) continue
    for (const index of row.entries.keys()) variables.add(index)
    tolerance += 1e-12 + Number.EPSILON * 8 * (Math.abs(row.value) + tolerance)
    let lower = row.value - tolerance, upper = row.value + tolerance
    for (const [pivot, previous] of basis) {
      const factor = entries.get(pivot)
      if (!factor) continue
      // Both operands are bounded multiples of 2^-10, so products and
      // subtraction are exact in binary64. Keep that invariant after each row.
      for (const [index, coefficient] of previous.entries) {
        const value = (entries.get(index) ?? 0) - factor * coefficient
        if (!simple(value)) { usable = false; break }
        if (value) entries.set(index, value)
        else entries.delete(index)
      }
      if (!usable) break
      const a = factor * previous.lower, b = factor * previous.upper
      const padding = 1e-12 + Number.EPSILON * 8 * (Math.abs(lower) + Math.abs(upper) + Math.abs(a) + Math.abs(b))
      lower -= Math.max(a, b) + padding
      upper -= Math.min(a, b) - padding
    }
    if (!usable || !Number.isFinite(lower) || !Number.isFinite(upper)) continue
    if (!entries.size) {
      if (lower > 0 || upper < 0) return { variables: [...variables], residual: Math.max(lower, -upper) }
      continue
    }
    const [pivot, divisor] = [...entries].reduce((best, entry) => Math.abs(entry[1]) > Math.abs(best[1]) ? entry : best)
    // Division by a power of two is exact; reject awkward or large factors.
    if (!Number.isInteger(Math.log2(Math.abs(divisor)))) continue
    const normalized = new Map([...entries].map(([index, value]) => [index, value / divisor]))
    if (![...normalized.values()].every(simple)) continue
    const a = lower / divisor, b = upper / divisor
    basis.set(pivot, { entries: normalized, lower: Math.min(a, b), upper: Math.max(a, b) })
  }
}
