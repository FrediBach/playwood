import { expect, it } from 'vitest'
import { createPanel } from './model'
import { differingPanelDimension, equalizePanelSizes } from './equal-panel-sizes'
import type { Project } from './types'

const panels = [500, 510, 520].map((width, i) => createPanel({ id: `p${i}`, width, height: 300, position: [i*1000, 500, 0] }))
const project: Project = { version: 1, name: 'Sizes', panels, connections: [] }
it('requires exactly one differing dimension and at least two panels', () => {
  expect(differingPanelDimension([])).toBeNull()
  expect(differingPanelDimension([panels[0]])).toBeNull()
  expect(differingPanelDimension([panels[0], panels[0]])).toBeNull()
  expect(differingPanelDimension(panels)).toBe('width')
  expect(differingPanelDimension([panels[0], {...panels[1], height: 310}])).toBeNull()
  expect(differingPanelDimension([panels[0], {...panels[0], thickness: 19}])).toBe('thickness')
})
it('sets all selected cuts to an existing value without mutating the source', () => {
  const next = equalizePanelSizes(project, panels.map(p => p.id), 510)
  expect(next.panels.map(p => p.width)).toEqual([510,510,510])
  expect(project.panels.map(p => p.width)).toEqual([500,510,520])
  expect(next.panels.map(p => p.id)).toEqual(panels.map(p => p.id))
  expect(equalizePanelSizes(project, panels.map(p => p.id), 515.25).panels.map(p => p.width)).toEqual([515.25,515.25,515.25])
  for (const value of [NaN, Infinity, 0, 4001]) expect(() => equalizePanelSizes(project, ['p0', 'p1'], value)).toThrow()
  expect(() => equalizePanelSizes(project, ['p0', 'missing'], 500)).toThrow('no longer exists')
})
it('deduplicates a reordered selection and leaves unselected cuts unchanged', () => {
  const next = equalizePanelSizes(project, ['p2', 'p0', 'p2'], 515)
  expect(next.panels.map(panel => [panel.id, panel.width])).toEqual([
    ['p0', 515], ['p1', 510], ['p2', 515],
  ])
  expect(project.panels.map(panel => panel.width)).toEqual([500, 510, 520])
})
