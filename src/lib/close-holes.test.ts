import { describe, expect, it } from 'vitest'
import { closePanelHole, findPanelHoles } from './close-holes'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { ASSEMBLY_LIBRARY } from './assembly-library'
import { duplicateAssembly, moveAssemblies, updateAssemblyParameterValues } from './assemblies'
import { connectClosingPanel } from './closure-connectors'
import { getPhysicalConnectors } from './connector-selection'

const openings = (project: ReturnType<typeof gridProject>) => findPanelHoles(resolvePanels(project))

describe('close holes', () => {
  it('finds front and back and closes exactly one, then the other', () => {
    const project = gridProject('Box', [350], [350])
    expect(openings(project).map(hole => hole.label)).toEqual(['Back', 'Front'])
    const result = closePanelHole(project, project.panels.map(panel => panel.id), openings(project)[0].id)
    const added = result.project.connections.filter(connection => [connection.parentId, connection.childId].includes(result.panelId))
    expect(added).toHaveLength(4)
    expect(new Set(added.map(connection => connection.parentId === result.panelId ? connection.childId : connection.parentId))).toEqual(new Set(project.panels.map(panel => panel.id)))
    expect(getPhysicalConnectors(result.project)).toHaveLength(getPhysicalConnectors(project).length + 8)
    expect(added.some(connection => connection.quarterTurn)).toBe(true)
    expect(openings(result.project).map(hole => hole.label)).toEqual(['Front'])
    expect(validateProject(result.project)).toEqual([])
    const closed = closePanelHole(result.project, result.project.panels.map(panel => panel.id), openings(result.project)[0].id)
    expect(openings(closed.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(closed.project))).panels).toHaveLength(6)
    expect(project.panels).toHaveLength(4)
    expect(() => closePanelHole(result.project, project.panels.map(panel => panel.id), openings(project)[0].id)).toThrow('no longer available')
  })

  it('does not treat two parallel panels or an incomplete rim as a hole', () => {
    const project = gridProject('Box', [350], [350])
    expect(findPanelHoles(project.panels.slice(0, 2))).toEqual([])
    expect(findPanelHoles(project.panels.slice(0, 3))).toEqual([])
    expect(findPanelHoles(project.panels.map((panel, i) => i ? panel : { ...panel, visible: false }))).toEqual([])
  })

  it('finds individual compartments without spanning dividers', () => {
    const project = gridProject('Cubbies', [350, 350], [350, 350])
    expect(openings(project)).toHaveLength(8)
    expect(new Set(openings(project).map(hole => hole.label)).size).toBe(8)
  })

  it('handles rotated boxes and rejects unrelated obstructions', () => {
    const project = rotateProject(gridProject('Box', [350], [350]), 'y', 37)
    expect(openings(project)).toHaveLength(2)
    const hole = openings(project)[0]
    const blocked = createPanel({ ...hole.panel, id: 'obstacle' })
    expect(findPanelHoles(project.panels, [...project.panels, blocked])).toHaveLength(1)
    const result = closePanelHole(project, project.panels.map(panel => panel.id), hole.id)
    expect(validateProject(result.project)).toEqual([])
  })

  it('keeps a fitted panel in its assembly without changing linked copies', () => {
    let project = ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-cube')!.create()
    const original = project.assemblies!.instances[0]
    project = updateAssemblyParameterValues(project, original.id, { 'side-length': 450 })
    project = duplicateAssembly(project, original.id)
    const copy = project.assemblies!.instances[1]
    const ids = Object.values(original.panelIds)
    const holes = findPanelHoles(resolvePanels(project).filter(panel => ids.includes(panel.id)), resolvePanels(project))
    expect(holes).toHaveLength(2)
    const result = closePanelHole(project, ids, holes[0].id)
    expect(Object.keys(result.project.assemblies!.instances[0].panelIds)).toHaveLength(5)
    expect(result.project.assemblies!.instances[1]).toEqual(copy)
    expect(validateProject(result.project)).toEqual([])
    expect(result.project.connections.filter(connection => [connection.parentId, connection.childId].includes(result.panelId))).toHaveLength(4)
    const resized = updateAssemblyParameterValues(result.project, original.id, { 'side-length': 500 })
    expect(validateProject(resized)).toEqual([])
    expect(resized.panels.find(panel => panel.id === result.panelId)!.width).toBeCloseTo(500)
    expect(resized.panels.find(panel => panel.id === result.panelId)!.height).toBeCloseTo(500)
    const loaded = parseProject(JSON.parse(JSON.stringify(result.project)))
    expect(loaded.panels).toHaveLength(9)
    const moved = moveAssemblies(loaded, [original.id], [0, 100, 0])
    expect(moved.panels.find(panel => panel.id === result.panelId)!.position[1]).toBeCloseTo(result.project.panels.find(panel => panel.id === result.panelId)!.position[1] + 100)
  })

  it.each([false, true])('replaces shared 90° clamps with complete T joints (assembly: %s)', assembly => {
    let project = assembly ? ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-four-cubby')!.create() : gridProject('Cubbies', [350, 350], [350, 350])
    const before = structuredClone(project)
    for (let i = 0; i < 4; i++) {
      const hole = openings(project).find(item => item.label.startsWith('Front'))!
      expect(hole).toBeDefined()
      project = closePanelHole(project, project.panels.map(panel => panel.id), hole.id).project
      expect(validateProject(project)).toEqual([])
    }
    expect(openings(project)).toHaveLength(4)
    // Four shared closing edges now have one T joint rather than two 90° joints.
    const initialT = getPhysicalConnectors(before).filter(connector => connector.type === 't').length
    expect(getPhysicalConnectors(project).filter(connector => connector.type === 't')).toHaveLength(initialT + 8)
    expect(getPhysicalConnectors(project)).toHaveLength(getPhysicalConnectors(before).length + 24)
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  })

  it('upgrades an occupied T joint to a complete cross joint', () => {
    const parent = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
    const cross = attachPanel({ version: 1, name: 'Cross', panels: [parent], connections: [] }, parent.id, createPanel({ width: 300, height: 300 }),
      { side: 'top', type: 'cross', flip: false, offset: 0, inset: 0, color: '#ffffff', count: 2 })
    const panels = resolvePanels(cross)
    const closing = panels[2]
    const original = { ...cross, panels: panels.filter(panel => panel.id !== closing.id), connections: [
      { ...cross.connections[0], type: 't' as const },
      { ...cross.connections[2], id: cross.connections[1].id, type: 't' as const },
    ] }
    expect(validateProject(original)).toEqual([])
    const next = connectClosingPanel(original, closing, [parent.id])
    expect(next.connections).toHaveLength(3)
    expect(getPhysicalConnectors(next).map(connector => connector.type)).toEqual(['cross', 'cross'])
    expect(validateProject(next)).toEqual([])
  })

  it('rejects a closure that cannot be clamped without modifying the project', () => {
    const project = gridProject('Box', [350], [350])
    const incompatible = { ...project, panels: resolvePanels(project).map(panel => ({ ...panel, thickness: 25 })), connections: [] }
    const before = structuredClone(incompatible)
    expect(() => closePanelHole(incompatible, incompatible.panels.map(panel => panel.id), openings(incompatible)[0].id)).toThrow('Cannot fit connectors')
    expect(incompatible).toEqual(before)
  })
})
