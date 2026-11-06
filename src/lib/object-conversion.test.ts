import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { convertConstructionObject, objectConversionReason, type ObjectConversionOptions } from './object-conversion'
import { createPanel, createStarterProject, getProjectBounds, removePanel, resolvePanels, validateProject } from './model'
import { constructionBoxBounds } from './object-geometry'
import { addConstructionBox, combineConstructionObjects } from './construction-objects'
import { getPhysicalConnectors } from './connector-selection'
import { assertAddedHardwarePanelClearance } from './connector-clearance'
import { getConnectorRail } from './connector-movement'
import { Euler, Vector3 } from 'three'
import type { Project } from './types'
const options: ObjectConversionOptions = { thickness: 18, material: 'oak', color: '#123456', finishCoverage: .5, connectorColor: '#654321', connectorMaterial: 'metal' }
function source() {
  const added = addConstructionBox(createStarterProject('blank'))
  const box = added.project.constructionObjects!.nodes[0]
  if (box.kind !== 'box') throw new Error('Expected box')
  box.position = [1200, 500, -800]; box.rotation = [0, Math.PI / 2, 0]
  return { project: added.project, id: added.objectId, box }
}
describe('box conversion transaction', () => {
  it('preserves rotated world bounds, appearance and source identity, and creates removable ordinary panels', () => {
    const { project, id, box } = source(), before = structuredClone(project)
    const result = convertConstructionObject(project, [id], options)
    const bounds = constructionBoxBounds(box)
    expect(result.dimensions).toEqual(bounds.max.map((v, i) => v - bounds.min[i]))
    expect(result.hardwareCount).toBe(24)
    expect(validateProject(result.project)).toEqual([])
    expect(result.project.panels).toHaveLength(6)
    expect(result.project.panels.every(p => p.material === 'oak' && p.finishCoverage === .5 && p.color === '#123456')).toBe(true)
    expect(getPhysicalConnectors(result.project).every(p => p.color === '#654321' && p.material === 'metal')).toBe(true)
    expect(result.project.constructionObjects!.nodes[0]).toEqual({ ...box, visible: false })
    expect(project).toEqual(before)
    const opened = removePanel(result.project, result.panelIds[0])
    expect(resolvePanels(opened)).toEqual(resolvePanels(result.project).filter(p => p.id !== result.panelIds[0]))
    expect(roundTripProject(opened).constructionObjects).toEqual(result.project.constructionObjects)
  })
  it('preserves unrelated existing furniture and rejects collisions, including hidden stock', () => {
    const { project, id, box } = source()
    const panel = createPanel({ position: [-4000, 500, 0] })
    const existing: Project = { ...project, panels: [panel] }
    expect(convertConstructionObject(existing, [id], options).project.panels[0]).toEqual(panel)
    const bounds = constructionBoxBounds(box)
    const obstruction = createPanel({ position: [bounds.min[0] + 9, 500, -800], width: 400, height: 400, rotation: [0, Math.PI / 2, 0], visible: false })
    expect(() => convertConstructionObject({ ...project, panels: [obstruction] }, [id], options)).toThrow(/overlap/)
  })
  it('rejects repeat conversion in the same place and invalid stock or finish', () => {
    const { project, id } = source()
    const result = convertConstructionObject(project, [id], options)
    expect(() => convertConstructionObject(result.project, [id], options)).toThrow(/overlap/)
    expect(() => convertConstructionObject(project, [id], { ...options, thickness: 20 })).toThrow(/thickness/)
    expect(() => convertConstructionObject(project, [id], { ...options, finishCoverage: 50 })).toThrow(/coverage/)
  })
  it('allows complete root selections but rejects nested operands', () => {
    const { project, id } = source()
    const next = addConstructionBox(project)
    const combined = combineConstructionObjects(next.project, [id, next.objectId], 'union')
    expect(objectConversionReason(combined.project, [combined.objectId])).toBeUndefined()
    expect(objectConversionReason(combined.project, [id])).toMatch(/top-level/)
    expect(objectConversionReason(next.project, [id, next.objectId])).toBeUndefined()
    expect(objectConversionReason(next.project, [id, id])).toMatch(/top-level/)
    expect(objectConversionReason(next.project, [])).toMatch(/top-level/)
    expect(objectConversionReason(next.project, ['missing'])).toMatch(/top-level/)
    expect(objectConversionReason(createStarterProject('blank'), [id])).toMatch(/top-level/)
  })
  it('rejects new violations of build space before acceptance', () => {
    const { project, id } = source()
    project.spaceConstraint = { enabled: true, width: 300, height: 300, depth: 300, centerX: 0, centerZ: 0 }
    expect(() => convertConstructionObject(project, [id], options)).toThrow(/build space/i)
  })
  it('checks new hardware against old stock and old hardware against new stock', () => {
    const { project, id } = source()
    const result = convertConstructionObject(project, [id], options).project
    const piece = getPhysicalConnectors(result)[0]
    const rail = getConnectorRail(piece.connection, resolvePanels(result), result.connections)!
    const placement = rail.placements[piece.index]
    const center = new Vector3(18, 0, 18).applyEuler(new Euler(...placement.rotation)).add(new Vector3(...placement.position)).toArray()
    const obstacle = createPanel({ name: 'Hardware obstruction', width: 100, height: 100, position: center })
    const combined = { ...result, panels: [...result.panels, obstacle] }
    expect(() => assertAddedHardwarePanelClearance({ ...project, panels: [obstacle] }, combined)).toThrow(/hardware overlaps/)
    expect(() => assertAddedHardwarePanelClearance(result, combined)).toThrow(/hardware overlaps/)
  })
  it('rejects document panel limits before starting a solve', () => {
    const { project, id } = source()
    project.panels = Array.from({ length: 195 }, () => createPanel())
    expect(() => convertConstructionObject(project, [id], options)).toThrow(/200 panels/)
  })
})

