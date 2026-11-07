import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, resolvePanels, validateProject } from './model'
import { evaluateDesignConstraints, getDesignConstraintBounds } from './design-constraints'
import { movePanels, reconcileDesignConstraints, resizePanelDimensions, resizePanelEdge, resizePanels } from './structure-edit'
import { gridProject } from './example-geometry'
import type { ConstraintRequirement, DesignConstraint, Panel, Project } from './types'

const shelf = (id: string, y: number): Panel => createPanel({ id, name: id, width: 600, height: 300, thickness: 18, position: [0, y, 0], rotation: [-Math.PI / 2, 0, 0] })
const project = (panels: Panel[], constraints: DesignConstraint[]): Project => ({ version: 1, name: 'Design rules', panels, connections: [], constraints })
const byId = (value: Project, id: string) => resolvePanels(value).find(panel => panel.id === id)!
const satisfied = (value: Project) => expect(evaluateDesignConstraints(value.constraints, resolvePanels(value)).filter(result => result.constraint.enabled).map(result => result.violation)).toEqual(value.constraints?.filter(rule => rule.enabled).map(() => 0))
const boundedMeasurements: { requirement: ConstraintRequirement; initial: number; expected: number }[] = [
  { requirement: { relation: 'minimum', value: 500 }, initial: 400, expected: 500 },
  { requirement: { relation: 'minimum', value: 500 }, initial: 600, expected: 600 },
  { requirement: { relation: 'maximum', value: 500 }, initial: 600, expected: 500 },
  { requirement: { relation: 'maximum', value: 500 }, initial: 400, expected: 400 },
  { requirement: { relation: 'range', min: 400, max: 600 }, initial: 300, expected: 400 },
  { requirement: { relation: 'range', min: 400, max: 600 }, initial: 700, expected: 600 },
  { requirement: { relation: 'range', min: 400, max: 600 }, initial: 500, expected: 500 },
  { requirement: { relation: 'range', min: 500, max: 500 }, initial: 400, expected: 500 },
]

