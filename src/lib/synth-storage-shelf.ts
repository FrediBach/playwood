import { equalOpeningSelection } from './equal-opening-selection'
import { autoConnect } from './auto-connect'
import { gridProject } from './example-geometry'
import { resolvePanels } from './model'
import { parseConnectorId } from './connector-selection'
import { synthShelfProject } from './synth-shelf'
import type { Project } from './types'

/** A regular two-by-two cabinet raises the optimized synth stand by 670 mm. */
export function synthStorageShelfProject(): Project {
  const source = synthShelfProject()
  const base = source.panels.find(panel => panel.name === 'Deep floor base')!
  const storage = gridProject('Synth shelf with 2×2 storage', [(base.width - 35) / 2, (base.width - 35) / 2], [300, 300], {
    depth: base.height, color: base.color, connectorColor: '#292b27',
  })
  const equalCells = [
    ...[1, 2].map(row => [1, 2, 3].map(column => `Upright ${column}.${row}`)),
    ...[1, 2].map(column => [1, 2, 3].map(row => `Shelf ${column}.${row}`)),
  ].map(names => {
    const rule = equalOpeningSelection(storage.panels, names.map(name => {
      const panel = storage.panels.find(panel => panel.name === name)
      if (!panel) throw new Error(`Missing storage boundary: ${name}`)
      return panel.id
    }))
    if (!rule) throw new Error('Could not constrain the storage openings.')
    return rule
  })
  // Also match openings across rows/columns, so differing stock thicknesses
  // cannot leave two internally equal rows with different clear cell sizes.
  for (const [first, second] of [[equalCells[0], equalCells[1]], [equalCells[2], equalCells[3]]]) {
    equalCells.push({ ...first, id: crypto.randomUUID(), panelIds: [first.panelIds[0], first.panelIds[1], second.panelIds[0], second.panelIds[1]] })
  }
  const panels = resolvePanels(source).filter(panel => panel.id !== base.id).map(panel => ({
    ...panel, position: [panel.position[0], panel.position[1] + 670, panel.position[2]] as [number, number, number],
  }))
  const connections = source.connections.filter(connection => connection.parentId !== base.id && connection.childId !== base.id)
  const retained = new Set(connections.map(connection => connection.id))
  const combined: Project = {
    ...source, name: storage.name, constraints: [...source.constraints ?? [], ...equalCells],
    panels: [...storage.panels.map(panel => ({ ...panel, name: `Storage ${panel.name.toLowerCase()}`,
      position: [panel.position[0], panel.position[1], panel.position[2] + base.position[2]] as [number, number, number] })), ...panels],
    connections: [...storage.connections, ...connections],
    connectorOverrides: Object.fromEntries(Object.entries(source.connectorOverrides ?? {}).filter(([id]) => {
      const piece = parseConnectorId(id)
      return retained.has(piece[0])
    })),
  }
  // The former floor is two roof panels, so the center divider has a real T
  // joint. Upgrade the outer roof corners to join the stand's existing uprights.
  return autoConnect(combined).project
}
