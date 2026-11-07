import { describe, expect, it } from 'vitest'
import { createPanel, parseProject, removePanel, resolvePanels, validateProject } from './model'
import { copyDesignConstraints, measureDesignConstraint, openingMeasurements } from './design-constraints'
import { designConstraintMeasurements } from './design-constraint-measurements'
import { movePanels, reconcileDesignConstraints, resizePanels } from './structure-edit'
import { setDesignConstraint } from './design-constraint-commands'
import { gridProject } from './example-geometry'
import { roundTripProject } from '../test/project-round-trip'
import type { DesignConstraint, Project } from './types'

const rule = (ratio = 1): Extract<DesignConstraint, { kind: 'opening-ratio' }> => ({ id: 'openings', enabled: true, kind: 'opening-ratio', panelIds: ['a', 'b', 'b', 'c'], axis: 'y', ratio })
const source = (): Project => ({ version: 1, name: 'Openings', connections: [], panels: [0, 318, 636].map((y, index) => createPanel({ id: ['a', 'b', 'c'][index], name: `Shelf ${index}`, width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [0, 500 + y, 0] })), constraints: [rule()] })
const gaps = (project: Project) => openingMeasurements(project.constraints![0] as ReturnType<typeof rule>, resolvePanels(project))

describe('saved opening relationships', () => {
  it('measures stock clearances, preserves shared references on reload/copy, and removes incident rules', () => {
    const project = source()
    gaps(project).forEach(gap => expect(gap).toBeCloseTo(300))
    expect(roundTripProject(project).constraints).toEqual(project.constraints)
    const copy = copyDesignConstraints(project.constraints, new Map([['a', 'x'], ['b', 'y'], ['c', 'z']]))
    expect(copy[0]).toMatchObject({ panelIds: ['x', 'y', 'y', 'z'], ratio: 1 })
    expect(copy[0].id).not.toBe('openings')
    expect(copyDesignConstraints(project.constraints, new Map([['a', 'x'], ['b', 'y']]))).toEqual([])
    expect(removePanel(project, 'b').constraints).toEqual([])
    const measurement = designConstraintMeasurements(rule(), project.panels)!
    expect(measurement.lines).toHaveLength(2)
    expect(new Set(measurement.lines.map(line => line.id)).size).toBe(2)
    measurement.lines.forEach(line => expect(line.to[1] - line.from[1]).toBeCloseTo(300))
  })

  it.each([undefined, null, 0, -.1, .001, 101, Infinity, '2'])('rejects invalid ratio %j', ratio => {
    expect(() => parseProject({ ...source(), constraints: [{ ...rule(), ratio }] })).toThrow(/ratio/)
  })
  it.each([['a', 'b'], ['a', 'a', 'b', 'c'], ['a', 'b', 'a', 'b'], ['a', 'b', 'b', 'missing']])('rejects invalid references %j', (...panelIds) => {
    expect(() => parseProject({ ...source(), constraints: [{ ...rule(), panelIds }] })).toThrow()
  })

  it.each([.5, 1, 2])('reconciles a ratio of %s and propagates movement without changing loose cuts', ratio => {
    const before = source()
    const snapshot = JSON.stringify(before)
    const matched = setDesignConstraint(before, rule(ratio), 'a')
    expect(gaps(matched)[1]).toBeCloseTo(ratio * gaps(matched)[0])
    expect(matched.panels[0].position).toEqual(before.panels[0].position)
    const moved = movePanels(matched, ['c'], [0, 120, 0])
    expect(gaps(moved)[1]).toBeCloseTo(ratio * gaps(moved)[0])
    expect(moved.panels.map(panel => [panel.width, panel.height])).toEqual(before.panels.map(panel => [panel.width, panel.height]))
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('keeps a shared divider between fixed outer boundaries', () => {
    const before = source()
    before.constraints = [rule(2), ...['a', 'c'].map((panelId, index): DesignConstraint => ({ id: `fixed-${panelId}`, enabled: true, kind: 'floor', panelId, reference: 'center', value: before.panels[index * 2].position[1] }))]
    const next = reconcileDesignConstraints(before)
    expect(gaps(next)[0]).toBeCloseTo(200)
    expect(gaps(next)[1]).toBeCloseTo(400)
    expect(next.panels[0].position).toEqual(before.panels[0].position)
    expect(next.panels[2].position).toEqual(before.panels[2].position)
  })

  it('does not consider matching negative gaps satisfied and rejects impossible reversed boundaries atomically', () => {
    const before = source()
    before.panels[1].position[1] = 500
    before.panels[2].position[1] = 500
    expect(measureDesignConstraint(rule(), before.panels).actual).toBeCloseTo(0)
    expect(measureDesignConstraint(rule(), before.panels).violation).toBeCloseTo(18)
    before.constraints!.push(...before.panels.map((panel): DesignConstraint => ({ id: `fixed-${panel.id}`, enabled: true, kind: 'floor', panelId: panel.id, reference: 'center', value: 500 })))
    const snapshot = JSON.stringify(before)
    expect(() => reconcileDesignConstraints(before)).toThrow()
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('repairs negative gaps even when their ratio residual is zero', () => {
    const before = source()
    before.panels[1].position[1] = 500
    before.panels[2].position[1] = 500
    const next = reconcileDesignConstraints(before, 'a', 'openings')
    gaps(next).forEach(gap => expect(gap).toBeGreaterThanOrEqual(-.001))
    expect(measureDesignConstraint(rule(), resolvePanels(next)).violation).toBe(0)
  })

  it('supports two separate openings and leaves disabled proportions inactive', () => {
    const before = source()
    before.panels.push(createPanel({ ...before.panels[2], id: 'd', position: [0, 1600, 0] }))
    before.constraints = [{ ...rule(2), panelIds: ['a', 'b', 'c', 'd'] }]
    const next = reconcileDesignConstraints(before, 'a', 'openings')
    expect(gaps(next)[1]).toBeCloseTo(gaps(next)[0] * 2)
    expect(roundTripProject(next).constraints).toEqual(next.constraints)
    const disabled = { ...next, constraints: next.constraints!.map(rule => ({ ...rule, enabled: false })) }
    const moved = movePanels(disabled, ['d'], [0, 100, 0])
    expect(moved.panels.slice(0, 3)).toEqual(disabled.panels.slice(0, 3))
    expect(gaps(moved)[1]).toBeCloseTo(gaps(next)[1] + 100)
  })

  it('keeps connected clear bays equal when one span grows', () => {
    const before = gridProject('Two bays', [300, 300], [400])
    const ids = ['Upright 1.1', 'Upright 2.1', 'Upright 3.1'].map(name => before.panels.find(panel => panel.name === name)!.id)
    before.constraints = [{ ...rule(), axis: 'x', panelIds: [ids[0], ids[1], ids[1], ids[2]] }]
    const shelf = before.panels.find(panel => panel.name === 'Shelf 1.1')!
    const next = resizePanels(before, [shelf.id], { width: 400 })
    expect(gaps(next)[0]).toBeCloseTo(gaps(next)[1])
    expect(gaps(next)[0]).toBeGreaterThan(gaps(before)[0])
    expect(validateProject(next)).toEqual([])
  })
})
