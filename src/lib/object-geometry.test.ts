import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { constructionBounds, evaluateConstructionObjects, moveConstructionSelection, resizeConstructionSelection, rotateConstructionSelection } from './object-geometry'
import type { ConstructionObject, ConstructionObjects, ObjectBooleanOperation, Vec3 } from './types'

const box = (id: string, position: Vec3 = [0, 0, 0], size = 100): Extract<ConstructionObject, { kind: 'box' }> =>
  ({ id, name: id, visible: true, kind: 'box', width: size, height: size, depth: size, position, rotation: [0, 0, 0] })
const shape = (operation: ObjectBooleanOperation, a = box('a'), b = box('b', [50, 0, 0])): ConstructionObjects => ({ roots: ['result'], nodes: [a, b,
  { id: 'result', name: 'Result', visible: true, kind: 'boolean', operation, children: [a.id, b.id] }] })
function surfaceMetrics(positions: Float32Array) {
  let area = 0, signedVolume = 0
  for (let i = 0; i < positions.length; i += 9) {
    const a = new Vector3().fromArray(positions, i), b = new Vector3().fromArray(positions, i + 3), c = new Vector3().fromArray(positions, i + 6)
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
    signedVolume += a.dot(b.clone().cross(c)) / 6
  }
  return { area: area * 1e6, volume: signedVolume * 1e9 }
}

describe('orthogonal object previews', () => {
  it.each([['union', 1500000, 80000], ['subtract', 500000, 40000], ['intersect', 500000, 40000]] as const)('evaluates %s with outward surface winding', (operation, volume, area) => {
    const [result] = evaluateConstructionObjects(shape(operation))
    expect(result.volume).toBe(volume)
    expect(surfaceMetrics(result.positions).volume).toBeCloseTo(volume, 0)
    expect(surfaceMetrics(result.positions).area).toBeCloseTo(area, 1)
  })

  it('removes the internal wall of touching union boxes but keeps separate roots separate', () => {
    const a = box('a'), b = box('b', [100, 0, 0])
    const [union] = evaluateConstructionObjects(shape('union', a, b))
    expect(union.volume).toBe(2000000)
    expect(surfaceMetrics(union.positions).area).toBeCloseTo(100000, 1)
    const separate = evaluateConstructionObjects({ roots: ['a', 'b'], nodes: [a, b] })
    expect(separate).toHaveLength(2)
    expect(separate.reduce((area, surface) => area + surfaceMetrics(surface.positions).area, 0)).toBeCloseTo(120000, 1)
    for (let i = 0; i < union.positions.length; i += 9) {
      expect([0, 3, 6].every(offset => Math.abs(union.positions[i + offset] - 0.05) < 1e-8)).toBe(false)
    }
  })

  it('handles coincident, empty, disconnected and nested results', () => {
    const same = shape('subtract', box('a'), box('b'))
    expect(evaluateConstructionObjects(same)[0]).toMatchObject({ volume: 0, bounds: null, positions: new Float32Array() })
    expect(evaluateConstructionObjects(shape('intersect', box('a'), box('b', [100, 0, 0])))[0].volume).toBe(0)
    expect(evaluateConstructionObjects(shape('union', box('a'), box('b', [200, 0, 0])))[0].volume).toBe(2000000)
    const nested: ConstructionObjects = { roots: ['nested'], nodes: [...shape('union').nodes, box('c', [0, 0, 0], 20),
      { id: 'nested', name: 'Nested', visible: true, kind: 'boolean', operation: 'subtract', children: ['result', 'c'] }] }
    expect(evaluateConstructionObjects(nested)[0].volume).toBe(1500000 - 8000)
  })

  it('retains inner cavity and tunnel surfaces', () => {
    const [cavity] = evaluateConstructionObjects(shape('subtract', box('a'), box('b', [0, 0, 0], 50)))
    expect(cavity.volume).toBe(875000)
    expect(surfaceMetrics(cavity.positions).volume).toBeCloseTo(875000, 0)
    expect(surfaceMetrics(cavity.positions).area).toBeCloseTo(75000, 1)
    const cutter = { ...box('b', [0, 0, 0], 50), depth: 200 }
    expect(evaluateConstructionObjects(shape('subtract', box('a'), cutter))[0].volume).toBe(750000)
  })

  it('treats root visibility as display metadata without disabling a hidden cutter', () => {
    const objects = shape('subtract')
    objects.nodes[1].visible = false
    expect(evaluateConstructionObjects(objects)[0].volume).toBe(500000)
    objects.nodes[2].visible = false
    expect(evaluateConstructionObjects(objects)).toEqual([])
  })

  it('preserves fractional dimensions and quarter turns', () => {
    const rotated = { ...box('a', [12.25, 22.5, 0]), width: 100.5, height: 80.25, depth: 20.125, rotation: [0, Math.PI / 2, 0] as Vec3 }
    const objects = { roots: ['a'], nodes: [rotated] }
    const [result] = evaluateConstructionObjects(objects)
    expect(result.volume).toBeCloseTo(100.5 * 80.25 * 20.125, 8)
    expect(result.bounds).toEqual({ min: [2.1875, -17.625, -50.25], max: [22.3125, 62.625, 50.25] })
  })

  it('rejects expensive coordinate subdivisions before allocating a huge grid', () => {
    const boxes = Array.from({ length: 50 }, (_, index) => box(`box-${index}`, [index * 10, index * 11, index * 12], 5))
    const objects: ConstructionObjects = { roots: ['union'], nodes: [...boxes,
      { id: 'union', name: 'Union', visible: true, kind: 'boolean', operation: 'union', children: boxes.map(box => box.id) }] }
    expect(() => evaluateConstructionObjects(objects)).toThrow('too complex')
  })
})

