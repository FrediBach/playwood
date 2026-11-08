import { describe, expect, it } from 'vitest'
import { equalOpeningSelection } from './equal-opening-selection'
import { setDesignConstraint } from './design-constraint-commands'
import { gridProject } from './example-geometry'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { openingMeasurements } from './design-constraints'
import { resizePanels } from './structure-edit'
import { roundTripProject } from '../test/project-round-trip'

const grid = () => gridProject('Grid', [300, 450], [250, 350])

describe('equal compartment openings', () => {
  it.each(['x', 'y'] as const)('infers %s boundaries in geometric order, ignoring unrelated panels', axis => {
    const project = grid()
    const names = axis === 'x' ? ['Upright 3.1', 'Upright 1.1', 'Upright 2.1'] : ['Shelf 1.3', 'Shelf 1.1', 'Shelf 1.2']
    const ids = names.map(name => project.panels.find(panel => panel.name === name)!.id)
    const rule = equalOpeningSelection(project.panels, ids, 'test')!
    expect(rule).toMatchObject({ id: 'test', axis, ratio: 1, panelIds: [ids[1], ids[2], ids[2], ids[0]] })
    const matched = setDesignConstraint(project, rule, rule.panelIds[0])
    const gaps = openingMeasurements(rule, resolvePanels(matched))
    expect(gaps[0]).toBeCloseTo(gaps[1], 4)
    expect(validateProject(matched)).toEqual([])
  })

  it('does not infer gaps from mixed faces, unrelated bays, or non-cardinal rotation', () => {
    const project = grid()
    expect(equalOpeningSelection(project.panels, project.panels.slice(0, 3).map(panel => panel.id))).toBeNull()
    const names = ['Shelf 1.1', 'Shelf 2.2', 'Shelf 1.3']
    expect(equalOpeningSelection(project.panels, names.map(name => project.panels.find(panel => panel.name === name)!.id))).toBeNull()
    const rotated = rotateProject(project, 'z', 15)
    const ids = ['Upright 1.1', 'Upright 2.1', 'Upright 3.1'].map(name => rotated.panels.find(panel => panel.name === name)!.id)
    expect(equalOpeningSelection(rotated.panels, ids)).toBeNull()
  })

  it('retains the existing world-axis rule guard for rotations', () => {
    const project = synthStorageShelfProject()
    const snapshot = structuredClone(project)
    expect(() => rotateProject(project, 'y', 37)).toThrow()
    expect(project).toEqual(snapshot)
  })

  it.each([['Storage shelf 1.1', 500], ['Storage upright 1.1', 360]] as const)('keeps all four library cells equal after resizing %s', (name, width) => {
    const source = synthStorageShelfProject()
    const snapshot = structuredClone(source)
    expect(source.constraints).toHaveLength(6)
    const panel = source.panels.find(panel => panel.name === name)!
    const next = resizePanels(source, [panel.id], { width })
    expect(next.panels.find(item => item.id === panel.id)!.width).toBeCloseTo(width)
    const measures = next.constraints!.map(rule => {
      if (rule.kind !== 'opening-ratio') throw new Error('Expected opening rule')
      const gaps = openingMeasurements(rule, resolvePanels(next))
      expect(gaps[0]).toBeCloseTo(gaps[1], 4)
      return gaps[0]
    })
    expect(measures[0]).toBeCloseTo(measures[1], 4)
    expect(measures[2]).toBeCloseTo(measures[3], 4)
    expect(validateProject(next)).toEqual([])
    expect(roundTripProject(next)).toEqual(next)
    expect(source).toEqual(snapshot)
    expect(getProjectBounds(resolvePanels(next)).height).toBeGreaterThan(0)
  })
})
