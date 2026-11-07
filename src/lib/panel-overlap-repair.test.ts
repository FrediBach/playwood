import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, parseProject, validateProject } from './model'
import { repairPanelOverlaps } from './panel-overlap-repair'
import type { Project } from './types'

const fixture = (): Project => ({ ...createStarterProject('blank'), panels: [
  createPanel({ id: 'a', name: 'First', width: 200, height: 200, position: [0, 200, 0] }),
  createPanel({ id: 'b', name: 'Second', width: 200, height: 200, position: [190, 200, 0] }),
] })

describe('reviewed panel overlap repair', () => {
  it('removes overlaps without mutating the source and survives serialization', () => {
    const source = fixture(), snapshot = JSON.stringify(source)
    const next = repairPanelOverlaps(source, 'a')
    expect(validateProject(next)).toEqual([])
    expect(JSON.stringify(source)).toBe(snapshot)
    expect(next.panels.map(panel => panel.id)).toEqual(['a', 'b'])
    expect(parseProject(JSON.parse(JSON.stringify(next))).panels).toEqual(next.panels)
  })
  it('repairs rotated panels using their local axes', () => {
    const source = fixture()
    source.panels[1].rotation = [0, 0, Math.PI / 4]
    expect(validateProject(repairPanelOverlaps(source, 'a'))).toEqual([])
  })
  it('rejects a repair blocked by fixed positions without changing the source', () => {
    const source = fixture()
    source.constraints = source.panels.flatMap(panel => (['x', 'y', 'z'] as const).map((axis, index) => ({
      id: `${panel.id}-${axis}`, enabled: true, kind: 'position' as const, panelId: panel.id, axis, reference: 'center' as const, value: panel.position[index],
    })))
    const snapshot = JSON.stringify(source)
    expect(() => repairPanelOverlaps(source, 'a')).toThrow(/No automatic repair/)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('leaves a valid construction unchanged', () => {
    const source = createStarterProject()
    expect(repairPanelOverlaps(source, source.panels[0].id)).toBe(source)
  })
})
