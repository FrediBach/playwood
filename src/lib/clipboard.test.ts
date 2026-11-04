import { describe, expect, it } from 'vitest'
import { copySelection, getPasteTargets, getInsertionTargets } from './clipboard'
import { createAssembly, materializeAssemblies, removeAssembly, updateAssemblyFinish, updateAssemblyParameters, updateAssemblyParameterValues } from './assemblies'
import { createExampleProject } from './example-library'
import { attachPanel, createPanel, parseProject, resolvePanels, validateProject } from './model'
import { connectorId } from './connector-selection'
import type { Project } from './types'

const looseProject = (): Project => ({ version: 1, name: 'Paste', panels: [createPanel({ name: 'Source', width: 250, height: 250, position: [-1000, 500, 0], color: '#123456', pattern: 'pegboard' }), createPanel({ name: 'Target', position: [0, 500, 0] })], connections: [] })
const boxProject = () => { const project = createExampleProject('cube'); return createAssembly(project, project.panels.map(panel => panel.id), 'Box') }

describe('copy and paste attachments', () => {
  it.each(['paste', 'insert'] as const)('matches new %s attachment hardware to the destination project colors', operation => {
    const loose = looseProject()
    const project = attachPanel(loose, loose.panels[0].id, createPanel({ width: 250, height: 250 }),
      { side: 'left', type: '90', flip: false, offset: 0, inset: 0, count: 2, color: '#ff0000' })
    const existing = project.connections[0]
    project.connectorOverrides = {
      [connectorId(existing.id, 0)]: { color: '#123456' },
      [connectorId(existing.id, 1)]: { color: '#123456' },
    }
    const snapshot = structuredClone(project), copied = copySelection(project, [project.panels[0].id])
    const targets = (operation === 'paste' ? getPasteTargets : getInsertionTargets)(project, [project.panels[1].id], copied)
      .filter(target => target.project)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.project!.connections.filter(connection => connection.id !== existing.id).map(connection => connection.color)).toEqual(['#123456'])
      expect(target.project!.connections[0]).toEqual(existing)
      expect(target.project!.connectorOverrides).toEqual(project.connectorOverrides)
    }
    expect(project).toEqual(snapshot)
  })

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
    const next = getPasteTargets(removed, [panel.id], copied).find(target => target.project && !target.warning)?.project
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

  it('keeps configured dimensions when pasting an assembly onto a corner or a loose panel', () => {
    const initial = createExampleProject('assembly-wide-box')
    const source = initial.assemblies!.instances[0]
    const values = { width: 900, height: 400, depth: 300 }
    const configured = updateAssemblyParameterValues(initial, source.id, values)
    const copied = copySelection(configured, Object.values(source.panelIds))
    const panel = createPanel({ width: 200, height: 200, position: [3000, 1000, 0] })
    const project = { ...configured, panels: [...configured.panels, panel] }
    const before = structuredClone(project)
    for (const selection of [Object.values(source.panelIds), [panel.id]]) {
      const next = getPasteTargets(project, selection, copied).find(target => target.project)?.project
      expect(next).toBeDefined()
      const pasted = next!.assemblies!.instances.at(-1)!
      expect(pasted.parameterValues).toEqual(values)
      expect(pasted.definitionId).toBe(source.definitionId)
      const panels = next!.panels.filter(item => Object.values(pasted.panelIds).includes(item.id))
      expect(panels.filter(item => item.name.startsWith('Shelf')).every(item => item.width === 900 && item.height === 300)).toBe(true)
      expect(panels.filter(item => item.name.startsWith('Upright')).every(item => item.width === 400 && item.height === 300)).toBe(true)
      expect(validateProject(next!).filter(issue => issue.severity === 'error' || issue.id.startsWith('collision'))).toEqual([])
      expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    }
    expect(project).toEqual(before)
  })

  it.each(['removed', 'recreated'] as const)('pastes a copied instance after its width control is %s in the shared source', change => {
    const initial = createExampleProject('assembly-wide-box')
    const source = initial.assemblies!.instances[0]
    const configured = updateAssemblyParameterValues(initial, source.id, { width: 900, height: 400, depth: 300 })
    const copied = copySelection(configured, Object.values(source.panelIds))
    const parameters = configured.assemblies!.definitions[0].parameters!
    const edited = updateAssemblyParameters(configured, source.id, change === 'removed'
      ? parameters.filter(parameter => parameter.id !== 'width')
      : parameters.map(parameter => parameter.id === 'width' ? { ...parameter, id: 'new-width' } : parameter))
    const panel = createPanel({ width: 200, height: 200, position: [3000, 1000, 0] })
    const project = { ...edited, panels: [...edited.panels, panel] }
    for (const selection of [Object.values(source.panelIds), [panel.id]]) {
      const next = getPasteTargets(project, selection, copied).find(target => target.project)?.project
      expect(next).toBeDefined()
      const pasted = next!.assemblies!.instances.at(-1)!
      expect(pasted.parameterValues).toEqual({ height: 400, depth: 300 })
      const shelves = next!.panels.filter(item => Object.values(pasted.panelIds).includes(item.id) && item.name.startsWith('Shelf'))
      expect(shelves).toHaveLength(2)
      expect(shelves.every(item => item.width === 700 && item.height === 300)).toBe(true)
      expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    }
  })

  it('rejects empty selections', () => {
    const project = looseProject()
    expect(() => copySelection(project, [])).toThrow('Select panels')
    expect(() => getPasteTargets(project, [], copySelection(project, [project.panels[0].id]))).toThrow('Select a target')
  })
})


