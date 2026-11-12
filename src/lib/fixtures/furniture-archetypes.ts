import { createPanel } from '../model'
import type { Panel } from '../types'

/**
 * Minimal, recognisable furniture built from real panels, in millimetres.
 * Each archetype states the role auto furnish should recognise, so changes to
 * the scoring are checked against the whole set rather than one example.
 */
const T = 18

/** A level board whose top surface is at `top`. */
export const board = (id: string, width: number, depth: number, x: number, top: number, z = 0, name = 'Board') =>
  createPanel({ id, name, width, height: depth, thickness: T, position: [x, top - T / 2, z], rotation: [-Math.PI / 2, 0, 0] })
/** An upright facing ±X, standing on `bottom`. */
export const side = (id: string, depth: number, height: number, x: number, bottom = 0, z = 0) =>
  createPanel({ id, name: 'Side', width: depth, height, thickness: T, position: [x, bottom + height / 2, z], rotation: [0, Math.PI / 2, 0] })
/** An upright facing ±Z, standing on `bottom`. */
export const back = (id: string, width: number, height: number, z: number, bottom = 0, x = 0) =>
  createPanel({ id, name: 'Back', width, height, thickness: T, position: [x, bottom + height / 2, z] })

/** A carcass: top, side walls to the floor, optional bottom, shelves and back. */
function carcass(prefix: string, width: number, depth: number, height: number,
  { bottom, shelves = [], withBack = true }: { bottom?: number; shelves?: number[]; withBack?: boolean } = {}) {
  const inner = width - 2 * T
  return [
    board(`${prefix}-top`, width, depth, 0, height),
    side(`${prefix}-left`, depth, height - T, -width / 2 + T / 2),
    side(`${prefix}-right`, depth, height - T, width / 2 - T / 2),
    ...(bottom === undefined ? [] : [board(`${prefix}-bottom`, inner, depth - T, 0, bottom, T / 2)]),
    ...shelves.map((top, index) => board(`${prefix}-shelf-${index}`, inner, depth - T, 0, top, T / 2)),
    ...(withBack ? [back(`${prefix}-back`, inner, height - T - (bottom ?? 0) + T, -depth / 2 + T / 2, Math.max(0, (bottom ?? T) - T))] : []),
  ]
}

export interface Archetype { id: string; role: string; panels: Panel[]; top: string }

export function furnitureArchetypes(): Archetype[] {
  return [
    { id: 'desk', role: 'desk', top: 'desk-top', panels: [board('desk-top', 1200, 600, 0, 740), side('desk-l', 600, 722, -591), side('desk-r', 600, 722, 591)] },
    // The regression: desk height and depth, but an inner shelf blocks the knees.
    { id: 'sideboard', role: 'sideboard', top: 'sb-top', panels: carcass('sb', 1200, 560, 760, { bottom: 80, shelves: [400] }) },
    { id: 'dining', role: 'dining-table', top: 'dine-top', panels: [board('dine-top', 1600, 900, 0, 750), side('dine-l', 700, 732, -650), side('dine-r', 700, 732, 650)] },
    { id: 'coffee', role: 'coffee-table', top: 'coffee-top', panels: [board('coffee-top', 1100, 600, 0, 420), side('coffee-l', 600, 402, -541), side('coffee-r', 600, 402, 541)] },
    { id: 'side-table', role: 'side-table', top: 'st-top', panels: carcass('st', 450, 450, 560, { bottom: 60, withBack: false }) },
    { id: 'counter', role: 'counter', top: 'ctr-top', panels: carcass('ctr', 1400, 620, 920, { bottom: 100, shelves: [500] }) },
    { id: 'standing-desk', role: 'standing-desk', top: 'sd-top', panels: [board('sd-top', 1200, 700, 0, 1050), side('sd-l', 600, 1032, -560), side('sd-r', 600, 1032, 560)] },
    { id: 'lowboard', role: 'lowboard', top: 'lb-top', panels: [...carcass('lb', 1600, 400, 460, { bottom: 80 }), side('lb-divider', 382, 362, 0, 80, 9)] },
    { id: 'bench', role: 'bench', top: 'bench-top', panels: [board('bench-top', 1000, 360, 0, 450), side('bench-l', 360, 432, -491), side('bench-r', 360, 432, 491)] },
    { id: 'bed', role: 'bed', top: 'bed-top', panels: [board('bed-top', 2000, 900, 0, 380), side('bed-head', 900, 900, -1009), side('bed-foot', 900, 362, 991)] },
    {
      // A 3 × 2 cube grid whose separate cube tops form one counter-height top.
      id: 'cube-sideboard', role: 'sideboard', top: 'cube-top-0', panels: [0, 1, 2].flatMap(column => {
        const x = (column - 1) * 385
        return [
          board(`cube-floor-${column}`, 350, 350, x, 18), board(`cube-mid-${column}`, 350, 350, x, 403), board(`cube-top-${column}`, 350, 350, x, 788),
          side(`cube-wall-a-${column}`, 350, 350, x - 193, 27), side(`cube-wall-b-${column}`, 350, 350, x + 193, 27),
          side(`cube-wall-c-${column}`, 350, 350, x - 193, 412), side(`cube-wall-d-${column}`, 350, 350, x + 193, 412),
        ]
      }),
    },
    {
      // A monitor riser at the back still leaves a usable desk.
      id: 'riser-desk', role: 'desk', top: 'rd-top', panels: [
        board('rd-top', 1400, 700, 0, 740), side('rd-l', 700, 722, -691), side('rd-r', 700, 722, 691),
        board('rd-riser', 1000, 220, 0, 900, -230), side('rd-riser-l', 220, 142, -491, 740, -230), side('rd-riser-r', 220, 142, 491, 740, -230),
      ],
    },
  ]
}

/** A row of identical compartments with stable IDs. */
export function compartmentRow(columns: number, prefix = 'row') {
  const width = 380, depth = 420, height = 320, pitch = width + 35
  const panels: Panel[] = []
  for (let column = 0; column < columns; column++) {
    const x = (column - (columns - 1) / 2) * pitch
    panels.push(board(`${prefix}-shelf-${column}`, width, depth, x, 18), board(`${prefix}-roof-${column}`, width, depth, x, 18 + height + 35))
  }
  for (let column = 0; column <= columns; column++) panels.push(side(`${prefix}-wall-${column}`, depth, height + 17, (column - columns / 2) * pitch, 27))
  return panels
}
