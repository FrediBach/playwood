import { attachPanel, createPanel, getProjectBounds, resolvePanels } from './model'
import { gridProject, hTableProject } from './example-geometry'
import { islandProject, workstationProject } from './platform-examples'
import type { AttachmentOptions, Connection, Panel, Project } from './types'

const WHITE = '#eeede7'
const RED = '#e75a35'
const HALF_PI = Math.PI / 2
const joint: AttachmentOptions = { side: 'right', type: '90', offset: 0, inset: 0, flip: false, color: RED, count: 2 }
const panel = (name: string, width: number, height: number, options: Partial<Panel> = {}) => createPanel({ name, width, height, material: 'painted', color: WHITE, ...options })

function centerProject(project: Project): Project {
  const panels = resolvePanels(project)
  const bounds = getProjectBounds(panels)
  const offset = [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2]
  return { ...project, panels: panels.map(p => ({ ...p, position: p.position.map((value, axis) => value - offset[axis]) as Panel['position'] })) }
}

function closeRing(project: Project, parent: Panel, child: Panel, options: AttachmentOptions): Project {
  const connection: Connection = { ...options, id: crypto.randomUUID(), parentId: parent.id, childId: child.id, role: 'support' }
  return { ...project, connections: [...project.connections, connection] }
}

/** Four walls joined on their vertical edges; the unfastened lid sits inside the rim. */
function closedPlinth(name: string, width: number, depth: number, height: number): Project {
  const front = panel('Front wall', width, height, { position: [0, height / 2, 0] })
  let project: Project = { version: 1, name, panels: [front], connections: [] }
  const right = panel('Right wall', depth, height)
  const back = panel('Back wall', width, height)
  const left = panel('Left wall', depth, height)
  for (const [parent, child] of [[front, right], [right, back], [back, left]]) project = attachPanel(project, parent.id, child, joint)
  project = closeRing(project, left, front, joint)
  const bounds = getProjectBounds(resolvePanels(project))
  project.panels.push(panel('Inset top', width, depth, { rotation: [-HALF_PI, 0, 0], position: [(bounds.min[0] + bounds.max[0]) / 2, height - 9, (bounds.min[2] + bounds.max[2]) / 2] }))
  return centerProject(project)
}

function benchProject(): Project {
  const base = panel('Bench bottom', 1120, 350, { position: [0, 9, 0], rotation: [-HALF_PI, 0, 0] })
  let project: Project = { version: 1, name: 'Bench', panels: [base], connections: [] }
  const front = panel('Bench front', 1120, 350)
  const seat = panel('Bench seat', 1120, 350)
  const back = panel('Bench back', 1120, 350)
  const options = { ...joint, side: 'top' as const, count: 3 }
  for (const [parent, child] of [[base, front], [front, seat], [seat, back]]) project = attachPanel(project, parent.id, child, options)
  return centerProject(closeRing(project, back, base, options))
}

// Divider accessories use their rectangular envelopes. Their proprietary slots,
// door hinges and printed graphics are not part of the panel editor's geometry.
// Leave these inserts freely placed rather than inventing PlayWood hardware.
function divider(project: Project, x: number, y: number, width: number, height: number, label: string): void {
  const thickness = 6
  const depth = 330
  project.panels.push(createPanel({ name: `${label} divider`, width: depth, height: height - 20, thickness, position: [x, y, 0], rotation: [0, HALF_PI, 0] }))
  if (height > 500) for (const direction of [-1, 1]) project.panels.push(createPanel({ name: `${label} insert shelf ${direction < 0 ? 'left' : 'right'}`, width: width / 2 - thickness / 2 - 10, height: depth, thickness,
    position: [x + direction * (width / 4 + thickness / 4), y, 0], rotation: [-HALF_PI, 0, 0] }))
}

function filledGrid(name: string, columns: number[], rows: number[], options: { doors?: [number, number][]; fronts?: [number, number][]; divide?: boolean } = {}): Project {
  const project = gridProject(name, columns, rows)
  const bounds = getProjectBounds(resolvePanels(project))
  // Grid boundaries are connector centerlines; panels begin 17.5 mm inward.
  let x = -(columns.reduce((sum, width) => sum + width + 35, 0)) / 2
  for (let column = 0; column < columns.length; column++) {
    const width = columns[column]
    let y = bounds.min[1] + 9
    for (let row = 0; row < rows.length; row++) {
      const height = rows[row]
      const cx = x + (width + 35) / 2, cy = y + (height + 35) / 2
      if (options.divide !== false) divider(project, cx, cy, width, height, `Cell ${column + 1}.${row + 1}`)
      if (options.doors?.some(([c, r]) => c === column && r === row)) {
        for (const direction of [-1, 1]) project.panels.push(panel(`Cell ${column + 1}.${row + 1} ${direction < 0 ? 'left' : 'right'} door`, (width - 10) / 2, (height - 10) / 2, { thickness: 6, color: '#d9bd8c', position: [cx + direction * width / 4, cy - height / 4, 181] }))
      }
      if (options.fronts?.some(([c, r]) => c === column && r === row)) project.panels.push(panel(`Cell ${column + 1}.${row + 1} display face`, width + 12, height + 12, { thickness: 3, color: '#cbd1cd', position: [cx, cy, 184] }))
      y += height + 35
    }
    x += width + 35
  }
  return project
}

