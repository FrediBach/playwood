import { roundTripProject } from '../test/project-round-trip'
import { convertConstructionObject } from './object-conversion'
import { outlineWorldPoints } from './outline-closures'
import { describe, expect, it } from 'vitest'
import { evaluateConstructionObjects, rotateConstructionSelection } from './object-geometry'
import { solveObjectPrism } from './object-prism-solver'
import { getProjectBounds, resolvePanels, validateProject, createStarterProject, removePanel } from './model'
import { getPhysicalConnectors } from './connector-selection'
import type { ConstructionObjects } from './types'
const shape: ConstructionObjects = { roots: ['l'], nodes: [
  { id: 'a', name: 'Wide', kind: 'box', visible: true, width: 600, height: 250, depth: 400, position: [300, 125, 0], rotation: [0, 0, 0] },
  { id: 'b', name: 'Tall', kind: 'box', visible: true, width: 250, height: 600, depth: 400, position: [125, 300, 0], rotation: [0, 0, 0] },
  { id: 'l', name: 'L', kind: 'boolean', visible: true, operation: 'union', children: ['a', 'b'] },
] }
describe('L prism conversion', () => {
  it.each([16, 18, 19])('fits a complete shell at %s mm stock preserving the outside envelope', thickness => {
    const evaluated = evaluateConstructionObjects(shape)[0]
    expect(evaluated.prism).toBeDefined()
    const project = solveObjectPrism(evaluated.prism!, thickness)
    expect(project.panels).toHaveLength(8)
    expect(project.connections).toHaveLength(18)
    expect(getPhysicalConnectors(project)).toHaveLength(36)
    expect(validateProject(project)).toEqual([])
    const bounds = getProjectBounds(resolvePanels(project))
    bounds.min.forEach((v, i) => expect(v).toBeCloseTo(evaluated.bounds!.min[i], 5))
    bounds.max.forEach((v, i) => expect(v).toBeCloseTo(evaluated.bounds!.max[i], 5))
  })
})