describe('object group transforms', () => {
  it('moves every leaf once even when its ancestor is also selected, without mutating the source', () => {
    const objects = shape('subtract'), before = structuredClone(objects)
    const moved = moveConstructionSelection(objects, ['result', 'a'], [100, 10, -20])
    expect(moved.nodes[0]).toMatchObject({ position: [100, 10, -20] })
    expect(moved.nodes[1]).toMatchObject({ position: [150, 10, -20] })
    expect(objects).toEqual(before)
  })

  it('rotates a whole group around its source center and restores it after four turns', () => {
    const objects = shape('union'), before = constructionBounds(objects, ['result'])!
    let rotated = rotateConstructionSelection(objects, ['result'], 2)
    const bounds = constructionBounds(rotated, ['result'])!
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(before.max[1] - before.min[1])
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(before.max[0] - before.min[0])
    for (let i = 0; i < 3; i++) rotated = rotateConstructionSelection(rotated, ['result'], 2)
    for (const node of rotated.nodes) if (node.kind === 'box') {
      const original = objects.nodes.find(item => item.id === node.id) as typeof node
      node.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis]))
    }
    expect(evaluateConstructionObjects(rotated)[0].volume).toBeCloseTo(1500000)
  })

  it('scales along world axes with rotated leaves and rejects stock source limits atomically', () => {
    const a = { ...box('a'), width: 100, depth: 200, rotation: [0, Math.PI / 2, 0] as Vec3 }
    const objects = { roots: ['a'], nodes: [a] }
    const resized = resizeConstructionSelection(objects, ['a'], 0, 400)
    expect(resized.nodes[0]).toMatchObject({ width: 100, depth: 400 })
    expect(() => resizeConstructionSelection(objects, ['a'], 0, 20000)).toThrow()
    expect(objects.nodes[0].depth).toBe(200)
  })
})

it('merges rotation roundoff without erasing small real gaps or cavities', () => {
  const touching = evaluateConstructionObjects(shape('union', box('a'), box('b', [100 + 1e-13, 0, 0])), true)[0]
  expect(touching.cuboid).toBe(true)
  const separated = evaluateConstructionObjects(shape('union', box('a'), box('b', [100 + 1e-6, 0, 0])), true)[0]
  expect(separated.cuboid).toBe(false)
  expect(separated.solids).toHaveLength(2)
  const cavity = evaluateConstructionObjects(shape('subtract', box('a'), { ...box('b'), width: 1, height: 1, depth: 1 }), true)[0]
  expect(cavity.cuboid).toBe(false)
  expect(cavity.solids?.[0].cross).toBeUndefined()
})
