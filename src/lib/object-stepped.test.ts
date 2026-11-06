import { roundTripProject } from '../test/project-round-trip'
import { Euler, Quaternion, Vector3 } from 'three'
import { outlineWorldPoints } from './outline-closures'
import { expect, it } from 'vitest'
import fixture from '../../tests/fixtures/stepped-object.json'
import doubleFixture from '../../tests/fixtures/double-stepped-object.json'
import { getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { convertConstructionObject } from './object-conversion'
import { evaluateConstructionObjects, rotateConstructionSelection } from './object-geometry'
import { overlappingConnectorIds } from './connector-clearance'
import { getPhysicalConnectors } from './connector-selection'
import { solveObjectShell } from './object-notch-solver'
import { findObjectStepped } from './object-stepped'
import type { Vec3 } from './types'
const options = { thickness: 18, material: 'birch' as const, color: '#ffffff', finishCoverage: 0, connectorColor: '#ff0000', connectorMaterial: 'plastic' as const }

it.each([fixture, doubleFixture].flatMap(input => [16, 17, 18, 19].map(thickness => ({ input, thickness, cuts: input === fixture ? 1 : 2 }))))('converts $cuts-cut stepped crosses at $thickness mm in every axis and direction', ({ input, thickness }) => {
  for (const scale of [1, 2]) for (const axis of [0, 1, 2] as const) {
    const source = parseProject(input)
    source.constructionObjects!.nodes = source.constructionObjects!.nodes.map(n => n.kind === 'box' ? { ...n, width: n.width * scale, height: n.height * scale, depth: n.depth * scale, position: n.position.map(v => v * scale) as Vec3 } : n)
    for (let turn = 0; turn < 4; turn++) {
      const objects = source.constructionObjects!, before = JSON.stringify(source)
      const evaluated = evaluateConstructionObjects(objects, true)[0]
      expect(evaluated.solids![0].stepped).toBeDefined()
      let result: ReturnType<typeof convertConstructionObject>
      try { result = convertConstructionObject(source, objects.roots, { ...options, thickness, rectangularOnly: scale === 2 && turn % 2 === 0 }) }
      catch (error) { throw new Error(`scale ${scale}, axis ${axis}, turn ${turn}: ${String(error)}`) }
      expect(JSON.stringify(source)).toBe(before)
      const panels = resolvePanels(result.project), bounds = getProjectBounds(panels)
      for (let a = 0; a < 3; a++) {
        expect(bounds.min[a]).toBeCloseTo(evaluated.bounds!.min[a], 5)
        expect(bounds.max[a]).toBeCloseTo(evaluated.bounds!.max[a], 5)
      }
      // Check the full stock volume against exact occupied cells, including
      // all source planes crossing each board; centers alone miss bridged notches.
      const shape = evaluated.solids![0].stepped!, sizes = shape.planes.map(p => p.length - 1)
      for (const panel of panels) {
        const b = getProjectBounds([panel])
        const mid = b.min.map((lo, a) => {
          const cuts = [lo, ...[...shape.planes[a], ...outlineWorldPoints(panel).map(p => p.getComponent(a))].sort((a, b) => a - b).filter(v => v > lo + 1e-5 && v < b.max[a] - 1e-5), b.max[a]].filter((v, i, values) => !i || v - values[i - 1] > 1e-5)
          return cuts.slice(1).map((v, i) => (v + cuts[i]) / 2)
        })
        for (const x of mid[0]) for (const y of mid[1]) for (const z of mid[2]) {
          if (panel.customOutline) {
            const local = new Vector3(x, y, z).sub(new Vector3(...panel.position)).applyQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation)).invert())
            const px = local.x / panel.width + .5, py = .5 - local.y / panel.height
            let inside = false
            for (const [i, p] of panel.customOutline.entries()) {
              const q = panel.customOutline[(i + 1) % panel.customOutline.length]
              if ((p.y > py) !== (q.y > py) && px < p.x + (q.x - p.x) * (py - p.y) / (q.y - p.y)) inside = !inside
            }
            if (!inside) continue
          }
          const cell = [x, y, z].map((v, a) => shape.planes[a].findIndex((lo, i, ps) => v >= lo && v < ps[i + 1]))
          expect(cell.every(c => c >= 0)).toBe(true)
          expect(shape.occupied[(cell[0] * sizes[1] + cell[1]) * sizes[2] + cell[2]], `${panel.name} at ${[x,y,z]} scale ${scale} axis ${axis} turn ${turn}`).toBe(1)
        }
      }
      expect(panels.every(p => (scale === 1 || !p.customOutline) && p.thickness === thickness)).toBe(true)
      expect(validateProject(result.project)).toEqual([])
      expect(overlappingConnectorIds(result.project).size).toBe(0)
      const hardware = getPhysicalConnectors(result.project)
      for (const p of panels) {
        const neighbors = new Set(hardware.flatMap(h => h.connection.parentId === p.id ? [h.connection.childId] : h.connection.childId === p.id ? [h.connection.parentId] : []))
        expect(neighbors.size).toBeGreaterThanOrEqual(input === fixture ? 2 : 1)
        if (neighbors.size === 1) {
          expect(p.customOutline).toBeUndefined()
          const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...p.rotation))
          const a = [0, 1, 2].find(a => Math.abs(normal.getComponent(a)) > .99)!
          expect(Math.min(Math.abs(p.position[a] - thickness / 2 - bounds.min[a]), Math.abs(p.position[a] + thickness / 2 - bounds.max[a]))).toBeLessThan(1e-5)
        }
      }
      const reached = new Set([panels[0].id]), queue = [panels[0].id]
      for (let i = 0; i < queue.length; i++) for (const { connection: c } of hardware) {
        const next = c.parentId === queue[i] ? c.childId : c.childId === queue[i] ? c.parentId : undefined
        if (next && !reached.has(next)) { reached.add(next); queue.push(next) }
      }
      expect(reached.size).toBe(panels.length)
      expect(roundTripProject(result.project)).toEqual(JSON.parse(JSON.stringify(result.project)))
      expect(result.project.constructionObjects!.nodes.find(n => n.id === objects.roots[0])!.visible).toBe(false)
      source.constructionObjects = rotateConstructionSelection(objects, objects.roots, axis)
    }
  }
}, 60000)
it('converts the original at its unchanged dimensions', () => {
  const source = parseProject(fixture), before = JSON.stringify(source)
  const result = convertConstructionObject(source, source.constructionObjects!.roots, options)
  expect(validateProject(result.project)).toEqual([])
  expect(JSON.stringify(source)).toBe(before)
})
it('solves a multi-level terrace with different heights in both footprint directions', () => {
  const planes = [[0, 250, 500, 750], [0, 250, 500, 750], [0, 250, 500, 750]]
  const occupied = Uint8Array.from({ length: 27 }, (_, i) => Number(Math.floor(i / 3) % 3 <= Math.min(Math.floor(i / 9), i % 3)))
  const shape = findObjectStepped(planes, occupied)!
  expect(shape).toBeDefined()
  expect(validateProject(solveObjectShell(shape, 18))).toEqual([])
})
it('classifies multi-level terraces and rejects cavities and overhangs', () => {
  const planes = [[0, 200, 400, 600], [0, 200, 400, 600], [0, 200, 400, 600]]
  const terrace = Uint8Array.from({ length: 27 }, (_, i) => Number(Math.floor(i / 3) % 3 <= Math.floor(i / 9)))
  expect(findObjectStepped(planes, terrace)).toBeDefined()
  const cavity = new Uint8Array(27).fill(1); cavity[13] = 0
  expect(findObjectStepped(planes, cavity)).toBeUndefined()
  const overhang = new Uint8Array(27).fill(1); overhang[12] = 0; overhang[13] = 0; overhang[14] = 0; overhang[10] = 0
  expect(findObjectStepped(planes, overhang)).toBeUndefined()
  expect(findObjectStepped(planes, new Uint8Array(27))).toBeUndefined()
})

