import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, resolvePanels } from './model'
import { getSharedPanelFields, panelValuesEqual, selectPanelIds, updateSelectedConnections, updateSelectedPanels } from './selection'
import type { Panel, Project } from './types'

const makeProject = (...panels: Partial<Panel>[]): Project => ({
  version: 1, name: 'Selection test', connections: [],
  panels: panels.map((panel, index) => createPanel({ id: String(index), ...panel })),
})

describe('shared panel values', () => {
  it('compares numeric vectors with tolerance without conflating text or different values', () => {
    expect(panelValuesEqual([0, Math.PI, 2], [1e-9, Math.PI, 2])).toBe(true)
    expect(panelValuesEqual(100, 100.001)).toBe(false)
    expect(panelValuesEqual('Oak', 'oak')).toBe(false)
    expect(panelValuesEqual(NaN, NaN)).toBe(false)
    expect(panelValuesEqual([1, 2], [1, 2, 3])).toBe(false)
  })

  it('finds common parameters independently and ignores hex color casing', () => {
    const project = makeProject({ width: 600, color: '#AABBCC', name: 'Left' }, { width: 900, color: '#aabbcc', name: 'Right' })
    const shared = getSharedPanelFields(project.panels)
    expect(shared.has('width')).toBe(false)
    expect(shared.has('name')).toBe(false)
    expect(shared.has('id')).toBe(false)
    expect(shared.has('thickness')).toBe(true)
    expect(shared.has('color')).toBe(true)
    expect(getSharedPanelFields([]).size).toBe(0)
  })
})

describe('bulk panel updates', () => {
  it('changes a shared parameter on all selected panels and leaves others untouched', () => {
    const project = makeProject({ width: 600 }, { width: 900 }, { width: 1200 })
    const next = updateSelectedPanels(project, ['0', '1'], { thickness: 19, width: 800 })
    expect(next.panels.map(panel => panel.thickness)).toEqual([19, 19, 18])
    expect(next.panels.map(panel => panel.width)).toEqual([600, 900, 1200])
    expect(next.panels[2]).toBe(project.panels[2])
    expect(project.panels[0].thickness).toBe(18)
  })

  it('preserves differing finishes when a common material is changed', () => {
    const project = makeProject({ color: '#111111' }, { color: '#222222' })
    const next = updateSelectedPanels(project, ['0', '1'], { material: 'oak', color: '#bc945e' })
    expect(next.panels.map(panel => panel.material)).toEqual(['oak', 'oak'])
    expect(next.panels.map(panel => panel.color)).toEqual(['#111111', '#222222'])
  })

  it('does not change mixed hole spacing through an accompanying geometry patch', () => {
    const project = makeProject({ pattern: 'pegboard', holeSpacing: 40 }, { pattern: 'pegboard', holeSpacing: 60 })
    const next = updateSelectedPanels(project, ['0', '1'], { width: 900, holeSpacing: 50 })
    expect(next.panels.map(panel => panel.width)).toEqual([900, 900])
    expect(next.panels.map(panel => panel.holeSpacing)).toEqual([40, 60])
  })

  it('edits shared vector components while preserving each mixed component', () => {
    const project = makeProject({ position: [10, 20, 30], rotation: [0, 0, 0] }, { position: [100, 20, 30], rotation: [Math.PI, 0, 0] })
    const next = updateSelectedPanels(project, ['0', '1'], { position: [999, 50, 30], rotation: [1, 0.5, 0] })
    expect(next.panels.map(panel => panel.position)).toEqual([[10, 50, 30], [100, 50, 30]])
    expect(next.panels.map(panel => panel.rotation)).toEqual([[0, 0.5, 0], [Math.PI, 0.5, 0]])
  })

  it('keeps direct transforms disabled for a selection containing attached panels', () => {
    const project = attachPanel(makeProject({}), '0', createPanel({ id: 'child' }), {
      type: '90', side: 'top', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2,
    })
    const before = resolvePanels(project)
    const next = updateSelectedPanels(project, ['0', 'child'], { position: [50, 50, 50], rotation: [1, 1, 1], color: '#ffffff' })
    const after = resolvePanels(next)
    expect(after.map(panel => panel.position)).toEqual(before.map(panel => panel.position))
    expect(after.map(panel => panel.rotation)).toEqual(before.map(panel => panel.rotation))
    expect(after.map(panel => panel.color)).toEqual(['#ffffff', '#ffffff'])
  })

  it('ignores supplemental supports when determining whether a panel can move', () => {
    const project = makeProject({}, {})
    project.connections.push({ id: 'support', role: 'support', parentId: '0', childId: '1', type: '90', side: 'top', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 })
    const next = updateSelectedPanels(project, ['0', '1'], { position: [20, 400, 0] })
    expect(next.panels.map(panel => panel.position[0])).toEqual([20, 20])
  })

  it('ignores missing IDs and metadata and avoids no-op project changes', () => {
    const project = makeProject({})
    expect(updateSelectedPanels(project, ['missing'], { width: 800 })).toBe(project)
    expect(updateSelectedPanels(project, ['0', 'missing', '0'], { id: 'replacement' })).toBe(project)
    expect(updateSelectedPanels(project, ['0'], { width: 600 })).toBe(project)
    expect(updateSelectedPanels(project, ['0', 'missing'], { width: 800 }).panels[0].width).toBe(800)
  })
})

