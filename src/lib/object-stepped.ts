import type { ObjectNotches } from './object-notches'
import type { Vec3 } from './types'

/** Height fields on any axis: each nonempty column is contiguous and starts
 * at one common plane. This excludes enclosed voids and overhanging layers. */
export function findObjectStepped(planes: number[][], occupied: Uint8Array): ObjectNotches | undefined {
  const sizes = planes.map(p => p.length - 1)
  for (const axis of [0, 1, 2]) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    let commonLow = true, commonHigh = true, firstLow: number | undefined, firstHigh: number | undefined
    for (let a = 0; a < sizes[u]; a++) for (let b = 0; b < sizes[v]; b++) {
      let low = -1, high = -1, count = 0
      for (let d = 0; d < sizes[axis]; d++) {
        const c = [0, 0, 0]; c[axis] = d; c[u] = a; c[v] = b
        if (!occupied[(c[0] * sizes[1] + c[1]) * sizes[2] + c[2]]) continue
        if (low < 0) low = d
        high = d; count++
      }
      if (!count) continue
      firstLow ??= low; firstHigh ??= high
      commonLow &&= low === firstLow && count === high - low + 1
      commonHigh &&= high === firstHigh && count === high - low + 1
    }
    if (firstLow !== undefined && (commonLow || commonHigh)) return {
      planes, occupied, bounds: { min: planes.map(p => p[0]) as Vec3, max: planes.map(p => p[p.length - 1]) as Vec3 },
    }
  }
}
