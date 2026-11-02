import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, resolvePanels } from './model'
import { evaluateDesignConstraints, getDesignConstraintBounds } from './design-constraints'
import { movePanels, reconcileDesignConstraints, resizePanelEdge, resizePanels } from './structure-edit'
import { gridProject } from './example-geometry'
import type { DesignConstraint, Panel, Project } from './types'

const shelf = (id: string, y: number): Panel => createPanel({ id, name: id, width: 600, height: 300, thickness: 18, position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0] })
const project = (panels: Panel[], constraints: DesignConstraint[]): Project => ({ version: 1, name: 'Design rules', panels, connections: [], constraints })
const byId = (value: Project, id: string) => resolvePanels(value).find(panel => panel.id === id)!
const satisfied = (value: Project) => expect(evaluateDesignConstraints(value.constraints, resolvePanels(value)).filter(result => result.constraint.enabled).map(result => result.violation)).toEqual(value.constraints?.filter(rule => rule.enabled).map(() => 0))

describe('automatic design rules in structural edits', () => {
  it('places the top of a shelf above the floor including its thickness', () => {
    const before = project([shelf('shelf', 200)], [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'shelf', reference: 'max', value: 800 }])
    const snapshot = JSON.stringify(before)
    const next = reconcileDesignConstraints(before)
    expect(byId(next, 'shelf').position).toEqual([0, 791, 0])
    expect(byId(next, 'shelf').width).toBe(600)
    expect(byId(next, 'shelf').height).toBe(300)
    satisfied(next)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('preserves absolute floor placement when every panel is selected', () => {
    const before = project([shelf('shelf', 791)], [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'shelf', reference: 'max', value: 800 }])
    expect(() => movePanels(before, ['shelf'], [0, 10, 0])).toThrow(/design rules/)
    const next = movePanels(before, ['shelf'], [10, 0, 0])
    expect(byId(next, 'shelf').position).toEqual([10, 791, 0])
    satisfied(next)
  })

  it('matches disconnected cut dimensions to the reference and follows later resizing', () => {
    const a = createPanel({ id: 'a', width: 400, position: [-1000, 500, 0] })
    const b = createPanel({ id: 'b', width: 600, position: [1000, 500, 0], visible: false })
    const before = project([a, b], [{ id: 'same', enabled: true, kind: 'equal-dimension', panelIds: ['a', 'b'], dimension: 'width' }])
    const aligned = reconcileDesignConstraints(before, 'a')
    expect(byId(aligned, 'a').width).toBe(400)
    expect(byId(aligned, 'b').width).toBe(400)
    const next = resizePanels(aligned, ['a'], { width: 700 })
    expect(byId(next, 'a').width).toBe(700)
    expect(byId(next, 'b').width).toBe(700)
    expect(byId(next, 'b').visible).toBe(false)
    satisfied(next)
  })

  it('moves a disconnected peer to preserve level without changing its cut dimensions', () => {
    const a = shelf('a', 500), b = { ...shelf('b', 500), position: [2000, 500, 0] as [number, number, number] }
    const before = project([a, b], [{ id: 'level', enabled: true, kind: 'level', panelIds: ['a', 'b'], references: ['max', 'max'] }])
    const next = movePanels(before, ['a'], [0, 100, 0])
    expect(byId(next, 'a').position[1]).toBe(600)
    expect(byId(next, 'b').position[1]).toBe(600)
    expect(byId(next, 'b').width).toBe(b.width)
    expect(byId(next, 'b').height).toBe(b.height)
    satisfied(next)
  })

  it('keeps minimum gaps slack, activates at the boundary, and releases when opened', () => {
    const before = project([shelf('a', 100), shelf('b', 500)], [{ id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 }])
    const slack = movePanels(before, ['a'], [0, 50, 0])
    expect(byId(slack, 'b').position[1]).toBe(500)
    const boundary = movePanels(slack, ['a'], [0, 200, 0])
    expect(byId(boundary, 'a').position[1]).toBe(350)
    expect(byId(boundary, 'b').position[1]).toBe(568)
    const opened = movePanels(boundary, ['a'], [0, -100, 0])
    expect(byId(opened, 'b').position[1]).toBe(568)
    expect(evaluateDesignConstraints(opened.constraints, resolvePanels(opened))[0].actual).toBeCloseTo(300)
    satisfied(opened)
  })

  it('enforces a chain of minimum gaps and fixed stock dimensions', () => {
    const before = project([shelf('a', 100), shelf('b', 400), shelf('c', 700)], [
      { id: 'ab', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 },
      { id: 'bc', enabled: true, kind: 'gap', panelIds: ['b', 'c'], axis: 'y', relation: 'minimum', value: 200 },
    ])
    const next = movePanels(before, ['a'], [0, 400, 0])
    expect(byId(next, 'a').position[1]).toBeCloseTo(500)
    expect(byId(next, 'b').position[1]).toBeCloseTo(718, 4)
    expect(byId(next, 'c').position[1]).toBeCloseTo(936, 4)
    satisfied(next)
  })

  it('releases a weaker active minimum when a stricter rule sets the same gap', () => {
    const before = project([shelf('a', 100), shelf('b', 500)], [
      { id: 'small-gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 },
      { id: 'large-gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 300 },
    ])
    const next = movePanels(before, ['a'], [0, 250, 0])
    expect(byId(next, 'a').position[1]).toBe(350)
    expect(byId(next, 'b').position[1]).toBe(668)
    satisfied(next)
  })

  it('lets a top-height rule override the default numeric-resize center anchor', () => {
    const panel = createPanel({ id: 'side', width: 400, height: 400, position: [0, 400, 0] })
    const before = project([panel], [{ id: 'floor', enabled: true, kind: 'floor', panelId: panel.id, reference: 'max', value: 600 }])
    const next = resizePanels(before, [panel.id], { height: 600 })
    expect(byId(next, panel.id).position[1]).toBe(300)
    expect(getDesignConstraintBounds(byId(next, panel.id)).max[1]).toBe(600)
    // Edge pulls promise that the opposite edge remains anchored.
    expect(() => resizePanelEdge(before, panel.id, 'height', 1, 100)).toThrow(/design rules/)
    satisfied(next)
  })

  it('rejects conflicting exact requirements atomically and ignores paused rules', () => {
    const before = project([shelf('a', 500)], [
      { id: 'fixed', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', value: 600 },
      { id: 'paused', enabled: false, kind: 'dimension', panelId: 'a', dimension: 'width', value: 800 },
    ])
    const snapshot = JSON.stringify(before)
    expect(() => resizePanels(before, ['a'], { width: 700 })).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(reconcileDesignConstraints(before)).toBe(before)
    expect(() => reconcileDesignConstraints({ ...before, constraints: before.constraints!.map(rule => ({ ...rule, enabled: true })) })).toThrow(/design rules/)
  })

  it('keeps the physical joints when an interior shelf receives a floor requirement', () => {
    const original = createStarterProject()
    const middle = original.panels.find(panel => panel.name === 'Middle shelf')!
    const before: Project = { ...original, constraints: [{ id: 'floor', enabled: true, kind: 'floor', panelId: middle.id, reference: 'max', value: 800 }] }
    const next = reconcileDesignConstraints(before)
    expect(next.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
    expect(byId(next, middle.id).width).toBe(middle.width)
    expect(byId(next, middle.id).height).toBe(middle.height)
    satisfied(next)
  })

  it('solves a near-limit connected grid with an absolute floor rule', () => {
    const before = gridProject('Large grid', Array(8).fill(350), Array(10).fill(300))
    const panels = resolvePanels(before)
    const bottom = panels.find(panel => panel.name === 'Shelf 1.1')!
    const middle = panels.find(panel => panel.name === 'Shelf 4.5')!
    before.constraints = [{ id: 'floor', enabled: true, kind: 'floor', panelId: bottom.id, reference: 'min', value: getDesignConstraintBounds(bottom).min[1] }]
    const next = movePanels(before, [middle.id], [0, 10, 0])
    expect(next.panels).toHaveLength(178)
    expect(byId(next, middle.id).position[1]).toBeCloseTo(middle.position[1] + 10, 5)
    satisfied(next)
  })

  it('propagates minimum gaps through a 200-panel chain', () => {
    const panels = Array.from({ length: 200 }, (_, index) => shelf(`p${index}`, 100 + index * 220))
    const constraints: DesignConstraint[] = panels.slice(1).map((panel, index) => ({ id: `gap${index}`, enabled: true,
      kind: 'gap', panelIds: [panels[index].id, panel.id], axis: 'y', relation: 'minimum', value: 200 }))
    const before = project(panels, constraints)
    const next = movePanels(before, ['p0'], [0, 1000, 0])
    expect(byId(next, 'p0').position[1]).toBeCloseTo(1100)
    expect(byId(next, 'p199').position[1]).toBeCloseTo(1100 + 199 * 218, 3)
    satisfied(next)
  })
})
