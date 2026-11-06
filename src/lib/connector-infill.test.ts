import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createStarterProject, resolvePanels } from './model'
import { addConnectorsBetween, connectorInfillReason } from './connector-infill'
import { connectorId, editConnectors, getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { rotateSelection } from './selection-rotation'
import { createAssembly } from './assemblies'
import type { Project } from './types'

function positions(project: Project) {
  const panels = resolvePanels(project)
  return Object.fromEntries(getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    return [piece.id, rail.along[piece.index] + connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)]
  }))
}
function fixture() {
  const project = createStarterProject('shelf')
  const first = getPhysicalConnectors(project).find(piece => piece.type === '90')!
  return { project, ids: [connectorId(first.connection.id, 0), connectorId(first.connection.id, 1)] }
}

describe('adding connectors between selected hardware', () => {
  it('adds evenly spaced matching pieces while preserving stable IDs, slides, panels and saved format', () => {
    const base = fixture()
    const project = editConnectors(editConnectors(base.project, base.ids, { material: 'metal', color: '#123456' }), [base.ids[0]], { slide: 10 })
    const before = positions(project)
    const next = addConnectorsBetween(project, base.ids, 2)
    const after = positions(next)
    for (const [id, position] of Object.entries(before)) expect(after[id]).toBeCloseTo(position)
    const added = getPhysicalConnectors(next).filter(piece => !(piece.id in before))
    expect(added).toHaveLength(2)
    for (const [index, piece] of added.entries()) {
      expect(piece).toMatchObject({ type: '90', material: 'metal', color: '#123456' })
      expect(after[piece.id]).toBeCloseTo(before[base.ids[0]] + (before[base.ids[1]] - before[base.ids[0]]) * (index + 1) / 3)
    }
    expect(resolvePanels(next)).toEqual(resolvePanels(project))
    expect(roundTripProject(next)).toEqual(next)
    expect(positions(project)).toEqual(before)
  })
  it('rejects excessive, fractional, empty and overlapping quantities', () => {
    const { project, ids } = fixture()
    for (const count of [0, -1, 1.5, 19, NaN, 18]) expect(() => addConnectorsBetween(project, ids, count)).toThrow()
    const next = addConnectorsBetween(project, ids, 1)
    expect(() => addConnectorsBetween(next, ids, 1)).toThrow(/room/)
    expect(() => addConnectorsBetween(next, ids, 2)).not.toThrow()
  })
  it('preserves removed pieces and rotated shared T branches', () => {
    const base = createStarterProject('shelf')
    const rotated = rotateSelection(base, base.panels.map(panel => panel.id), 'y', 37)
    const first = getPhysicalConnectors(rotated).find(piece => piece.type === 't')!
    const ids = [connectorId(first.connection.id, 0), connectorId(first.connection.id, 1)]
    const filled = addConnectorsBetween(rotated, ids, 1)
    const added = getPhysicalConnectors(filled).find(piece => !getPhysicalConnectors(rotated).some(old => old.id === piece.id))!
    const removed = editConnectors(filled, [added.id], { removed: true })
    const next = addConnectorsBetween(removed, ids, 2)
    expect(next.connectorOverrides?.[added.id]?.removed).toBe(true)
    expect(resolvePanels(next)).toEqual(resolvePanels(rotated))
    expect(roundTripProject(next)).toEqual(next)
  })
  it('checks endpoint selection, matching finish, and assembly ownership', () => {
    const { project, ids } = fixture()
    expect(connectorInfillReason(project, ids)).toBe('')
    expect(connectorInfillReason(project, [ids[0]])).toMatch(/two/)
    expect(connectorInfillReason(editConnectors(project, [ids[0]], { color: '#ffffff' }), ids)).toMatch(/same type/)
    expect(connectorInfillReason(editConnectors(project, [ids[0]], { removed: true }), ids)).toMatch(/two/)
    const assembly = createAssembly(project, project.panels.map(panel => panel.id), 'Shelf')
    const pieces = getPhysicalConnectors(assembly).slice(0, 2).map(piece => piece.id)
    expect(connectorInfillReason(assembly, pieces)).toMatch(/Disassemble/)
  })
})