it.each([-4, 4])('converts nearby cutter placements (%s mm) without special-casing the fixture', offset => {
  const source = parseProject(fixture), cutter = source.constructionObjects!.nodes.at(-2)!
  if (cutter.kind !== 'box') throw new Error('Expected box cutter')
  cutter.position[0] += offset
  cutter.width += offset * 2 // Keep the cutter entry aligned with the outside face.
  const result = convertConstructionObject(source, source.constructionObjects!.roots, options)
  expect(validateProject(result.project)).toEqual([])
  expect(overlappingConnectorIds(result.project).size).toBe(0)
})
it('rejects an undersized version atomically and respects rectangular-only', () => {
  const source = parseProject(fixture), before = JSON.stringify(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, { ...options, rectangularOnly: true })).toThrow(/turning off Rectangular panels only/)
  expect(JSON.stringify(source)).toBe(before)
  source.constructionObjects!.nodes = source.constructionObjects!.nodes.map(n => n.kind !== 'box' ? n : { ...n, width: n.width / 10, height: n.height / 10, depth: n.depth / 10, position: n.position.map(v => v / 10) as Vec3 })
  const small = JSON.stringify(source)
  expect(() => convertConstructionObject(source, source.constructionObjects!.roots, options)).toThrow(/cuts|clearance|attach/)
  expect(JSON.stringify(source)).toBe(small)
})

it.each([-8, 8])('converts the second cutter shifted by %s mm', offset => {
  const source = parseProject(doubleFixture), cutter = source.constructionObjects!.nodes.at(-2)!
  if (cutter.kind !== 'box') throw new Error('Expected box cutter')
  cutter.position[0] += offset
  const result = convertConstructionObject(source, source.constructionObjects!.roots, options)
  expect(validateProject(result.project)).toEqual([])
  expect(overlappingConnectorIds(result.project).size).toBe(0)
})
