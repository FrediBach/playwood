import { attachPanel, createPanel, resolvePanels } from './model'
import { gridProject, groundProject, hTableProject } from './example-geometry'
import type { Panel, Project } from './types'

const accessory = (overrides: Partial<Panel>) => createPanel({ material: 'painted', thickness: 3, color: '#c9ced5', ...overrides })

/** Rectangular versions of the source's folded divider inserts and lower doors. */
function insert(project: Project, cx: number, cy: number, width: number, height: number, doors: boolean, label: string) {
  const thickness = 14, depth = 256, color = '#e4ce9b'
  const base = { material: 'birch' as const, color, thickness }
  project.panels.push(
    createPanel({ ...base, name: `${label} back`, width, height, position: [cx, cy, -135 + thickness / 2] }),
    createPanel({ ...base, name: `${label} left`, width: depth, height, position: [cx - width / 2 + thickness / 2, cy, 7], rotation: [0, Math.PI / 2, 0] }),
    createPanel({ ...base, name: `${label} right`, width: depth, height, position: [cx + width / 2 - thickness / 2, cy, 7], rotation: [0, Math.PI / 2, 0] }),
    createPanel({ ...base, name: `${label} shelf`, width: width - thickness * 2, height: depth, position: [cx, cy, 7], rotation: [-Math.PI / 2, 0, 0] }),
  )
  if (doors) project.panels.push(accessory({ name: `${label} lower door`, width: width - thickness * 2, height: height / 2 - thickness,
    color, position: [cx, cy - height / 4, 138] }))
}

export function counterWithDoorsProject(): Project {
  const p = gridProject('Counter with doors', [735, 735, 735], [735])
  for (const [bay, x] of [-770, 0, 770].entries()) for (const [side, dx] of [-185, 185].entries()) {
    insert(p, x + dx, 394, 370, 750, true, `Bay ${bay + 1}.${side + 1}`)
  }
  return p
}

function promotionalDeskProject(): Project {
  const p = gridProject('Promotional desk', [735], [735, 350])
  for (const [i, x] of [-185, 185].entries()) insert(p, x, 394, 370, 750, false, `Lower insert ${i + 1}`)
  insert(p, 0, 971.5, 750, 365, false, 'Upper insert')
  p.panels.push(
    accessory({ name: 'Lower printed panel', width: 747, height: 747, position: [0, 394, 150] }),
    accessory({ name: 'Upper printed panel', width: 747, height: 362, position: [0, 971.5, 150] }),
  )
  return p
}

function totemProject(): Project {
  const cells: [number, number][] = [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1], [2, 2]]
  const p = gridProject('Totem', [350, 350, 350], [350, 350, 735], { cells,
    edgeDepths: { 'h:2:0': 735, 'h:2:1': 735, 'v:2:0': 735, 'v:3:0': 735 } })
  // The original deep bay extends forward. Native shared joints currently
  // require one common seam offset, so this editable version centers its
  // deeper panels. Additional corner clamps use the remaining open seam.
  const panels = resolvePanels(p)
  for (const shelfName of ['Shelf 3.1', 'Shelf 3.2']) for (const sideName of ['Upright 3.1', 'Upright 4.1']) {
    const parent = panels.find(panel => panel.name === shelfName)!
    const child = panels.find(panel => panel.name === sideName)!
    for (const side of ['left', 'right'] as const) for (const flip of [false, true]) {
      const c = { id: `${crypto.randomUUID()}:0`, parentId: parent.id, childId: child.id,
        type: '90' as const, side, flip, offset: 0, inset: 0, count: 1, color: '#e75a35' }
      const expected = resolvePanels({ version: 1, name: 'Corner support', panels: [parent, child], connections: [c] })[1]
      if (expected.position.every((value, i) => Math.abs(value - child.position[i]) < 0.01)) p.connections.push({ ...c, role: 'support' })
    }
  }
  for (const [x, y] of cells) p.panels.push(accessory({ name: `Printed panel ${x + 1}.${y + 1}`, width: 362,
    height: y === 2 ? 747 : 362, position: [(x - 1) * 385, y === 2 ? 1164 : 201.5 + y * 385, 145] }))
  return p
}

function cornerBoothProject(): Project {
  const back = createPanel({ name: 'Back wall', width: 1200, height: 1200, material: 'painted', position: [0, 600, 0] })
  let p: Project = { version: 1, name: 'Corner booth', panels: [back], connections: [] }
  const options = { type: '90' as const, inset: 0, offset: 0, flip: false, count: 3, color: '#e75a35' }
  p = attachPanel(p, back.id, createPanel({ name: 'Full-height side', width: 1200, height: 1200, material: 'painted' }), { ...options, side: 'left' })
  p = attachPanel(p, back.id, createPanel({ name: 'Low side', width: 1200, height: 800, material: 'painted' }), { ...options, side: 'right', offset: -200, count: 2 })
  return groundProject(p)
}

export const CAD_EXAMPLES = [
  { id: 'totem', name: 'Totem', description: 'A stepped display inspired by the supplied Totem.', category: 'Display', source: '000-totem/000-totem.pdf', create: totemProject },
  { id: 'corner-booth', name: 'Corner booth', description: 'Three panels define a welcoming corner.', category: 'Display', source: '001-corner/001-corner.pdf', create: cornerBoothProject },
  { id: 'counter-with-doors', name: 'Counter with doors', description: 'Three bays with six lower storage doors.', category: 'Counters', source: '002-shelf/002-shelf.pdf', create: counterWithDoorsProject },
  { id: 'h-table-180', name: 'H-table 180', description: 'A long work table with a central spine.', category: 'Tables', source: '003-workshop-table/003-workshop-table.pdf', create: () => hTableProject('H-table 180', 1800) },
  { id: 'cube', name: 'Cube', description: 'One open cube for seating or display.', category: 'Seating', source: '003-workshop-table/003-workshop-table.pdf', create: () => gridProject('Cube', [350], [350]) },
  { id: 'promotional-desk', name: 'Promotional desk', description: 'A tall counter with two printable faces.', category: 'Display', source: '004-display-counter/004-display-counter.pdf', create: promotionalDeskProject },
] as const
