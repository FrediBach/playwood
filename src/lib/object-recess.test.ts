import { expect, it } from 'vitest'
import { solveObjectRecess } from './object-tunnel-solver'
import { validateProject } from './model'
it('builds a blind rectangular recess with a back panel', () => {
  const project = solveObjectRecess({ axis: 2, entry: 0, outer: { min: [0, 0, 0], max: [1000, 1000, 700] }, opening: { min: [300, 300, 0], max: [700, 700, 400] } }, 18)
  expect(project.panels).toHaveLength(14)
  expect(validateProject(project)).toEqual([])
})

import { findObjectRecess, type ObjectRecess } from './object-tunnel'
import { evaluateConstructionObjects } from './object-geometry'
import { convertConstructionObject } from './object-conversion'
import { createPanel, createStarterProject, getProjectBounds, parseProject, removePanel, resolvePanels } from './model'
import { getPhysicalConnectors } from './connector-selection'
import type { ConstructionObjects, Project, Vec3 } from './types'
const options = { rectangularOnly: true, thickness: 18, material: 'birch' as const, color: '#d9bb87', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }
function objects(axis: 0 | 1 | 2, entry: 0 | 1): ConstructionObjects {
  const dimensions: Vec3 = [1000, 1100, 1200], opening: Vec3 = [400, 450, 500], position: Vec3 = [30, 500, -20], center: Vec3 = [0, 550, 0]
  dimensions[axis] = 700; opening[axis] = 800
  position[axis] = center[axis] + (entry ? 350 : -350)
  return { roots: ['result'], nodes: [
    { id: 'outer', name: 'Outer', kind: 'box', visible: true, width: dimensions[0], height: dimensions[1], depth: dimensions[2], position: center, rotation: [0, 0, 0] },
    { id: 'cut', name: 'Opening', kind: 'box', visible: false, width: opening[0], height: opening[1], depth: opening[2], position, rotation: [0, 0, 0] },
    { id: 'result', name: 'Recess', kind: 'boolean', visible: true, operation: 'subtract', children: ['outer', 'cut'] },
  ] }
}
for (const axis of [0, 1, 2] as const) for (const entry of [0, 1] as const) for (const thickness of [16, 18, 19]) it(`preserves recess depth on axis ${axis}, entry ${entry}, ${thickness} mm stock`, () => {
  const source: Project = { ...createStarterProject('blank'), constructionObjects: objects(axis, entry) }, before = structuredClone(source)
  const shape = evaluateConstructionObjects(source.constructionObjects!)[0]
  expect(shape.recess).toMatchObject({ axis, entry })
  expect(shape.tunnel).toBeUndefined()
  const result = convertConstructionObject(source, ['result'], { ...options, thickness })
  expect(result.panelIds).toHaveLength(14)
  expect(result.project.connections).toHaveLength(28)
  expect(result.project.panels.every(p => !p.customOutline)).toBe(true)
  const panels = resolvePanels(result.project), recess = shape.recess!, bounds = getProjectBounds(panels)
  for (let i = 0; i < 3; i++) {
    expect(bounds.min[i]).toBeCloseTo(recess.outer.min[i], 6)
    expect(bounds.max[i]).toBeCloseTo(recess.outer.max[i], 6)
  }
  for (const panel of panels) {
    const b = getProjectBounds([panel])
    expect([0, 1, 2].some(i => b.max[i] <= recess.opening.min[i] + 1e-5 || b.min[i] >= recess.opening.max[i] - 1e-5)).toBe(true)
  }
  const back = panels.slice(5, 10).find(p => Math.abs(getProjectBounds([p]).max[axis] - getProjectBounds([p]).min[axis] - thickness) < 1e-5)!
  expect(back).toBeDefined()
  expect(entry ? getProjectBounds([back]).max[axis] : getProjectBounds([back]).min[axis]).toBeCloseTo(entry ? recess.opening.min[axis] : recess.opening.max[axis], 6)
  // Every piece belongs to one connected physical construction, including the inner back.
  const visited = new Set([panels[0].id]), joints = getPhysicalConnectors(result.project)
  for (let i = 0; i < panels.length; i++) for (const { connection: c } of joints) if (visited.has(c.parentId) || visited.has(c.childId)) { visited.add(c.parentId); visited.add(c.childId) }
  expect(visited.size).toBe(14)
  expect(validateProject(removePanel(result.project, back.id))).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(result.project))).panels).toHaveLength(14)
  expect(validateProject(result.project)).toEqual([])
  expect(source).toEqual(before)
})
it('does not turn enclosed cavities or stepped cavities into blind rectangular recesses', () => {
  const planes = [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]]
  const occupied = new Uint8Array(27).fill(1); occupied[13] = 0
  expect(findObjectRecess(planes, occupied)).toBeUndefined()
  occupied[12] = 0; occupied[3] = 0
  expect(findObjectRecess(planes, occupied)).toBeUndefined()
})
it('rejects a back panel squeezed against the outer shell without changing the source', () => {
  const source: Project = { ...createStarterProject('blank'), constructionObjects: objects(2, 0) }
  const cutter = source.constructionObjects!.nodes[1]
  if (cutter.kind !== 'box') throw new Error('Expected box')
  cutter.depth = 1360
  const before = structuredClone(source)
  expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/overlap|collision|clearance/i)
  expect(source).toEqual(before)
})
it('rejects invalid entry faces and counts all fourteen panels before solving', () => {
  const recess = evaluateConstructionObjects(objects(2, 0))[0].recess!
  expect(() => solveObjectRecess({ ...recess, entry: 2 } as unknown as ObjectRecess, 18)).toThrow(/entry face/)
  const source = { ...createStarterProject('blank'), constructionObjects: objects(2, 0), panels: Array.from({ length: 187 }, () => createPanel()) }
  expect(() => convertConstructionObject(source, ['result'], options)).toThrow(/200 panels/)
})
it('converts a recess alongside a disconnected box in one candidate', () => {
  const constructionObjects = objects(2, 1)
  constructionObjects.nodes.push(
    { id: 'box', name: 'Separate', kind: 'box', visible: true, width: 600, height: 600, depth: 400, position: [2000, 300, 0], rotation: [0, 0, 0] },
    { id: 'union', name: 'Both', kind: 'boolean', visible: true, operation: 'union', children: ['result', 'box'] },
  )
  constructionObjects.roots = ['union']
  const result = convertConstructionObject({ ...createStarterProject('blank'), constructionObjects }, ['union'], options)
  expect(result.panelIds).toHaveLength(20)
  expect(result.compartments).toHaveLength(2)
})
