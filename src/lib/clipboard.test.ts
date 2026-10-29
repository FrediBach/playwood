import { describe, expect, it } from 'vitest'
import { copySelection, getPasteTargets } from './clipboard'
import { createAssembly, materializeAssemblies, removeAssembly, updateAssemblyFinish } from './assemblies'
import { createExampleProject } from './example-library'
import { createPanel, parseProject, validateProject } from './model'
import type { Project } from './types'

const looseProject = (): Project => ({ version: 1, name: 'Paste', panels: [createPanel({ name: 'Source', width: 250, height: 250, position: [-1000, 500, 0], color: '#123456', pattern: 'pegboard' }), createPanel({ name: 'Target', position: [0, 500, 0] })], connections: [] })
const boxProject = () => { const project = createExampleProject('cube'); return createAssembly(project, project.panels.map(panel => panel.id), 'Box') }

describe('copy and paste attachments', () => {
  it('snapshots a panel and pastes fresh IDs without moving the originals', () => {
    const project = looseProject()
    const copied = copySelection(project, [project.panels[0].id])
    project.panels[0].color = '#ffffff'
    const targets = getPasteTargets(project, [project.panels[1].id], copied).filter(target => target.project)
    expect(targets.length).toBeGreaterThan(0)
    const next = targets[0].project!
    expect(next.panels.slice(0, 2)).toEqual(project.panels)
    expect(next.panels[2]).toMatchObject({ color: '#123456', pattern: 'pegboard', width: 250, height: 250 })
    expect(next.panels[2].id).not.toBe(project.panels[0].id)
    const repeat = getPasteTargets(project, [project.panels[1].id], copied).find(target => target.project)!.project!
    expect(repeat.panels[2].id).not.toBe(next.panels[2].id)
    expect(next.connections[0]).toMatchObject({ parentId: project.panels[1].id, childId: next.panels[2].id })
  })

  it('copies a connected assembly as a linked instance with its finish', () => {
    let project = boxProject()
    const source = project.assemblies!.instances[0]
    project = updateAssemblyFinish(project, source.id, { color: '#123456' })
    const copied = copySelection(project, Object.values(source.panelIds))
    const next = getPasteTargets(project, Object.values(source.panelIds), copied).find(target => target.project)!.project!
    expect(next.assemblies!.instances).toHaveLength(2)
    expect(next.assemblies!.instances[1]).toMatchObject({ definitionId: source.definitionId, finish: { color: '#123456' } })
    expect(next.assemblies!.links.length).toBeGreaterThan(0)
    const connectedCopy = copySelection(next, Object.values(source.panelIds))
    expect(getPasteTargets(next, Object.values(next.assemblies!.instances[1].panelIds), connectedCopy).some(target => target.project)).toBe(true)
    expect(parseProject(JSON.parse(JSON.stringify(next))).panels).toHaveLength(8)
  })

  it('supports panels onto assemblies and assemblies onto panels, including a deleted source', () => {
    const box = boxProject()
    const source = box.assemblies!.instances[0]
    const copied = copySelection(box, Object.values(source.panelIds))
    const panel = createPanel({ width: 200, height: 200, position: [2500, 1000, 0] })
    const mixed = { ...box, panels: [...box.panels, panel] }
    expect(getPasteTargets(mixed, Object.values(source.panelIds), copySelection(mixed, [panel.id])).some(target => target.project)).toBe(true)
    const removed = removeAssembly(mixed, source.id)
    const next = getPasteTargets(removed, [panel.id], copied).find(target => target.project)?.project
    expect(next).toBeDefined()
    expect(next!.panels).toHaveLength(5)
    expect(next!.assemblies!.instances).toHaveLength(1)
    expect(validateProject(next!).filter(issue => issue.severity === 'error')).toEqual([])
    const rebuilt = materializeAssemblies(next!)
    expect(rebuilt.panels).toEqual(next!.panels)
    expect(parseProject(JSON.parse(JSON.stringify(next))).panels).toHaveLength(5)
    const deleted = removeAssembly(next!, next!.assemblies!.instances[0].id)
    expect(deleted.connections).toHaveLength(0)
    expect(deleted.panels).toEqual([panel])
  })

  it('rejects ambiguous selections', () => {
    const project = looseProject()
    expect(() => copySelection(project, [])).toThrow('Select one')
    expect(() => copySelection(project, project.panels.map(panel => panel.id))).toThrow('Select one')
    expect(() => getPasteTargets(project, [], copySelection(project, [project.panels[0].id]))).toThrow('Select a target')
  })
})
