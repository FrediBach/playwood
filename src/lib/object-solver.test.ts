import { describe, expect, it } from 'vitest'
import { overlappingConnectorIds } from './connector-clearance'
import { getPhysicalConnectors } from './connector-selection'
import { getProjectBounds, parseProject, removePanel, resolvePanels, validateProject } from './model'
import { solveCuboid } from './object-solver'

describe('cuboid object solver proof', () => {
  it.each([16, 18, 19])('preserves the outside envelope with %s mm stock and fits all twelve joints', thickness => {
    const project = solveCuboid({ width: 600, height: 800, depth: 400, thickness })
    const bounds = getProjectBounds(resolvePanels(project))
    expect(bounds.width).toBeCloseTo(600)
    expect(bounds.height).toBeCloseTo(800)
    expect(bounds.depth).toBeCloseTo(400)
    expect(bounds.min[1]).toBeCloseTo(0)
    expect(project.panels).toHaveLength(6)
    expect(project.connections).toHaveLength(12)
    expect(getPhysicalConnectors(project)).toHaveLength(24)
    expect(overlappingConnectorIds(project).size).toBe(0)
    expect(validateProject(project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(project))).panels).toEqual(project.panels)
  })

  it('allows removing any face without moving the remaining construction or mutating the source', () => {
    const project = solveCuboid({ width: 600, height: 800, depth: 400, thickness: 18 })
    const before = structuredClone(project)
    for (const face of project.panels) {
      const opened = removePanel(project, face.id)
      expect(resolvePanels(opened)).toEqual(project.panels.filter(panel => panel.id !== face.id))
      expect(opened.connections).toHaveLength(8)
      expect(validateProject(opened)).toEqual([])
      expect(parseProject(JSON.parse(JSON.stringify(opened))).panels).toHaveLength(5)
    }
    expect(project).toEqual(before)
  })

  it.each([NaN, Infinity, -1, 80, 5000])('rejects unsupported outside dimensions (%s)', width => {
    expect(() => solveCuboid({ width, height: 600, depth: 400, thickness: 18 })).toThrow('Outside dimensions')
  })

  it.each([NaN, 15, 20])('rejects incompatible stock (%s)', thickness => {
    expect(() => solveCuboid({ width: 600, height: 600, depth: 400, thickness })).toThrow('thickness')
  })

  it('rejects a dimensionally legal box when the complete hardware cannot fit', () => {
    expect(() => solveCuboid({ width: 93, height: 93, depth: 93, thickness: 18 })).toThrow(/joint|clearance/)
  })
})
