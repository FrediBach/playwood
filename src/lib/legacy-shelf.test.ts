import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { repairLegacyShelf } from './legacy-shelf'
import type { AttachmentOptions, Connection, Project } from './types'

function legacyShelf(): Project {
  const defaults: AttachmentOptions = { type: '90', side: 'left', inset: 0, offset: 0, flip: false, count: 2, color: '#e75a35' }
  const connections: Connection[] = [
    { ...defaults, id: 'base-left:0', parentId: 'base', childId: 'left' },
    { ...defaults, id: 'base-right:0', parentId: 'base', childId: 'right', side: 'right' },
    { ...defaults, id: 'left-top:0', parentId: 'left', childId: 'top' },
    { ...defaults, id: 'left-middle:0', parentId: 'left', childId: 'middle', inset: 390 },
    { ...defaults, id: 'right-top:0', parentId: 'right', childId: 'top', side: 'right', role: 'support' },
    { ...defaults, id: 'right-middle:0', parentId: 'right', childId: 'middle', side: 'right', role: 'support', inset: 390 },
  ]
  const project: Project = { version: 1, name: 'My shelf', connections, panels: [
    createPanel({ id: 'base', name: 'Bottom shelf', width: 1100, height: 360, position: [0, 28, 0], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'left', name: 'Left side', width: 780, height: 360 }),
    createPanel({ id: 'right', name: 'Right side', width: 780, height: 360 }),
    createPanel({ id: 'top', name: 'Top shelf', width: 1100, height: 360 }),
    createPanel({ id: 'middle', name: 'Middle shelf', width: 1100, height: 360 }),
  ] }
  return { ...project, panels: resolvePanels(project) }
}

describe('legacy shelf repair', () => {
  it('replaces the two embedded corner clamps with complete T joints without moving the shelves', () => {
    const original = legacyShelf()
    const snapshot = JSON.stringify(original)
    const repaired = repairLegacyShelf(original)
    expect(repaired).not.toBe(original)
    expect(repaired.panels).toHaveLength(7)
    expect(repaired.connections).toHaveLength(8)
    expect(repaired.panels.slice(0, 5).map(panel => panel.id)).toEqual(original.panels.map(panel => panel.id))
    for (const id of ['base', 'middle', 'top']) {
      const before = original.panels.find(panel => panel.id === id)!
      const after = repaired.panels.find(panel => panel.id === id)!
      before.position.forEach((value, axis) => expect(after.position[axis]).toBeCloseTo(value, 8))
      before.rotation.forEach((value, axis) => expect(after.rotation[axis]).toBeCloseTo(value, 8))
      expect([after.width, after.height, after.thickness]).toEqual([before.width, before.height, before.thickness])
    }
    expect(repaired.panels.filter(panel => ['left', 'right'].includes(panel.id)).map(panel => panel.width)).toEqual([390, 390])
    expect(repaired.panels.slice(-2).map(panel => panel.width)).toEqual([355, 355])
    expect(repaired.connections.filter(c => c.type === 't').reduce((sum, c) => sum + c.count, 0)).toBe(4)
    expect(repaired.connections.reduce((sum, c) => sum + c.count, 0)).toBe(12)
    expect(validateProject(repaired)).toEqual([])
    expect(() => parseProject(repaired)).not.toThrow()
    expect(JSON.stringify(original)).toBe(snapshot)
    expect(repairLegacyShelf(repaired)).toBe(repaired)
  })

  it('preserves custom names, finishes, holes, hardware and the world envelope after resizing and rotating', () => {
    const original = legacyShelf()
    original.panels = original.panels.map((panel, i) => ({
      ...panel, name: `Custom ${i}`, width: i === 1 || i === 2 ? 940 : 1450, height: 520,
      material: i === 1 ? 'walnut' : 'painted', color: i === 1 ? '#442211' : '#224466',
      pattern: i === 1 ? 'slots' : 'pegboard', holeSize: 8, holeSpacing: 35,
    }))
    original.panels[0] = { ...original.panels[0], position: [120, 230, -440], rotation: [0.3, 0.8, -0.2] }
    original.connections = original.connections.map((connection, i) => ({
      ...connection, inset: connection.inset > 0 ? 480 : 0, color: i % 2 ? '#101010' : '#336699', count: i % 2 ? 3 : 2,
    }))
    original.panels = resolvePanels(original)
    const repaired = repairLegacyShelf(original)
    expect(repaired).not.toBe(original)
    for (const panel of original.panels) {
      const edited = repaired.panels.find(p => p.id === panel.id)!
      expect(edited).toMatchObject({ name: panel.name, material: panel.material, color: panel.color, pattern: panel.pattern, holeSize: panel.holeSize, holeSpacing: panel.holeSpacing })
    }
    for (const [index, originalId] of [[5, 'left'], [6, 'right']] as const) {
      const source = original.panels.find(panel => panel.id === originalId)!
      expect(repaired.panels[index]).toMatchObject({ width: 445, height: source.height, thickness: source.thickness, material: source.material, color: source.color, pattern: source.pattern, holeSize: source.holeSize, holeSpacing: source.holeSpacing })
    }
    for (const connection of original.connections) {
      expect(repaired.connections.find(c => c.id === connection.id)).toMatchObject({ color: connection.color, count: connection.count })
    }
    const before = getProjectBounds(original.panels), after = getProjectBounds(repaired.panels)
    for (const key of ['width', 'height', 'depth'] as const) expect(after[key]).toBeCloseTo(before[key], 8)
    expect(validateProject(repaired).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('retains standalone connection IDs when adding shared branches', () => {
    const original = legacyShelf()
    original.connections = original.connections.map(c => ({ ...c, id: c.id.replace(':0', '') }))
    const repaired = repairLegacyShelf(original)
    expect(repaired.connections.find(c => c.id === 'left-middle')).toMatchObject({ type: 't', count: 2 })
    expect(repaired.connections.find(c => c.id === 'left-middle:1')).toMatchObject({ type: 't', count: 0 })
    expect(() => parseProject(repaired)).not.toThrow()
  })

  it('leaves unrelated, incomplete, misaligned and incompatible projects untouched', () => {
    for (const template of ['shelf', 'desk', 'display', 'blank'] as const) {
      const project = createStarterProject(template)
      expect(repairLegacyShelf(project)).toBe(project)
    }
    const changes: ((project: Project) => void)[] = [
      project => { project.connections[0].offset = 10 },
      project => { project.connections[0].flip = true },
      project => { project.connections[3].type = '105' },
      project => { project.connections[3].id = 'left-middle:2' },
      project => { project.connections[4].side = 'left' },
      project => { project.connections.pop() },
      project => { project.panels[4].width += 10 },
      project => { project.panels[4].width += 0.4 },
      project => { project.panels[3].width += 0.5 },
      project => { project.panels[1].thickness = 17 },
      project => { project.connections[3].inset = project.connections[5].inset = 50 },
    ]
    for (const change of changes) {
      const project = legacyShelf()
      change(project)
      expect(repairLegacyShelf(project)).toBe(project)
    }
  })
})
