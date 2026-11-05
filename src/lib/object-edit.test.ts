import { describe, expect, it } from 'vitest'
import { objectResizeHandles, objectSnapTargets, previewObjectResize, resizeObjectEdge, snapObjectDelta } from './object-edit'
import { constructionBounds } from './object-geometry'
import { createPanel } from './model'
import type { ConstructionObjects } from './types'

const objects = (): ConstructionObjects => ({ roots: ['a', 'b'], nodes: [
  { id: 'a', name: 'A', kind: 'box', visible: true, width: 200, height: 300, depth: 100, position: [0, 150, 0], rotation: [0, 0, 0] },
  { id: 'b', name: 'B', kind: 'box', visible: true, width: 200, height: 300, depth: 100, position: [400, 150, 0], rotation: [0, 0, 0] },
] })
const geometry = { grid: false, geometry: true, spacing: 50, tolerance: 10 }

describe('object gesture geometry', () => {
  it.each([-1, 1] as const)('resizes the %s X edge while keeping the opposite face fixed', side => {
    const source = objects(), before = structuredClone(source)
    const resized = resizeObjectEdge(source, ['a'], { axis: 0, side }, 80)
    const bounds = constructionBounds(resized, ['a'])!
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(280)
    expect(side > 0 ? bounds.min[0] : bounds.max[0]).toBe(side > 0 ? -100 : 100)
    expect(resized.nodes[1]).toEqual(before.nodes[1])
    expect(source).toEqual(before)
  })

  it('scales all selected source boxes once, including rotated and nested leaves', () => {
    const source = objects()
    if (source.nodes[1].kind === 'box') source.nodes[1].rotation = [0, Math.PI / 2, 0]
    source.roots = ['union']
    source.nodes.push({ id: 'union', name: 'Union', kind: 'boolean', visible: true, operation: 'union', children: ['a', 'b'] })
    const before = constructionBounds(source, ['union'])!
    const resized = resizeObjectEdge(source, ['union', 'a'], { axis: 0, side: 1 }, 100)
    const bounds = constructionBounds(resized, ['union'])!
    bounds.min.forEach((value, axis) => expect(value).toBeCloseTo(before.min[axis], 8))
    expect(bounds.max[0]).toBeCloseTo(before.max[0] + 100)
    expect(resized.nodes[1]).toMatchObject({ width: 200, height: 300, depth: 100 * 650 / 550 })
  })

  it('rejects collapsing, non-finite and oversized resizes without mutating the source', () => {
    const source = objects(), before = structuredClone(source)
    for (const distance of [-200, -500, 10000, NaN, Infinity]) expect(() => resizeObjectEdge(source, ['a'], { axis: 0, side: 1 }, distance)).toThrow()
    expect(source).toEqual(before)
    expect(objectResizeHandles(source, [])).toEqual([])
  })

  it('snaps moving and resizing edges to neighboring source boxes and panel boundaries', () => {
    const source = objects()
    expect(snapObjectDelta(source, ['a'], [], [194, 0, 0], geometry)).toEqual([200, 0, 0])
    const resized = previewObjectResize(source, ['a'], [], { axis: 0, side: 1 }, 194, geometry)
    expect(resized.distance).toBe(200)
    expect(constructionBounds(resized.objects, ['a'])!.max[0]).toBe(300)
    const panel = createPanel({ width: 100, height: 200, position: [230, 150, 0] })
    expect(snapObjectDelta(source, ['a'], [panel], [74, 0, 0], geometry)).toEqual([80, 0, 0])
    expect(snapObjectDelta(source, ['a'], [{ ...panel, visible: false }], [74, 0, 0], geometry)).toEqual([74, 0, 0])
  })

  it('excludes selected descendants and hidden roots from snapping targets', () => {
    const source = objects()
    source.nodes[1].visible = false
    expect(objectSnapTargets(source, ['a'], [])).toEqual([])
    source.nodes[1].visible = true
    expect(objectSnapTargets(source, ['a', 'b'], [])).toEqual([])
    source.roots = ['union']
    source.nodes.push({ id: 'union', name: 'Union', kind: 'boolean', visible: true, operation: 'union', children: ['a', 'b'] })
    expect(objectSnapTargets(source, ['union'], [])).toEqual([])
  })

  it('snaps to the world grid without changing stationary axes or trapping keyboard movement', () => {
    const grid = { ...geometry, geometry: false, grid: true }
    expect(snapObjectDelta(objects(), ['a'], [], [43, 0, 0], grid)).toEqual([50, 0, 0])
    expect(snapObjectDelta(objects(), ['a'], [], [10, 0, 0], grid, true)).toEqual([10, 0, 0])
    expect(snapObjectDelta(objects(), ['a'], [], [43, 0, 0], { ...grid, grid: false })).toEqual([43, 0, 0])
  })
})
