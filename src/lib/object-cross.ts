import type { ObjectNotches } from './object-notches'
import type { Vec3 } from './types'

/** A rectangular core with full-face arms on three axes (three to six arms).
 * Exact occupancy matching excludes cavities, bent arms, and partial faces. */
export function findObjectCross(planes: number[][], occupied: Uint8Array): ObjectNotches | undefined {
  const sizes = planes.map(p => p.length - 1)
  const coordinates = (i: number) => [Math.floor(i / (sizes[1] * sizes[2])), Math.floor(i / sizes[2]) % sizes[1], i % sizes[2]]
  const counts = sizes.map(n => new Array<number>(n).fill(0))
  occupied.forEach((value, i) => { if (value) coordinates(i).forEach((c, a) => counts[a][c]++) })
  const core = counts.map(values => {
    const max = Math.max(...values)
    return [values.indexOf(max), values.lastIndexOf(max)]
  })
  if (core.some(([lo, hi], a) => lo === 0 && hi === sizes[a] - 1)) return
  for (let i = 0; i < occupied.length; i++) {
    const inside = coordinates(i).filter((c, a) => c >= core[a][0] && c <= core[a][1]).length >= 2
    if (!!occupied[i] !== inside) return
  }
  return { planes, occupied, bounds: { min: planes.map(p => p[0]) as Vec3, max: planes.map(p => p[p.length - 1]) as Vec3 } }
}
