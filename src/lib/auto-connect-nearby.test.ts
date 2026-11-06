import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { autoConnectNearby } from './auto-connect-nearby'
import { attachPanel, createPanel, resolvePanels, rotateProject, validateProject } from './model'
import type { Project } from './types'

function looseJoint(distance = 75): Project {
  const parent = createPanel({ id: 'parent', width: 300, height: 300, position: [0, 700, 0] })
  const joint = attachPanel({ version: 1, name: 'Nearby', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'loose', width: 300, height: 300 }),
    { type: '90', side: 'top', flip: false, offset: 0, inset: 0, count: 2, color: '#222222' })
  return { ...joint, panels: resolvePanels(joint).map(panel => panel.id === 'loose'
    ? { ...panel, position: [panel.position[0], panel.position[1] + distance, panel.position[2]] } : panel), connections: [] }
}

describe('generous explicit auto connect', () => {
  it.each([false, true])('moves a loose panel up to 100 mm without resizing (rotated: %s)', rotated => {
    const source = rotated ? rotateProject(rotateProject(looseJoint(), 'z', 17), 'y', 31) : looseJoint()
    const before = structuredClone(source)
    const result = autoConnectNearby(source, ['loose'])
    expect(result.movedPanelIds).toEqual(['loose'])
    expect(result.connectors).toBe(2)
    expect(result.project.panels[0]).toEqual(source.panels[0])
    expect(result.project.panels[1].width).toBe(source.panels[1].width)
    expect(result.project.panels[1].height).toBe(source.panels[1].height)
    expect(validateProject(result.project)).toEqual([])
    expect(roundTripProject(result.project).connections).toEqual(result.project.connections)
    expect(autoConnectNearby(result.project, ['loose']).joints).toBe(0)
    expect(source).toEqual(before)
  })

  it.each([false, true])('snaps to the middle of an upright and fits an interior T (quarter turn: %s)', quarterTurn => {
    const source: Project = { version: 1, name: 'Interior', panels: [
      createPanel({ id: 'upright', width: 300, height: 900, position: [0, 700, 0] }),
      createPanel({ id: 'loose', width: quarterTurn ? 300 : 200, height: quarterTurn ? 200 : 300, position: [20, 700, 225], rotation: [Math.PI / 2, 0, quarterTurn ? Math.PI / 2 : 0] }),
    ], connections: [] }
    const result = autoConnectNearby(source, ['loose'])
    expect(result.movedPanelIds).toEqual(['loose'])
    expect(result.splits).toBe(1)
    expect(result.connectors).toBe(2)
    expect(validateProject(result.project)).toEqual([])
    expect(result.project.panels.find(panel => panel.id === 'loose')!.position).toEqual([20, 700, 167.5])
  })

  it('fits loose panels at the inclusive radius with no selection or a pair selected', () => {
    for (const selection of [[], ['parent', 'loose']]) {
      const result = autoConnectNearby(looseJoint(100), selection)
      expect(result.connectors).toBe(2)
      expect(result.movedPanelIds).toHaveLength(1)
      expect(validateProject(result.project)).toEqual([])
    }
  })

  it('respects radius, selection, visibility and thickness', () => {
    expect(autoConnectNearby(looseJoint(101), ['loose']).joints).toBe(0)
    expect(autoConnectNearby(looseJoint(), ['missing']).joints).toBe(0)
    for (const patch of [{ visible: false }, { thickness: 25 }]) {
      const source = looseJoint()
      source.panels[1] = { ...source.panels[1], ...patch }
      expect(autoConnectNearby(source, ['loose']).joints).toBe(0)
    }
  })

  it('keeps a saved floor constraint when snapping would change height', () => {
    const source = looseJoint()
    source.constraints = [{ id: 'floor', enabled: true, kind: 'floor', panelId: 'loose', reference: 'center', value: source.panels[1].position[1] }]
    expect(autoConnectNearby(source, ['loose']).movedPanelIds).toEqual([])
  })

  it('rejects a destination blocked by another panel', () => {
    const source = looseJoint()
    source.panels.push(createPanel({ id: 'obstacle', width: 100, height: 100, position: [0, 867.5, 100] }))
    const result = autoConnectNearby(source, ['loose'])
    expect(result.movedPanelIds).toEqual([])
    expect(result.project.panels).toEqual(source.panels)
  })
})
