import { describe, expect, it } from 'vitest'
import { evaluateDesignConstraints, getDesignConstraintBounds } from './design-constraints'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { attachPanel, createPanel, moveProject, resolvePanels, rotateProject } from './model'
import { movePreviewDrag, preparePreviewDrag } from './preview-drag'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { rotateSelection } from './selection-rotation'
import type { DesignConstraint, Panel, Project, Vec3 } from './types'

const shelf = (id: string, y: number, x = 0): Panel => createPanel({ id, name: id, width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [x, y, 0] })
const project = (panels: Panel[], constraints: DesignConstraint[] = []): Project => ({ version: 1, name: 'Constraint gestures', panels, connections: [], constraints })
const floor = (panel: Panel, value = getDesignConstraintBounds(panel).max[1]): DesignConstraint => ({ id: `floor-${panel.id}`, enabled: true, kind: 'floor', panelId: panel.id, reference: 'max', value })
const panel = (value: Project, id: string) => resolvePanels(value).find(item => item.id === id)!
const satisfied = (value: Project) => expect(evaluateDesignConstraints(value.constraints, resolvePanels(value)).every(result => !result.constraint.enabled || result.violation === 0)).toBe(true)

function connectedShelf(): Project {
  const side = createPanel({ id: 'side', width: 400, height: 400, position: [0, 500, 0] })
  return attachPanel(project([side]), 'side', createPanel({ id: 'shelf', name: 'Shelf', width: 400, height: 400 }),
    { type: '90', side: 'top', flip: false, offset: 0, inset: 0, color: '#e75a35', count: 2 })
}

