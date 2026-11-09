import { describe, expect, it } from 'vitest'
import { designConstraintCoordinate, evaluateDesignConstraints } from './design-constraints'
import { attachPanel, createPanel, resolvePanels, validateProject } from './model'
import { movePanels } from './structure-edit'
import type { AttachmentOptions, Project } from './types'

function branchedTrays(): Project {
  const shelf = createPanel({ id: 'shelf', name: 'Shelf', width: 600, height: 300,
    position: [0, 1000, 0], rotation: [-Math.PI / 2, 0, 0] })
  const options: AttachmentOptions = { type: '150', side: 'top', flip: false,
    offset: 0, inset: 0, count: 2, color: '#292b27' }
  let project: Project = { version: 1, name: 'Independent angled branches', panels: [shelf], connections: [] }
  project = attachPanel(project, shelf.id, createPanel({ id: 'held-tray', name: 'Constrained tray', width: 600, height: 250 }), options)
  project = attachPanel(project, shelf.id, createPanel({ id: 'free-tray', name: 'Free tray', width: 600, height: 250 }), { ...options, side: 'bottom' })
  project = attachPanel(project, 'held-tray', createPanel({ id: 'end', name: 'Fixed-height end shelf', width: 600, height: 250 }), { ...options, flip: true })
  const end = resolvePanels(project).find(panel => panel.id === 'end')!
  return { ...project, constraints: [{ id: 'floor', enabled: true, kind: 'floor',
    panelId: end.id, reference: 'min', relation: 'exact', value: designConstraintCoordinate(end, 'min') }] }
}

describe('preserving independent cuts when another cut must adapt', () => {
  it.each([-20, 20])('moves a shelf by %s mm, adapting only the branch required by its floor rule', distance => {
    const before = branchedTrays(), snapshot = JSON.stringify(before)
    expect(validateProject(before)).toEqual([])
    const next = movePanels(before, ['shelf'], [0, distance, 0])
    const panels = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
    const original = new Map(resolvePanels(before).map(panel => [panel.id, panel]))
    expect(panels.get('shelf')!.position[1]).toBe(1000 + distance)
    // The 30-degree tray must change its cut to bridge the fixed end height.
    expect(panels.get('held-tray')!.height).toBeCloseTo(250 - distance * 2, 6)
    for (const id of ['free-tray', 'end']) {
      expect(panels.get(id)!.width).toBe(original.get(id)!.width)
      expect(panels.get(id)!.height).toBe(original.get(id)!.height)
    }
    original.get('free-tray')!.position.forEach((value, axis) => {
      expect(panels.get('free-tray')!.position[axis]).toBeCloseTo(value + (axis === 1 ? distance : 0), 6)
    })
    expect(panels.get('end')!.position[1]).toBe(original.get('end')!.position[1])
    expect(evaluateDesignConstraints(next.constraints, resolvePanels(next)).every(result => result.violation === 0)).toBe(true)
    expect(validateProject(next)).toEqual([])
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
