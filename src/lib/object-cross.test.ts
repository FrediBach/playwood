import { expect, it } from 'vitest'
import fixture from '../../tests/fixtures/cross-object.json'
import { getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { convertConstructionObject } from './object-conversion'
import { constructionBoxBounds, evaluateConstructionObjects, rotateConstructionSelection } from './object-geometry'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { findObjectCross } from './object-cross'
import type { Project, Vec3 } from './types'

const options = { thickness: 18, material: 'birch' as const, color: '#ffffff', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }
it.each([16, 17, 18, 19])('converts the reported five-arm cross at %s mm through quarter turns', thickness => {
  for (const axis of [0, 1, 2] as const) {
    let objects = parseProject(fixture).constructionObjects!
    for (let turn = 0; turn < 4; turn++) {
      const source: Project = { version: 1, name: 'Cross', panels: [], connections: [], constructionObjects: objects }
      const before = JSON.stringify(source), bounds = evaluateConstructionObjects(objects)[0].bounds!
      const result = convertConstructionObject(source, objects.roots, { ...options, thickness, rectangularOnly: true })
      expect(JSON.stringify(source)).toBe(before)
      const panels = resolvePanels(result.project), actual = getProjectBounds(panels)
      for (let a = 0; a < 3; a++) {
        expect(actual.min[a]).toBeCloseTo(bounds.min[a], 5)
        expect(actual.max[a]).toBeCloseTo(bounds.max[a], 5)
      }
      // Each rectangular board must remain inside the union, including every
      // cell formed by its source-box boundaries (not just its center).
      const boxes = objects.nodes.flatMap(n => n.kind === 'box' ? [constructionBoxBounds(n)] : [])
      for (const panel of panels) {
        const b = getProjectBounds([panel])
        const planes = b.min.map((lo, a) => [lo, ...boxes.flatMap(box => [box.min[a], box.max[a]]).filter(v => v > lo + 1e-5 && v < b.max[a] - 1e-5), b.max[a]].sort((x, y) => x - y))
        const mid = planes.map(p => p.slice(1).map((v, i) => (v + p[i]) / 2))
        for (const x of mid[0]) for (const y of mid[1]) for (const z of mid[2]) expect(boxes.some(box => [x, y, z].every((v, a) => v >= box.min[a] - 1e-5 && v <= box.max[a] + 1e-5))).toBe(true)
      }
      expect(panels.every(p => !p.customOutline && p.thickness === thickness)).toBe(true)
      expect(validateProject(result.project)).toEqual([])
      expect(overlappingConnectorIds(result.project).size).toBe(0)
      const hardware = getPhysicalConnectors(result.project)
      expect(panels.every(p => new Set(hardware.flatMap(h => h.connection.parentId === p.id ? [h.connection.childId] : h.connection.childId === p.id ? [h.connection.parentId] : [])).size >= 2)).toBe(true)
      expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(JSON.parse(JSON.stringify(result.project)))
      expect(result.project.constructionObjects!.nodes.find(n => n.id === objects.roots[0])!.visible).toBe(false)
      objects = rotateConstructionSelection(objects, objects.roots, axis)
    }
  }
})

function cross(arms: number): Project {
  const directions = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]].slice(0, arms)
  return { version: 1, name: 'Cross', panels: [], connections: [], constructionObjects: { roots: ['union'], nodes: [
    ...directions.map((d, i) => ({ id: `arm-${i}`, name: 'Arm', visible: true, kind: 'box' as const,
      width: d[0] ? 650 : 250, height: d[1] ? 650 : 250, depth: d[2] ? 650 : 250,
      position: d.map((v, a) => v * 200 + (a === 1 ? 1000 : 0)) as Vec3, rotation: [0, 0, 0] as Vec3 })),
    { id: 'union', name: 'Union', visible: true, kind: 'boolean', operation: 'union', children: directions.map((_, i) => `arm-${i}`) },
  ] } }
}
it.each([3, 4, 5, 6])('converts a cross with %s arms', arms => {
  const source = cross(arms)
  expect(validateProject(convertConstructionObject(source, ['union'], options).project)).toEqual([])
})
it('rejects narrow arms without mutating the source', () => {
  const source = parseProject(fixture)
  source.constructionObjects!.nodes = source.constructionObjects!.nodes.map(n => n.kind !== 'box' ? n : { ...n, width: n.width / 10, height: n.height / 10, depth: n.depth / 10, position: n.position.map(v => v / 10) as Vec3 })
  const before = JSON.stringify(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/cuts|clearance|attach/)
  expect(JSON.stringify(source)).toBe(before)
})
it('rejects missing cores, bent arms, and extra occupied corners', () => {
  const planes = [[0, 250, 500, 750], [0, 250, 500, 750], [0, 250, 500, 750]]
  const occupied = Uint8Array.from({ length: 27 }, (_, i) => Number([Math.floor(i / 9), Math.floor(i / 3) % 3, i % 3].filter(c => c === 1).length >= 2))
  expect(findObjectCross(planes, occupied)).toBeDefined()
  for (const index of [13, 0, 1]) {
    const changed = occupied.slice(); changed[index] = Number(!changed[index])
    expect(findObjectCross(planes, changed)).toBeUndefined()
  }
})