describe('library insertion targets', () => {
  it('offers multiple selected panels without mutating the project', () => {
    const project = looseProject()
    const before = structuredClone(project)
    const source = createExampleProject('assembly-cube')
    const copied = copySelection(source, source.panels.map(panel => panel.id))
    if (copied.kind !== 'assembly') throw new Error('Expected assembly')
    const targets = getInsertionTargets(project, project.panels.map(panel => panel.id), copied).filter(target => target.project)
    for (const panel of project.panels) expect(targets.some(target => target.id.startsWith(panel.id))).toBe(true)
    expect(new Set(targets.map(target => target.id)).size).toBe(targets.length)
    expect(project).toEqual(before)
    for (const target of targets) {
      expect(target.project!.assemblies!.instances).toHaveLength(target.warning ? 0 : 1)
      expect(validateProject(target.project!)).toEqual([])
      const serialized = JSON.parse(JSON.stringify(target.project))
      expect(parseProject(serialized)).toEqual(serialized)
    }
  })

  it('offers each selected assembly once and keeps saved-source inserts linked', () => {
    const project = boxProject()
    const ids = project.panels.map(panel => panel.id)
    const copied = copySelection(project, ids)
    if (copied.kind !== 'assembly') throw new Error('Expected assembly')
    const targets = getInsertionTargets(project, ids, copied).filter(target => target.project && !target.warning)
    expect(targets).toHaveLength(4)
    for (const target of targets) {
      expect(target.project!.assemblies!.definitions).toHaveLength(1)
      expect(target.project!.assemblies!.instances).toHaveLength(2)
      expect(target.project!.assemblies!.links).toHaveLength(1)
    }
  })

  it.each(['paste', 'insert'] as const)('allows a shared-panel %s after warning and keeps the reusable source', operation => {
    const project = boxProject()
    const before = structuredClone(project)
    const ids = project.panels.map(panel => panel.id)
    const copied = copySelection(project, ids)
    const targets = operation === 'paste' ? getPasteTargets(project, ids, copied) : getInsertionTargets(project, ids, copied)
    const target = targets.find(candidate => candidate.project && candidate.warning)
    expect(target).toBeDefined()
    expect(target!.warning).toMatch(/disassembl/i)
    const next = target!.project!
    expect(next.panels).toHaveLength(7)
    expect(next.assemblies!.instances).toHaveLength(0)
    expect(next.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    expect(validateProject(next)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    expect(materializeAssemblies(next)).toEqual(next)
    expect(project).toEqual(before)
  })
})

describe('new panel insertion targets', () => {
  it.each(['panels', 'assembly'] as const)('preserves the new panel properties across selected %s', kind => {
    const project = kind === 'assembly' ? boxProject() : looseProject()
    const before = structuredClone(project)
    const panel = createPanel({ name: 'Custom shelf', width: 250, height: 250, color: '#123456', pattern: 'pegboard' })
    const targets = getInsertionTargets(project, project.panels.map(part => part.id), { kind: 'panel', panel }).filter(target => target.project)
    expect(targets.length).toBeGreaterThan(0)
    expect(project).toEqual(before)
    for (const target of targets) {
      const next = target.project!
      expect(next.panels).toHaveLength(project.panels.length + 1)
      expect(next.panels.at(-1)).toMatchObject({ name: panel.name, width: 250, height: 250, color: panel.color, pattern: panel.pattern })
      expect(next.connections.at(-1)!.parentId).toSatisfy((id: string) => project.panels.some(part => part.id === id))
      const serialized = JSON.parse(JSON.stringify(next))
      expect(parseProject(serialized)).toEqual(serialized)
    }
  })
})


describe('selection clipboard', () => {
  function source(type: '90' | 'cross' = '90') {
    const parent = createPanel({ name: 'Source base', width: 250, height: 250, position: [-2000, 1000, 0] })
    const target = createPanel({ name: 'Destination', width: 500, height: 500, position: [2000, 1000, 0] })
    return attachPanel({ version: 1, name: 'Selection', panels: [parent, target], connections: [] }, parent.id,
      createPanel({ name: 'Source side', width: 250, height: 250 }), { side: 'left', type, flip: false, count: 2, color: '#123456', offset: 0, inset: 0 })
  }

  it.each(['panels', 'connectors', 'mixed'] as const)('copies %s with internal joints, overrides, constraints, and fresh identities', kind => {
    const project = source()
    const [parent, target, child] = project.panels
    const connection = project.connections[0]
    project.connectorOverrides = { [connectorId(connection.id, 0)]: { color: '#abcdef', slide: 5 }, [connectorId(connection.id, 1)]: { removed: true } }
    project.constraints = [
      { id: 'width', kind: 'equal-dimension', panelIds: [parent.id, child.id], dimension: 'width', enabled: true },
      { id: 'floor', kind: 'floor', panelId: parent.id, reference: 'center', value: 1000, enabled: true },
    ]
    const before = structuredClone(project)
    const copied = copySelection(project, kind === 'panels' ? [parent.id, child.id] : kind === 'mixed' ? [child.id] : [], kind === 'panels' ? [] : [connectorId(connection.id, 0)])
    expect(copied.kind).toBe('selection')
    expect(copied.constraints).toHaveLength(1)
    const candidates = getPasteTargets(project, [target.id], copied).filter(target => target.project)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const next = candidate.project!
      expect(next.panels).toHaveLength(5)
      expect(next.connections).toHaveLength(3)
      expect(next.panels.slice(0, 3)).toEqual(before.panels)
      const joint = next.connections.at(-1)!
      expect(joint.id).not.toBe(connection.id)
      expect(next.connectorOverrides![connectorId(joint.id, 0)]).toEqual({ color: '#abcdef', slide: 5 })
      expect(next.connectorOverrides![connectorId(joint.id, 1)]).toEqual({ removed: true })
      expect(next.constraints).toHaveLength(3)
      expect(next.constraints!.at(-1)!.id).not.toBe('width')
      expect(validateProject(next).filter(issue => issue.severity === 'error')).toEqual([])
      expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(JSON.parse(JSON.stringify(next)))
    }
    expect(project).toEqual(before)
    project.panels[0].color = '#000000'
    if (copied.kind === 'selection') expect(copied.panels[0].color).toBe(before.panels[0].color)
  })

  it('includes all branches when copying shared cross hardware', () => {
    const project = source('cross')
    const copied = copySelection(project, [], [connectorId(project.connections[0].id, 0), connectorId(project.connections[0].id, 1)])
    if (copied.kind !== 'selection') throw new Error('Expected selection')
    expect(copied.panels).toHaveLength(4)
    expect(copied.connections).toHaveLength(3)
    const next = getPasteTargets(project, [project.panels[1].id], copied).find(target => target.project)?.project
    expect(next).toBeDefined()
    expect(validateProject(next!).filter(issue => issue.severity === 'error')).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(JSON.parse(JSON.stringify(next)))
  })

  it('preserves disconnected panel spacing and omits external joints', () => {
    const project = source()
    const copied = copySelection(project, [project.panels[0].id, project.panels[1].id])
    if (copied.kind !== 'selection') throw new Error('Expected selection')
    expect(copied.connections).toEqual([])
    const next = getPasteTargets(project, [project.panels[2].id], copied).find(target => target.project)!.project!
    const added = resolvePanels(next).slice(-2)
    const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, index) => value - b[index]))
    expect(distance(added[0].position, added[1].position)).toBeCloseTo(distance(copied.panels[0].position, copied.panels[1].position))
    const repeated = getPasteTargets(next, [project.panels[1].id], copied).find(target => target.project)?.project
    expect(repeated).toBeDefined()
    expect(new Set(repeated!.panels.map(panel => panel.id)).size).toBe(repeated!.panels.length)
  })
})


