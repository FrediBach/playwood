import { expect, it, vi } from 'vitest'
import * as kernel from './structural-solver'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { preparePreviewResize, movePreviewResize, finishPreviewResize } from './preview-resize'
import { resizePanelEdge, movePanels } from './structure-edit'
import { resolvePanels, validateProject } from './model'

it.each([-1, 1] as const)('widens the 900 mm synth panels from side %s with the same geometry as independent solves', side => {
  const source = synthStorageShelfProject()
  const original = structuredClone(source)
  const panel = source.panels.find(panel => panel.name === 'Synth tray 1')!
  const session = preparePreviewResize(source, { panelId: panel.id })!
  const handle = `panel-width-${side === 1 ? 'positive' : 'negative'}`
  for (const distance of [8, 16, 100, 200, 53, -24]) {
    const result = movePreviewResize(session, handle, distance)
    expect(result.limited, result.reason).toBe(false)
    expect(finishPreviewResize(session, handle, result).distance).toBe(distance)
    const expected = resolvePanels(resizePanelEdge(source, panel.id, 'width', side, distance))
    for (const [index, actual] of resolvePanels(result.project).entries()) {
      expect(actual.width).toBeCloseTo(expected[index].width, 4)
      expect(actual.height).toBeCloseTo(expected[index].height, 4)
      actual.position.forEach((value, axis) => expect(value).toBeCloseTo(expected[index].position[axis], 4))
    }
    for (const before of source.panels.filter(item => item.width === 900)) {
      expect(result.project.panels.find(item => item.id === before.id)!.width).toBeCloseTo(900 + distance, 4)
    }
    expect(validateProject(result.project)).toEqual(validateProject(source))
  }
  expect(source).toEqual(original)
}, 20000)

// Count solver work instead of using a machine-dependent wall-clock assertion.
it('does not solve again for every already-preserved synth/storage cut', () => {
  const source = synthStorageShelfProject()
  const panel = source.panels.find(panel => panel.name === 'Synth tray 1')!
  const calls = vi.spyOn(kernel, 'solveWithBounds')
  try {
    const result = resizePanelEdge(source, panel.id, 'width', 1, 8)
    expect(result.panels.find(item => item.id === panel.id)!.width).toBeCloseTo(908, 5)
    expect(calls.mock.calls.length).toBe(1)
  } finally { calls.mockRestore() }
})

it('wide-shelf resizing and pulling the side produce matching cuts', () => {
  const source = synthStorageShelfProject()
  const tray = source.panels.find(panel => panel.name === 'Synth tray 1')!
  const side = source.panels.find(panel => panel.name === 'Upright 2.1')!
  for (const distance of [-40, 8, 200]) {
    const wide = resizePanelEdge(source, tray.id, 'width', 1, distance)
    const pulled = movePanels(source, [side.id], [distance, 0, 0])
    wide.panels.forEach((panel, index) => {
      expect(panel.width).toBeCloseTo(pulled.panels[index].width, 4)
      expect(panel.height).toBeCloseTo(pulled.panels[index].height, 4)
    })
  }
})