describe('automatic design rules in structural edits', () => {
  it.each(['width', 'height'] as const)('preserves a loose peer’s %s under protective limits during movement and reconciliation', dimension => {
    const axis = dimension === 'width' ? 0 : 1
    const a = createPanel({ id: 'a', width: 600, height: 600, position: [0, 1000, 0] })
    const b = { ...a, id: 'b', position: a.position.map((value, index) => value + (index === axis ? 800 : 0)) as Panel['position'] }
    const gap: DesignConstraint = { id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: axis === 0 ? 'x' : 'y', relation: 'minimum', value: 200 }
    const delta = [0, 0, 0] as Panel['position']
    delta[axis] = 100
    const baseline = movePanels(project([a, b], [gap]), ['a'], delta)
    for (const requirement of [
      { relation: 'minimum', value: 500 },
      { relation: 'maximum', value: 700 },
      { relation: 'range', min: 500, max: 700 },
    ] as const) {
      const before = project([a, b], [gap, { id: 'cut', enabled: true, kind: 'dimension', panelId: 'b', dimension, ...requirement }])
      const snapshot = JSON.stringify(before)
      const next = movePanels(before, ['a'], delta)
      expect(next.panels).toEqual(baseline.panels)
      expect(byId(next, 'b')[dimension]).toBe(600)
      satisfied(next)
      const toReconcile = { ...before, panels: [{ ...a, position: byId(next, 'a').position }, b] }
      const reconciled = reconcileDesignConstraints(toReconcile, 'a', 'gap')
      expect(reconciled.panels).toEqual(baseline.panels)
      satisfied(reconciled)
      expect(JSON.stringify(before)).toBe(snapshot)
    }
  })

  it('does not shrink a loose peer to bypass a fixed elevation and minimum gap', () => {
    const a = createPanel({ id: 'a', width: 600, height: 600, position: [0, 1000, 0] })
    const b = { ...a, id: 'b', position: [0, 1800, 0] as Panel['position'] }
    const before = project([a, b], [
      { id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 },
      { id: 'cut', enabled: true, kind: 'dimension', panelId: 'b', dimension: 'height', relation: 'minimum', value: 400 },
      { id: 'floor', enabled: true, kind: 'floor', panelId: 'b', reference: 'center', value: 1800 },
    ])
    const snapshot = JSON.stringify(before)
    expect(() => movePanels(before, ['a'], [0, 100, 0])).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('allows physically connected spans with protective limits to resize', () => {
    const before = createStarterProject()
    const middle = before.panels.find(panel => panel.name === 'Middle shelf')!
    const side = before.panels.find(panel => panel.name === 'Left side')!
    const baseline = movePanels(before, [middle.id], [0, 10, 0])
    const constrained: Project = { ...before, constraints: [{ id: 'cut', enabled: true, kind: 'dimension', panelId: side.id,
      dimension: 'width', relation: 'minimum', value: 40 }] }
    const next = movePanels(constrained, [middle.id], [0, 10, 0])
    expect(next.panels).toEqual(baseline.panels)
    expect(byId(next, side.id).width).toBeCloseTo(side.width + 10)
    satisfied(next)
    const floor: DesignConstraint = { id: 'floor', enabled: true, kind: 'floor', panelId: middle.id, reference: 'max',
      value: getDesignConstraintBounds(byId(before, middle.id)).max[1] + 10 }
    const reconciled = reconcileDesignConstraints({ ...constrained, constraints: [...constrained.constraints!, floor] })
    const baselineReconciled = reconcileDesignConstraints({ ...before, constraints: [floor] })
    expect(reconciled.panels).toEqual(baselineReconciled.panels)
    satisfied(reconciled)
  })

  it.each(boundedMeasurements)('reconciles floor $requirement.relation from $initial to $expected without removing slack', ({ requirement, initial, expected }) => {
    const before = project([shelf('shelf', initial - 9)], [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'shelf', reference: 'max', ...requirement }])
    const next = reconcileDesignConstraints(before)
    expect(getDesignConstraintBounds(byId(next, 'shelf')).max[1]).toBeCloseTo(expected)
    expect([byId(next, 'shelf').width, byId(next, 'shelf').height]).toEqual([600, 300])
    if (initial === expected) expect(next).toBe(before)
    satisfied(next)
  })

  it.each(boundedMeasurements)('reconciles cut dimension $requirement.relation from $initial to $expected without removing slack', ({ requirement, initial, expected }) => {
    const before = project([{ ...shelf('shelf', 400), width: initial }], [{ id: 'width', enabled: true, kind: 'dimension', panelId: 'shelf', dimension: 'width', ...requirement }])
    const next = reconcileDesignConstraints(before)
    expect(byId(next, 'shelf').width).toBeCloseTo(expected)
    expect(byId(next, 'shelf').position).toEqual([0, 400, 0])
    if (initial === expected) expect(next).toBe(before)
    satisfied(next)
  })

  it('allows edits inside a floor range and blocks moves through either boundary', () => {
    const before = project([shelf('shelf', 491)], [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'shelf', reference: 'max', relation: 'range', min: 400, max: 600 }])
    const higher = movePanels(before, ['shelf'], [0, 50, 0])
    expect(byId(higher, 'shelf').position[1]).toBe(541)
    expect(() => movePanels(higher, ['shelf'], [0, 60, 0])).toThrow(/design rules/)
    const lower = movePanels(higher, ['shelf'], [0, -100, 0])
    expect(byId(lower, 'shelf').position[1]).toBe(441)
    expect(() => movePanels(lower, ['shelf'], [0, -60, 0])).toThrow(/design rules/)
    satisfied(lower)
  })

  it('allows cut dimension edits within a range and rejects either out-of-range target atomically', () => {
    const before = project([shelf('shelf', 400)], [{ id: 'width', enabled: true, kind: 'dimension', panelId: 'shelf', dimension: 'width', relation: 'range', min: 400, max: 700 }])
    const next = resizePanels(before, ['shelf'], { width: 650 })
    expect(byId(next, 'shelf').width).toBe(650)
    const snapshot = JSON.stringify(next)
    expect(() => resizePanels(next, ['shelf'], { width: 800 })).toThrow(/design rules/)
    expect(() => resizePanels(next, ['shelf'], { width: 300 })).toThrow(/design rules/)
    expect(JSON.stringify(next)).toBe(snapshot)
    satisfied(next)
  })

  it('keeps maximum gaps slack, activates at the upper boundary, and releases when closed', () => {
    const before = project([shelf('a', 500), shelf('b', 800)], [{ id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'maximum', value: 300 }])
    const slack = movePanels(before, ['a'], [0, -10, 0])
    expect(byId(slack, 'b').position[1]).toBe(800)
    const boundary = movePanels(slack, ['a'], [0, -100, 0])
    expect(byId(boundary, 'a').position[1]).toBe(390)
    expect(byId(boundary, 'b').position[1]).toBe(708)
    const closed = movePanels(boundary, ['a'], [0, 50, 0])
    expect(byId(closed, 'b').position[1]).toBe(708)
    expect(evaluateDesignConstraints(closed.constraints, resolvePanels(closed))[0].actual).toBeCloseTo(250)
    satisfied(closed)
  })

  it('switches between both gap boundaries and releases each when moving into the permitted range', () => {
    const before = project([shelf('a', 100), shelf('b', 400)], [{ id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 200, max: 300 }])
    const lower = movePanels(before, ['a'], [0, 100, 0])
    expect(byId(lower, 'b').position[1]).toBe(418)
    const slack = movePanels(lower, ['a'], [0, -50, 0])
    expect(byId(slack, 'b').position[1]).toBe(418)
    const upper = movePanels(slack, ['a'], [0, -100, 0])
    expect(byId(upper, 'b').position[1]).toBe(368)
    const released = movePanels(upper, ['a'], [0, 50, 0])
    expect(byId(released, 'b').position[1]).toBe(368)
    expect(byId(released, 'b').width).toBe(600)
    expect(byId(released, 'b').height).toBe(300)
    expect(evaluateDesignConstraints(released.constraints, resolvePanels(released))[0].actual).toBeCloseTo(250)
    satisfied(released)
  })

  it.each([{ initial: 200, expected: 318 }, { initial: 500, expected: 418 }])('reconciles a gap range from panel center $initial to the nearer edge at $expected', ({ initial, expected }) => {
    const before = project([shelf('a', 100), shelf('b', initial)], [{ id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 200, max: 300 }])
    const next = reconcileDesignConstraints(before, 'a')
    expect(byId(next, 'a').position[1]).toBe(100)
    expect(byId(next, 'b').position[1]).toBe(expected)
    satisfied(next)
  })

  it.each([{ thickness: 22, expected: 199 }, { thickness: 4, expected: 203 }])('includes prescribed thickness $thickness when enforcing both floor range bounds', ({ thickness, expected }) => {
    const before = project([shelf('shelf', 200)], [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'shelf', reference: 'max', relation: 'range', min: 205, max: 210 }])
    const next = resizePanelDimensions(before, { shelf: { thickness } })
    expect(byId(next, 'shelf').position[1]).toBe(expected)
    expect(byId(next, 'shelf').thickness).toBe(thickness)
    satisfied(next)
  })

  it('releases weaker upper bounds when a stricter maximum sets the same gap', () => {
    const before = project([shelf('a', 1000), shelf('b', 1318)], [
      { id: 'wide', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'maximum', value: 500 },
      { id: 'narrow', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'maximum', value: 400 },
    ])
    const next = movePanels(before, ['a'], [0, -600, 0])
    expect(byId(next, 'a').position[1]).toBe(400)
    expect(byId(next, 'b').position[1]).toBe(818)
    satisfied(next)
  })

  it('rejects incompatible ranges without modifying the source', () => {
    const before = project([shelf('shelf', 400)], [
      { id: 'small', enabled: true, kind: 'dimension', panelId: 'shelf', dimension: 'width', relation: 'range', min: 400, max: 600 },
      { id: 'large', enabled: true, kind: 'dimension', panelId: 'shelf', dimension: 'width', relation: 'range', min: 700, max: 900 },
    ])
    const snapshot = JSON.stringify(before)
    expect(() => reconcileDesignConstraints(before)).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('maintains physical joints when a connected shelf moves within a floor range', () => {
    const original = createStarterProject()
    const middle = resolvePanels(original).find(panel => panel.name === 'Middle shelf')!
    const initial = getDesignConstraintBounds(middle).max[1]
    const before: Project = { ...original, constraints: [{ id: 'floor', enabled: true, kind: 'floor', panelId: middle.id, reference: 'max', relation: 'range', min: initial + 40, max: initial + 80 }] }
    const reconciled = reconcileDesignConstraints(before)
    expect(getDesignConstraintBounds(byId(reconciled, middle.id)).max[1]).toBeCloseTo(initial + 40)
    const next = movePanels(reconciled, [middle.id], [0, 20, 0])
    expect(getDesignConstraintBounds(byId(next, middle.id)).max[1]).toBeCloseTo(initial + 60)
    expect(next.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
    expect(validateProject(next).filter(issue => issue.severity === 'error')).toEqual([])
    satisfied(next)
  })

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
    const before = project([a, b], [
      { id: 'same', enabled: true, kind: 'equal-dimension', panelIds: ['a', 'b'], dimension: 'width' },
      { id: 'cut', enabled: true, kind: 'dimension', panelId: 'b', dimension: 'width', relation: 'range', min: 300, max: 800 },
    ])
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


describe('cross-dimension cascades', () => {
  const rule: DesignConstraint = { id: 'cross', enabled: true, kind: 'equal-dimension', panelIds: ['a', 'b'], dimension: 'width', secondDimension: 'height' }
  const source = () => project([
    createPanel({ id: 'a', width: 600, height: 250, position: [-1000, 1200, 0] }),
    createPanel({ id: 'b', width: 350, height: 400, position: [1000, 1200, 0], rotation: [0, 0, Math.PI / 2] }),
  ], [rule])

  it.each(['a', 'b'])('reconciles against the selected cut of anchor %s', anchor => {
    const before = source()
    const snapshot = JSON.stringify(before)
    const next = reconcileDesignConstraints(before, anchor, rule.id)
    expect(byId(next, 'a').width).toBeCloseTo(anchor === 'a' ? 600 : 400)
    expect(byId(next, 'b').height).toBeCloseTo(anchor === 'a' ? 600 : 400)
    expect(byId(next, 'a').height).toBe(250)
    expect(byId(next, 'b').width).toBe(350)
    satisfied(next)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('propagates edits in both directions and leaves unrelated cuts fixed', () => {
    const before = reconcileDesignConstraints(source(), 'a', rule.id)
    const wider = resizePanelDimensions(before, { a: { width: 750 } })
    expect(byId(wider, 'b').height).toBeCloseTo(750)
    const shorter = resizePanelDimensions(wider, { b: { height: 500 } })
    expect(byId(shorter, 'a').width).toBeCloseTo(500)
    expect(byId(shorter, 'a').height).toBe(250)
    expect(byId(shorter, 'b').width).toBe(350)
    satisfied(shorter)
    const protectedProject: Project = { ...shorter, constraints: [...shorter.constraints!, { id: 'max', enabled: true, kind: 'dimension', panelId: 'b', dimension: 'height', relation: 'maximum', value: 550 }] }
    const snapshot = JSON.stringify(protectedProject)
    expect(() => resizePanelDimensions(protectedProject, { a: { width: 600 } })).toThrow()
    expect(JSON.stringify(protectedProject)).toBe(snapshot)
  })
})
