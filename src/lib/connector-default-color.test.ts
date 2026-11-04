import { describe, expect, it } from 'vitest'
import { createAssembly } from './assemblies'
import { closePanelHole, findPanelHoles } from './close-holes'
import { connectorId, editConnectors, getDefaultConnectorColor, getPhysicalConnectors } from './connector-selection'
import { DEFAULT_CONNECTOR_COLOR } from './connector-options'
import { gridProject } from './example-geometry'
import { parseProject, resolvePanels, validateProject } from './model'
import type { Project } from './types'

describe('default connector color', () => {
  it('counts physical pieces rather than connection records or empty joint branches', () => {
    const source = gridProject('Box', [350], [350])
    const connections = source.connections.map((connection, index) => ({ ...connection,
      count: index === 0 ? 4 : 1, color: index === 0 ? '#000000' : '#ffffff' }))
    connections.push({ ...connections[0], id: 'empty-branch', count: 0, color: '#ffffff' })
    expect(getDefaultConnectorColor({ connections })).toBe('#000000')
  })

  it('includes hidden hardware and individual color overrides, excluding removed pieces', () => {
    const source = gridProject('Box', [350], [350])
    const pieces = getPhysicalConnectors(source)
    const project = { ...source, panels: source.panels.map(panel => ({ ...panel, visible: false })),
      connectorOverrides: Object.fromEntries(pieces.map((piece, index) => [piece.id,
        index < 4 ? { color: '#000000' } : { color: '#ffffff', ...(index === 7 ? { removed: true } : {}) }])) }
    expect(getDefaultConnectorColor(project)).toBe('#000000')
    const changed = editConnectors(project, [pieces[0].id, pieces[1].id], { color: '#ffffff' })
    expect(getDefaultConnectorColor(changed)).toBe('#ffffff')
  })

  it('groups hex colors case-insensitively and keeps the first color when final totals tie', () => {
    const source = gridProject('Box', [350], [350])
    const connections = source.connections.slice(0, 3).map((connection, index) => ({ ...connection,
      color: ['#FFFFFF', '#000000', '#ffffff'][index], count: index === 1 ? 2 : 1 }))
    expect(getDefaultConnectorColor({ connections })).toBe('#ffffff')
  })

  it('uses the original default only when no installed hardware remains', () => {
    expect(getDefaultConnectorColor({ connections: [] })).toBe(DEFAULT_CONNECTOR_COLOR)
    const source = gridProject('Box', [350], [350])
    const removed = editConnectors(source, getPhysicalConnectors(source).map(piece => piece.id), { removed: true })
    expect(getDefaultConnectorColor(removed)).toBe(DEFAULT_CONNECTOR_COLOR)
  })

  it.each([false, true])('uses the project majority for all new closure joints (assembly: %s)', assembly => {
    const frame = gridProject('Box', [350], [350])
    const base = assembly ? createAssembly(frame, frame.panels.map(panel => panel.id)) : frame
    const ids = base.panels.map(panel => panel.id)
    const original = editConnectors(base, getPhysicalConnectors(base).map(piece => piece.id), { color: '#000000' })
    const snapshot = structuredClone(original)
    const hole = findPanelHoles(resolvePanels(original))[0]
    const closed = closePanelHole(original, ids, hole.id).project
    const existing = new Set(original.connections.map(connection => connection.id))
    const added = closed.connections.filter(connection => !existing.has(connection.id))
    expect(added).toHaveLength(4)
    expect(added.every(connection => connection.color === '#000000')).toBe(true)
    for (const piece of getPhysicalConnectors(original)) {
      expect(closed.connectorOverrides?.[piece.id]).toEqual(original.connectorOverrides?.[piece.id])
    }
    expect(parseProject(JSON.parse(JSON.stringify(closed)))).toEqual(closed)
    expect(validateProject(closed)).toEqual([])
    expect(original).toEqual(snapshot)
  })

  it('uses hardware outside the selected assembly when choosing the project majority', () => {
    const frame = gridProject('Selected box', [350], [350])
    const assembly = createAssembly(frame, frame.panels.map(panel => panel.id))
    const neighbor = gridProject('Other hardware', [350], [350], { connectorColor: '#ffffff' })
    const project: Project = { ...assembly,
      panels: [...assembly.panels, ...neighbor.panels.map(panel => ({ ...panel, position: [panel.position[0] + 2000, panel.position[1], panel.position[2]] as [number, number, number] }))],
      connections: [...assembly.connections, ...neighbor.connections.map(connection => ({ ...connection, count: 3 }))],
      connectorOverrides: Object.fromEntries(assembly.connections.flatMap(connection => [0, 1].map(index => [connectorId(connection.id, index), { color: '#000000' }]))),
    }
    const panels = resolvePanels(project), ids = assembly.panels.map(panel => panel.id)
    const hole = findPanelHoles(panels.filter(panel => ids.includes(panel.id)), panels)[0]
    const closed = closePanelHole(project, ids, hole.id).project
    const existing = new Set(project.connections.map(connection => connection.id))
    expect(closed.connections.filter(connection => !existing.has(connection.id)).every(connection => connection.color === '#ffffff')).toBe(true)
    expect(parseProject(JSON.parse(JSON.stringify(closed)))).toEqual(closed)
    expect(validateProject(closed)).toEqual([])
  })
})
