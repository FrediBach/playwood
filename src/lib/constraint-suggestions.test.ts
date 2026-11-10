import { describe, expect, it } from 'vitest'
import { ASSEMBLY_LIBRARY } from './assembly-library'
import { applyConstraintSuggestion, suggestDesignConstraints } from './constraint-suggestions'
import { evaluateDesignConstraints, isPanelDimensionLocked } from './design-constraints'
import { createPanel, resolvePanels } from './model'
import type { Panel, Project } from './types'

const project = (...panels: Panel[]): Project => ({ version: 1, name: 'Suggestions', panels, connections: [] })
const labels = (value: Project, ids: string[]) => suggestDesignConstraints(value, ids).map(item => item.label)
const pick = (value: Project, ids: string[], id: string) => {
  const suggestion = suggestDesignConstraints(value, ids).find(item => item.id === id)
  if (!suggestion) throw new Error(`Missing ${id} suggestion`)
  return suggestion
}
const satisfied = (value: Project) => evaluateDesignConstraints(value.constraints, resolvePanels(value)).every(result => result.violation === 0)
const side = (id: string, x: number) => createPanel({ id, name: id, width: 300, height: 500, rotation: [0, Math.PI / 2, 0], position: [x, 250, 0] })

describe('one-click constraint suggestions', () => {
  it('offers prefilled single-panel rules and hides each one once it exists', () => {
    const before = project(createPanel({ id: 'a', name: 'Shelf', width: 600, height: 360, position: [0, 180, 0] }))
    expect(labels(before, ['a'])).toEqual(['Stick to ground', 'Lock width at 600 mm', 'Lock height at 360 mm', 'Pin current position'])
    const grounded = applyConstraintSuggestion(before, pick(before, ['a'], 'ground'))
    expect(grounded.panels).toEqual(before.panels)
    expect(grounded.constraints).toMatchObject([{ kind: 'floor', panelId: 'a', reference: 'min', value: 0 }])
    expect(labels(grounded, ['a'])).not.toContain('Stick to ground')
    const locked = applyConstraintSuggestion(grounded, pick(grounded, ['a'], 'lock-width'))
    expect(isPanelDimensionLocked(locked.constraints, 'a', 'width')).toBe(true)
    expect(labels(locked, ['a'])).not.toContain('Lock width at 600 mm')
    expect(before.constraints).toBeUndefined()
  })

  it('keeps a raised panel at its current floor height', () => {
    const before = project(createPanel({ id: 'a', position: [0, 700, 0] }))
    expect(labels(before, ['a'])[0]).toBe('Keep bottom 520 mm above floor')
    const after = applyConstraintSuggestion(before, pick(before, ['a'], 'floor-height'))
    expect(after.panels).toEqual(before.panels)
    expect(satisfied(after)).toBe(true)
  })

  it('distributes parallel panels equally and saves opening rules that preserve the spacing', () => {
    const before = project(side('left', -400), side('middle', -250), side('right', 400))
    const ids = ['middle', 'left', 'right']
    const suggestion = pick(before, ids, 'distribute')
    expect(suggestion).toMatchObject({ label: 'Distribute equally', adjusts: true })
    const after = applyConstraintSuggestion(before, suggestion)
    const x = (id: string) => after.panels.find(panel => panel.id === id)!.position[0]
    expect([x('left'), x('middle'), x('right')]).toEqual([-400, expect.closeTo(0, 3), 400])
    expect(after.constraints).toMatchObject([{ kind: 'opening-ratio', axis: 'x', ratio: 1, panelIds: ['left', 'middle', 'middle', 'right'] }])
    expect(satisfied(after)).toBe(true)
    expect(labels(after, ids)).not.toContain('Keep spacing equal')
  })

  it('matches cuts to the primary panel only when they run in the same direction', () => {
    const a = createPanel({ id: 'a', name: 'Top', width: 600, position: [0, 180, 0] })
    const b = createPanel({ id: 'b', name: 'Bottom', width: 500, position: [0, 180, 300] })
    const before = project(a, b)
    const match = pick(before, ['a', 'b'], 'equal-width')
    expect(match).toMatchObject({ label: 'Match widths to Top', anchorPanelId: 'a', adjusts: true })
    const after = applyConstraintSuggestion(before, match)
    expect(after.panels.map(panel => panel.width)).toEqual([600, expect.closeTo(600, 3)])
    expect(labels(after, ['a', 'b'])).not.toContain('Keep widths equal')
    const turned = project(a, { ...b, rotation: [0, 0, Math.PI / 2] })
    expect(suggestDesignConstraints(turned, ['a', 'b']).map(item => item.id)).not.toContain('equal-width')
  })

  it('aligns levels only between parallel panels and skips coincidental cross-direction matches', () => {
    const top = createPanel({ id: 'top', name: 'Top', width: 600, height: 600, rotation: [-Math.PI / 2, 0, 0], position: [0, 700, 0] })
    const leg = createPanel({ id: 'leg', name: 'Leg', width: 600, height: 600, rotation: [0, Math.PI / 2, 0], position: [-300, 300, 0] })
    const ids = suggestDesignConstraints(project(top, leg), ['top', 'leg']).map(item => item.id)
    expect(ids).not.toContain('level-min')
    expect(ids).not.toContain('equal-width')
    const shelves = project(createPanel({ id: 'a', name: 'A', position: [0, 300, 0] }), createPanel({ id: 'b', name: 'B', position: [0, 400, 400] }))
    expect(labels(shelves, ['a', 'b'])).toContain('Align bottoms with A')
  })

  it('offers the measured gap between two separated panels', () => {
    const before = project(createPanel({ id: 'a', position: [0, 180, 0] }), createPanel({ id: 'b', position: [0, 180, 318] }))
    const gap = pick(before, ['b', 'a'], 'gap')
    expect(gap.label).toBe('Keep 300 mm front-to-back gap')
    expect(gap.rules).toMatchObject([{ kind: 'gap', panelIds: ['a', 'b'], axis: 'z', value: 300 }])
    expect(applyConstraintSuggestion(before, gap).panels).toEqual(before.panels)
  })

  it('omits suggestions for linked assembly members', () => {
    const cube = ASSEMBLY_LIBRARY.find(item => item.id === 'assembly-cube')!.create()
    expect(suggestDesignConstraints(cube, [cube.panels[0].id])).toEqual([])
  })
})
