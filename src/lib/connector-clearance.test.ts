import { describe, expect, it } from 'vitest'
import { createAssembly, materializeAssemblies } from './assemblies'
import { autoConnect } from './auto-connect'
import { separateOverlappingConnectors } from './connector-clearance'
import { installedHardware, overlappingHardware } from './connector-hardware-test-helpers'
import { getPhysicalConnectors } from './connector-selection'
import { getConnectorRail } from './connector-movement'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject } from './model'
import { closePanelHole, findPanelHoles } from './close-holes'
import { gridProject } from './example-geometry'
import type { Project } from './types'

function crowded(width = 300) {
  const parent = createPanel({ width, height: 300, position: [0, 500, 0] })
  const source = attachPanel({ version: 1, name: 'Overlaps', panels: [parent], connections: [] }, parent.id,
    createPanel({ width, height: 300 }), { side: 'top', type: '90', flip: false, offset: 0, inset: 0, color: '#123456', count: 2 })
  const pieces = getPhysicalConnectors(source)
  const rail = getConnectorRail(pieces[0].connection, resolvePanels(source), source.connections)!
  const project: Project = { ...source, connectorOverrides: Object.fromEntries(pieces.map(piece => [piece.id,
    { slide: (rail.lower + rail.upper) / 2 - rail.along[piece.index], material: 'metal', color: '#123456' }])) }
  return { project, ids: pieces.map(piece => piece.id) }
}

describe('connector body clearance', () => {
  it.each([0, 37])('separates selected overlaps on rotated rails (%i degrees), preserving identities and saves', degrees => {
    const fixture = crowded(100)
    const source = degrees ? rotateProject(fixture.project, 'y', degrees) : fixture.project
    const snapshot = structuredClone(source)
    expect(overlappingHardware(source)).toHaveLength(1)
    const next = separateOverlappingConnectors(source, fixture.ids)
    expect(overlappingHardware(next)).toEqual([])
    expect(next.connections).toEqual(source.connections)
    expect(next.panels).toEqual(source.panels)
    expect(getPhysicalConnectors(next)).toEqual(getPhysicalConnectors(source))
    expect(overlappingHardware(parseProject(JSON.parse(JSON.stringify(next))))).toEqual([])
    expect(source).toEqual(snapshot)
    expect(separateOverlappingConnectors(next, fixture.ids)).toBe(next)
  })

  it('moves only selected pieces, including on hidden panels', () => {
    const { project, ids } = crowded()
    project.panels = project.panels.map(panel => ({ ...panel, visible: false }))
    const before = installedHardware(project)
    const next = separateOverlappingConnectors(project, [ids[1]])
    expect(overlappingHardware(next)).toEqual([])
    expect(installedHardware(next)[0].origin.distanceTo(before[0].origin)).toBe(0)
    expect(next.connectorOverrides?.[ids[0]]).toEqual(project.connectorOverrides?.[ids[0]])
  })

  it('retains linked assembly metadata and repair slides through materialization and reload', () => {
    const { project } = crowded()
    const linked = createAssembly(project, project.panels.map(panel => panel.id))
    const pieces = getPhysicalConnectors(linked)
    const rail = getConnectorRail(pieces[0].connection, resolvePanels(linked), linked.connections)!
    linked.connectorOverrides = Object.fromEntries(pieces.map(piece => [piece.id,
      { slide: (rail.lower + rail.upper) / 2 - rail.along[piece.index] }]))
    const repaired = separateOverlappingConnectors(linked, pieces.map(piece => piece.id))
    expect(overlappingHardware(repaired)).toEqual([])
    expect(repaired.assemblies).toEqual(linked.assemblies)
    expect(materializeAssemblies(repaired)).toEqual(repaired)
    expect(parseProject(JSON.parse(JSON.stringify(repaired)))).toEqual(repaired)
  })

  it('leaves impossible fits intact and ignores removed hardware', () => {
    const { project, ids } = crowded(60)
    const before = structuredClone(project)
    expect(() => separateOverlappingConnectors(project, ids)).toThrow(/Could not find room/)
    expect(project).toEqual(before)
    const removed = { ...project, connectorOverrides: { ...project.connectorOverrides, [ids[0]]: { removed: true } } }
    expect(separateOverlappingConnectors(removed, ids)).toBe(removed)
  })

  it.each([0, 37])('auto-connect fits perpendicular cap hardware against whole CAD bodies (%i degrees)', degrees => {
    const frame = gridProject('Box', [350], [350])
    const hole = findPanelHoles(resolvePanels(frame))[0]
    const closed = closePanelHole(frame, frame.panels.map(panel => panel.id), hole.id).project
    const loose = rotateProject({ ...closed, panels: resolvePanels(closed), connections: [], connectorOverrides: undefined }, 'y', degrees)
    const result = autoConnect(loose)
    expect(result.joints).toBeGreaterThan(4)
    expect(overlappingHardware(result.project)).toEqual([])
    expect(result.project.panels).toEqual(loose.panels)
  })
})
