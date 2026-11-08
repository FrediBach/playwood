import { expect, it } from 'vitest'
import { evaluateConstructionObjects, moveConstructionSelection } from './object-geometry'
import { resizeObjectEdge } from './object-edit'
import { reuseObjectPreview } from './object-preview'
import type { ConstructionObjects } from './types'

function source(): ConstructionObjects {
  return { roots: ['shape', 'fixed'], nodes: [
    { id: 'a', name: 'a', kind: 'box', visible: true, width: 200, height: 200, depth: 200, position: [0, 0, 0], rotation: [0, 0, 0] },
    { id: 'b', name: 'b', kind: 'box', visible: false, width: 100, height: 100, depth: 300, position: [50, 0, 0], rotation: [0, 0, 0] },
    { id: 'shape', name: 'shape', kind: 'boolean', visible: true, operation: 'subtract', children: ['a', 'b'] },
    { id: 'fixed', name: 'fixed', kind: 'box', visible: true, width: 100, height: 100, depth: 100, position: [400, 0, 0], rotation: [0, 0, 0] },
  ] }
}
it('translates Boolean surfaces immediately and retains stationary geometry without mutating the source', () => {
  const objects = source(), surfaces = evaluateConstructionObjects(objects)
  const original = surfaces[0].positions.slice()
  const moved = moveConstructionSelection(objects, ['shape'], [80, 0, -20])
  const reused = reuseObjectPreview(objects, moved, surfaces)
  const evaluated = evaluateConstructionObjects(moved)
  expect(reused).toHaveLength(2)
  expect(reused[1]).toBe(surfaces[1])
  expect(reused[0].volume).toBe(evaluated[0].volume)
  reused[0].positions.forEach((value, index) => expect(value).toBeCloseTo(evaluated[0].positions[index], 6))
  expect(surfaces[0].positions).toEqual(original)
})
it('invalidates changed operands and operations without clearing unrelated roots', () => {
  const objects = source(), surfaces = evaluateConstructionObjects(objects)
  const changed = moveConstructionSelection(objects, ['b'], [20, 0, 0])
  expect(reuseObjectPreview(objects, changed, surfaces)).toEqual([surfaces[1]])
  const reordered = structuredClone(objects)
  const root = reordered.nodes[2]
  if (root.kind !== 'boolean') throw new Error('Expected Boolean')
  root.children.reverse()
  expect(reuseObjectPreview(objects, reordered, surfaces)).toEqual([surfaces[1]])
  root.children.reverse(); root.operation = 'union'
  expect(reuseObjectPreview(objects, reordered, surfaces)).toEqual([surfaces[1]])
})
it('does not reuse hidden, removed or rotated roots', () => {
  const objects = source(), surfaces = evaluateConstructionObjects(objects)
  for (const edit of ['hide', 'remove', 'rotate']) {
    const changed = structuredClone(objects), box = changed.nodes[3]
    if (box.kind !== 'box') throw new Error('Expected box')
    if (edit === 'hide') box.visible = false
    if (edit === 'remove') { changed.roots.pop(); changed.nodes.pop() }
    if (edit === 'rotate') box.rotation[0] = Math.PI / 2
    expect(reuseObjectPreview(objects, changed, surfaces)).toEqual([surfaces[0]])
  }
})

for (const ids of [['fixed'], ['shape'], ['shape', 'fixed']]) it(`reuses resized ${ids.join('/')} surfaces exactly while refreshing clearance warnings`, () => {
  const objects = source(), surfaces = evaluateConstructionObjects(objects)
  const original = surfaces.map(surface => surface.positions.slice())
  for (const axis of [0, 1, 2] as const) for (const distance of [-50, 80]) {
    const resized = resizeObjectEdge(objects, ids, { axis, side: 1 }, distance)
    const reused = reuseObjectPreview(objects, resized, surfaces), evaluated = evaluateConstructionObjects(resized)
    expect(reused).toHaveLength(2)
    reused.forEach((surface, i) => {
      expect(surface.volume).toBeCloseTo(evaluated[i].volume, 5)
      expect(surface.positions.length).toBe(evaluated[i].positions.length)
      surface.positions.forEach((value, j) => expect(value).toBeCloseTo(evaluated[i].positions[j], 6))
      if (ids.includes(surface.id)) {
        expect(surface.warningsPending).toBe(true)
        expect(surface.warningPositions).toBeUndefined()
      } else expect(surface).toBe(surfaces[i])
    })
  }
  surfaces.forEach((surface, i) => expect(surface.positions).toEqual(original[i]))
})
it('rejects resizing only one Boolean operand', () => {
  const objects = source(), surfaces = evaluateConstructionObjects(objects)
  expect(reuseObjectPreview(objects, resizeObjectEdge(objects, ['b'], { axis: 0, side: 1 }, 40), surfaces)).toEqual([surfaces[1]])
})
it('reuses rotated box resizing and drops warnings when a narrow box grows', () => {
  const objects = source(), box = objects.nodes[3]
  if (box.kind !== 'box') throw new Error('Expected box')
  box.rotation = [0, Math.PI / 2, 0]
  box.depth = 50
  const surfaces = evaluateConstructionObjects(objects)
  expect(surfaces[1].warningPositions?.length).toBeGreaterThan(0)
  const resized = resizeObjectEdge(objects, ['fixed'], { axis: 0, side: -1 }, 100)
  const reused = reuseObjectPreview(objects, resized, surfaces)[1]
  const evaluated = evaluateConstructionObjects(resized)[1]
  reused.positions.forEach((value, i) => expect(value).toBeCloseTo(evaluated.positions[i], 6))
  expect(reused.warningsPending).toBe(true)
  expect(reused.warningPositions).toBeUndefined()
  expect(evaluated.warningPositions?.length ?? 0).toBe(0)
})
