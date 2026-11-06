import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import fixture from '../../tests/fixtures/everyday-shelf-angled-opening.json'
import { prepareHoleEdgeAlignment } from './close-hole-alignment'
import { closePanelHole, findPanelHoles } from './close-holes'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { createPanel, parseProject, resolvePanels, validateProject } from './model'
import { outlineConnectionAligned } from './outline-closures'
import type { Project } from './types'

const polygonNames = ['Right side', 'Right upper side', 'Panel 8', 'Panel 10', 'Panel 11', 'Panel 12']
const ids = (project: Project, names: string[]) => project.panels.filter(panel => names.includes(panel.name)).map(panel => panel.id)
const source = () => parseProject(structuredClone(fixture))
function hardware(project: Project) {
  const panels = resolvePanels(project)
  return new Map(getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    return [piece.id, new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))]
  }))
}

describe('reviewed hole edge alignment', () => {
  it.each([-1, 1] as const)('extends the supplied angled rim to face %s without moving opposite edges or installed hardware', sign => {
    const project = source(), snapshot = structuredClone(project), before = resolvePanels(project), beforeHardware = hardware(project)
    const result = prepareHoleEdgeAlignment(project, ids(project, polygonNames), [0, 0, 1], sign)
    expect(result.adjustments.length).toBeGreaterThan(0)
    expect(Math.max(...result.adjustments.map(adjustment => adjustment.distance))).toBeCloseTo(13.6984629, 5)
    const after = resolvePanels(result.project), ends = after.filter(panel => polygonNames.includes(panel.name)).map(panel => sign * panel.position[2] + panel.height / 2)
    expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(0.00001)
    for (const panel of after) {
      const original = before.find(item => item.id === panel.id)!
      expect(panel.width).toBe(original.width)
      expect(panel.position[0]).toBeCloseTo(original.position[0], 5)
      expect(panel.position[1]).toBeCloseTo(original.position[1], 5)
      expect(sign * panel.position[2] - panel.height / 2).toBeCloseTo(sign * original.position[2] - original.height / 2, 5)
    }
    const afterHardware = hardware(result.project)
    for (const [id, point] of beforeHardware) expect(afterHardware.get(id)!.distanceTo(point)).toBeLessThan(0.00001)
    expect(validateProject(result.project)).toEqual([])
    expect(project).toEqual(snapshot)
    const hole = findPanelHoles(after).find(hole => hole.panel.customOutline?.length === 5 && (sign < 0 ? hole.label.startsWith('Back') : hole.label.startsWith('Front')))!
    expect(hole).toBeDefined()
    expect(validateProject(closePanelHole(result.project, after.map(panel => panel.id), hole.id).project)).toEqual([])
  })

  it('carries an existing upper filler and all of its rim edges together when the neighboring polygon is aligned', () => {
    const project = source(), panels = resolvePanels(project)
    const upper = findPanelHoles(panels).find(hole => hole.label.startsWith('Front') && hole.panel.customOutline?.length === 4)!
    expect(upper).toBeDefined()
    const closed = closePanelHole(project, panels.map(panel => panel.id), upper.id)
    const before = resolvePanels(closed.project), cap = before.find(panel => panel.id === closed.panelId)!
    const beforeHardware = hardware(closed.project)
    const result = prepareHoleEdgeAlignment(closed.project, ids(project, polygonNames), [0, 0, 1], 1)
    const after = resolvePanels(result.project), movedCap = after.find(panel => panel.id === cap.id)!
    expect(result.adjustments.map(adjustment => adjustment.panelName)).toEqual(expect.arrayContaining(['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side (section)']))
    expect(movedCap.position[2] - cap.position[2]).toBeCloseTo(8, 5)
    expect(movedCap.width).toBeCloseTo(cap.width, 5)
    expect(movedCap.height).toBeCloseTo(cap.height, 5)
    const afterHardware = hardware(result.project)
    for (const piece of getPhysicalConnectors(closed.project)) {
      const delta = afterHardware.get(piece.id)!.clone().sub(beforeHardware.get(piece.id)!)
      expect(delta.distanceTo(new Vector3(0, 0, piece.connection.childId === cap.id ? 8 : 0))).toBeLessThan(0.00001)
    }
    for (const joint of result.project.connections.filter(connection => connection.childId === cap.id)) {
      expect(outlineConnectionAligned(after.find(panel => panel.id === joint.parentId)!, movedCap, joint)).toBe(true)
    }
    expect(validateProject(result.project)).toEqual([])
    expect(roundTripProject(result.project).connections).toEqual(result.project.connections)
    const polygon = findPanelHoles(after).find(hole => hole.label.startsWith('Front') && hole.panel.customOutline?.length === 5)!
    expect(polygon).toBeDefined()
    const filled = closePanelHole(result.project, after.map(panel => panel.id), polygon.id)
    expect(validateProject(filled.project)).toEqual([])
  })

  it('rejects conflicting saved dimensions and excessive depth changes without changing the construction', () => {
    const project = source(), right = project.panels.find(panel => panel.name === 'Right side')!
    const constrained: Project = { ...project, constraints: [{ id: 'depth', enabled: true, kind: 'dimension', panelId: right.id, dimension: 'height', value: right.height }] }
    const snapshot = structuredClone(constrained)
    expect(() => prepareHoleEdgeAlignment(constrained, ids(project, polygonNames), [0, 0, 1], 1)).toThrow()
    expect(constrained).toEqual(snapshot)
    const offset = { ...project, panels: project.panels.map(panel => panel.name === 'Panel 8' ? { ...panel, height: panel.height - 250 } : panel) }
    expect(() => prepareHoleEdgeAlignment(offset, ids(offset, polygonNames), [0, 0, 1], 1)).toThrow('100 mm')
  })

  it('rejects an extension into an unselected obstacle before it becomes the closure baseline', () => {
    const project = source(), right = resolvePanels(project).find(panel => panel.name === 'Right side')!
    const obstacle = createPanel({ id: 'obstacle', name: 'Obstacle', width: 100, height: 100, thickness: 3,
      position: [right.position[0], right.position[1], 170] })
    const blocked: Project = { ...project, panels: [...project.panels, obstacle] }, snapshot = structuredClone(blocked)
    expect(validateProject(blocked)).toEqual([])
    expect(() => prepareHoleEdgeAlignment(blocked, ids(blocked, polygonNames), [0, 0, 1], 1)).toThrow('overlaps')
    expect(blocked).toEqual(snapshot)
  })
})
