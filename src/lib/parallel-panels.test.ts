import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, getProjectBounds, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { parallelPanelCut, splitParallelPanels } from './parallel-panels'
import { gridProject } from './example-geometry'
import type { Project } from './types'

const shelves = (width = 900, height = 300): Project => ({ version: 1, name: 'Pair', connections: [], panels: [
  createPanel({ id: 'a', width, height, position: [0, 0, 0] }),
  createPanel({ id: 'b', width, height, position: [0, 0, 400] }),
] })

describe('split parallel panels', () => {
  it.each([[900, 300], [300, 900]])('splits along the long dimension (%s × %s) and fits two T joints', (width, height) => {
    const original = shelves(width, height), before = structuredClone(original)
    const result = splitParallelPanels(original, ['a', 'b'])
    expect(result.project.panels).toHaveLength(5)
    expect(result.connectors).toBe(4)
    expect(result.project.connections).toHaveLength(4)
    expect(result.project.connections.every(c => c.type === 't')).toBe(true)
    expect(validateProject(result.project)).toEqual([])
    expect(getProjectBounds(result.project.panels)).toEqual(getProjectBounds(original.panels))
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(original).toEqual(before)
  })
  it('preserves outer joints and unselected panels in the starter shelf', () => {
    const original = createStarterProject()
    const before = resolvePanels(original)
    const selected = before.filter(p => ['Top shelf', 'Middle shelf'].includes(p.name))
    expect(selected).toHaveLength(2)
    const result = splitParallelPanels(original, selected.map(p => p.id))
    expect(result.project.panels).toHaveLength(before.length + 3)
    for (const panel of before.filter(p => !selected.includes(p))) expect(resolvePanels(result.project).find(p => p.id === panel.id)).toEqual(panel)
    expect(validateProject(result.project).filter(i => i.severity === 'error')).toEqual([])
    expect(original.connections.every(c => result.project.connections.some(next => next.id === c.id))).toBe(true)
  })
  it('works after arbitrary world rotation and with rounded panels', () => {
    const original = shelves()
    original.panels.forEach(p => { p.cornerRadius = 30 })
    const rotated = rotateProject(rotateProject(original, 'y', 37), 'x', 24)
    const result = splitParallelPanels(rotated, ['b', 'a'])
    expect(validateProject(result.project)).toEqual([])
    expect(result.project.panels.filter(p => p.name !== 'Center divider').every(p => p.cornerRadius === 30)).toBe(true)
  })
  it('rejects incompatible selections and leaves the original intact', () => {
    expect(parallelPanelCut(shelves().panels.slice(0, 1))).toBeUndefined()
    const original = shelves()
    original.panels[1].position[0] = 100
    expect(() => splitParallelPanels(original, ['a', 'b'])).toThrow('aligned')
    original.panels[1].position[0] = 0
    original.panels[1].thickness = 16
    expect(() => splitParallelPanels(original, ['a', 'b'])).toThrow('18–19')
  })
  it('rejects a divider crossing an intermediate shelf', () => {
    const original = gridProject('Three levels', [900], [300, 300])
    const selected = original.panels.filter(p => p.name === 'Shelf 1.1' || p.name === 'Shelf 1.3')
    expect(() => splitParallelPanels(original, selected.map(p => p.id))).toThrow('overlaps')
  })
})
