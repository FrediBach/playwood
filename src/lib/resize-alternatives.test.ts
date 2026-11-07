import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, parseProject, resolvePanels, validateProject } from './model'
import { acceptResizeAlternative, getResizeAlternatives, resizePanels, StructureEditError } from './structure-edit'
import type { Project } from './types'

function fixture(childHeight = 300): Project {
  const parent = createPanel({ id: 'parent', name: 'Parent', width: 600, height: 400, position: [0, 800, 0] })
  const connected = attachPanel({ version: 1, name: 'Setback review', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'child', name: 'Child', width: 400, height: childHeight }),
    { type: '90', side: 'right', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 })
  return { ...connected, constraints: [{ id: 'fixed', enabled: true, kind: 'dimension', panelId: 'child', dimension: 'height', value: childHeight }] }
}

describe('reviewed inferred resize relationships', () => {
  it('offers individual setback releases while keeping the authored cut, joints, and opposite setback', () => {
    const before = fixture()
    const snapshot = JSON.stringify(before)
    expect(validateProject(before)).toEqual([])
    expect(() => resizePanels(before, ['parent'], { height: 500 })).toThrow(StructureEditError)
    const review = getResizeAlternatives(before, ['parent'], { height: 500 })!
    expect(review.alternatives).toHaveLength(2)
    for (const [index, alternative] of review.alternatives.entries()) {
      expect(alternative.relaxed.kind).toBe('setback')
      expect(alternative.relaxed.panelIds).toEqual(['parent', 'child'])
      const panels = resolvePanels(alternative.project)
      expect(panels[0].height).toBe(500)
      expect(panels[0].position).toEqual(before.panels[0].position)
      expect(panels[1].height).toBe(300)
      expect(Math.abs(alternative.project.connections[0].offset)).toBeCloseTo(50)
      expect(alternative.project.constraints).toEqual(before.constraints)
      expect(alternative.project.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
      expect(validateProject(alternative.project)).toEqual([])
      expect(parseProject(alternative.project).panels).toEqual(alternative.project.panels)
      expect(alternative.changes.map(change => change.after.id)).toEqual(['parent', 'child'])
      expect(acceptResizeAlternative(before, review, index)).toBe(alternative.project)
    }
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(() => acceptResizeAlternative({ ...before }, review, 0)).toThrow(/project changed/)
    expect(() => acceptResizeAlternative(before, review, 99)).toThrow(/Choose/)
  })

  it('never offers to release authored dimensions or invalid requested stock sizes', () => {
    const before = fixture()
    before.constraints!.push({ id: 'parent-fixed', enabled: true, kind: 'dimension', panelId: 'parent', dimension: 'height', value: 400 })
    expect(getResizeAlternatives(before, ['parent'], { height: 500 })).toBeNull()
    expect(getResizeAlternatives(fixture(), ['parent'], { height: 4001 })).toBeNull()
  })

  it('excludes alternatives that introduce panel overlaps', () => {
    const before = fixture()
    const child = resolvePanels(before)[1]
    const obstacle = createPanel({ ...child, id: 'obstacle', name: 'Obstacle', height: 40,
      position: [child.position[0], child.position[1] + 171, child.position[2]] })
    const blocked = { ...before, panels: [...before.panels, obstacle] }
    expect(validateProject(blocked)).toEqual([])
    const review = getResizeAlternatives(blocked, ['parent'], { height: 500 })!
    expect(review.alternatives).toHaveLength(1)
    expect(review.alternatives[0].project.connections[0].offset).toBeCloseTo(-50)
    expect(validateProject(review.alternatives[0].project)).toEqual([])
  })

  it.each([200, 200.01])('retains protective defaults at the overlap threshold for a %s mm child', height => {
    const before = { ...fixture(height), constraints: [] }
    const next = resizePanels(before, ['parent'], { height: 500 })
    expect(next.panels[1].height).toBeCloseTo(height === 200 ? 200 : 300.01)
    expect(getResizeAlternatives(before, ['parent'], { height: 500 })).toBeNull()
  })
})