describe('selection gestures', () => {
  it('replaces on ordinary click and toggles on additive click', () => {
    expect(selectPanelIds(['one', 'two'], 'three')).toEqual(['three'])
    expect(selectPanelIds(['one'], 'two', true)).toEqual(['one', 'two'])
    expect(selectPanelIds(['one', 'two'], 'one', true)).toEqual(['two'])
    expect(selectPanelIds(['one'], 'one', true)).toEqual([])
  })

  it('clears on an empty click while modifier clicks keep the selection', () => {
    expect(selectPanelIds(['one', 'two'], null)).toEqual([])
    expect(selectPanelIds(['one', 'two'], null, true)).toEqual(['one', 'two'])
  })
})


describe('bulk connection updates', () => {
  const options = { type: '90' as const, side: 'top' as const, offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 }

  it('updates only common connection parameters across the selection', () => {
    let project = attachPanel(makeProject({}), '0', createPanel({ id: 'first' }), options)
    project = attachPanel(project, '0', createPanel({ id: 'second' }), { ...options, offset: 80 })
    const next = updateSelectedConnections(project, ['first', 'second'], { offset: 200, inset: 20, flip: true })
    expect(next.connections.map(connection => connection.offset)).toEqual([0, 80])
    expect(next.connections.map(connection => connection.inset)).toEqual([20, 20])
    expect(next.connections.map(connection => connection.flip)).toEqual([true, true])
    expect(next.panels).toBe(project.panels)
  })

  it('keeps connection parameters disabled for selections including a free panel', () => {
    const project = attachPanel(makeProject({}), '0', createPanel({ id: 'child' }), options)
    expect(updateSelectedConnections(project, ['0', 'child'], { inset: 20 })).toBe(project)
    expect(updateSelectedConnections(project, ['missing'], { inset: 20 })).toBe(project)
  })

  it('updates an entire shared T joint while preserving unrelated hardware', () => {
    let project = attachPanel(makeProject({}), '0', createPanel({ id: 'branch' }), { ...options, type: 't' })
    project = attachPanel(project, '0', createPanel({ id: 'unrelated' }), { ...options, side: 'bottom' })
    const next = updateSelectedConnections(project, ['branch'], { offset: 40 })
    expect(next.connections.map(connection => connection.offset)).toEqual([40, 40, 0])
    expect(next.connections[2]).toBe(project.connections[2])
    expect(next.connections.map(connection => connection.count)).toEqual(project.connections.map(connection => connection.count))
  })
})
