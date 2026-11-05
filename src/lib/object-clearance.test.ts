import { expect, it } from 'vitest'
import { narrowObjectCells, OBJECT_CONNECTOR_MIN_SPAN } from './object-clearance'
import { evaluateConstructionObjects, moveConstructionSelection } from './object-geometry'
import { reuseObjectPreview } from './object-preview'
import type { ConstructionObjects } from './types'

it('uses continuous solid runs rather than small operand subdivisions on every axis', () => {
  for (let axis = 0; axis < 3; axis++) {
    const planes = [[0, 200], [0, 200], [0, 200]]
    planes[axis] = [0, 20, 200]
    expect([...narrowObjectCells(planes, new Uint8Array([1, 1]))]).toEqual([0, 0])
    expect([...narrowObjectCells(planes, new Uint8Array([1, 0]))]).toEqual([1, 0])
    planes[axis] = [0, OBJECT_CONNECTOR_MIN_SPAN, 200]
    expect([...narrowObjectCells(planes, new Uint8Array([1, 0]))]).toEqual([0, 0])
  }
})

it('highlights narrow Boolean remnants, translates warnings, and clears repaired or empty geometry', () => {
  const objects: ConstructionObjects = { roots: ['shape'], nodes: [
    { id: 'a', name: 'Body', kind: 'box', visible: true, width: 400, height: 400, depth: 400, position: [0, 0, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'Cutter', kind: 'box', visible: false, width: 400, height: 400, depth: 500, position: [50, 50, 0], rotation: [0, 0, 0] },
    { id: 'shape', name: 'L', kind: 'boolean', visible: true, operation: 'subtract', children: ['a', 'b'] },
  ] }
  const surfaces = evaluateConstructionObjects(objects)
  expect(surfaces[0].warningPositions!.length).toBeGreaterThan(0)
  const original = surfaces[0].warningPositions!.slice()
  const moved = moveConstructionSelection(objects, ['shape'], [100, 0, 0])
  const reused = reuseObjectPreview(objects, moved, surfaces)[0]
  evaluateConstructionObjects(moved)[0].warningPositions!.forEach((value, i) => expect(reused.warningPositions![i]).toBeCloseTo(value, 6))
  expect(surfaces[0].warningPositions).toEqual(original)
  const repaired = moveConstructionSelection(objects, ['b'], [100, 100, 0])
  expect(reuseObjectPreview(objects, repaired, surfaces)).toEqual([])
  expect(evaluateConstructionObjects(repaired)[0].warningPositions).toBeUndefined()
  expect(evaluateConstructionObjects(moveConstructionSelection(objects, ['b'], [-50, -50, 0]))[0].warningPositions).toBeUndefined()
})
