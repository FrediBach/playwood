import { expect, it } from 'vitest'
import { solveObjectTunnel } from './object-tunnel-solver'
import { validateProject } from './model'
it('builds a rectangular tunnel with sixteen panels', () => {
  const project = solveObjectTunnel({ axis: 2, outer: { min: [0, 0, 0], max: [1000, 1000, 400] }, opening: { min: [300, 300, 0], max: [700, 700, 400] } }, 18)
  expect(project.panels).toHaveLength(16)
  expect(validateProject(project)).toEqual([])
})

import { findObjectTunnel, type ObjectTunnel } from './object-tunnel'
import { evaluateConstructionObjects } from './object-geometry'
import { convertConstructionObject } from './object-conversion'
import { createPanel, createStarterProject, getProjectBounds, parseProject, removePanel, resolvePanels } from './model'
import { getPhysicalConnectors } from './connector-selection'
import type { ConstructionObjects, Project, Vec3 } from './types'

const options = { rectangularOnly: true, thickness: 18, material: 'birch' as const, color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }
function objects(axis: 0 | 1 | 2): ConstructionObjects {
  const dimensions: Vec3 = [1000, 1100, 1200], opening: Vec3 = [400, 450, 500], position: Vec3 = [30, 500, -20]
  dimensions[axis] = 400; opening[axis] = 800; position[axis] = axis === 1 ? 550 : 0
  return { roots: ['result'], nodes: [
    { id: 'outer', name: 'Outer', kind: 'box', visible: true, width: dimensions[0], height: dimensions[1], depth: dimensions[2], position: [0, 550, 0], rotation: [0, 0, 0] },
    { id: 'cut', name: 'Opening', kind: 'box', visible: false, width: opening[0], height: opening[1], depth: opening[2], position, rotation: [0, 0, 0] },
    { id: 'result', name: 'Tunnel', kind: 'boolean', visible: true, operation: 'subtract', children: ['outer', 'cut'] },
  ] }
}
for (const axis of [0, 1, 2] as const) for (const thickness of [16, 18, 19]) it(`preserves an off-center opening on axis ${axis} at ${thickness} mm stock`, () => {
  const source: Project = { ...createStarterProject('blank'), constructionObjects: objects(axis) }, before = structuredClone(source)
  const shape = evaluateConstructionObjects(source.constructionObjects!)[0]
  expect(shape.tunnel?.axis).toBe(axis)
  const result = convertConstructionObject(source, ['result'], { ...options, thickness })
  expect(result.panelIds).toHaveLength(16)
  expect(result.project.connections).toHaveLength(32)
  expect(result.project.panels.every(p => !p.customOutline)).toBe(true)
  expect(validateProject(result.project)).toEqual([])
  const panels = resolvePanels(result.project), outer = getProjectBounds(panels), tunnel = shape.tunnel!
  for (let i = 0; i < 3; i++) {
    expect(outer.min[i]).toBeCloseTo(tunnel.outer.min[i], 6)
    expect(outer.max[i]).toBeCloseTo(tunnel.outer.max[i], 6)
  }
  for (const panel of panels) {
    const bounds = getProjectBounds([panel])
    // No stock may occupy the open rectangular passage (hardware can project).
    expect([0, 1, 2].some(i => i !== axis && (bounds.max[i] <= tunnel.opening.min[i] + 1e-5 || bounds.min[i] >= tunnel.opening.max[i] - 1e-5))).toBe(true)
  }
  const rimIds = new Set(panels.slice(0, 8).map(p => p.id))
  for (const piece of panels.slice(8)) {
    const joints = getPhysicalConnectors(result.project).filter(({ connection: c }) => c.parentId === piece.id || c.childId === piece.id)
    expect(joints.length).toBeGreaterThanOrEqual(2)
    expect(joints.every(({ connection: c }) => c.type === '90' && (rimIds.has(c.parentId) || rimIds.has(c.childId)))).toBe(true)
  }
  expect(validateProject(removePanel(result.project, panels[8].id))).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(result.project))).panels).toHaveLength(16)
  expect(source).toEqual(before)
})
it('does not classify an enclosed cavity or two parallel tunnels as one rectangular tunnel', () => {
  const planes = [[0, 1, 2, 3, 4, 5], [0, 1, 2, 3], [0, 1, 2, 3]]
  const occupied = new Uint8Array(45).fill(1)
  occupied[(1 * 3 + 1) * 3 + 1] = 0
  expect(findObjectTunnel(planes, occupied)).toBeUndefined()
  for (const x of [1, 3]) for (let z = 0; z < 3; z++) occupied[(x * 3 + 1) * 3 + z] = 0
  expect(findObjectTunnel(planes, occupied)).toBeUndefined()
})
it('rejects thin surrounds, small passages, and non-through inputs without partial results', () => {
  const tunnel: ObjectTunnel = { axis: 2, outer: { min: [0, 0, 0], max: [1000, 1000, 400] }, opening: { min: [300, 300, 0], max: [700, 700, 400] } }
  expect(() => solveObjectTunnel({ ...tunnel, opening: { min: [50, 300, 0], max: [700, 700, 400] } }, 18)).toThrow(/cuts|connectors/)
  expect(() => solveObjectTunnel({ ...tunnel, opening: { min: [499.5, 499.5, 0], max: [500.5, 500.5, 400] } }, 18)).toThrow(/cuts/)
  expect(() => solveObjectTunnel({ ...tunnel, opening: { min: [300, 300, 20], max: [700, 700, 400] } }, 18)).toThrow(/through-opening/)
})
it('allows existing furniture through the passage but rejects stock in a tunnel wall', () => {
  const source: Project = { ...createStarterProject('blank'), constructionObjects: objects(2), panels: [createPanel({ width: 100, height: 100, position: [30, 500, 0] })] }
  expect(convertConstructionObject(source, ['result'], options).project.panels).toHaveLength(17)
  const evaluated = evaluateConstructionObjects(source.constructionObjects!)[0].tunnel!
  source.panels = [createPanel({ width: 200, height: 200, position: [evaluated.opening.min[0] - 9, 500, 0], rotation: [0, Math.PI / 2, 0] })]
  const before = structuredClone(source)
  expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/overlap|collision/i)
  expect(source).toEqual(before)
})
it('checks the sixteen-panel project budget before fitting a tunnel', () => {
  const source: Project = { ...createStarterProject('blank'), constructionObjects: objects(2), panels: Array.from({ length: 185 }, () => createPanel()) }
  expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/200 panels/)
})
it('classifies and converts a tunnel inside a disconnected Boolean result', () => {
  const constructionObjects = objects(2)
  constructionObjects.nodes.push(
    { id: 'box', name: 'Separate', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [2000, 300, 0], rotation: [0, 0, 0] },
    { id: 'combined', name: 'Combined', kind: 'boolean', visible: true, operation: 'union', children: ['result', 'box'] },
  )
  constructionObjects.roots = ['combined']
  const source: Project = { ...createStarterProject('blank'), constructionObjects }, before = structuredClone(source)
  const result = convertConstructionObject(source, ['combined'], options)
  expect(result.panelIds).toHaveLength(22)
  expect(result.compartments).toHaveLength(2)
  expect(validateProject(result.project)).toEqual([])
  expect(source).toEqual(before)
})
