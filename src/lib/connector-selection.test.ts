import { describe, expect, it } from 'vitest'
import { createStarterProject, parseProject, projectToCsv, resolvePanels } from './model'
import { editConnectors, getPhysicalConnectors } from './connector-selection'
import { createAssembly, materializeAssemblies } from './assemblies'

describe('physical connector edits', () => {
  it('edits one piece independently of the other hardware and preserves panel poses', () => {
    const project = createStarterProject('shelf')
    const original = getPhysicalConnectors(project)
    const selected = original.find(connector => connector.type === 't')!
    const edited = editConnectors(project, [selected.id], { color: '#123456', type: 'cross' })
    expect(getPhysicalConnectors(edited).find(connector => connector.id === selected.id)).toMatchObject({ color: '#123456', type: 'cross' })
    expect(getPhysicalConnectors(edited).filter(connector => connector.id !== selected.id)).toEqual(original.filter(connector => connector.id !== selected.id))
    expect(resolvePanels(edited)).toEqual(resolvePanels(project))
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited)
    expect(projectToCsv(edited)).toContain('"Playwood Cross connector","1"')
  })
  it('removes a selection without removing panels or repositioning remaining pieces', () => {
    const project = createStarterProject('shelf')
    const original = getPhysicalConnectors(project)
    const removed = editConnectors(project, original.slice(0, 3).map(connector => connector.id), { removed: true })
    expect(getPhysicalConnectors(removed)).toEqual(original.slice(3))
    expect(resolvePanels(removed)).toEqual(resolvePanels(project))
    expect(getPhysicalConnectors(parseProject(JSON.parse(JSON.stringify(removed))))).toHaveLength(original.length - 3)
    expect(getPhysicalConnectors(project)).toHaveLength(original.length)
  })
  it('retains edits when an assembly is materialized again', () => {
    const base = createStarterProject('shelf')
    const project = createAssembly(base, base.panels.map(panel => panel.id), 'Shelf')
    const selected = getPhysicalConnectors(project).slice(0, 2).map(connector => connector.id)
    const edited = editConnectors(project, selected, { color: '#123456' })
    expect(getPhysicalConnectors(materializeAssemblies(edited))).toEqual(getPhysicalConnectors(edited))
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited)
  })
  it('rejects malformed persisted hardware', () => {
    const project = createStarterProject('shelf')
    const id = getPhysicalConnectors(project)[0].id
    for (const patch of [{ color: 'bad' }, { type: 'other' }, { removed: 'yes' }]) {
      expect(() => parseProject({ ...project, connectorOverrides: { [id]: patch } })).toThrow()
    }
  })
})
