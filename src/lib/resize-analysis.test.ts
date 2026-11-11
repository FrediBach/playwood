import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, resolvePanels } from './model'
import { editConnectors, getPhysicalConnectors } from './connector-selection'
import { analyzeStructuralJoints, analyzeStructure, inspectResizeAnalysis } from './resize-analysis'
import { preparePreviewResize } from './preview-resize'
import type { Project } from './types'

function corner(type: 't' | 'cross'): Project {
  const parent = createPanel({ id: 'parent', width: 400, height: 400, position: [0, 800, 0] })
  return attachPanel({ version: 1, name: 'Complete joint', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'child', width: 400, height: 400 }),
    { type, side: 'right', offset: 0, inset: 0, flip: false, count: 2, color: '#292b27' })
}

describe('shared structural joint analysis', () => {
  it.each(['t', 'cross'] as const)('retains every %s branch when hardware is removed and panels are hidden', type => {
    const original = corner(type)
    const removed = editConnectors(original, getPhysicalConnectors(original).map(piece => piece.id), { removed: true })
    const source = { ...removed, panels: resolvePanels(removed).map(panel => ({ ...panel, visible: false })),
      connections: removed.connections.map(connection => ({ ...connection, role: 'support' as const })) }
    const saved = structuredClone(source)
    const joints = analyzeStructuralJoints(source)
    expect(joints).toHaveLength(1)
    expect(new Set(joints[0].panelIds)).toEqual(new Set(source.panels.map(panel => panel.id)))
    expect(joints[0].supportConnectionIds).toEqual(source.connections.map(connection => connection.id))
    expect(inspectResizeAnalysis(source).installedConnectorIds).toEqual([])
    expect(Object.isFrozen(joints[0].panelIds)).toBe(true)
    expect(source).toEqual(saved)
  })

  it.each(['t', 'cross'] as const)('requires all %s branches visible for connector handles', type => {
    const source = corner(type), saved = structuredClone(source)
    const piece = getPhysicalConnectors(source)[0]
    expect(preparePreviewResize(source, { connectorId: piece.id })).not.toBeNull()
    for (const member of source.panels) {
      const hidden = { ...source, panels: source.panels.map(panel => panel.id === member.id ? { ...panel, visible: false } : panel) }
      expect(preparePreviewResize(hidden, { connectorId: piece.id })).toBeNull()
      expect(analyzeStructuralJoints(hidden)).toEqual(analyzeStructuralJoints(source))
    }
    expect(source).toEqual(saved)
  })

  it('keeps separate joints distinct and retains complete membership after connection reordering', () => {
    const first = corner('cross'), second = corner('t')
    const source = { ...first, connections: [...first.connections, ...second.connections] }
    const before = analyzeStructuralJoints(source)
    expect(before).toHaveLength(2)
    const after = analyzeStructuralJoints({ ...source, connections: [...source.connections].reverse() })
    for (const joint of before) {
      const reordered = after.find(item => item.id === joint.id)!
      expect(new Set(reordered.connectionIds)).toEqual(new Set(joint.connectionIds))
      expect(new Set(reordered.panelIds)).toEqual(new Set(joint.panelIds))
    }
  })

  it('retains outline stock contacts for movement fallback without protecting them in resize', () => {
    // A fitted outline touches a loose panel through its rectangular stock bound.
    // This contact is conservative fallback evidence, not a shape-aware support.
    const rim = createPanel({ id: 'rim', position: [2000, 800, 0] })
    const cap = createPanel({ id: 'cap', width: 400, height: 400, position: [0, 800, 0],
      customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }] })
    const loose = createPanel({ id: 'loose', width: 400, height: 400, position: [0, 800, 18] })
    const source: Project = { version: 1, name: 'Outline contact', panels: [rim, cap, loose], connections: [{
      id: 'outline', parentId: rim.id, childId: cap.id, role: 'support', outlineEdge: 0,
      type: '90', side: 'right', offset: 0, inset: 0, flip: false, count: 1, color: '#292b27',
    }] }
    const geometry = analyzeStructure(source)
    expect(geometry.surfaceContacts.map(contact => [geometry.panels[contact.a].id, geometry.panels[contact.b].id])).toEqual([['cap', 'loose']])
    expect(geometry.contacts).toEqual([])
    expect(inspectResizeAnalysis(source, geometry).contacts).toEqual([])
  })
})
