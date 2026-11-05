import type { ObjectBounds } from './object-geometry'
import type { Vec3 } from './types'

export interface ObjectRecess extends ObjectTunnel { entry: 0 | 1 }
export interface ObjectTunnel { axis: 0 | 1 | 2; outer: ObjectBounds; opening: ObjectBounds }

/** Locate exactly one rectangular empty region inside the occupied bounding box. */
function findBoxVoid(planes: number[][], occupied: Uint8Array) {
  const sizes = planes.map(p => p.length - 1)
  const first = [Infinity, Infinity, Infinity], last = [-Infinity, -Infinity, -Infinity]
  const visit = (fn: (cell: number[], filled: boolean) => void) => {
    for (let x = 0; x < sizes[0]; x++) for (let y = 0; y < sizes[1]; y++) for (let z = 0; z < sizes[2]; z++) fn([x, y, z], !!occupied[(x * sizes[1] + y) * sizes[2] + z])
  }
  visit((cell, filled) => { if (filled) cell.forEach((v, axis) => { first[axis] = Math.min(first[axis], v); last[axis] = Math.max(last[axis], v) }) })
  if (!Number.isFinite(first[0])) return
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  let missing = 0
  visit((cell, filled) => {
    if (filled || cell.some((v, axis) => v < first[axis] || v > last[axis])) return
    missing++
    cell.forEach((v, axis) => { lo[axis] = Math.min(lo[axis], v); hi[axis] = Math.max(hi[axis], v) })
  })
  if (!missing || missing !== lo.reduce((n, v, axis) => n * (hi[axis] - v + 1), 1)) return
  const bounds = (min: number[], max: number[]): ObjectBounds => ({ min: min.map((v, axis) => planes[axis][v]) as Vec3, max: max.map((v, axis) => planes[axis][v + 1]) as Vec3 })
  return { outer: bounds(first, last), opening: bounds(lo, hi) }
}

export function findObjectTunnel(planes: number[][], occupied: Uint8Array): ObjectTunnel | undefined {
  const shape = findBoxVoid(planes, occupied)
  if (!shape) return
  const { outer, opening } = shape
  const axes = [0, 1, 2].filter(i => opening.min[i] === outer.min[i] && opening.max[i] === outer.max[i])
  if (axes.length !== 1 || [0, 1, 2].some(i => i !== axes[0] && (opening.min[i] <= outer.min[i] || opening.max[i] >= outer.max[i]))) return
  return { ...shape, axis: axes[0] as 0 | 1 | 2 }
}

/** A blind rectangular pocket touches exactly one outer face. */
export function findObjectRecess(planes: number[][], occupied: Uint8Array): ObjectRecess | undefined {
  const shape = findBoxVoid(planes, occupied)
  if (!shape) return
  const contacts = ([0, 1, 2] as const).flatMap(axis => ([0, 1] as const).flatMap(entry => {
    const side = entry ? 'max' : 'min'
    return shape.opening[side][axis] === shape.outer[side][axis] ? [{ axis, entry }] : []
  }))
  if (contacts.length !== 1) return
  return { ...shape, ...contacts[0] }
}
