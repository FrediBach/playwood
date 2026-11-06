import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createAssembly, duplicateAssembly, updateAssemblyParameterValues } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { insertAssemblyDefinition } from './assembly-library'
import { copySelection } from './clipboard'
import { closePanelHole, findPanelHoles } from './close-holes'
import { duplicatePanel, parseProject, resolvePanels, validateProject } from './model'
import { pentagonalFrame } from './outline-closure-test-fixtures'
import { outlineConnectionAligned } from './outline-closures'
import type { Project } from './types'

function expectOutlineJoints(project: Project, count: number) {
  const panels = resolvePanels(project), joints = project.connections.filter(connection => connection.outlineEdge !== undefined)
  expect(joints).toHaveLength(count)
  for (const joint of joints) expect(outlineConnectionAligned(panels.find(panel => panel.id === joint.parentId)!, panels.find(panel => panel.id === joint.childId)!, joint)).toBe(true)
  expect(validateProject(project)).toEqual([])
  const saved = JSON.parse(JSON.stringify(project))
  expect(parseProject(saved)).toEqual(saved)
}

describe('fitted outline lifecycle', () => {
  it('forks an assembly closure, reshapes through parameters, and preserves it in copies and standalone files', () => {
    const frame = pentagonalFrame(), top = frame.panels.find(panel => panel.id === 'rim-3')!
    let project = createAssembly(frame, frame.panels.map(panel => panel.id), 'Pentagon', [{ id: 'top', name: 'Top width', defaultValue: top.width,
      bindings: [{ panelId: top.id, dimension: 'width', scale: 1, offset: 0 }] }])
    const original = project.assemblies!.instances[0]
    project = duplicateAssembly(project, original.id)
    const untouched = structuredClone(project.assemblies!.instances[1])
    const selection = Object.values(original.panelIds), panels = resolvePanels(project)
    const hole = findPanelHoles(panels.filter(panel => selection.includes(panel.id)), panels)[0]
    const closed = closePanelHole(project, selection, hole.id)
    expect(closed.project.assemblies!.instances[1]).toEqual(untouched)
    expectOutlineJoints(closed.project, 5)
    const resized = updateAssemblyParameterValues(closed.project, original.id, { top: top.width + 80 })
    expectOutlineJoints(resized, 5)
    expect(resized.panels.find(panel => panel.id === closed.panelId)!.customOutline).not.toEqual(closed.project.panels.find(panel => panel.id === closed.panelId)!.customOutline)
    const instance = resized.assemblies!.instances[0]
    const copied = copySelection(resized, Object.values(instance.panelIds))
    expect(copied.kind).toBe('assembly')
    if (copied.kind === 'assembly') {
      expect(copied.definition.connections.filter(connection => connection.outlineEdge !== undefined)).toHaveLength(5)
      expect(copied.definition.ports.every(port => copied.definition.connections.find(connection => connection.id === port.connectionId)!.outlineEdge === undefined)).toBe(true)
    }
    const definition = parseAssemblyFile(JSON.parse(JSON.stringify(createAssemblyFile(resized, original.id))))
    const inserted = insertAssemblyDefinition({ version: 1, name: 'Imported', panels: [], connections: [] }, definition)
    expectOutlineJoints(inserted, 5)
    const duplicate = duplicateAssembly(inserted, inserted.assemblies!.instances[0].id)
    expectOutlineJoints(duplicate, 10)
    expect(new Set(duplicate.connections.map(connection => connection.id)).size).toBe(duplicate.connections.length)
  })

  it('copies the cut alone as an independent outline without references to the source rim', () => {
    const frame = pentagonalFrame(), hole = findPanelHoles(resolvePanels(frame))[0]
    const closed = closePanelHole(frame, frame.panels.map(panel => panel.id), hole.id)
    const source = closed.project.panels.find(panel => panel.id === closed.panelId)!
    const copied = copySelection(closed.project, [source.id])
    expect(copied.kind).toBe('panel')
    if (copied.kind === 'panel') expect(copied.panel.customOutline).toEqual(source.customOutline)
    const duplicated = duplicatePanel(closed.project, source.id)
    const duplicate = duplicated.panels.at(-1)!
    expect(duplicate.customOutline).toEqual(source.customOutline)
    expect(duplicate.customOutline).not.toBe(source.customOutline)
    expect(duplicated.connections.some(connection => connection.parentId === duplicate.id || connection.childId === duplicate.id)).toBe(false)
    expect(roundTripProject(duplicated).panels.at(-1)!.customOutline).toEqual(source.customOutline)
  })
})