it('retains a copied group after its source is deleted and rejects overlapping group placements', () => {
  const panels = [
    createPanel({ name: 'First', width: 200, height: 200, position: [-2000, 1000, 0] }),
    createPanel({ name: 'Second', width: 200, height: 200, position: [-2400, 1000, 0] }),
    createPanel({ name: 'Target', width: 500, height: 500, position: [2000, 1000, 0] }),
  ]
  const project: Project = { version: 1, name: 'Deleted source', panels, connections: [] }
  const copied = copySelection(project, panels.slice(0, 2).map(panel => panel.id))
  const destination = { ...project, panels: [panels[2]] }
  const next = getPasteTargets(destination, [panels[2].id], copied).find(target => target.project)!.project!
  expect(next.panels).toHaveLength(3)
  expect(next.panels.slice(1).map(panel => panel.name)).toEqual(['First copy', 'Second copy'])
  const overlap = copySelection({ ...project, panels: [panels[0], { ...panels[1], position: panels[0].position }, panels[2]] }, panels.slice(0, 2).map(panel => panel.id))
  expect(getPasteTargets(destination, [panels[2].id], overlap).every(target => !target.project)).toBe(true)
})


it('copies assembly hardware selections as resolved panels with overrides, without changing source ownership', () => {
  const project = boxProject()
  const target = createPanel({ name: 'Target', width: 500, height: 500, position: [3000, 1000, 0] })
  project.panels.push(target)
  const pieces = project.connections.filter(connection => connection.count > 0).map(connection => connectorId(connection.id, 0))
  project.connectorOverrides = { [pieces[0]]: { color: '#abcdef' } }
  const before = structuredClone(project)
  const copied = copySelection(project, [], pieces)
  expect(copied.kind).toBe('selection')
  const next = getPasteTargets(project, [target.id], copied).find(target => target.project)?.project
  expect(next).toBeDefined()
  expect(next!.assemblies).toEqual(before.assemblies)
  expect(next!.panels).toHaveLength(9)
  const rebuilt = materializeAssemblies(next!)
  expect(rebuilt.panels.map(panel => panel.id).sort()).toEqual(next!.panels.map(panel => panel.id).sort())
  expect(validateProject(rebuilt).filter(issue => issue.severity === 'error')).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(JSON.parse(JSON.stringify(next)))
  expect(project).toEqual(before)
})
