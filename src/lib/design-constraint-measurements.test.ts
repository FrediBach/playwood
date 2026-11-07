import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createPanel } from './model'
import { designConstraintMeasurements } from './design-constraint-measurements'
import type { DesignConstraint } from './types'

const lower = createPanel({ id: 'lower', width: 600, height: 300, thickness: 18, position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0] })
const upper = createPanel({ ...lower, id: 'upper', position: [0, 900, 0] })

describe('design constraint measurement geometry', () => {
  it('measures the stock surface from the floor in millimeters', () => {
    const result = designConstraintMeasurements({ id: 'floor', kind: 'floor', enabled: true, panelId: lower.id, reference: 'max', value: 609 }, [lower])!
    expect(result.violation).toBe(0)
    expect(result.lines[0].from[1]).toBe(0)
    expect(result.lines[0].to[1]).toBeCloseTo(609)
    expect(result.lines[0].label).toBe('Floor height · 609 mm')
  })

  it('keeps a rotated cut measurement parallel to its local dimension', () => {
    const panel = createPanel({ ...lower, rotation: [0, 0, Math.PI / 2] })
    const result = designConstraintMeasurements({ id: 'cut', kind: 'dimension', enabled: true, panelId: panel.id, dimension: 'width', value: 600 }, [panel])!
    const line = result.lines[0]
    const direction = new Vector3(...line.to).sub(new Vector3(...line.from))
    expect(direction.length()).toBeCloseTo(600)
    expect(direction.x).toBeCloseTo(0)
    expect(direction.y).toBeCloseTo(600)
    expect(line.id).toBe(panel.id)
  })

  it('retains panel identities when the order of equal-dimension references changes', () => {
    const rule: DesignConstraint = { id: 'equal', kind: 'equal-dimension', enabled: true, panelIds: [lower.id, upper.id], dimension: 'width' }
    const before = designConstraintMeasurements(rule, [lower, upper])!
    const after = designConstraintMeasurements({ ...rule, panelIds: [upper.id, lower.id] }, [lower, upper])!
    expect(after.lines).toEqual([...before.lines].reverse())
    expect(new Set(after.lines.map(line => line.id)).size).toBe(2)
  })

  it('draws each matched cut on its own local axis', () => {
    const result = designConstraintMeasurements({ id: 'cross', kind: 'equal-dimension', enabled: true, panelIds: [lower.id, upper.id], dimension: 'width', secondDimension: 'height' }, [lower, upper])!
    const directions = result.lines.map(line => new Vector3(...line.to).sub(new Vector3(...line.from)))
    expect(directions[0].length()).toBeCloseTo(600)
    expect(directions[1].length()).toBeCloseTo(300)
    expect(directions[0].dot(directions[1])).toBeCloseTo(0)
  })

  it('measures a gap between stock boundaries, excluding thickness', () => {
    const result = designConstraintMeasurements({ id: 'gap', kind: 'gap', enabled: true, panelIds: [lower.id, upper.id], axis: 'y', relation: 'exact', value: 282 }, [lower, upper])!
    const line = result.lines[0]
    expect(result.violation).toBe(0)
    expect(line.to[1] - line.from[1]).toBeCloseTo(282)
    expect(line.leaders).toHaveLength(2)
    expect(line.label).toBe('Y gap · 282 mm')
  })

  it('distinguishes a level difference from aligned surfaces', () => {
    const rule: DesignConstraint = { id: 'level', kind: 'level', enabled: true, panelIds: [lower.id, upper.id], references: ['max', 'max'] }
    const different = designConstraintMeasurements(rule, [lower, upper])!
    expect(different.violation).toBeCloseTo(300)
    expect(different.lines[0].label).toBe('Level difference · 300 mm')
    const aligned = designConstraintMeasurements(rule, [lower, { ...upper, position: [...lower.position] }])!
    expect(aligned.violation).toBe(0)
    expect(aligned.lines[0].label).toBe('Same level · 609 mm')
  })

  it('omits measurements with missing panels or unsupported orientations', () => {
    const rule: DesignConstraint = { id: 'floor', kind: 'floor', enabled: true, panelId: lower.id, reference: 'max', value: 609 }
    expect(designConstraintMeasurements(rule, [])).toBeNull()
    expect(designConstraintMeasurements(rule, [{ ...lower, rotation: [0, 0, Math.PI / 4] }])).toBeNull()
  })
})
