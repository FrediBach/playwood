import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createStarterProject, parseProject, projectToCsv, resolvePanels } from './model'
import { connectorId, editConnectors, getPhysicalConnectors, parseConnectorId } from './connector-selection'
import { createAssembly, materializeAssemblies } from './assemblies'
import { METAL_CONNECTOR_COLOR } from './connector-options'

describe('connector identity validation', () => {
  it.each([0, 19])('preserves escaped connection IDs and piece index %i', index => {
    const connection = 'joint/"corner"/[part]'
    expect(parseConnectorId(connectorId(connection, index))).toEqual([connection, index])
  })
  it.each(['invalid', 'null', '{}', '"joint"', '[]', '["joint"]', '["joint",0,1]', '[4,0]', '["joint","0"]', '["joint",-1]', '["joint",0.5]', '["joint",20]'])('rejects malformed identity %s', id => {
    expect(() => parseConnectorId(id)).toThrow(/connector selection ID/)
    const project = createStarterProject('blank')
    expect(() => parseProject({ ...project, connectorOverrides: { [id]: { removed: true } } })).toThrow(/connector selection ID/)
  })
})

describe('physical connector edits', () => {
  it('edits one piece independently of the other hardware and preserves panel poses', () => {
    const project = createStarterProject('shelf')
    const original = getPhysicalConnectors(project)
    const selected = original.find(connector => connector.type === 't')!
    const edited = editConnectors(project, [selected.id], { color: '#123456', type: 'cross' })
    expect(getPhysicalConnectors(edited).find(connector => connector.id === selected.id)).toMatchObject({ color: '#123456', type: 'cross' })
    expect(getPhysicalConnectors(edited).filter(connector => connector.id !== selected.id)).toEqual(original.filter(connector => connector.id !== selected.id))
    expect(resolvePanels(edited)).toEqual(resolvePanels(project))
    expect(roundTripProject(edited)).toEqual(edited)
    expect(projectToCsv(edited)).toContain('"Playwood Cross connector","1"')
  })
  it('removes a selection without removing panels or repositioning remaining pieces', () => {
    const project = createStarterProject('shelf')
    const original = getPhysicalConnectors(project)
    const removed = editConnectors(project, original.slice(0, 3).map(connector => connector.id), { removed: true })
    expect(getPhysicalConnectors(removed)).toEqual(original.slice(3))
    expect(resolvePanels(removed)).toEqual(resolvePanels(project))
    expect(getPhysicalConnectors(roundTripProject(removed))).toHaveLength(original.length - 3)
    expect(getPhysicalConnectors(project)).toHaveLength(original.length)
  })
  it('retains edits when an assembly is materialized again', () => {
    const base = createStarterProject('shelf')
    const project = createAssembly(base, base.panels.map(panel => panel.id), 'Shelf')
    const selected = getPhysicalConnectors(project).slice(0, 2).map(connector => connector.id)
    const edited = editConnectors(project, selected, { color: '#123456' })
    expect(getPhysicalConnectors(materializeAssemblies(edited))).toEqual(getPhysicalConnectors(edited))
    expect(roundTripProject(edited)).toEqual(edited)
  })
  it('rejects malformed persisted hardware', () => {
    const project = createStarterProject('shelf')
    const id = getPhysicalConnectors(project)[0].id
    for (const patch of [{ color: 'bad' }, { type: 'other' }, { material: 'chrome' }, { removed: 'yes' }]) {
      expect(() => parseProject({ ...project, connectorOverrides: { [id]: patch } })).toThrow()
    }
  })
  it('persists per-piece metal independently of plastic color and groups parts by material', () => {
    const project = createStarterProject('shelf')
    const corners = getPhysicalConnectors(project).filter(piece => piece.type === '90')
    const edited = editConnectors(project, [corners[0].id, corners[1].id], { material: 'metal' })
    expect(roundTripProject(edited)).toEqual(edited)
    expect(getPhysicalConnectors(edited).filter(piece => piece.material === 'metal')).toHaveLength(2)
    expect(resolvePanels(edited)).toEqual(resolvePanels(project))
    const csv = projectToCsv(edited)
    expect(csv).toContain(`"Playwood 90° connector","2","","","","Cast metal","${METAL_CONNECTOR_COLOR}"`)
    expect(csv).toContain('"Playwood 90° connector","6","","","","Reinforced plastic"')
    const restored = editConnectors(edited, [corners[0].id], { material: 'plastic' })
    expect(getPhysicalConnectors(restored).find(piece => piece.id === corners[0].id)).toMatchObject({ material: 'plastic', color: corners[0].color })
  })
  it('limits metal to 90° hardware including mixed edits and type changes', () => {
    const project = createStarterProject('shelf')
    const pieces = getPhysicalConnectors(project)
    const edited = editConnectors(project, pieces.map(piece => piece.id), { material: 'metal' })
    expect(getPhysicalConnectors(edited).filter(piece => piece.material === 'metal')).toHaveLength(8)
    expect(getPhysicalConnectors(edited).filter(piece => piece.type === 't').every(piece => piece.material === 'plastic')).toBe(true)
    const corner = pieces.find(piece => piece.type === '90')!
    const changed = editConnectors(edited, [corner.id], { type: '105' })
    expect(getPhysicalConnectors(changed).find(piece => piece.id === corner.id)?.material).toBe('plastic')
    const back = editConnectors(changed, [corner.id], { type: '90' })
    expect(getPhysicalConnectors(back).find(piece => piece.id === corner.id)?.material).toBe('plastic')
  })
  it('loads legacy plastic and connection-level metal, including assembly definitions', () => {
    const project = createStarterProject('shelf')
    expect(getPhysicalConnectors(parseProject(project)).every(piece => piece.material === 'plastic')).toBe(true)
    const corner = project.connections.find(connection => connection.type === '90')!
    corner.material = 'metal'
    const parsed = roundTripProject(project)
    expect(parsed.connections.find(connection => connection.id === corner.id)?.material).toBe('metal')
    const assembly = createAssembly(parsed, parsed.panels.map(panel => panel.id), 'Metal corners')
    expect(getPhysicalConnectors(parseProject(materializeAssemblies(assembly))).filter(piece => piece.material === 'metal')).toHaveLength(corner.count)
    expect(() => parseProject({ ...project, connections: project.connections.map(connection => ({ ...connection, material: 'silver' })) })).toThrow('Invalid connector material')
  })
})
