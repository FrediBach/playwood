import { roundTripProject } from '../test/project-round-trip'
import { preparePreviewResize, movePreviewResize } from './preview-resize'
import { resizePanels } from './structure-edit'
import { describe, expect, it } from 'vitest'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { lockPanelSizes, setDesignConstraint } from './design-constraint-commands'
import { evaluateDesignConstraints } from './design-constraints'
import { createPanel, createStarterProject, resolvePanels } from './model'
import type { DesignConstraint, Project } from './types'

const floorRule = (panelId: string, value: number): DesignConstraint => ({ id: 'floor', enabled: true, kind: 'floor', panelId, reference: 'max', value })
const emptyWithPanel = (): Project => ({ version: 1, name: 'Rules', panels: [createPanel({ id: 'side', width: 400, height: 600, position: [0, 500, 0] })], connections: [] })

describe('design rule command transactions', () => {
  it('keeps a floor height inside a range unchanged and adjusts to the nearest permitted edge outside it', () => {
    const before = emptyWithPanel(), snapshot = JSON.stringify(before)
    const range: DesignConstraint = { id: 'floor', enabled: true, kind: 'floor', panelId: 'side', reference: 'max', relation: 'range', min: 700, max: 900 }
    const within = setDesignConstraint(before, range)
    expect(within.panels).toEqual(before.panels)
    const below = setDesignConstraint(before, { ...range, min: 900, max: 1100 })
    expect(below.panels[0].position[1]).toBeCloseTo(600)
    const above = setDesignConstraint(before, { ...range, min: 500, max: 700 })
    expect(above.panels[0].position[1]).toBeCloseTo(400)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('reactivates a maximum dimension by adjusting geometry without rewriting the target', () => {
    const rule: DesignConstraint = { id: 'width', enabled: false, kind: 'dimension', panelId: 'side', dimension: 'width', relation: 'maximum', value: 300 }
    const before = { ...emptyWithPanel(), constraints: [rule] }
    const after = setDesignConstraint(before, { ...rule, enabled: true })
    expect(after.panels[0].width).toBeCloseTo(300)
    expect(after.constraints).toEqual([{ ...rule, enabled: true }])
    expect(before.panels[0].width).toBe(400)
  })

  it('previews a floor rule on a vertical panel by moving it without shrinking its cut height', () => {
    const before = emptyWithPanel(), snapshot = JSON.stringify(before)
    const candidate = setDesignConstraint(before, floorRule('side', 1000))
    expect(candidate.panels[0].height).toBe(600)
    expect(candidate.panels[0].width).toBe(400)
    expect(candidate.panels[0].position).toEqual([0, 700, 0])
    expect(candidate.constraints).toEqual([floorRule('side', 1000)])
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('adds a connected shelf rule and geometry together while preserving its own dimensions', () => {
    const before = createStarterProject(), snapshot = JSON.stringify(before)
    const shelf = resolvePanels(before).find(panel => panel.name === 'Middle shelf')!
    const next = setDesignConstraint(before, floorRule(shelf.id, 800))
    const after = resolvePanels(next).find(panel => panel.id === shelf.id)!
    expect([after.width, after.height, after.thickness]).toEqual([shelf.width, shelf.height, shelf.thickness])
    expect(evaluateDesignConstraints(next.constraints, resolvePanels(next))[0].actual).toBeCloseTo(800)
    expect(next.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('rejects a new conflicting rule without changing either the rules or geometry', () => {
    const before = setDesignConstraint(emptyWithPanel(), floorRule('side', 800))
    const snapshot = JSON.stringify(before)
    expect(() => setDesignConstraint(before, { ...floorRule('side', 900), id: 'different-floor' })).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('allows an imported violation to stay or improve but rejects worsening or newly violated rules', () => {
    const before = { ...emptyWithPanel(), constraints: [floorRule('side', 900)] }
    expect(assertDesignConstraintEdit(before, { ...before, name: 'Renamed' }).name).toBe('Renamed')
    const moved = (y: number): Project => ({ ...before, panels: before.panels.map(panel => ({ ...panel, position: [0, y, 0] })) })
    expect(assertDesignConstraintEdit(before, moved(550)).panels[0].position[1]).toBe(550)
    expect(() => assertDesignConstraintEdit(before, moved(450))).toThrow(/above floor/)
    expect(() => assertDesignConstraintEdit(emptyWithPanel(), before)).toThrow(/above floor/)
  })

  it('preserves requirements if a reconstructed candidate accidentally omits the field', () => {
    const before = { ...emptyWithPanel(), constraints: [floorRule('side', 800)] }
    const candidate = emptyWithPanel()
    expect(assertDesignConstraintEdit(before, candidate).constraints).toEqual(before.constraints)
    expect(assertDesignConstraintEdit(before, { ...candidate, constraints: [] }).constraints).toEqual([])
  })

  it('pauses and re-enables a rule through the same atomic geometry preparation', () => {
    const before = { ...emptyWithPanel(), constraints: [{ ...floorRule('side', 1000), enabled: false }] }
    const enabled = setDesignConstraint(before, floorRule('side', 1000))
    expect(enabled.panels[0].position[1]).toBe(700)
    const paused = setDesignConstraint(enabled, { ...floorRule('side', 1000), enabled: false })
    expect(paused.panels).toEqual(enabled.panels)
    expect(paused.constraints?.[0].enabled).toBe(false)
  })

  it('leaves an unrelated imported violation untouched when applying a new rule', () => {
    const before: Project = { ...emptyWithPanel(), panels: [...emptyWithPanel().panels,
      createPanel({ id: 'separate', width: 400, height: 400, position: [3000, 300, 0] })], constraints: [floorRule('side', 900)] }
    const next = setDesignConstraint(before, { ...floorRule('separate', 800), id: 'new-floor' })
    expect(next.panels.find(panel => panel.id === 'side')).toEqual(before.panels.find(panel => panel.id === 'side'))
    expect(evaluateDesignConstraints(next.constraints, resolvePanels(next)).find(result => result.constraint.id === 'floor')?.violation).toBe(100)
    expect(evaluateDesignConstraints(next.constraints, resolvePanels(next)).find(result => result.constraint.id === 'new-floor')?.violation).toBe(0)
  })

  it('keeps an explicitly chosen alignment reference fixed even when another rule conflicts', () => {
    const before: Project = { ...emptyWithPanel(), panels: [...emptyWithPanel().panels,
      createPanel({ id: 'separate', width: 400, height: 400, position: [3000, 300, 0] })],
    constraints: [{ ...floorRule('separate', 500), id: 'other-floor' }] }
    const level: DesignConstraint = { id: 'level', enabled: true, kind: 'level', panelIds: ['side', 'separate'], references: ['max', 'max'] }
    const snapshot = JSON.stringify(before)
    expect(() => setDesignConstraint(before, level, 'side')).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('panel size locks', () => {
  it('locks multiple panels atomically, round-trips, and avoids duplicate rules', () => {
    const project = emptyWithPanel()
    project.panels.push(createPanel({ id: 'other', position: [1000, 500, 0] }))
    const locked = lockPanelSizes(project, ['side', 'other', 'side'])
    expect(locked.constraints).toHaveLength(4)
    expect(project.constraints).toBeUndefined()
    expect(locked.panels).toEqual(project.panels)
    expect(lockPanelSizes(locked, ['side', 'other'])).toBe(locked)
    expect(roundTripProject(locked).constraints).toEqual(locked.constraints)
  })

  it('blocks numeric and independent edge resizing and marks the arrows as locked', () => {
    const locked = lockPanelSizes(emptyWithPanel(), ['side'])
    const session = preparePreviewResize(locked, { panelId: 'side' })!
    const edges = session.handles.filter(handle => handle.panelEdge)
    expect(edges).toHaveLength(4)
    expect(edges.every(handle => handle.sizeLocked && handle.blocked)).toBe(true)
    for (const edge of edges) {
      expect(movePreviewResize(session, edge.id, 50).project).toBe(locked)
      expect(movePreviewResize(session, edge.id, 50, true).project).toBe(locked)
    }
    expect(() => resizePanels(locked, ['side'], { width: 500 })).toThrow()
    const unlocked = { ...locked, constraints: locked.constraints!.map(rule => ({ ...rule, enabled: false })) }
    expect(preparePreviewResize(unlocked, { panelId: 'side' })!.handles.filter(handle => handle.panelEdge).every(handle => !handle.sizeLocked && !handle.blocked)).toBe(true)
  })
})
