import { getNiceValueStep } from './nice-values'
import { getRescaleValues, rescaleProject, type RescaleValue } from './project-rescale'
import type { Project } from './types'

/** Search outwards from the current cut, stopping at the first sampled failure.
 * Refinement stays on the configured step grid. Every actual edit is still
 * validated: collision feasibility need not be monotonic between samples. */
function reachableLimit(current: number, target: number, direction: -1 | 1, accepts: (index: number) => boolean): number {
  let valid = current
  const distance = Math.abs(target - current)
  if (!distance) return current
  const samples = [...new Set([1, ...[1, 2, 3, 4].map(part => Math.ceil(distance * part / 4))])]
  for (const offset of samples) {
    const probe = current + direction * offset
    if (accepts(probe)) { valid = probe; continue }
    let invalid = probe
    while (Math.abs(invalid - valid) > 1) {
      const middle = valid + direction * Math.floor(Math.abs(invalid - valid) / 2)
      if (accepts(middle)) valid = middle
      else invalid = middle
    }
    break
  }
  return valid
}

/** Offer a local, solver-tested range, normally half to twice the current cut.
 * Range discovery is memoized per committed project and frozen during a drag. */
export function getPreviewRescaleValues(project: Project): RescaleValue[] {
  const step = getNiceValueStep(project.niceValues) ?? 1
  const ranked = getRescaleValues(project).filter(value => value.kind === 'dimension')
    .sort((a, b) => b.count - a.count || a.value - b.value)
  const available: RescaleValue[] = []
  for (const value of ranked) {
    const low = Math.ceil(Math.max(value.min, Math.min(value.value / 2, value.value - step)) / step - 1e-9)
    const high = Math.floor(Math.min(value.max, Math.max(value.value * 2, value.value + step)) / step + 1e-9)
    const amount = (index: number) => Number((index * step).toFixed(9))
    const cache = new Map<number, boolean>()
    const accepts = (index: number) => {
      if (index < low || index > high) return false
      if (cache.has(index)) return cache.get(index)!
      let valid = Math.abs(amount(index) - value.value) < 1e-6
      if (!valid) {
        try { valid = rescaleProject(project, { [value.id]: amount(index) }) !== project }
        catch { /* Joints, constraints, collisions and inserts bound the range. */ }
      }
      cache.set(index, valid)
      return valid
    }
    // Starting just inside the current cut lets fractional legacy values probe
    // the next absolute multiple in each direction, without skipping a step.
    const downStart = Math.ceil(value.value / step - 1e-9)
    const upStart = Math.floor(value.value / step + 1e-9)
    const down = reachableLimit(downStart, low, -1, accepts)
    const up = reachableLimit(upStart, high, 1, accepts)
    const min = down < downStart ? amount(down) : value.value
    const max = up > upStart ? amount(up) : value.value
    if (max - min > 1e-6) available.push({ ...value, min, max })
    if (available.length === 4) break
  }
  return available
}