it.each([0, 1, 2] as const)('converts rotated L shapes about axis %s and retains the complete source tree', axis => {
  const objects = rotateConstructionSelection(shape, ['l'], axis)
  const source = { ...createStarterProject('blank'), constructionObjects: objects }, before = structuredClone(source)
  const result = convertConstructionObject(source, ['l'], { thickness: 18, material: 'birch', color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' })
  expect(result.panelIds).toHaveLength(8)
  const closures = result.project.panels.filter(p => p.customOutline)
  expect(closures).toHaveLength(2)
  closures.forEach(p => expect(outlineWorldPoints(p)).toHaveLength(6))
  const opened = removePanel(result.project, closures[0].id)
  expect(opened.panels).toHaveLength(7)
  expect(validateProject(opened)).toEqual([])
  expect(roundTripProject(opened).constructionObjects!.nodes).toEqual(JSON.parse(JSON.stringify(objects.nodes.map(n => n.id === 'l' ? { ...n, visible: false } : n))))
  expect(source).toEqual(before)
})
it('recognizes a mirrored corner subtraction and rejects an infeasibly narrow arm', () => {
  const objects = structuredClone(shape)
  const a = objects.nodes[0], b = objects.nodes[1], root = objects.nodes[2]
  if (a.kind !== 'box' || b.kind !== 'box' || root.kind !== 'boolean') throw new Error('Expected L tree')
  a.width = a.height = 600; a.position = [300, 300, 0]
  b.width = b.height = 350; b.position = [175, 175, 0]; root.operation = 'subtract'
  const prism = evaluateConstructionObjects(objects)[0].prism!
  expect(solveObjectPrism(prism, 18).panels).toHaveLength(8)
  b.width = b.height = 580; b.position = [290, 290, 0]
  expect(() => solveObjectPrism(evaluateConstructionObjects(objects)[0].prism!, 18)).toThrow()
})
it('rejects a profile that changes along the extrusion instead of flattening it', () => {
  const objects = structuredClone(shape), b = objects.nodes[1]
  if (b.kind !== 'box') throw new Error('Expected box')
  b.depth = 300
  expect(evaluateConstructionObjects(objects)[0].prism).toBeUndefined()
})

function profile(kind: 'u' | 'steps'): ConstructionObjects {
  const boxes = kind === 'u' ? [
    { width: 900, height: 250, position: [450, 125, 0] },
    { width: 250, height: 850, position: [125, 425, 0] },
    { width: 250, height: 850, position: [775, 425, 0] },
  ] : [
    { width: 900, height: 250, position: [450, 125, 0] },
    { width: 600, height: 550, position: [300, 275, 0] },
    { width: 300, height: 850, position: [150, 425, 0] },
  ]
  return { roots: ['result'], nodes: [
    ...boxes.map((box, i) => ({ ...box, id: `box-${i}`, name: `Box ${i}`, kind: 'box' as const, visible: true, depth: 400, rotation: [0, 0, 0] as [number, number, number], position: box.position as [number, number, number] })),
    { id: 'result', name: kind, kind: 'boolean', visible: true, operation: 'union', children: boxes.map((_, i) => `box-${i}`) },
  ] }
}
describe.each(['u', 'steps'] as const)('%s profile conversion', kind => {
  it.each([16, 18, 19])('fits every joint at %s mm stock and retains the concave closing faces', thickness => {
    const objects = profile(kind), evaluated = evaluateConstructionObjects(objects)[0]
    expect(evaluated.prism?.outline).toHaveLength(8)
    const result = convertConstructionObject({ ...createStarterProject('blank'), constructionObjects: objects }, ['result'], { thickness, material: 'birch', color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' })
    expect(result.panelIds).toHaveLength(10)
    expect(result.project.connections).toHaveLength(24)
    expect(result.hardwareCount).toBe(48)
    expect(result.project.panels.filter(p => p.customOutline?.length === 8)).toHaveLength(2)
    expect(validateProject(result.project)).toEqual([])
    expect(result.dimensions).toEqual([900, 850, 400])
  })
  it.each([0, 1, 2] as const)('supports rotation around axis %s and removing a closing face', axis => {
    const objects = rotateConstructionSelection(profile(kind), ['result'], axis), evaluated = evaluateConstructionObjects(objects)[0]
    const project = solveObjectPrism(evaluated.prism!, 18)
    const bounds = getProjectBounds(resolvePanels(project))
    bounds.min.forEach((v, i) => expect(v).toBeCloseTo(evaluated.bounds!.min[i], 5))
    bounds.max.forEach((v, i) => expect(v).toBeCloseTo(evaluated.bounds!.max[i], 5))
    const closure = project.panels.find(p => p.customOutline)!
    const opened = removePanel(project, closure.id)
    expect(opened.panels).toHaveLength(9)
    expect(validateProject(opened)).toEqual([])
  })
})

it('accepts the twelve-edge limit and rejects more complex profiles before solving', () => {
  const stairs = (count: number): ConstructionObjects => ({ roots: ['stairs'], nodes: [
    ...Array.from({ length: count }, (_, i) => ({ id: `step-${i}`, name: 'Step', kind: 'box' as const, visible: true, width: (count - i) * 300, height: (i + 1) * 300, depth: 400,
      position: [(count - i) * 150, (i + 1) * 150, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] })),
    { id: 'stairs', name: 'Stairs', kind: 'boolean', visible: true, operation: 'union', children: Array.from({ length: count }, (_, i) => `step-${i}`) },
  ] })
  const evaluated = evaluateConstructionObjects(stairs(5))[0]
  expect(evaluated.prism?.outline).toHaveLength(12)
  const project = solveObjectPrism(evaluated.prism!, 18)
  expect(project.panels).toHaveLength(14)
  expect(project.connections).toHaveLength(36)
  expect(validateProject(project)).toEqual([])
  expect(evaluateConstructionObjects(stairs(6))[0].prism).toBeUndefined()
})

it('converts a disconnected L and cuboid as separate complete shells', () => {
  const objects = structuredClone(shape)
  objects.nodes.push({ id: 'separate', name: 'Separate', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [1500, 300, 0], rotation: [0, 0, 0] },
    { id: 'all', name: 'Mixed pieces', kind: 'boolean', visible: true, operation: 'union', children: ['l', 'separate'] })
  objects.roots = ['all']
  const source = { ...createStarterProject('blank'), constructionObjects: objects }, before = structuredClone(source)
  const result = convertConstructionObject(source, ['all'], { thickness: 18, material: 'birch', color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' })
  expect(result.panelIds).toHaveLength(14)
  expect(result.hardwareCount).toBe(60)
  expect(result.project.panels.filter(p => p.customOutline)).toHaveLength(2)
  expect(result.dimensions).toEqual([1800, 600, 400])
  expect(validateProject(result.project)).toEqual([])
  expect(source).toEqual(before)
})

it('fits rectangular profile pieces when rectangular-only conversion is requested', () => {
  const source = { ...createStarterProject('blank'), constructionObjects: structuredClone(shape) }, before = structuredClone(source)
  const options = { thickness: 18, material: 'birch' as const, color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }
  const result = convertConstructionObject(source, ['l'], { ...options, rectangularOnly: true })
  expect(result.project.panels).toHaveLength(10)
  expect(result.project.panels.every(p => !p.customOutline)).toBe(true)
  expect(source).toEqual(before)
  expect(convertConstructionObject(source, ['l'], { ...options, rectangularOnly: false }).project.panels.filter(p => p.customOutline)).toHaveLength(2)
})

it('closes a U with three rectangles per face attached only to surrounding walls', () => {
  const prism = evaluateConstructionObjects(profile('u'))[0].prism!
  const project = solveObjectPrism(prism, 18, true)
  expect(project.panels).toHaveLength(14)
  expect(project.panels.every(p => !p.customOutline)).toBe(true)
  expect(validateProject(project)).toEqual([])
})

describe.each(['u', 'steps'] as const)('rectangular %s closing faces', kind => {
  it.each([16, 18, 19])('fits %s mm stock with complete wall support and no seam connectors', thickness => {
    const prism = evaluateConstructionObjects(profile(kind))[0].prism!
    const project = solveObjectPrism(prism, thickness, true)
    const rimIds = new Set(project.panels.slice(0, 8).map(p => p.id)), pieces = project.panels.slice(8)
    expect(pieces).toHaveLength(6)
    expect(project.panels.every(p => !p.customOutline)).toBe(true)
    for (const piece of pieces) {
      const hardware = getPhysicalConnectors(project).filter(({ connection: c }) => c.parentId === piece.id || c.childId === piece.id)
      expect(hardware.length).toBeGreaterThanOrEqual(2)
      expect(hardware.every(({ connection: c }) => c.type === '90' && (rimIds.has(c.parentId) || rimIds.has(c.childId)))).toBe(true)
      expect(validateProject(removePanel(project, piece.id))).toEqual([])
    }
    const custom = solveObjectPrism(prism, thickness).panels.filter(p => p.customOutline)
    const area = custom.reduce((sum, p) => sum + Math.abs(p.customOutline!.reduce((area, a, i, points) => {
      const b = points[(i + 1) % points.length]; return area + a.x * b.y - b.x * a.y
    }, 0)) * p.width * p.height / 2, 0)
    expect(Math.abs(pieces.reduce((sum, p) => sum + p.width * p.height, 0) - area)).toBeLessThan(.1)
    expect(roundTripProject(project).panels).toHaveLength(14)
    expect(validateProject(project)).toEqual([])
    if (kind === 'u') {
      const heights = pieces.slice(0, 3).map(p => p.height).sort((a, b) => a - b)
      expect(heights[0]).toBeLessThan(heights[1])
      expect(heights[1]).toBeCloseTo(heights[2], 6)
    }
  })
  it.each([0, 1, 2] as const)('preserves the rotated envelope around axis %s', axis => {
    const objects = rotateConstructionSelection(profile(kind), ['result'], axis)
    const evaluated = evaluateConstructionObjects(objects)[0]
    const project = solveObjectPrism(evaluated.prism!, 18, true)
    const bounds = getProjectBounds(resolvePanels(project))
    for (let i = 0; i < 3; i++) {
      expect(bounds.min[i]).toBeCloseTo(evaluated.bounds!.min[i], 6)
      expect(bounds.max[i]).toBeCloseTo(evaluated.bounds!.max[i], 6)
    }
    expect(project.panels).toHaveLength(14)
  })
})