export const PDF_EXAMPLES = [
  { id: 'modular-shelf', name: 'Modular rectangular shelf', description: 'Two tiers of wide compartments with divider inserts.', category: 'Shelving', source: 'meeting-room/preventivi-04-r4.pdf', create: () => filledGrid('Modular rectangular shelf', [735, 735], [350, 350]) },
  { id: 'shelf-04', name: 'Shelf 04', description: 'A compact square shelf with four compartments.', category: 'Shelving', source: 'store-01/preventivi-07-shelf-04.pdf', create: () => filledGrid('Shelf 04', [735], [735]) },
  { id: 'shelf-08', name: 'Shelf 08', description: 'Two square bays with eight divided compartments.', category: 'Shelving', source: 'store-02/preventivi-08-shelf-08.pdf', create: () => filledGrid('Shelf 08', [735, 735], [735]) },
  { id: 'high-meeting-table', name: 'High meeting table', description: 'A narrow standing table with two stacked compartments.', category: 'Tables', source: 'fiera-03/preventivi-05-meeting-table.pdf', create: highTableProject },
  { id: 'h-table-120', name: 'H-table 120', description: 'A 120 cm desk with split sides and an H-shaped brace.', category: 'Tables', source: 'office/preventivi-23-desk-120.pdf', create: () => hTableProject('H-table 120', 1200) },
  { id: 'bench', name: 'Bench', description: 'A 112 cm bench built from four long panels.', category: 'Seating', source: 'office/preventivi-19-panchina.pdf', create: benchProject },
  { id: 'counter', name: 'Popup counter', description: 'Three counter bays with a divided center and display faces.', category: 'Counters', source: 'popup-shop/preventivi-26-bancone.pdf', create: () => popupCounter() },
  { id: 'reception-counter', name: 'Reception counter with doors', description: 'Four doors and a central display face across three bays.', category: 'Counters', source: 'reception/preventivi-27-bancone-ante.pdf', create: () => filledGrid('Reception counter with doors', [735, 735, 735], [735], { doors: [[0, 0], [2, 0]], fronts: [[1, 0]] }) },
  { id: 'trade-fair-display', name: 'Trade fair display stand', description: 'Six square bays with lower doors and central display faces.', category: 'Display', source: 'fiera-02/preventivi-24-espositore-ante.pdf', create: () => filledGrid('Trade fair display stand', [735, 735, 735], [735, 735], { doors: [[0, 0], [2, 0]], fronts: [[1, 0], [1, 1]] }) },
  { id: 'workstation', name: 'Workshop table with shelves', description: 'A broad work surface on two storage pedestals. Workstation 08.', category: 'Tables', source: 'fiera-02/preventivi-28-workshop-table.pdf', create: workstationProject },
  { id: 'plinth-closed-tall', name: 'Tall closed plinth', description: 'A narrow exhibition pedestal with a fitted top.', category: 'Display', source: 'store-02/preventivi-15-plinti-chiusi.pdf', create: () => closedPlinth('Tall closed plinth', 350, 350, 1120) },
  { id: 'plinth-closed-medium', name: 'Medium closed plinth', description: 'A rectangular exhibition pedestal with a fitted top.', category: 'Display', source: 'store-02/preventivi-15-plinti-chiusi.pdf', create: () => closedPlinth('Medium closed plinth', 735, 350, 735) },
  { id: 'plinth-closed-low', name: 'Low closed plinth', description: 'A low square display platform with a fitted top.', category: 'Display', source: 'store-02/preventivi-15-plinti-chiusi.pdf', create: () => closedPlinth('Low closed plinth', 735, 735, 350) },
  { id: 'plinth-open-tall', name: 'Tall open plinth', description: 'A tall, open exhibition frame.', category: 'Display', source: 'store-03/preventivi-16-plinti-aperti.pdf', create: () => gridProject('Tall open plinth', [350], [735]) },
  { id: 'plinth-open-wide', name: 'Wide open plinth', description: 'A wide, low exhibition frame.', category: 'Display', source: 'store-03/preventivi-16-plinti-aperti.pdf', create: () => gridProject('Wide open plinth', [735], [350]) },
  { id: 'island-display', name: 'Island display', description: 'A freestanding stepped display with two broad platforms.', category: 'Display', source: 'store-03/preventivi-21-isola.pdf', create: islandProject },
] as const

function highTableProject(): Project {
  const project = gridProject('High meeting table', [350], [735, 350])
  const baseY = getProjectBounds(resolvePanels(project)).min[1] + 9
  project.panels.push(createPanel({ name: 'Lower compartment insert shelf', width: 330, height: 330, thickness: 6, position: [0, baseY + 385, 0], rotation: [-HALF_PI, 0, 0] }))
  return project
}

function popupCounter(): Project {
  // Only the middle bay has a structural middle shelf. Outer bays remain full
  // height, with split verticals where their T joints meet that middle shelf.
  const project = gridProject('Popup counter', [735, 735, 735], [350, 350], { omitShelves: [[0, 1], [2, 1]] })
  for (const x of [-770, 770]) {
    divider(project, x, 394, 735, 735, x < 0 ? 'Left bay' : 'Right bay')
    project.panels.push(panel(`${x < 0 ? 'Left' : 'Right'} display face`, 747, 747, { thickness: 3, color: '#cbd1cd', position: [x, 394, 184] }))
  }
  for (const [row, y] of [201.5, 586.5].entries()) divider(project, 0, y, 735, 350, `Middle bay ${row + 1}`)
  project.panels.push(panel('Middle lower display face', 747, 362, { thickness: 3, color: '#cbd1cd', position: [0, 201.5, 184] }))
  return project
}
