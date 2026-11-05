/** An exact simple orthogonal cross-section extruded along one world axis. */
export const OBJECT_PRISM_EDGE_LIMIT = 12
export interface ObjectPrism { axis: 0 | 1 | 2; outline: [number, number][]; min: number; max: number }

/** Recognize one bounded orthogonal loop with constant occupancy along its extrusion.
 * Integer grid topology avoids mistaking small cavities or disconnected pieces for a prism. */
export function findObjectPrism(planes: number[][], occupied: Uint8Array): ObjectPrism | undefined {
  const sizes = planes.map(p => p.length - 1)
  const at = (cell: number[]) => occupied[(cell[0] * sizes[1] + cell[1]) * sizes[2] + cell[2]]
  for (const axis of [2, 0, 1] as const) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, columns = new Map<string, [number, number]>()
    let first = Infinity, last = -Infinity, valid = true
    for (let a = 0; a < sizes[u]; a++) for (let b = 0; b < sizes[v]; b++) {
      let lo = Infinity, hi = -Infinity, count = 0
      for (let d = 0; d < sizes[axis]; d++) {
        const cell = [0, 0, 0]; cell[u] = a; cell[v] = b; cell[axis] = d
        if (at(cell)) { lo = Math.min(lo, d); hi = d; count++ }
      }
      if (!count) continue
      if (count !== hi - lo + 1 || (columns.size && (lo !== first || hi !== last))) valid = false
      first = lo; last = hi; columns.set(`${a},${b}`, [a, b])
    }
    if (!valid || !columns.size) continue
    const edges = new Map<string, [number, number]>()
    const edge = (a: number, b: number, c: number, d: number) => {
      const key = `${a},${b}`
      if (edges.has(key)) valid = false // touching loops are not a single simple boundary
      edges.set(key, [c, d])
    }
    for (const [a, b] of columns.values()) {
      if (!columns.has(`${a},${b - 1}`)) edge(a, b, a + 1, b)
      if (!columns.has(`${a + 1},${b}`)) edge(a + 1, b, a + 1, b + 1)
      if (!columns.has(`${a},${b + 1}`)) edge(a + 1, b + 1, a, b + 1)
      if (!columns.has(`${a - 1},${b}`)) edge(a, b + 1, a, b)
    }
    if (!valid) continue
    const start = edges.keys().next().value!, loop: [number, number][] = []
    let key = start
    do {
      const next = edges.get(key)
      if (!next) { valid = false; break }
      loop.push(key.split(',').map(Number) as [number, number]); edges.delete(key); key = next.join(',')
    } while (key !== start)
    if (!valid || edges.size) continue // cavities and multiple components
    const corners = loop.filter((p, i) => {
      const prev = loop[(i + loop.length - 1) % loop.length], next = loop[(i + 1) % loop.length]
      return (p[0] - prev[0]) * (next[1] - p[1]) !== (p[1] - prev[1]) * (next[0] - p[0])
    })
    if (corners.length >= 6 && corners.length <= OBJECT_PRISM_EDGE_LIMIT) return { axis, outline: corners.map(([a, b]) => [planes[u][a], planes[v][b]]), min: planes[axis][first], max: planes[axis][last + 1] }
  }
}
