import { createPanel } from '../model'
import type { Panel, Project } from '../types'

export const PREVIEW_BENCH_SEAT_ID = 'preview-bench-seat'

/** A forward-projecting seat supported by a cubby at one end and a leg at the other. */
export function createPreviewBenchProject({ seatDepth = 360, seatHeight = 400, seatLength = 1200, hutch = true }: {
  seatDepth?: number
  seatHeight?: number
  seatLength?: number
  hutch?: boolean
} = {}): Project {
  const rootZ = 200, cubbyDepth = 350, cubbyZ = rootZ + cubbyDepth / 2
  const columnPitch = seatDepth + 35, rowPitch = 365
  const paint = { material: 'painted' as const, finishCoverage: 1, color: '#e8e7df' }
  const horizontal = (id: string, width: number, depth: number, x: number, y: number, z: number, color = paint.color) => createPanel({
    ...paint, id, name: 'Horizontal board', width, height: depth, position: [x, y, z], rotation: [-Math.PI / 2, 0, 0], color,
  })
  const panels: Panel[] = [
    horizontal(PREVIEW_BENCH_SEAT_ID, seatDepth, seatLength, 0, seatHeight - 9, rootZ + seatLength / 2),
    createPanel({ ...paint, id: 'preview-bench-front-leg', name: 'End support', width: seatDepth, height: seatHeight - 18,
      position: [0, (seatHeight - 18) / 2, rootZ + seatLength - 25] }),
  ]
  // The lower storage cubby supports the attached end; its two sides are one
  // support region along the seat, so removing the far leg leaves a cantilever.
  for (let column = 0; column < 3; column++) {
    panels.push(horizontal(`preview-cubby-base-${column}`, seatDepth, cubbyDepth, column * columnPitch, 9, cubbyZ))
    if (column > 0) panels.push(horizontal(`preview-cubby-level-${column}-0`, seatDepth, cubbyDepth,
      column * columnPitch, seatHeight - 9, cubbyZ))
  }
  for (let column = 0; column <= 3; column++) {
    panels.push(createPanel({ ...paint, id: `preview-cubby-support-${column}`, name: 'Storage support', width: cubbyDepth, height: seatHeight - 53,
      position: [(column - 0.5) * columnPitch, seatHeight / 2, cubbyZ], rotation: [0, Math.PI / 2, 0] }))
  }
  if (hutch) {
    for (let row = 1; row <= 3; row++) for (let column = 0; column < 3; column++) {
      panels.push(horizontal(`preview-cubby-level-${column}-${row}`, seatDepth, cubbyDepth,
        column * columnPitch, seatHeight - 9 + row * rowPitch, cubbyZ, (row + column) % 2 ? '#b76c54' : paint.color))
    }
    for (let row = 0; row < 3; row++) for (let column = 0; column <= 3; column++) {
      panels.push(createPanel({ ...paint, id: `preview-cubby-upright-${column}-${row}`, name: 'Storage upright', width: cubbyDepth, height: rowPitch - 35,
        color: (row + column) % 2 ? '#b76c54' : paint.color,
        position: [(column - 0.5) * columnPitch, seatHeight - 9 + (row + 0.5) * rowPitch, cubbyZ], rotation: [0, Math.PI / 2, 0] }))
    }
  }
  return { version: 1, name: 'Shelving with a forward bench', panels, connections: [] }
}
