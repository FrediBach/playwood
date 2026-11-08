import { describe, expect, it } from 'vitest'
import { autoConnect } from './auto-connect'
import { autoConnectNearby } from './auto-connect-nearby'
import { restoreRemovedConnectors } from './restore-connectors'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { editConnectors, getPhysicalConnectors } from './connector-selection'
import { roundTripProject } from '../test/project-round-trip'

const fixture = () => {
  const project = synthStorageShelfProject()
  const piece = getPhysicalConnectors(project).find(piece => piece.connection.type === '90' && piece.connection.role === 'support'
    && [piece.connection.parentId, piece.connection.childId].every(id => project.panels.find(panel => panel.id === id)!.name.startsWith('Storage ')))!
  return { project, piece }
}

describe('restore removed connectors with explicit Auto-add', () => {
  it.each(['all', 'one', 'pair'] as const)('restores the library corner with %s selected, retaining its identity and saved position', scope => {
    const { project, piece } = fixture()
    const removed = editConnectors(project, [piece.id], { removed: true })
    const snapshot = structuredClone(removed)
    const ids = scope === 'all' ? [] : scope === 'one' ? [piece.connection.parentId] : [piece.connection.parentId, piece.connection.childId]
    const result = autoConnectNearby(removed, ids)
    expect(result.connectors).toBe(1)
    expect(result.joints).toBe(1)
    expect(result.project).toEqual(project)
    expect(removed).toEqual(snapshot)
    expect(roundTripProject(result.project)).toEqual(project)
    expect(autoConnectNearby(result.project, ids).connectors).toBe(0)
    // Internal geometry operations must not resurrect deliberately removed pieces.
    expect(autoConnect(removed, ids).project).toEqual(removed)
  })

  it('honors unrelated selection and hidden panels', () => {
    const { project, piece } = fixture()
    const removed = editConnectors(project, [piece.id], { removed: true })
    expect(restoreRemovedConnectors(removed, [project.panels.find(panel => panel.name === 'Synth tray 3')!.id]).connectors).toBe(0)
    const hidden = { ...removed, panels: removed.panels.map(panel => panel.id === piece.connection.parentId ? { ...panel, visible: false } : panel) }
    expect(restoreRemovedConnectors(hidden).connectors).toBe(0)
  })

  it('preserves appearance and refuses to move a removed piece to evade occupied hardware', () => {
    const { project } = fixture()
    const pieces = getPhysicalConnectors(project).filter(piece => piece.connection.type === '150')
    const removed = editConnectors(project, [pieces[0].id], { removed: true, color: '#123456' })
    const restored = restoreRemovedConnectors(removed)
    expect(restored.connectors).toBe(1)
    expect(restored.project.connectorOverrides![pieces[0].id]).toMatchObject({ color: '#123456', slide: project.connectorOverrides![pieces[0].id].slide })
    // Put another installed piece at the removed piece's exact saved location.
    const blocked = structuredClone(removed)
    blocked.connectorOverrides![pieces[1].id] = { ...blocked.connectorOverrides![pieces[1].id], slide: -145 }
    expect(restoreRemovedConnectors(blocked).connectors).toBe(0)
    expect(restoreRemovedConnectors(blocked).project).toBe(blocked)
  })
})
