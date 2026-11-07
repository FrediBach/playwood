import { Euler, Quaternion, Vector3 } from 'three'
import { getPhysicalConnectors } from './connector-selection'
import { separateOverlappingConnectors } from './connector-clearance'
import { gridProject } from './example-geometry'
import { findPanelHoles } from './close-holes'
import { connectClosingPanel } from './closure-connectors'
import { resolvePanels } from './model'
import type { Panel, Project } from './types'

const layouts: Record<string, [number[], number[]]> = {
  'modular-shelf': [[350, 350, 350, 350], [350, 350]],
  'shelf-04': [[350, 350], [350, 350]],
  'shelf-08': [[350, 350, 350, 350], [350, 350]],
  'high-meeting-table': [[350], [350, 350, 350]],
  'counter-with-doors': [Array(6).fill(350), [350, 350]],
  'promotional-desk': [[350, 350], [350, 350, 350]],
  counter: [Array(6).fill(350), [350, 350]],
  'reception-counter': [Array(6).fill(350), [350, 350]],
  'trade-fair-display': [Array(6).fill(350), Array(4).fill(350)],
}
const normal = (panel: Panel) => new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation))
const finish = (panel: Panel, source: Panel): Panel => ({ ...panel, material: source.material, color: source.color,
  ...(source.finishCoverage === undefined ? {} : { finishCoverage: source.finishCoverage }) })

/** Replace source accessories with subdivided stock and exposed-edge joints.
 * Historical factories stay unchanged for conservative saved-project repairs.
 */
export function connectedExample(id: string, source: Project): Project {
  if (id === 'workstation') return connectedWorkstation(source)
  const layout = layouts[id]
  if (!layout && id !== 'totem') return source
  const original = resolvePanels(source)
  let project = layout ? gridProject(source.name, ...layout) : {
    ...source, panels: source.panels.filter(panel => panel.thickness === 18),
  }
  // Keep frame finishes; the new intermediate cuts inherit the nearest parallel
  // divider/shelf finish. No appearance is inferred from a panel's display name.
  project.panels = project.panels.map(panel => {
    const candidates = original.filter(other => Math.abs(normal(panel).dot(normal(other))) > .999)
    const nearest = candidates.sort((a, b) => new Vector3(...a.position).distanceToSquared(new Vector3(...panel.position))
      - new Vector3(...b.position).distanceToSquared(new Vector3(...panel.position)))[0]
    return nearest ? finish(panel, nearest) : panel
  })
  if (id === 'totem') {
    // Align the front edges of the deeper base bay with the upper bays. Each
    // branch retains its own seam offset; the common rail stays in their overlap.
    project.panels = resolvePanels(project).map(panel => ({ ...panel, position: [panel.position[0], panel.position[1], 175 - panel.height / 2] }))
    const byId = new Map(project.panels.map(panel => [panel.id, panel]))
    project.connections = project.connections.map(connection => {
      const parent = byId.get(connection.parentId)!, child = byId.get(connection.childId)!
      const delta = new Vector3(...child.position).sub(new Vector3(...parent.position))
        .applyQuaternion(new Quaternion().setFromEuler(new Euler(...parent.rotation)).invert())
      return { ...connection, offset: delta.y }
    })
    project = separateOverlappingConnectors(project, getPhysicalConnectors(project).map(piece => piece.id))
  }
  const faces = original.filter(panel => panel.thickness < 18 && Math.abs(normal(panel).z) > .999)
  // Each original face can cover several new compartments. Individual fitted
  // faces share T joints where their edges meet instead of overlapping dividers.
  const holes = findPanelHoles(resolvePanels(project)).filter(hole => /^Front|^Back/.test(hole.label))
  const faceCounts = new Map<string, number>()
  for (const hole of holes) {
    const [x, y, z] = hole.panel.position
    const sourceFace = faces.find(face => Math.sign(face.position[2]) === Math.sign(z)
      && Math.abs(x - face.position[0]) < face.width / 2
      && Math.abs(y - face.position[1]) < face.height / 2)
    if (!sourceFace) continue
    const count = (faceCounts.get(sourceFace.id) ?? 0) + 1
    faceCounts.set(sourceFace.id, count)
    const panel = finish({ ...hole.panel, id: crypto.randomUUID(), name: `${sourceFace.name.replace(/door/gi, 'fixed front')} · ${count}` }, sourceFace)
    project = connectClosingPanel(project, panel, hole.boundaryIds)
  }
  return project
}

function connectedWorkstation(source: Project): Project {
  const original = resolvePanels(source)
  const top = original.find(panel => panel.name === 'Worktop')!
  let project: Project = { version: 1, name: source.name, panels: [], connections: [] }
  const upperIds = new Set<string>()
  for (const [label, x] of [['Left', -565], ['Right', 565]] as const) {
    const pedestal = gridProject(`${label} pedestal`, [350, 350], [350, 350], { depth: 350, omitShelves: [[0, 2], [1, 2]] })
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    pedestal.panels = resolvePanels(pedestal).map(panel => {
      const e = new Euler().setFromQuaternion(turn.clone().multiply(new Quaternion().setFromEuler(new Euler(...panel.rotation))))
      const position = new Vector3(...panel.position).applyQuaternion(turn).add(new Vector3(x, 17.5, 0)).toArray()
      if (panel.name.startsWith('Upright') && panel.name.endsWith('.2')) upperIds.add(panel.id)
      const interior = panel.name === 'Upright 2.1' || panel.name === 'Upright 2.2' || panel.name.startsWith('Shelf') && panel.name.endsWith('.2')
      const appearance = original.find(item => item.name === `${label} ${interior ? 'insert divider' : 'pedestal back'}`)!
      return finish({ ...panel, name: `${label} ${panel.name}`, position, rotation: [e.x, e.y, e.z] }, appearance)
    })
    project.panels.push(...pedestal.panels)
    project.connections.push(...pedestal.connections)
  }
  for (const sign of [-1, 1]) {
    const half = { ...top, id: crypto.randomUUID(), name: `${sign < 0 ? 'Front' : 'Back'} worktop`, height: 350, position: [0, top.position[1], sign * 192.5] as Panel['position'] }
    const boundaries = project.panels.filter(panel => upperIds.has(panel.id) && sign * panel.position[2] > -1).map(panel => panel.id)
    project = connectClosingPanel(project, half, boundaries)
  }
  return project
}