describe('design rules across alternate geometry commands', () => {
  it('allows whole-project movement within a floor range and rejects movement past either edge', () => {
    const a = shelf('a', 791)
    const rule: DesignConstraint = { id: 'floor-range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 700, max: 900 }
    const original = project([a], [rule]), snapshot = JSON.stringify(original)
    expect(panel(moveProject(original, [0, 50, 0]), 'a').position[1]).toBe(841)
    satisfied(moveProject(original, [0, -100, 0]))
    satisfied(moveProject(original, [0, 100, 0]))
    expect(() => moveProject(original, [0, -101, 0])).toThrow(/between 700.*900/)
    expect(() => moveProject(original, [0, 101, 0])).toThrow(/between 700.*900/)
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('measures imported maximum violations numerically and explains the upper limit', () => {
    const a = shelf('a', 791)
    const rule: DesignConstraint = { id: 'floor-max', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'maximum', value: 700 }
    const original = project([a], [rule])
    expect(panel(moveProject(original, [100, 0, 0]), 'a').position[1]).toBe(791)
    expect(panel(moveProject(original, [0, -50, 0]), 'a').position[1]).toBe(741)
    expect(() => moveProject(original, [0, 1, 0])).toThrow(/at most 700/)
  })

  it('rejects dangling references even when a saved rule is disabled', () => {
    const a = shelf('a', 300), original = project([a], [{ ...floor(a), enabled: false }])
    expect(() => assertDesignConstraintEdit(original, { ...original, panels: [] })).toThrow(/referenced by a saved constraint/)
    expect(assertDesignConstraintEdit(original, { ...original, panels: [], constraints: [] }).constraints).toEqual([])
  })

  it('retains floor rules after Control-drag releases a physical joint', () => {
    const original = connectedShelf()
    original.constraints = [floor(panel(original, 'shelf'))]
    const snapshot = JSON.stringify(original)
    const session = preparePreviewDrag(original, ['shelf'])!
    expect(session.project.connections).toEqual([])
    expect(session.project.constraints).toEqual(original.constraints)
    expect(() => movePreviewDrag(session, [0, 20, 0], 0)).toThrow(/design rules/)
    const moved = movePreviewDrag(session, [60, 0, 0], 0).project
    expect(panel(moved, 'shelf').position[0]).toBeCloseTo(panel(original, 'shelf').position[0] + 60)
    expect(panel(moved, 'side').position).toEqual(panel(original, 'side').position)
    satisfied(moved)
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('propagates a disconnected same-level peer during Control-drag', () => {
    const original = project([shelf('a', 300), shelf('b', 300, 2000)], [
      { id: 'level', enabled: true, kind: 'level', panelIds: ['a', 'b'], references: ['max', 'max'] },
    ])
    const session = preparePreviewDrag(original, ['a'])!
    const moved = movePreviewDrag(session, [0, 80, 0], 0).project
    expect(panel(moved, 'a').position[1]).toBe(380)
    expect(panel(moved, 'b').position[1]).toBe(380)
    const further = movePreviewDrag(session, [0, 100, 0], 0).project
    expect(panel(further, 'a').position[1]).toBe(400)
    expect(panel(further, 'b').position[1]).toBe(400)
    satisfied(further)
  })

  it('pushes a disconnected minimum-gap peer and preserves its cut sizes during Control-drag', () => {
    const original = project([shelf('a', 100), shelf('b', 500)], [
      { id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 },
    ])
    const moved = movePreviewDrag(preparePreviewDrag(original, ['a'])!, [0, 250, 0], 0).project
    expect(panel(moved, 'a').position[1]).toBe(350)
    expect(panel(moved, 'b').position[1]).toBe(568)
    expect([panel(moved, 'b').width, panel(moved, 'b').height]).toEqual([600, 300])
    satisfied(moved)
  })

  it('skips an attachment snap that would change a fixed floor height', () => {
    const attached = connectedShelf()
    const loose: Project = { ...attached, connections: [], panels: attached.panels.map(item => item.id === 'shelf'
      ? { ...item, position: item.position.map((value, axis) => value - (axis === 1 ? 10 : 0)) as Vec3 } : item) }
    const delta: Vec3 = [8, 0, 4]
    expect(movePreviewDrag(preparePreviewDrag(loose, ['shelf'])!, delta, 30).snap).not.toBeNull()
    const original = { ...loose, constraints: [floor(panel(loose, 'shelf'))] }
    const result = movePreviewDrag(preparePreviewDrag(original, ['shelf'])!, delta, 30)
    expect(result.snap).toBeNull()
    expect(result.project.connections).toEqual([])
    expect(panel(result.project, 'shelf').position[1]).toBe(panel(original, 'shelf').position[1])
    satisfied(result.project)
  })

  it('still lets Control-drag release incidental support when an unrelated rule exists', () => {
    const base = shelf('base', 100)
    const insert = createPanel({ id: 'insert', name: 'Insert', width: 200, height: 200, position: [0, 209, 0] })
    const separate = shelf('separate', 300, 3000)
    const original = project([base, insert, separate], [floor(separate)])
    const moved = movePreviewDrag(preparePreviewDrag(original, ['insert'])!, [1000, 0, 0], 0).project
    expect(panel(moved, 'insert').position).toEqual([1000, 209, 0])
    expect(panel(moved, 'base')).toEqual(base)
    expect(panel(moved, 'separate')).toEqual(separate)
    satisfied(moved)
  })

  it('blocks whole-project and selection transforms that violate world references', () => {
    const a = shelf('a', 500), original = project([a], [floor(a)])
    const snapshot = JSON.stringify(original)
    expect(() => moveProject(original, [0, 10, 0])).toThrow(/above floor/)
    expect(() => rotateProject(original, 'x', 90)).toThrow(/above floor/)
    expect(() => rotateSelection(original, ['a'], 'x', 90)).toThrow(/above floor/)
    expect(() => rotateProject(original, 'y', 45)).toThrow(/world axes/)
    satisfied(moveProject(original, [20, 0, 50]))
    satisfied(rotateProject(original, 'y', 90))
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('allows transforms that leave an imported violation unchanged or improve it', () => {
    const a = shelf('a', 500), original = project([a], [floor(a, 800)])
    expect(moveProject(original, [20, 0, 0]).panels[0].position[1]).toBe(500)
    expect(moveProject(original, [0, 100, 0]).panels[0].position[1]).toBe(600)
    expect(() => moveProject(original, [0, -10, 0])).toThrow(/above floor/)
    const barelyWorse: Project = { ...original, panels: [{ ...a, position: [0, 499.95, 0] }] }
    expect(() => assertDesignConstraintEdit(original, barelyWorse)).toThrow(/above floor/)
  })

  it('lets an explicit floor reference outrank default grounding after creation rescale', () => {
    const a = createPanel({ id: 'a', width: 400, height: 600, position: [0, 500, 0] })
    const b = createPanel({ id: 'b', width: 400, height: 600, position: [2000, 500, 0] })
    const original = project([a, b], [floor(a), floor(b)])
    const value = getRescaleValues(original).find(item => item.kind === 'dimension' && item.value === 600)!
    const next = rescaleProject(original, { [value.id]: 800 })
    expect(next.panels.map(item => item.height)).toEqual([800, 800])
    expect(next.panels.map(item => item.position[1])).toEqual([400, 400])
    satisfied(next)
  })
})
