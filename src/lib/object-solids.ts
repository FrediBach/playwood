import { findObjectNotches, type ObjectNotches } from './object-notches'
import { findObjectRecess, findObjectTunnel, type ObjectRecess, type ObjectTunnel } from './object-tunnel'
import { findObjectPrism, type ObjectPrism } from './object-prism'
import type { ObjectBounds } from './object-geometry'
import type { Vec3 } from './types'

export interface ObjectSolid { bounds: ObjectBounds; cuboid: boolean; prism?: ObjectPrism; tunnel?: ObjectTunnel; recess?: ObjectRecess; notches?: ObjectNotches }

/** Split exact occupied cells by face connectivity. Edge/corner contacts remain
 * distinct solids and are rejected later by conversion's contact checks. */
export function findObjectSolids(planes: number[][], occupied: Uint8Array): ObjectSolid[] {
  const sizes = planes.map(p => p.length - 1), visited = new Uint8Array(occupied.length)
  const index = (cell: number[]) => (cell[0] * sizes[1] + cell[1]) * sizes[2] + cell[2]
  const coordinates = (i: number) => [Math.floor(i / (sizes[1] * sizes[2])), Math.floor(i / sizes[2]) % sizes[1], i % sizes[2]]
  const solids: ObjectSolid[] = []
  let remainingCells = 100000
  for (let start = 0; start < occupied.length; start++) {
    if (!occupied[start] || visited[start]) continue
    if (solids.length >= 33) throw new Error('Too many disconnected pieces for the 200-panel project limit.')
    const cells = [start], first = coordinates(start), last = [...first]
    visited[start] = 1
    for (let cursor = 0; cursor < cells.length; cursor++) {
      const cell = coordinates(cells[cursor])
      cell.forEach((value, axis) => { first[axis] = Math.min(first[axis], value); last[axis] = Math.max(last[axis], value) })
      for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
        const neighbor = [...cell]; neighbor[axis] += direction
        if (neighbor[axis] < 0 || neighbor[axis] >= sizes[axis]) continue
        const next = index(neighbor)
        if (occupied[next] && !visited[next]) { visited[next] = 1; cells.push(next) }
      }
    }
    const extent = first.map((value, axis) => last[axis] - value + 1)
    const count = extent.reduce((product, size) => product * size, 1)
    const bounds = { min: first.map((value, axis) => planes[axis][value]) as Vec3, max: last.map((value, axis) => planes[axis][value + 1]) as Vec3 }
    const cuboid = cells.length === count
    let prism: ObjectPrism | undefined, tunnel: ObjectTunnel | undefined, recess: ObjectRecess | undefined, notches: ObjectNotches | undefined
    if (!cuboid) {
      remainingCells -= count
      if (remainingCells < 0) throw new Error('Disconnected object pieces are too complex. Simplify the shape.')
      const local = new Uint8Array(count)
      for (const i of cells) {
        const cell = coordinates(i).map((value, axis) => value - first[axis])
        local[(cell[0] * extent[1] + cell[1]) * extent[2] + cell[2]] = 1
      }
      const localPlanes = planes.map((values, axis) => values.slice(first[axis], last[axis] + 2))
      prism = findObjectPrism(localPlanes, local)
      if (!prism) tunnel = findObjectTunnel(localPlanes, local)
      if (!prism && !tunnel) recess = findObjectRecess(localPlanes, local)
      if (!prism && !tunnel && !recess) notches = findObjectNotches(localPlanes, local)
    }
    solids.push({ bounds, cuboid, prism, tunnel, recess, notches })
  }
  return solids
}
