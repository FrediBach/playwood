import { CONNECTOR_PROFILES } from './connector-profile'

// Optimistic stock choice: warn even before a conversion thickness is selected.
export const OBJECT_CONNECTOR_MIN_SPAN = 40 + 16 + 2 * CONNECTOR_PROFILES['90'].seat

/** Mark narrow solid runs, not individual subdivision cells introduced by operands.
 * This is an early geometric warning, not the solver's complete hardware-fit test.
 * Three linear sweeps keep work bounded by the evaluator's cell limit.
 */
export function narrowObjectCells(planes: number[][], occupied: Uint8Array): Uint8Array {
  const sizes = planes.map(values => values.length - 1)
  const marked = new Uint8Array(occupied.length)
  const index = (cell: number[]) => (cell[0] * sizes[1] + cell[1]) * sizes[2] + cell[2]
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    for (let a = 0; a < sizes[u]; a++) for (let b = 0; b < sizes[v]; b++) {
      const cell = [0, 0, 0]; cell[u] = a; cell[v] = b
      let start = -1
      for (let n = 0; n <= sizes[axis]; n++) {
        cell[axis] = n
        if (n < sizes[axis] && occupied[index(cell)]) { if (start < 0) start = n; continue }
        if (start < 0) continue
        if (planes[axis][n] - planes[axis][start] < OBJECT_CONNECTOR_MIN_SPAN - 1e-6) {
          for (let k = start; k < n; k++) { cell[axis] = k; marked[index(cell)] = 1 }
        }
        start = -1
      }
    }
  }
  return marked
}
