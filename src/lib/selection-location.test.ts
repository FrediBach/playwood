import { expect, it } from 'vitest'
import { createPanel } from './model'
import { connectorId } from './connector-selection'
import { connectorLocation, objectLocation, panelLocation } from './selection-location'
import type { Project } from './types'

const fixture = (): Project => ({ version: 1, name: 'Location', panels: [
  createPanel({ id: 'a', width: 600, height: 400, thickness: 18, position: [0, 200, 0] }),
  createPanel({ id: 'b', width: 600, height: 400, thickness: 18, position: [9999, 9999, 9999] }),
], connections: [{ id: 'joint', parentId: 'a', childId: 'b', type: '90', side: 'top', offset: 0, inset: 0, flip: false, color: '#ffffff', count: 1 }] })

it('measures connected panels in world space instead of their saved transform', () => {
  const location = panelLocation(fixture(), ['b'])!
  expect(location.min[1]).toBeCloseTo(408.5)
  expect(location.max[1]).toBeCloseTo(426.5)
  expect(location.rotation![0]).toBeCloseTo(Math.PI / 2)
  expect(panelLocation(fixture(), ['a', 'b'])!.rotation).toBeUndefined()
  expect(panelLocation(fixture(), [])).toBeNull()
})

it('includes individual hardware slide and omits removed pieces', () => {
  const project = fixture(), id = connectorId('joint', 0)
  const before = connectorLocation(project, [id])!
  project.connectorOverrides = { [id]: { slide: 50 } }
  const after = connectorLocation(project, [id])!
  expect(Math.abs(after.min[0] - before.min[0])).toBeCloseTo(50)
  expect(after.max[0] - after.min[0]).toBeCloseTo(before.max[0] - before.min[0])
  project.connectorOverrides[id].removed = true
  expect(connectorLocation(project, [id])).toBeNull()
})

it('shows rotated source bounds and signed below-ground clearance', () => {
  const location = objectLocation({ roots: ['box'], nodes: [{ id: 'box', kind: 'box', name: 'Box', visible: true,
    width: 100, height: 200, depth: 300, position: [20, 50, 40], rotation: [0, 0, Math.PI / 2] }] }, ['box'])!
  expect(location.min).toEqual([-80, 0, -110])
  expect(location.max).toEqual([120, 100, 190])
  const project = fixture(); project.panels[0].position[1] = 100
  expect(panelLocation(project, ['a'])!.min[1]).toBe(-100)
})
