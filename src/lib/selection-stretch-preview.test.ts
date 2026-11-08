import { describe, expect, it } from 'vitest'
import { resolvePanels, validateProject } from './model'
import { finishPreviewResize, movePreviewResize, preparePreviewResize } from './preview-resize'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { roundTripProject } from '../test/project-round-trip'

const selectedIds = (project: ReturnType<typeof synthStorageShelfProject>) => project.panels
  .filter(panel => !panel.name.startsWith('Storage ') && !['Upright 1.1', 'Upright 2.1'].includes(panel.name)).map(panel => panel.id)

describe('selection stretch previews', () => {
  it('offers both vertical arrows and previews from the immutable source in either direction', () => {
    const project = synthStorageShelfProject()
    const snapshot = JSON.stringify(project)
    const session = preparePreviewResize(project, { panelIds: selectedIds(project) })!
    const up = session.handles.find(handle => handle.direction[1] > .999 && !handle.blocked)!
    const down = session.handles.find(handle => handle.direction[1] < -.999 && !handle.blocked)!
    expect(up.affectedPanelIds).toHaveLength(2)
    expect(up.panelEdge).toBeFalsy()
    expect(up.panelHandle).toBeFalsy()
    for (const [handle, amount] of [[up, 100], [down, -100]] as const) {
      const result = movePreviewResize(session, handle.id, amount)
      expect(result.limited).toBe(false)
      const panels = resolvePanels(result.project)
      for (const original of resolvePanels(project)) {
        const panel = panels.find(item => item.id === original.id)!
        if (selectedIds(project).includes(panel.id)) {
          expect(panel.position[1]).toBeCloseTo(original.position[1] + 100, 4)
          expect(panel.width).toBe(original.width)
          expect(panel.height).toBe(original.height)
        } else if (up.affectedPanelIds!.includes(panel.id)) {
          expect(panel.width).toBeCloseTo(original.width + 100, 4)
        } else expect(panel).toEqual(original)
      }
      expect(roundTripProject(result.project)).toEqual(result.project)
    }
    expect(JSON.stringify(project)).toBe(snapshot)
    expect(movePreviewResize(session, up.id, 0).project).toBe(project)
  })

  it('stops a push at clearance and allows reversing without altering the cabinet', () => {
    const project = synthStorageShelfProject()
    const session = preparePreviewResize(project, { panelIds: selectedIds(project) })!
    const handle = session.handles.find(handle => handle.direction[1] > .999 && !handle.blocked)!
    const result = movePreviewResize(session, handle.id, -500)
    expect(result.limited).toBe(true)
    expect(result.distance).toBeLessThan(-1)
    expect(result.distance).toBeGreaterThan(-250)
    expect(result.reason).toMatch(/overlap|hardware|connector|clearance/i)
    expect(validateProject(result.project)).toEqual([])
    const before = resolvePanels(project).filter(panel => panel.name.startsWith('Storage '))
    expect(resolvePanels(result.project).filter(panel => panel.name.startsWith('Storage '))).toEqual(before)
    const reversed = movePreviewResize(session, handle.id, 50)
    expect(reversed.limited).toBe(false)
    expect(reversed.distance).toBe(50)
  })

  it('rounds the released connecting cut while preserving the selected geometry', () => {
    const project = { ...synthStorageShelfProject(), niceValues: { enabled: true, step: 10 } }
    const session = preparePreviewResize(project, { panelIds: selectedIds(project) })!
    const handle = session.handles.find(handle => handle.direction[1] > .999 && !handle.blocked)!
    const result = finishPreviewResize(session, handle.id, movePreviewResize(session, handle.id, 103))
    expect(result.limited).toBe(false)
    for (const id of handle.affectedPanelIds!) {
      const panel = result.project.panels.find(item => item.id === id)!
      expect(panel.width).toBeCloseTo(450, 4)
    }
    expect(result.project.constraints).toEqual(project.constraints)
  })

  it('does not offer group arrows for ambiguous selection APIs or the whole construction', () => {
    const project = synthStorageShelfProject()
    const panelIds = selectedIds(project)
    expect(preparePreviewResize(project, { panelId: panelIds[0], panelIds })).toBeNull()
    expect(preparePreviewResize(project, { connectorId: 'unknown', panelIds })).toBeNull()
    expect(preparePreviewResize(project, { panelIds: [] })).toBeNull()
    expect(preparePreviewResize(project, { panelIds: project.panels.map(panel => panel.id) })).toBeNull()
  })
})
