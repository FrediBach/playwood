import { expect, it } from 'vitest'
import { solveCuboidCompartments } from './object-compartments'
import { getPhysicalConnectors } from './connector-selection'
import type { ObjectBounds } from './object-geometry'
it.each([0, 1, 2])('fits one shared wall along axis %s', axis => {
  const a: ObjectBounds = { min: [0, 0, 0], max: [600, 600, 400] }
  const b = structuredClone(a); b.min[axis] = a.max[axis]; b.max[axis] += a.max[axis]
  const project = solveCuboidCompartments([a, b], axis, 18)
  expect(project.panels).toHaveLength(11)
  expect(getPhysicalConnectors(project).filter(p => p.type === 't')).toHaveLength(8)
  expect(getPhysicalConnectors(project)).toHaveLength(40)
})

import { convertConstructionObject, type ObjectConversionOptions } from './object-conversion'
import { createStarterProject, getProjectBounds, resolvePanels, validateProject, parseProject, removePanel } from './model'
import type { ConstructionObject, Project } from './types'
const options: ObjectConversionOptions = { thickness: 18, material: 'oak', color: '#123456', finishCoverage: .5, connectorColor: '#654321', connectorMaterial: 'plastic' }
function sources(positions: number[]): Project {
  const nodes: ConstructionObject[] = positions.map((x, i) => ({ id: `box-${i}`, name: `Box ${i}`, kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [x, 300, 0], rotation: [0, 0, 0] }))
  return { ...createStarterProject('blank'), constructionObjects: { roots: nodes.map(n => n.id), nodes } }
}
it('converts separated roots atomically, hides only selected roots, and preserves each shell', () => {
  const source = sources([0, 1200, 3000]), before = structuredClone(source)
  const result = convertConstructionObject(source, ['box-0', 'box-1'], options)
  expect(result.project.panels).toHaveLength(12)
  expect(result.hardwareCount).toBe(48)
  expect(result.sharedWalls).toBe(0)
  expect(result.dimensions).toEqual([1800, 600, 400])
  expect(result.compartments.map(c => c.clearDimensions)).toEqual([[564, 564, 364], [564, 564, 364]])
  expect(result.project.constructionObjects!.nodes.map(n => n.visible)).toEqual([false, false, true])
  expect(parseProject(JSON.parse(JSON.stringify(result.project))).panels).toHaveLength(12)
  expect(source).toEqual(before)
})
it.each([18, 19])('retains a single divider with %s mm stock, unlike a union shell', thickness => {
  const source = sources([0, 600]), before = structuredClone(source)
  const result = convertConstructionObject(source, ['box-1', 'box-0'], { ...options, thickness })
  expect(result.sharedWalls).toBe(1)
  expect(result.project.panels).toHaveLength(11)
  expect(result.hardwareCount).toBe(40)
  expect(result.compartments.every(c => c.sharedWall && c.clearDimensions![0] === 600 - thickness * 1.5)).toBe(true)
  const divider = result.project.panels.find(p => p.name.includes('Shared divider'))!
  expect(divider.position[0]).toBe(300)
  expect(divider.thickness).toBe(thickness)
  expect(validateProject(result.project)).toEqual([])
  const bounds = getProjectBounds(resolvePanels(result.project))
  expect(bounds.width).toBeCloseTo(1200)
  expect(bounds.min[0]).toBeCloseTo(-300)
  expect(source).toEqual(before)
})
it.each([
  { positions: [0, 300], reason: /overlap/ },
])('rejects unsupported root relationships atomically: $positions', ({ positions, reason }) => {
  const source = sources(positions), before = structuredClone(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(reason)
  expect(source).toEqual(before)
})
it('rejects unsupported partial faces and thin stock at shared walls', () => {
  const source = sources([0, 600])
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, { ...options, thickness: 16 })).toThrow(/18–19/)
  const other = source.constructionObjects!.nodes[1]
  if (other.kind !== 'box') throw new Error('Expected box')
  other.height = 500
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/matching full/)
})
it('does not accept the valid first root if a later root cannot be built', () => {
  const source = sources([0, 1200]), other = source.constructionObjects!.nodes[1]
  if (other.kind !== 'box') throw new Error('Expected box')
  other.width = 50
  const before = structuredClone(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/cuts/)
  expect(source).toEqual(before)
})
it('normalizes T hardware to plastic and preserves metal right-angle hardware on reload', () => {
  const source = sources([0, 600])
  const result = convertConstructionObject(source, source.constructionObjects!.roots, { ...options, connectorMaterial: 'metal' })
  expect(result.project.connections.filter(c => c.type === 't').every(c => c.material === 'plastic')).toBe(true)
  expect(result.project.connections.filter(c => c.type === '90').every(c => c.material === 'metal')).toBe(true)
  expect(parseProject(JSON.parse(JSON.stringify(result.project))).connections).toEqual(result.project.connections)
})

