import { describe, expect, it } from 'vitest'
import { synthStorageShelfProject } from './synth-storage-shelf'
import { Euler, Vector3 } from 'three'
import { roundTripProject } from '../test/project-round-trip'
import { synthShelfProject } from './synth-shelf'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import { overlappingHardware } from './connector-hardware-test-helpers'

describe('synth shelf with storage', () => {
  it('adds four level cells while preserving the optimized upper build', () => {
    const source = synthShelfProject()
    const project = synthStorageShelfProject()
    const panels = resolvePanels(project)
    const storage = panels.filter(panel => panel.name.startsWith('Storage '))
    expect(storage).toHaveLength(12)
    const shelves = storage.filter(panel => panel.name.startsWith('Storage shelf'))
    const uprights = storage.filter(panel => panel.name.startsWith('Storage upright'))
    expect(shelves).toHaveLength(6)
    expect(uprights).toHaveLength(6)
    expect(new Set(shelves.map(panel => Math.round(panel.position[1])))).toEqual(new Set([9, 344, 679]))
    for (const shelf of shelves) {
      expect(shelf.width).toBe(432.5)
      expect(Math.abs(new Vector3(0, 0, 1).applyEuler(new Euler(...shelf.rotation)).y)).toBeCloseTo(1)
    }
    for (const upright of uprights) expect(upright.width).toBe(300)
    for (const original of resolvePanels(source).filter(panel => panel.name !== 'Deep floor base')) {
      const actual = panels.find(panel => panel.id === original.id)!
      expect({ ...actual, position: original.position }).toEqual(original)
      actual.position.forEach((value, axis) => expect(value).toBeCloseTo(original.position[axis] + (axis === 1 ? 670 : 0), 5))
    }
    for (const connection of source.connections.filter(item => item.type === '150')) {
      expect(project.connections).toContainEqual(connection)
      for (const [id, override] of Object.entries(source.connectorOverrides!)) {
        if (id.includes(connection.id)) expect(project.connectorOverrides![id]).toEqual(override)
      }
    }
    expect(getProjectBounds(panels).min[1]).toBeCloseTo(0)
    expect(roundTripProject(project)).toEqual(project)
  })

  it('has connected and collision-free storage', () => {
    const project = synthStorageShelfProject()
    expect(validateProject(project)).toEqual([])
    expect(overlappingHardware(project)).toEqual([])
    const reached = new Set([project.panels[0].id])
    for (let i = 0; i < project.panels.length; i++) for (const connection of project.connections) {
      if (reached.has(connection.parentId)) reached.add(connection.childId)
      if (reached.has(connection.childId)) reached.add(connection.parentId)
    }
    expect(reached.size).toBe(project.panels.length)
  })
})
