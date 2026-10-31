import { describe, expect, it } from 'vitest'
import { createPanel } from './model'
import { DEFAULT_SNAP, panelSnapPoints, snapDistance, snapPanelDelta, snapTargets } from './preview-snap'
import { movePreviewResize, preparePreviewResize } from './preview-resize'
import type { Project } from './types'

const grid = { ...DEFAULT_SNAP, grid: true }
const geometry = { ...DEFAULT_SNAP, geometry: true }
describe('preview snapping', () => {
  it('is optional and snaps absolute coordinates on either side of the origin', () => {
    expect(snapDistance([13, 0, 0], [1, 0, 0], 34, [], DEFAULT_SNAP)).toBe(34)
    expect(snapDistance([13, 0, 0], [1, 0, 0], 34, [], grid)).toBe(37)
    expect(snapDistance([-13, 0, 0], [-1, 0, 0], 34, [], grid)).toBe(37)
    expect(snapDistance([13, 0, 0], [1, 0, 0], 12, [], grid)).toBe(12)
  })
  it('uses the closest target when both modes are enabled and preserves a diagonal rail', () => {
    const direction: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0]
    const result = snapDistance([0, 0, 0], direction, 69, [[48, 500, 0]], { ...grid, geometry: true })
    expect(result * direction[0]).toBeCloseTo(48)
    expect(result * direction[1]).toBeCloseTo(48)
  })
  it('excludes selected and hidden panels and preserves rigid selection offsets', () => {
    const a = createPanel({ width: 100, height: 100, position: [0, 0, 0] })
    const b = createPanel({ width: 100, height: 100, position: [209, 0, 0] })
    const hidden = createPanel({ visible: false, position: [201, 0, 0] })
    const project: Project = { version: 1, name: '', panels: [a, b, hidden], connections: [] }
    expect(snapTargets(project, [a.id])).toEqual(panelSnapPoints(b))
    expect(snapPanelDelta(project.panels, [a.id], [103, 0, 0], geometry)).toEqual([109, 0, 0])
    expect(snapPanelDelta([a, b], [a.id, b.id], [103, 0, 0], geometry)).toEqual([103, 0, 0])
  })
  it('keeps an already aligned boundary instead of snapping a different boundary', () => {
    const panel = createPanel({ width: 107, position: [3.5, 0, 0] })
    expect(snapPanelDelta([panel], [panel.id], [50, 0, 0], grid)).toEqual([50, 0, 0])
    expect(snapPanelDelta([panel], [panel.id], [50, 0, 0], grid, true)).toEqual([50, 0, 0])
  })
  it('resizes to the global grid while keeping the opposite edge fixed', () => {
    const panel = createPanel({ width: 100, height: 100, position: [13, 0, 0] })
    const project: Project = { version: 1, name: '', panels: [panel], connections: [] }
    const session = preparePreviewResize(project, { panelId: panel.id })!
    const handle = session.handles.find(h => h.id === 'panel-width-positive')!
    const distance = snapDistance(handle.position, handle.direction, 34, [], grid)
    const result = movePreviewResize(session, handle.id, distance)
    expect(result.project.panels[0].position[0] + result.project.panels[0].width / 2).toBe(100)
    expect(result.project.panels[0].position[0] - result.project.panels[0].width / 2).toBe(-37)
    expect(panel.width).toBe(100)
  })
})
