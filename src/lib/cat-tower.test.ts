import { describe, expect, it } from 'vitest'
import { roundTripProject } from '../test/project-round-trip'
import { catTowerProject } from './cat-tower'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import { overlappingHardware } from './connector-hardware-test-helpers'
import { assertAddedHardwarePanelClearance } from './connector-clearance'
import { getPhysicalConnectors } from './connector-selection'

const corners = [[-167.5, -167.5], [167.5, -167.5], [167.5, 167.5], [-167.5, 167.5]]

describe('cat tower', () => {
  it('uses the original cuts plus narrow center braces, connected hardware, and exportable geometry', () => {
    const project = catTowerProject()
    expect(project.panels).toHaveLength(44)
    expect(project.panels.filter(panel => panel.width === 635)).toHaveLength(20)
    expect(project.panels.filter(panel => panel.width === 300)).toHaveLength(18)
    expect(project.panels.every(panel => panel.height === 300 && panel.thickness === 18)).toBe(true)
    const braces = project.panels.filter(panel => panel.width === 50)
    expect(braces).toHaveLength(6)
    for (const brace of braces) {
      const joints = project.connections.filter(connection => connection.parentId === brace.id || connection.childId === brace.id)
      const jointIds = new Set(joints.map(connection => connection.id.replace(/:\d+$/, '')))
      const members = new Set(project.connections.filter(connection => jointIds.has(connection.id.replace(/:\d+$/, '')))
        .flatMap(connection => [connection.parentId, connection.childId]))
      const landings = resolvePanels(project).filter(panel => members.has(panel.id) && Math.abs(panel.rotation[0] + Math.PI / 2) < .001)
      // Each brace has installed hardware to horizontal stock above and below.
      for (const direction of [-1, 1]) {
        expect(landings.some(panel => Math.abs(panel.position[1] - brace.position[1] - direction * 167.5) < .001)).toBe(true)
      }
      expect(joints.every(connection => project.connections.some(other =>
        other.id.replace(/:\d+$/, '') === connection.id.replace(/:\d+$/, '') && other.count > 0))).toBe(true)
    }
    expect(validateProject(project)).toEqual([])
    expect(roundTripProject(project)).toEqual(project)
    expect(overlappingHardware(project)).toEqual([])
    expect(() => assertAddedHardwarePanelClearance({ ...project, panels: [], connections: [] }, project)).not.toThrow()
    expect(getPhysicalConnectors(project).some(piece => piece.type === 't')).toBe(true)
    const neighbors = new Map(project.panels.map(panel => [panel.id, new Set<string>()]))
    for (const connection of project.connections) {
      neighbors.get(connection.parentId)!.add(connection.childId)
      neighbors.get(connection.childId)!.add(connection.parentId)
    }
    expect(project.panels.filter(panel => neighbors.get(panel.id)!.size < 2).map(panel => panel.name)).toEqual([])
    const reached = new Set<string>()
    const visit = (id: string) => {
      if (reached.has(id)) return
      reached.add(id)
      neighbors.get(id)!.forEach(visit)
    }
    visit(project.panels[0].id)
    expect(reached.size).toBe(project.panels.length)
    const bounds = getProjectBounds(resolvePanels(project))
    expect(bounds.min[1]).toBeCloseTo(0)
    expect(bounds.width).toBeCloseTo(688)
    expect(bounds.depth).toBeCloseTo(688)
    expect(bounds.height).toBeCloseTo(2028)
  })

  it('leaves a continuous internal climbing route and a floored corner lookout on every tier', () => {
    const bounds = resolvePanels(catTowerProject()).map(panel => getProjectBounds([panel]))
    const floorAt = (level: number, x: number, z: number) => bounds.some(box =>
      Math.abs(box.height - 18) < .01 && Math.abs(box.min[1] - level * 335) < .01
      && x > box.min[0] && x < box.max[0] && z > box.min[2] && z < box.max[2])
    for (let level = 0; level <= 6; level++) {
      // Above the full base, exactly one 300 mm corner is open per surface.
      for (const [corner, [x, z]] of corners.entries()) {
        expect(floorAt(level, x, z)).toBe(level === 0 || corner !== level % 4)
        if (level > 0 && corner === level % 4) for (const dx of [-149, 149]) for (const dz of [-149, 149]) {
          expect(floorAt(level, x + dx, z + dz)).toBe(false)
        }
      }
      if (level === 6) continue
      const [x, z] = corners[(level + 1) % 4]
      expect(floorAt(level, x, z)).toBe(true)
      expect(floorAt(level + 1, x, z)).toBe(false)
      // Both outside walls are absent at this resting/climbing corner.
      const walls = bounds.filter(box => box.min[1] > level * 335 + 18 && box.max[1] < (level + 1) * 335)
      expect(walls).toHaveLength(5)
      expect(walls.some(box => x > box.min[0] && x < box.max[0] && Math.sign(z) * box.min[2] > 320)).toBe(false)
      expect(walls.some(box => z > box.min[2] && z < box.max[2] && Math.sign(x) * box.min[0] > 320)).toBe(false)
    }
  })
})
