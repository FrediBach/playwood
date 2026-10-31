import { describe, expect, it } from 'vitest'
import { gridProject } from './example-geometry'
import { createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { gridPanelCut, splitPanelGrid } from './grid-split'

describe('grid split', () => {
  it.each([[1, 1], [2, 1], [2, 2], [0, 2], [2, 0]])('divides an opening with %s × %s dividers', (x, y) => {
    const original = gridProject('Opening', [900], [600])
    const before = structuredClone(original)
    const result = splitPanelGrid(original, original.panels.map(panel => panel.id), x, y)
    expect(result.project.panels).toHaveLength(4 + 3 * (x + y) + 2 * x * y)
    expect(validateProject(result.project)).toEqual([])
    const bounds = getProjectBounds(resolvePanels(result.project)), originalBounds = getProjectBounds(resolvePanels(original))
    for (const axis of ['width', 'height', 'depth'] as const) expect(bounds[axis]).toBeCloseTo(originalBounds[axis], 6)
    expect(original.connections.every(c => result.project.connections.some(next => next.id === c.id))).toBe(true)
    expect(original).toEqual(before)
  })
  it('recognizes and divides a rotated opening', () => {
    const original = rotateProject(rotateProject(gridProject('Opening', [900], [600]), 'y', 23), 'x', 17)
    expect(gridPanelCut(resolvePanels(original))).toBeDefined()
    const result = splitPanelGrid(original, original.panels.map(panel => panel.id).reverse(), 1, 1)
    expect(validateProject(result.project)).toEqual([])
  })
})

it('keeps every grid cell equally sized, including when depth is the longest dimension', () => {
  const original = gridProject('Deep opening', [300], [240], { depth: 600 })
  const result = splitPanelGrid(original, original.panels.map(panel => panel.id), 2, 1)
  const panels = resolvePanels(result.project)
  const horizontal = panels.filter(panel => panel.name.startsWith('Shelf') || panel.name.startsWith('Horizontal'))
  const vertical = panels.filter(panel => panel.name.startsWith('Upright') || panel.name.startsWith('Vertical'))
  for (const panel of horizontal) expect(panel.width).toBeCloseTo((300 - 2 * 35) / 3)
  for (const panel of vertical) expect(panel.width).toBeCloseTo((240 - 35) / 2)
  expect(panels.every(panel => panel.height === 600)).toBe(true)
  expect(validateProject(result.project)).toEqual([])
})

it('rejects invalid counts, tight spacing, and incompatible selections without mutation', () => {
  const original = gridProject('Opening', [200], [200])
  const before = structuredClone(original), ids = original.panels.map(panel => panel.id)
  expect(gridPanelCut(resolvePanels(original).slice(0, 3))).toBeUndefined()
  for (const [x, y] of [[0, 0], [-1, 1], [1.5, 1], [NaN, 1], [Infinity, 1], [3, 1]]) {
    expect(() => splitPanelGrid(original, ids, x, y)).toThrow()
  }
  expect(original).toEqual(before)
  original.panels[0].thickness = 16
  expect(() => splitPanelGrid(original, ids, 1, 1)).toThrow('18–19')
})

it('rejects obstructions and oversized grids', () => {
  const original = gridProject('Opening', [900], [600])
  const ids = original.panels.map(panel => panel.id)
  // A second shelf physically occupies the proposed vertical dividers.
  original.panels.push({ ...resolvePanels(original)[0], id: 'obstruction', position: [0, 200, 0] })
  const before = structuredClone(original)
  expect(() => splitPanelGrid(original, ids, 1, 1)).toThrow()
  expect(original).toEqual(before)
  const large = gridProject('Large opening', [3900], [3900])
  expect(() => splitPanelGrid(large, large.panels.map(panel => panel.id), 20, 20)).toThrow('limit')
})


it('preserves neighboring compartments when dividing a starter shelf opening', () => {
  const original = createStarterProject()
  const world = resolvePanels(original)
  const selected = world.filter(panel => ['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side'].includes(panel.name))
  expect(selected).toHaveLength(4)
  const ids = selected.map(panel => panel.id)
  const result = splitPanelGrid(original, ids, 2, 1)
  const after = resolvePanels(result.project)
  for (const panel of world.filter(panel => !ids.includes(panel.id))) {
    const next = after.find(next => next.id === panel.id)!
    expect(next.width).toBe(panel.width)
    expect(next.height).toBe(panel.height)
    for (let axis = 0; axis < 3; axis++) expect(next.position[axis]).toBeCloseTo(panel.position[axis], 6)
  }
  expect(validateProject(result.project)).toEqual([])
  expect(original.connections.every(connection => result.project.connections.some(next => next.id === connection.id))).toBe(true)
})
