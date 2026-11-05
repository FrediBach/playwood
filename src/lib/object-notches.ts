import type { ObjectBounds } from './object-geometry'
import type { Vec3 } from './types'

/** A bounded family: a cuboid with separate rectangular bites at its corners. */
export interface ObjectNotches { planes: number[][]; occupied: Uint8Array; bounds: ObjectBounds }
export function findObjectNotches(planes: number[][], occupied: Uint8Array): ObjectNotches | undefined {
  const sizes = planes.map(p => p.length - 1), visited = new Set<number>()
  const index = (c: number[]) => (c[0] * sizes[1] + c[1]) * sizes[2] + c[2]
  const coordinates = (i: number) => [Math.floor(i / (sizes[1] * sizes[2])), Math.floor(i / sizes[2]) % sizes[1], i % sizes[2]]
  let notches = 0
  for (let i = 0; i < occupied.length; i++) {
    if (occupied[i] || visited.has(i)) continue
    const queue = [i], lo = coordinates(i), hi = [...lo]; visited.add(i)
    for (let j = 0; j < queue.length; j++) {
      const cell = coordinates(queue[j])
      cell.forEach((v, a) => { lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v) })
      for (let a = 0; a < 3; a++) for (const d of [-1, 1]) {
        const c = [...cell]; c[a] += d
        if (c[a] < 0 || c[a] >= sizes[a]) continue
        const next = index(c)
        if (!occupied[next] && !visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    if (++notches > 4 || queue.length !== lo.reduce((n, v, a) => n * (hi[a] - v + 1), 1)
      || lo.some((v, a) => Number(v === 0) + Number(hi[a] === sizes[a] - 1) !== 1)) return
  }
  if (!notches) return
  return { planes, occupied, bounds: { min: planes.map(p => p[0]) as Vec3, max: planes.map(p => p[p.length - 1]) as Vec3 } }
}
