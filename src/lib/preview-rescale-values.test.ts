import { describe, expect, it } from 'vitest'
import { createPanel } from './model'
import { rescaleProject } from './project-rescale'
import { getPreviewRescaleValues } from './preview-rescale-values'
import type { Project } from './types'

function project(): Project {
  return { version: 1, name: 'Repeated cuts', connections: [], panels: [100, 200, 300, 400, 500, 600].map((size, i) =>
    createPanel({ width: size, height: size, position: [i * 1500, 500, 0] })) }
}

describe('changeable preview dimensions', () => {
  it('omits locked values before selecting four and leaves the source untouched', () => {
    const source = project()
    source.constraints = [{ id: 'lock', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', value: 100 }]
    const before = structuredClone(source)
    expect(getPreviewRescaleValues(source).map(value => value.value)).toEqual([200, 300, 400, 500])
    expect(source).toEqual(before)
  })
  it('keeps a value that can change in only one direction', () => {
    const source = project()
    source.constraints = [{ id: 'limit', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', relation: 'range', min: 90, max: 100 }]
    expect(getPreviewRescaleValues(source).map(value => value.value)).toContain(100)
  })
  it('uses the configured step when deciding whether a value can change', () => {
    const source = project()
    source.constraints = [{ id: 'limit', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', relation: 'range', min: 95, max: 105 }]
    source.niceValues = { enabled: true, step: 10 }
    expect(getPreviewRescaleValues(source).map(value => value.value)).not.toContain(100)
    source.niceValues.enabled = false
    expect(getPreviewRescaleValues(source).map(value => value.value)).toContain(100)
  })
})

it('uses a local half-to-double range for free dimensions', () => {
  const source = project()
  expect(getPreviewRescaleValues(source).find(value => value.value === 300)).toMatchObject({ min: 150, max: 600 })
})

it('trims both endpoints to valid configured steps using the solver', () => {
  const source = project()
  source.niceValues = { enabled: true, step: 5 }
  source.constraints = [{ id: 'range', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', relation: 'range', min: 82, max: 118 }]
  expect(getPreviewRescaleValues(source).find(value => value.value === 100)).toMatchObject({ min: 85, max: 115 })
})

it('preserves a one-sided range at an exact limit', () => {
  const source = project()
  source.constraints = [{ id: 'range', kind: 'dimension', enabled: true, panelId: source.panels[0].id, dimension: 'width', relation: 'range', min: 90, max: 100 }]
  expect(getPreviewRescaleValues(source).find(value => value.value === 100)).toMatchObject({ min: 90, max: 100 })
})


it('narrows a range when expansion would collide with neighboring stock', () => {
  const source: Project = { version: 1, name: 'Neighbor clearance', connections: [], panels: [0, 700].map(x =>
    createPanel({ width: 600, height: 400, position: [x, 500, 0] })) }
  const range = getPreviewRescaleValues(source).find(value => value.value === 600)!
  expect(range.max).toBeGreaterThan(600)
  expect(range.max).toBeLessThan(1200)
  expect(() => rescaleProject(source, { [range.id]: range.max })).not.toThrow()
  expect(() => rescaleProject(source, { [range.id]: range.max + 1 })).toThrow()
})