function booleanProject(operation: 'union' | 'subtract' | 'intersect', offset = 300): Project {
  return { ...createStarterProject('blank'), constructionObjects: { roots: ['result'], nodes: [
    { id: 'a', name: 'A', visible: true, kind: 'box', width: 600, height: 600, depth: 400, position: [0, 300, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'B', visible: false, kind: 'box', width: 600, height: 600, depth: 400, position: [offset, 300, 0], rotation: [0, 0, 0] },
    { id: 'result', name: 'Result', visible: false, kind: 'boolean', operation, children: ['a', 'b'] },
  ] } }
}
describe('Boolean conversion', () => {
  it.each([['union', 600, 1200, -300], ['intersect', 300, 300, 0], ['subtract', 300, 300, -300]] as const)(
    'converts the exact %s result, including hidden operands and roots', (operation, offset, width, minX) => {
      const source = booleanProject(operation, offset), before = structuredClone(source)
      const result = convertConstructionObject(source, ['result'], options)
      expect(result.dimensions).toEqual([width, 600, 400])
      expect(result.project.panels).toHaveLength(6)
      expect(result.hardwareCount).toBe(24)
      expect(validateProject(result.project)).toEqual([])
      const bounds = constructionBoxBounds({ ...source.constructionObjects!.nodes[0], kind: 'box', width, height: 600, depth: 400, position: [minX + width / 2, 300, 0], rotation: [0, 0, 0] })
      const actual = getProjectBounds(resolvePanels(result.project))
      actual.min.forEach((value, axis) => expect(value).toBeCloseTo(bounds.min[axis], 8))
      actual.max.forEach((value, axis) => expect(value).toBeCloseTo(bounds.max[axis], 8))
      expect(result.project.constructionObjects).toEqual(before.constructionObjects)
      expect(source).toEqual(before)
    })
  it.each(['cavity', 'empty'] as const)('rejects %s without substituting its bounds', kind => {
    const source = booleanProject('subtract', 0)
    const cutter = source.constructionObjects!.nodes[1]
    if (cutter.kind !== 'box') throw new Error('Expected box')
    if (kind === 'cavity') { cutter.width = 1; cutter.height = 1; cutter.depth = 1 }
    const before = structuredClone(source)
    expect(() => convertConstructionObject(source, ['result'], options)).toThrow(kind === 'empty' ? /empty result/ : /not a supported cuboid/)
    expect(source).toEqual(before)
  })
  it('evaluates nested Boolean semantics and ignores unrelated expensive roots', () => {
    const source = booleanProject('union', 600)
    const nodes = source.constructionObjects!.nodes
    nodes.push({ id: 'trim', name: 'Trim', visible: true, kind: 'box', width: 300, height: 800, depth: 800, position: [-150, 300, 0], rotation: [0, 0, 0] },
      { id: 'nested', name: 'Nested', visible: true, kind: 'boolean', operation: 'subtract', children: ['result', 'trim'] })
    source.constructionObjects!.roots = ['nested']
    const result = convertConstructionObject(source, ['nested'], options)
    expect(result.dimensions).toEqual([900, 600, 400])
    expect(result.project.constructionObjects!.nodes.find(n => n.id === 'nested')!.visible).toBe(false)
    // The selected tree alone consumes the evaluator budget.
    for (let i = 0; i < 50; i++) nodes.push({ id: `other-${i}`, name: 'Other', visible: true, kind: 'box', width: 5, height: 5, depth: 5, position: [i * 10, i * 11, i * 12], rotation: [0, 0, 0] })
    nodes.push({ id: 'complex', name: 'Complex', visible: true, kind: 'boolean', operation: 'union', children: Array.from({ length: 50 }, (_, i) => `other-${i}`) })
    source.constructionObjects!.roots.push('complex')
    expect(convertConstructionObject(source, ['nested'], options).dimensions).toEqual(result.dimensions)
    expect(() => convertConstructionObject(source, ['complex'], options)).toThrow(/too complex/)
  })
})

describe('disconnected Boolean pieces', () => {
  it.each(['union', 'subtract'] as const)('converts every separated %s piece without bridging the gap', operation => {
    const source = booleanProject(operation, operation === 'union' ? 900 : 0)
    const cutter = source.constructionObjects!.nodes[1]
    if (cutter.kind !== 'box') throw new Error('Expected box')
    if (operation === 'subtract') { cutter.width = 200; cutter.height = 800; cutter.depth = 800 }
    const before = structuredClone(source)
    const result = convertConstructionObject(source, ['result'], options)
    expect(result.panelIds).toHaveLength(12)
    expect(result.hardwareCount).toBe(operation === 'union' ? 48 : 40)
    expect(result.sharedWalls).toBe(0)
    expect(result.compartments.map(c => c.name)).toEqual(['Result · Piece 1', 'Result · Piece 2'])
    expect(new Set(result.compartments.map(c => c.id)).size).toBe(2)
    const resolved = resolvePanels(result.project)
    const left = getProjectBounds(resolved.slice(0, 6)), right = getProjectBounds(resolved.slice(6))
    expect(right.min[0] - left.max[0]).toBeCloseTo(operation === 'union' ? 300 : 200, 6)
    expect(validateProject(result.project)).toEqual([])
    expect(roundTripProject(result.project).panels).toHaveLength(12)
    expect(source).toEqual(before)
  })
  it('rejects a later unbuildable piece without returning the valid first piece', () => {
    const source = booleanProject('union', 900), box = source.constructionObjects!.nodes[1]
    if (box.kind !== 'box') throw new Error('Expected box')
    box.width = 50
    const before = structuredClone(source)
    expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/cuts/)
    expect(source).toEqual(before)
  })
  it('checks aggregate panel limits across all pieces before solving', () => {
    const source = booleanProject('union', 900)
    source.panels = Array.from({ length: 189 }, () => createPanel())
    expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/200 panels/)
  })
  it.each([{ position: [600, 900, 0] }, { position: [600, 900, 400] }] as const)('rejects edge or corner contact at $position without a fabricated bridge', ({ position }) => {
    const source = booleanProject('union'), box = source.constructionObjects!.nodes[1]
    if (box.kind !== 'box') throw new Error('Expected box')
    box.position = [...position]
    expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/matching full/)
  })
})

it('restricts new panels to rectangles while retaining existing custom panels', () => {
  const { project, id } = source()
  const existing = createPanel({ position: [-4000, 500, 0], customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] })
  project.panels.push(existing)
  const before = structuredClone(project)
  const result = convertConstructionObject(project, [id], { ...options, rectangularOnly: true })
  expect(result.project.panels[0]).toEqual(existing)
  expect(result.project.panels.filter(p => result.panelIds.includes(p.id)).every(p => !p.customOutline?.length)).toBe(true)
  expect(result.panelIds).toHaveLength(6)
  expect(project).toEqual(before)
})
