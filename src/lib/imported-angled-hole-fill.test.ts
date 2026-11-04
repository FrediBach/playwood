import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/everyday-shelf-angled-opening.json'
import { closePanelHole, findClosingPanelHoles, findPanelHoles } from './close-holes'
import { createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { outlineConnectionAligned, outlineWorldPoints } from './outline-closures'
import { resizePanels } from './structure-edit'
import type { Project } from './types'

const angledNames = ['Right side', 'Right upper side', 'Panel 8', 'Panel 10', 'Panel 11', 'Panel 12']
const upperNames = ['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side', 'Right upper side (section)']
const idsFor = (project: Project, names: string[]) => project.panels.filter(panel => names.includes(panel.name)).map(panel => panel.id)
const holesFor = (project: Project, names = angledNames) => {
  const ids = idsFor(project, names)
  return findClosingPanelHoles(project, ids).filter(hole => hole.boundaryIds.length === ids.length && hole.boundaryIds.every(id => ids.includes(id)))
}

function expectSupported(project: Project, panelId: string, names: string[], edgeCount: number) {
  const panels = resolvePanels(project), fill = panels.find(panel => panel.id === panelId)!
  const supports = project.connections.filter(connection => connection.childId === panelId && connection.outlineEdge !== undefined)
  expect(fill.customOutline).toHaveLength(edgeCount)
  expect(supports).toHaveLength(names.length)
  expect(new Set(supports.map(connection => connection.parentId))).toEqual(new Set(idsFor(project, names)))
  expect(new Set(supports.map(connection => connection.outlineEdge)).size).toBe(edgeCount)
  for (const connection of supports) expect(outlineConnectionAligned(panels.find(panel => panel.id === connection.parentId)!, fill, connection)).toBe(true)
  expect(validateProject(project)).toEqual([])
  return fill
}

describe('imported angled opening with uneven rim depths', () => {
  it('offers both faces of all three compartments when the complete design is selected', () => {
    const project = parseProject(fixture), before = structuredClone(project)
    const holes = findClosingPanelHoles(project, project.panels.map(panel => panel.id))
    expect(holes.map(hole => hole.label)).toEqual(['Back 1', 'Back 2', 'Back 3', 'Front 1', 'Front 2', 'Front 3'])
    expect(holes.map(hole => hole.boundaryIds.length)).toEqual([4, 6, 5, 4, 6, 5])
    expect(holes.filter(hole => hole.alignment)).toHaveLength(2)
    expect(project).toEqual(before)
  })

  it('offers alignment for both faces without changing the project before acceptance', () => {
    const project = parseProject(fixture), original = structuredClone(project)
    const boundaryIds = idsFor(project, angledNames), panels = resolvePanels(project)
    expect(findPanelHoles(panels.filter(panel => boundaryIds.includes(panel.id)), panels)).toEqual([])
    const holes = holesFor(project)
    expect(holes.map(hole => hole.label)).toEqual(['Back', 'Front'])
    for (const hole of holes) {
      expect(hole.panel.customOutline).toHaveLength(5)
      expect(hole.alignment?.adjustments.length).toBeGreaterThan(0)
      for (const adjustment of hole.alignment!.adjustments) {
        const source = project.panels.find(panel => panel.id === adjustment.panelId)!
        expect(adjustment.before).toBeCloseTo(source[adjustment.dimension], 5)
        expect(Math.abs(adjustment.after - adjustment.before)).toBeGreaterThan(0.1)
        expect(Number.isFinite(adjustment.distance)).toBe(true)
      }
    }
    expect(project).toEqual(original)
  })

  it.each(['Back', 'Front'])('aligns the advertised edges and fills the %s face in one candidate', label => {
    const project = parseProject(fixture), original = structuredClone(project)
    const hole = holesFor(project).find(hole => hole.label === label)!
    expect(hole).toBeDefined()
    const result = closePanelHole(project, idsFor(project, angledNames), hole.id)
    expectSupported(result.project, result.panelId, angledNames, 5)
    for (const adjustment of hole.alignment!.adjustments) {
      expect(result.project.panels.find(panel => panel.id === adjustment.panelId)![adjustment.dimension]).toBeCloseTo(adjustment.after, 5)
    }
    expect(result.project.panels).toHaveLength(project.panels.length + 1)
    expect(new Set(result.project.connections.map(connection => connection.id))).toEqual(new Set([
      ...project.connections.map(connection => connection.id),
      ...result.project.connections.filter(connection => connection.childId === result.panelId).map(connection => connection.id),
    ]))
    expect(project).toEqual(original)
    const saved = JSON.parse(JSON.stringify(result.project))
    expect(parseProject(saved)).toEqual(saved)
  })

  it('keeps opposite-face proposals distinct after rotating the design away from world depth', () => {
    const project = rotateProject(rotateProject(parseProject(fixture), 'y', 72), 'z', 23)
    const holes = holesFor(project)
    expect(holes.map(hole => hole.label)).toEqual(['Left', 'Right'])
    expect(new Set(holes.map(hole => hole.alignment!.sign))).toEqual(new Set([-1, 1]))
    for (const hole of holes) {
      const result = closePanelHole(project, idsFor(project, angledNames), hole.id)
      expectSupported(result.project, result.panelId, angledNames, 5)
    }
  })

  it('keeps the aligned outline fitted when its top panel is resized after reload', () => {
    const project = parseProject(fixture), hole = holesFor(project).find(hole => hole.label === 'Front')!
    const closed = closePanelHole(project, idsFor(project, angledNames), hole.id)
    const loaded = parseProject(JSON.parse(JSON.stringify(closed.project)))
    const top = loaded.panels.find(panel => panel.name === 'Panel 8')!
    const originalFill = loaded.panels.find(panel => panel.id === closed.panelId)!
    const resized = resizePanels(loaded, [top.id], { width: top.width + 25 })
    const fill = expectSupported(resized, closed.panelId, angledNames, 5)
    expect(resized.panels.find(panel => panel.id === top.id)!.width).toBeCloseTo(top.width + 25, 5)
    expect(outlineWorldPoints(fill).some((point, index) => point.distanceTo(outlineWorldPoints(originalFill)[index]) > 1)).toBe(true)
    expect(resized.connections.map(connection => connection.id)).toEqual(loaded.connections.map(connection => connection.id))
  })

  it.each([true, false])('closes the neighboring front faces in either order (rectangle first: %s)', rectangleFirst => {
    let project = parseProject(fixture)
    const filled: { panelId: string; names: string[]; edgeCount: number }[] = []
    const order = rectangleFirst ? [upperNames, angledNames] : [angledNames, upperNames]
    for (const names of order) {
      const hole = holesFor(project, names).find(hole => hole.label.startsWith('Front'))
      expect(hole).toBeDefined()
      const result = closePanelHole(project, idsFor(project, names), hole!.id)
      project = result.project
      filled.push({ panelId: result.panelId, names, edgeCount: names === upperNames ? 4 : 5 })
      for (const item of filled) expectSupported(project, item.panelId, item.names, item.edgeCount)
    }
    expect(project.panels).toHaveLength(fixture.panels.length + 2)
    expect(holesFor(project, upperNames).some(hole => hole.label.startsWith('Front'))).toBe(false)
    expect(holesFor(project, angledNames).some(hole => hole.label.startsWith('Front'))).toBe(false)
  })

  it('does not offer or accept an alignment that conflicts with a saved rim depth', () => {
    const source = parseProject(fixture), top = source.panels.find(panel => panel.name === 'Panel 8')!
    const stale = holesFor(source).find(hole => hole.label === 'Front')!
    const project: Project = { ...source, constraints: [{ id: 'fixed-top-depth', enabled: true, kind: 'dimension', panelId: top.id,
      dimension: 'height', value: top.height }] }
    const before = structuredClone(project)
    expect(validateProject(project)).toEqual([])
    expect(holesFor(project)).toEqual([])
    expect(() => closePanelHole(project, idsFor(project, angledNames), stale.id)).toThrow('no longer available')
    expect(project).toEqual(before)
  })

  it('rejects a front alignment that would grow a rim into a hidden obstacle', () => {
    const source = parseProject(fixture), top = source.panels.find(panel => panel.name === 'Panel 8')!
    const obstacle = createPanel({ width: 40, height: 40, visible: false,
      position: [top.position[0], top.position[1], top.position[2] + top.height / 2 + 10] })
    const project = { ...source, panels: [...source.panels, obstacle] }, before = structuredClone(project)
    expect(validateProject(project)).toEqual([])
    expect(holesFor(project).map(hole => hole.label)).toEqual(['Back'])
    expect(project).toEqual(before)
  })

  it('leaves rim differences greater than 100 mm for explicit editing', () => {
    const source = parseProject(fixture)
    const project = { ...source, panels: source.panels.map(panel => panel.name === 'Panel 10' ? { ...panel, height: panel.height + 250 } : panel) }
    expect(validateProject(project)).toEqual([])
    expect(holesFor(project)).toEqual([])
  })

  it('does not let an unrelated imported panel ID collide with the speculative filler', () => {
    const source = parseProject(fixture)
    const project = { ...source, panels: [...source.panels, createPanel({ id: 'closing-fit-preview', position: [5000, 500, 5000] })] }
    expect(holesFor(project).map(hole => hole.label)).toEqual(['Back', 'Front'])
  })
})
