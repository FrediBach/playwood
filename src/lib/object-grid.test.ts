import { expect, it } from 'vitest'
import { cuboidGridLayout, solveCuboidGrid } from './object-grid'
import type { ObjectBounds } from './object-geometry'
import { createStarterProject, getProjectBounds, parseProject, removePanel, resolvePanels, validateProject } from './model'
import { getPhysicalConnectors } from './connector-selection'

it('fits a complete two by two grid', () => {
  const bounds: ObjectBounds[] = [0, 600].flatMap(x => [0, 600].map(y => ({ min: [x, y, 0], max: [x + 600, y + 600, 400] })))
  const project = solveCuboidGrid(bounds, 18)
  expect(project.connections).toHaveLength(47)
  expect(getPhysicalConnectors(project)).toHaveLength(74)
  expect(project.panels).toHaveLength(20)
  expect(validateProject(project)).toEqual([])
  expect(getPhysicalConnectors(project).some(p => p.type === 'cross')).toBe(true)
})

function grid(depthAxis: number, widths = [400, 600, 800], heights = [500, 700]): ObjectBounds[] {
  const u = (depthAxis + 1) % 3, v = (depthAxis + 2) % 3, bounds: ObjectBounds[] = []
  let x = 0
  for (const width of widths) {
    let y = 0
    for (const height of heights) {
      const min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [0, 0, 0]
      min[u] = x; min[v] = y; max[u] = x + width; max[v] = y + height; max[depthAxis] = 400
      bounds.push({ min, max }); y += height
    }
    x += width
  }
  return bounds
}
it.each([0, 1, 2])('fits unequal rows and columns with depth on axis %s', axis => {
  const bounds = grid(axis).reverse(), before = structuredClone(bounds)
  const project = solveCuboidGrid(bounds, 18)
  expect(project.panels).toHaveLength(29)
  expect(project.connections).toHaveLength(70)
  expect(getPhysicalConnectors(project).filter(piece => piece.type === 'cross')).toHaveLength(4)
  expect(validateProject(project)).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(project))).panels).toHaveLength(29)
  const actual = getProjectBounds(resolvePanels(project))
  for (let i = 0; i < 3; i++) {
    expect(actual.min[i]).toBeCloseTo(0, 6)
    expect(actual.max[i]).toBeCloseTo(Math.max(...bounds.map(b => b.max[i])), 6)
  }
  expect(bounds).toEqual(before)
})
import { convertConstructionObject } from './object-conversion'
import type { ConstructionObject, Project } from './types'
const options = { rectangularOnly: true, thickness: 19, material: 'oak' as const, color: '#123456', finishCoverage: .5, connectorColor: '#654321', connectorMaterial: 'metal' as const }
function sources(bounds: ObjectBounds[]): Project {
  const nodes: ConstructionObject[] = bounds.map((b, i) => ({ id: `box-${i}`, name: `Box ${i}`, kind: 'box', visible: true,
    width: b.max[0] - b.min[0], height: b.max[1] - b.min[1], depth: b.max[2] - b.min[2], position: b.min.map((value, axis) => (value + b.max[axis]) / 2) as [number, number, number], rotation: [0, 0, 0] }))
  return { ...createStarterProject('blank'), constructionObjects: { roots: nodes.map(n => n.id), nodes } }
}
it('converts a three by three grid atomically with correct middle clearance and removable dividers', () => {
  const source = sources(grid(2, [600, 600, 600], [600, 600, 600])), before = structuredClone(source)
  const result = convertConstructionObject(source, [...source.constructionObjects!.roots].reverse(), options)
  expect(result.sharedWalls).toBe(12)
  expect(result.panelIds).toHaveLength(42)
  expect(result.project.panels.every(p => !p.customOutline?.length)).toBe(true)
  expect(result.compartments.find(c => c.name === 'Box 4')!.clearDimensions).toEqual([581, 581, 362])
  expect(result.compartments.find(c => c.name === 'Box 0')!.clearDimensions).toEqual([571.5, 571.5, 362])
  expect(result.project.constructionObjects!.nodes.every(n => !n.visible)).toBe(true)
  expect(getPhysicalConnectors(result.project).filter(p => p.type === 'cross' || p.type === 't').every(p => p.material === 'plastic')).toBe(true)
  const divider = result.project.panels.find(p => p.name.includes('Shared divider'))!
  expect(validateProject(removePanel(result.project, divider.id))).toEqual([])
  expect(source).toEqual(before)
})
it('rejects incomplete grids, partial faces, three-dimensional arrays, and incompatible thickness', () => {
  const bounds = grid(2, [600, 600], [600, 600])
  expect(() => cuboidGridLayout(bounds.slice(1))).toThrow(/complete rectangular/)
  const partial = structuredClone(bounds); partial[0].max[0] -= 50
  expect(() => cuboidGridLayout(partial)).toThrow(/grid|faces/)
  expect(() => cuboidGridLayout([...bounds, ...bounds.map(b => ({ min: [b.min[0], b.min[1], 400] as [number, number, number], max: [b.max[0], b.max[1], 800] as [number, number, number] }))])).toThrow(/complete rectangular/)
  expect(() => solveCuboidGrid(grid(2, Array(6).fill(600), Array(6).fill(600)), 18)).toThrow(/400 connections/)
  expect(() => solveCuboidGrid(bounds, 16)).toThrow(/18–19/)
})
it('rejects a late narrow cell without changing the selected sources', () => {
  const source = sources(grid(2, [600, 50], [600, 600])), before = structuredClone(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/cuts/)
  expect(source).toEqual(before)
})
