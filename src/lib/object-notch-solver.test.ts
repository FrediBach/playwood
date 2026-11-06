import { roundTripProject } from '../test/project-round-trip'
import { expect, it } from 'vitest'
import fixture from '../../tests/fixtures/corner-cut-shelf.json'
import { getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { convertConstructionObject } from './object-conversion'
import { constructionBoxBounds, evaluateConstructionObjects, rotateConstructionSelection } from './object-geometry'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { findObjectNotches } from './object-notches'
import type { Project } from './types'
const options = { thickness: 18, material: 'birch' as const, color: '#ffffff', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }

it('converts the reported shelf object while preserving existing furniture', () => {
  const source = parseProject(fixture)
  const result = convertConstructionObject(source, source.constructionObjects!.roots, { ...options, rectangularOnly: true })
  expect(result.panelIds).toHaveLength(18)
  expect(result.project.panels.slice(0, source.panels.length)).toEqual(source.panels)
  expect(result.project.connections.slice(0, source.connections.length)).toEqual(source.connections)
  expect(validateProject(result.project).filter(i => i.panelIds.some(id => result.panelIds.includes(id)))).toEqual([])
})

it.each([16, 17, 18, 19])('preserves cutouts and envelope at %s mm through quarter-turn orientations', thickness => {
  for (const axis of [0, 1, 2] as const) {
    let objects = parseProject(fixture).constructionObjects!
    for (let turn = 0; turn < 4; turn++) {
      const source: Project = { version: 1, name: 'Corner cuts', panels: [], connections: [], constructionObjects: objects }
      const before = JSON.stringify(source)
      const bounds = evaluateConstructionObjects(objects)[0].bounds!
      const result = convertConstructionObject(source, objects.roots, { ...options, thickness })
      expect(JSON.stringify(source)).toBe(before)
      const panels = resolvePanels(result.project), actual = getProjectBounds(panels)
      for (let a = 0; a < 3; a++) {
        expect(actual.min[a]).toBeCloseTo(bounds.min[a], 5)
        expect(actual.max[a]).toBeCloseTo(bounds.max[a], 5)
      }
      const cutters = objects.nodes.flatMap(n => n.kind === 'box' && n.id !== '4f173334-a653-4720-84a5-67771c3a3731' ? [constructionBoxBounds(n)] : [])
      for (const panel of panels) {
        const box = getProjectBounds([panel])
        for (const cutter of cutters) expect([0, 1, 2].every(a => Math.min(box.max[a], cutter.max[a]) - Math.max(box.min[a], cutter.min[a]) > 1e-5)).toBe(false)
      }
      expect(panels.every(p => !p.customOutline && p.thickness === thickness)).toBe(true)
      expect(validateProject(result.project)).toEqual([])
      expect(overlappingConnectorIds(result.project).size).toBe(0)
      expect(roundTripProject(result.project)).toEqual(JSON.parse(JSON.stringify(result.project)))
      const hardware = getPhysicalConnectors(result.project)
      expect(panels.every(p => hardware.filter(h => h.connection.parentId === p.id || h.connection.childId === p.id).length >= 2)).toBe(true)
      expect(result.project.constructionObjects!.nodes.find(n => n.id === objects.roots[0])!.visible).toBe(false)
      objects = rotateConstructionSelection(objects, objects.roots, axis)
    }
  }
})

it('rejects a corner cut too small for cuts and hardware without changing the source', () => {
  const source = parseProject(fixture)
  source.panels = []; source.connections = []
  source.constructionObjects!.nodes = source.constructionObjects!.nodes.map(n => n.kind !== 'box' ? n : { ...n, width: n.width / 10, height: n.height / 10, depth: n.depth / 10, position: n.position.map(v => v / 10) as [number, number, number] })
  const before = JSON.stringify(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/cuts|clearance/)
  expect(JSON.stringify(source)).toBe(before)
})

it('does not classify enclosed cavities, edge slots, or irregular voids as corner cuts', () => {
  const planes = [[0, 100, 200, 300], [0, 100, 200, 300], [0, 100, 200, 300]]
  for (const missing of [[13], [0, 1, 2], [0, 1, 3]]) {
    const occupied = new Uint8Array(27).fill(1)
    missing.forEach(i => { occupied[i] = 0 })
    expect(findObjectNotches(planes, occupied)).toBeUndefined()
  }
})