it.each([0, 1, 2])('fits an unequal three-compartment row along axis %s with two complete dividers', axis => {
  const lengths = [400, 600, 800], bounds: ObjectBounds[] = []
  let start = -500
  for (const length of lengths) {
    const min: [number, number, number] = [-300, 0, -200], max: [number, number, number] = [300, 600, 200]
    min[axis] = start; max[axis] = start + length; start += length; bounds.push({ min, max })
  }
  const project = solveCuboidCompartments([bounds[2], bounds[0], bounds[1]], axis, 18)
  expect(project.panels).toHaveLength(16)
  expect(project.connections).toHaveLength(36)
  expect(getPhysicalConnectors(project)).toHaveLength(56)
  expect(getPhysicalConnectors(project).filter(p => p.type === 't')).toHaveLength(16)
  expect(project.panels.filter(p => p.name === 'Shared divider').map(p => p.position[axis]).sort((a, b) => a - b)).toEqual([-100, 500])
  expect(validateProject(project)).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(project))).panels).toHaveLength(16)
})
it.each([18, 19])('reports the different clear dimensions of middle and end compartments at %s mm', thickness => {
  const source = sources([0, 600, 1200, 3000]), before = structuredClone(source)
  const result = convertConstructionObject(source, ['box-2', 'box-0', 'box-1', 'box-3'], { ...options, thickness })
  expect(result.sharedWalls).toBe(2)
  expect(result.panelIds).toHaveLength(22)
  expect(result.hardwareCount).toBe(80)
  expect(result.compartments.map(c => c.clearDimensions![0])).toEqual([600 - thickness * 1.5, 600 - thickness, 600 - thickness * 1.5, 600 - thickness * 2])
  expect(source).toEqual(before)
})
it('rejects gaps, invalid axes, and oversized rows before solving', () => {
  const a: ObjectBounds = { min: [0, 0, 0], max: [600, 600, 400] }
  const b: ObjectBounds = { min: [700, 0, 0], max: [1300, 600, 400] }
  expect(() => solveCuboidCompartments([a, b], 0, 18)).toThrow(/matching full/)
  expect(() => solveCuboidCompartments([a, b], 3, 18)).toThrow(/straight row/)
  expect(() => solveCuboidCompartments(Array.from({ length: 34 }, () => a), 0, 18)).toThrow(/400 connections/)
})

it('matches reported middle clearance to the actual divider faces and allows divider removal', () => {
  const source = sources([0, 600, 1200])
  const result = convertConstructionObject(source, source.constructionObjects!.roots, options)
  const dividers = result.project.panels.filter(p => p.name.includes('Shared divider')).sort((a, b) => a.position[0] - b.position[0])
  const left = getProjectBounds([dividers[0]]), right = getProjectBounds([dividers[1]])
  expect(result.compartments[1].clearDimensions![0]).toBeCloseTo(right.min[0] - left.max[0], 8)
  const opened = removePanel(result.project, dividers[0].id)
  expect(opened.panels).toHaveLength(15)
  expect(validateProject(opened)).toEqual([])
  expect(opened.constructionObjects).toEqual(result.project.constructionObjects)
})
it('rejects turning compartment groups without modifying the sources', () => {
  const source = sources([0, 600, 1200]), last = source.constructionObjects!.nodes[2]
  if (last.kind !== 'box') throw new Error('Expected box')
  last.position = [600, 900, 0]
  const before = structuredClone(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/matching full|straight row/)
  expect(source).toEqual(before)
})
