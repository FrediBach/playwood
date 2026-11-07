import { describe, expect, it } from 'vitest'
import { copyDesignConstraints, designConstraintCoordinate, measureDesignConstraint } from './design-constraints'
import { designConstraintMeasurements } from './design-constraint-measurements'
import { createPanel, parseProject, resolvePanels, validateProject } from './model'
import { copySelection } from './clipboard'
import { setDesignConstraint } from './design-constraint-commands'
import { movePanels, resizePanels } from './structure-edit'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { gridProject } from './example-geometry'
import { roundTripProject } from '../test/project-round-trip'
import type { ConstraintReference, DesignConstraint, Project } from './types'

const source = (): Project => ({ version: 1, name: 'Reference rules', connections: [], panels: [
  createPanel({ id: 'a', width: 600, height: 300, position: [-1000, 1000, 0], rotation: [-Math.PI / 2, 0, 0] }),
  createPanel({ id: 'b', width: 500, height: 200, position: [1000, 1000, -40], rotation: [-Math.PI / 2, 0, 0] }),
] })
const position: DesignConstraint = { id: 'fixed', enabled: true, kind: 'position', panelId: 'a', axis: 'x', reference: 'min', value: -1300 }
const setback: DesignConstraint = { id: 'setback', enabled: true, kind: 'setback', panelIds: ['a', 'b'], axis: 'z', references: ['max', 'max'], value: -90 }

describe('authored positions and setbacks', () => {
  it('round-trips signed references, copies only relative rules, and measures signed overlays', () => {
    const project = { ...source(), constraints: [position, setback] }
    expect(roundTripProject(project).constraints).toEqual(project.constraints)
    expect(measureDesignConstraint(setback, project.panels).violation).toBe(0)
    const copied = copyDesignConstraints(project.constraints, new Map([['a', 'x'], ['b', 'y']]))
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ kind: 'setback', panelIds: ['x', 'y'], value: -90 })
    expect(copySelection(project, ['a', 'b']).constraints).toEqual([setback])
    const fixedLine = designConstraintMeasurements(position, project.panels)!.lines[0]
    expect(fixedLine.from[0]).toBe(0)
    expect(fixedLine.to[0]).toBe(-1300)
    const relativeLine = designConstraintMeasurements(setback, project.panels)!.lines[0]
    expect(relativeLine.to[2] - relativeLine.from[2]).toBeCloseTo(-90)
  })

  it.each([{ axis: 'q' }, { reference: 'front' }, { value: Infinity }, { value: -100001 }, { relation: 'minimum' }, { min: 0 }])('rejects malformed fixed references %j', fields => {
    expect(() => parseProject({ ...source(), constraints: [{ ...position, ...fields }] })).toThrow()
  })
  it.each([{ references: ['min'] }, { references: ['min', 'front'] }, { panelIds: ['a', 'a'] }, { value: -200001 }, { value: NaN }, { max: 1 }])('rejects malformed setbacks %j', fields => {
    expect(() => parseProject({ ...source(), constraints: [{ ...setback, ...fields }] })).toThrow()
  })

  for (const axis of ['x', 'y', 'z'] as const) it.each(['min', 'center', 'max'] as ConstraintReference[])(`holds the ${axis} %s reference during resizing and whole-project rescale`, reference => {
    const panel = createPanel({ id: 'a', width: 300, height: 500, position: [1000, 1000, 1000], rotation: axis === 'y' ? [0, 0, Math.PI / 2] : axis === 'z' ? [0, Math.PI / 2, 0] : [0, 0, 0] })
    const rule: DesignConstraint = { ...position, axis, reference, value: designConstraintCoordinate(panel, reference, axis) }
    const before: Project = { version: 1, name: 'Fixed edge', connections: [], panels: [panel, { ...panel, id: 'b', position: [4000, 4000, 4000] }], constraints: [rule] }
    const resized = resizePanels(before, ['a'], { width: 400 })
    expect(designConstraintCoordinate(resolvePanels(resized)[0], reference, axis)).toBeCloseTo(rule.value)
    const measurement = getRescaleValues(before).find(value => value.kind === 'dimension' && value.value === 300)!
    const rescaled = rescaleProject(before, { [measurement.id]: 400 })
    expect(designConstraintCoordinate(resolvePanels(rescaled)[0], reference, axis)).toBeCloseTo(rule.value)
    expect(before.panels[0].width).toBe(300)
  })

  it('reconciles signed setbacks against either anchor and propagates cut changes without recutting a loose peer', () => {
    const before = source()
    for (const anchor of ['a', 'b']) {
      const matched = setDesignConstraint(before, { ...setback, value: -50 }, anchor)
      expect(matched.panels.find(panel => panel.id === anchor)!.position).toEqual(before.panels.find(panel => panel.id === anchor)!.position)
      expect(measureDesignConstraint(matched.constraints![0], resolvePanels(matched)).violation).toBe(0)
      const next = resizePanels(matched, ['a'], { height: 400 })
      expect(measureDesignConstraint(next.constraints![0], resolvePanels(next)).violation).toBe(0)
      expect(next.panels[1].height).toBe(200)
      expect(next.panels[1].width).toBe(500)
    }
  })

  it('rejects a conflicting move atomically and ignores disabled reference rules', () => {
    const before = { ...source(), constraints: [position] }
    const snapshot = JSON.stringify(before)
    expect(() => movePanels(before, ['a'], [100, 0, 0])).toThrow()
    expect(JSON.stringify(before)).toBe(snapshot)
    const disabled = { ...before, constraints: [{ ...position, enabled: false }] }
    expect(movePanels(disabled, ['a'], [100, 0, 0]).panels[0].position[0]).toBe(-900)
  })

  it('holds the outside reference of a connected cabinet as a bay grows', () => {
    const before = gridProject('Two bays', [300, 300], [400])
    const left = resolvePanels(before).find(panel => panel.name === 'Upright 1.1')!
    const rule: DesignConstraint = { ...position, panelId: left.id, value: designConstraintCoordinate(left, 'min', 'x') }
    before.constraints = [rule]
    const shelf = before.panels.find(panel => panel.name === 'Shelf 1.1')!
    const next = resizePanels(before, [shelf.id], { width: 400 })
    expect(measureDesignConstraint(rule, resolvePanels(next)).violation).toBe(0)
    expect(validateProject(next)).toEqual([])
  })
})
