import { describe, expect, it } from 'vitest'
import { gridProject } from '@/lib/example-geometry'
import { createPanel, getProjectBounds, resolvePanels } from '@/lib/model'
import { movePreviewResize } from '@/lib/preview-resize'
import type { Panel, Project } from '@/lib/types'
import { createSelectionPreparations } from './selection-preparations'

const projectOf = (...panels: Panel[]): Project => ({ version: 1, name: 'Selection preparations', panels, connections: [] })

describe('selection preparations', () => {
  it('reuses a revisited selection while keeping different panels and their candidates separate', () => {
    const first = createPanel({ width: 400, height: 300, position: [0, 500, 0] })
    const second = createPanel({ width: 600, height: 300, position: [1000, 500, 0] })
    const project = projectOf(first, second)
    const before = structuredClone(project)
    const preparations = createSelectionPreparations(project)
    const firstResize = preparations.resize({ panelId: first.id })!
    const firstGround = preparations.ground(first.id)
    const secondResize = preparations.resize({ panelId: second.id })!
    const secondGround = preparations.ground(second.id)

    expect(preparations.resize({ panelId: first.id })).toBe(firstResize)
    expect(preparations.ground(first.id)).toBe(firstGround)
    expect(secondResize).not.toBe(firstResize)
    expect(secondGround).not.toBe(firstGround)
    expect(movePreviewResize(firstResize, 'panel-width-positive', 50).project.panels[0].width).toBe(450)
    expect(movePreviewResize(secondResize, 'panel-width-positive', 50).project.panels[1].width).toBe(650)
    expect(getProjectBounds([resolvePanels(firstGround.result!.project)[0]]).min[1]).toBeCloseTo(0)
    expect(firstGround.result!.project.panels[1]).toEqual(second)
    expect(project).toEqual(before)
  })

  it('preserves the order of multi-panel selections in separate preparations', () => {
    const project = gridProject('Two cells', [350], [300, 300])
    const names = ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2']
    const panelIds = names.map(name => project.panels.find(panel => panel.name === name)!.id)
    const preparations = createSelectionPreparations(project)
    const forward = preparations.resize({ panelIds })!
    const reversedIds = [...panelIds].reverse()
    const backward = preparations.resize({ panelIds: reversedIds })!

    expect(forward).not.toBeNull()
    expect(backward).not.toBeNull()
    expect(backward).not.toBe(forward)
    expect(backward.selection.panelIds).toEqual(reversedIds)
    expect(preparations.resize({ panelIds: [...panelIds] })).toBe(forward)
    expect(forward.selection.panelIds).toEqual(panelIds)
  })

  it('prepares changed snapshots independently even when panel IDs stay the same', () => {
    const panel = createPanel({ width: 400, height: 300, position: [0, 500, 0] })
    const project = projectOf(panel)
    const original = createSelectionPreparations(project)
    const firstResize = original.resize({ panelId: panel.id })!
    const firstGround = original.ground(panel.id)
    const updated = projectOf({ ...panel, width: 600, position: [0, 600, 0] })
    const changed = createSelectionPreparations(updated)
    const nextResize = changed.resize({ panelId: panel.id })!
    const nextGround = changed.ground(panel.id)

    expect(nextResize.original).toBe(updated)
    expect(nextResize).not.toBe(firstResize)
    expect(nextGround).not.toBe(firstGround)
    expect(movePreviewResize(nextResize, 'panel-width-positive', 50).project.panels[0].width).toBe(650)
    expect(firstGround.result!.to).toBe(650)
    expect(nextGround.result!.to).toBe(750)
    expect(original.resize({ panelId: panel.id })).toBe(firstResize)
    expect(original.ground(panel.id)).toBe(firstGround)
  })

  it('retains unavailable ground results and accepts selections without resize handles', () => {
    const panel = createPanel({ visible: false })
    const project = projectOf(panel)
    const preparations = createSelectionPreparations(project)
    const unavailable = preparations.ground(panel.id)

    expect(unavailable.result).toBeUndefined()
    expect(unavailable.reason).toMatch(/visible/)
    expect(preparations.ground(panel.id)).toBe(unavailable)
    expect(preparations.resize({ panelId: panel.id })).toBeNull()
    expect(preparations.resize({ panelId: panel.id })).toBeNull()
    expect(preparations.resize({})).toBeNull()
    const shown = createSelectionPreparations(projectOf({ ...panel, visible: true, position: [0, 500, 0] }))
    expect(shown.resize({ panelId: panel.id })).not.toBeNull()
    expect(shown.ground(panel.id).result).toBeDefined()
  })

  it.each(['resize', 'ground'] as const)('bounds retained %s results and keeps recently revisited selections', operation => {
    const panels = Array.from({ length: 9 }, (_, index) => createPanel({ width: 400, height: 300, position: [index * 1000, 500, 0] }))
    const preparations = createSelectionPreparations(projectOf(...panels))
    const read = (index: number) => operation === 'resize'
      ? preparations.resize({ panelId: panels[index].id })
      : preparations.ground(panels[index].id)
    const first = read(0)
    const second = read(1)
    for (let index = 2; index < 8; index++) read(index)
    expect(read(0)).toBe(first)
    read(8)
    expect(read(0)).toBe(first)
    expect(read(1)).not.toBe(second)
  })
})
