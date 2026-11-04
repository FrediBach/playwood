import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/everyday-shelf-angled-opening.json'
import { closePanelHole, findPanelHoles } from './close-holes'
import { parseProject, resolvePanels, validateProject } from './model'
import { outlineConnectionAligned } from './outline-closures'
import { resizePanels } from './structure-edit'
import type { Project } from './types'

const upperNames = ['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side', 'Right upper side (section)']
const upperIds = (project: Project) => project.panels.filter(panel => upperNames.includes(panel.name)).map(panel => panel.id)
const upperHoles = (project: Project, selectAll = false) => {
  const panels = resolvePanels(project), ids = upperIds(project)
  return findPanelHoles(selectAll ? panels : panels.filter(panel => ids.includes(panel.id)), panels)
    .filter(hole => hole.boundaryIds.length === ids.length && hole.boundaryIds.every(id => ids.includes(id)))
}

function expectUpperSupports(project: Project, panelId: string) {
  const panels = resolvePanels(project), fill = panels.find(panel => panel.id === panelId)!
  const supports = project.connections.filter(connection => connection.childId === panelId)
  expect(supports).toHaveLength(5)
  expect(new Set(supports.map(connection => connection.parentId))).toEqual(new Set(upperIds(project)))
  expect(new Set(supports.map(connection => connection.outlineEdge)).size).toBe(4)
  for (const connection of supports) expect(outlineConnectionAligned(panels.find(panel => panel.id === connection.parentId)!, fill, connection)).toBe(true)
  const rightIds = panels.filter(panel => panel.name.startsWith('Right upper side')).map(panel => panel.id)
  const rightSupports = supports.filter(connection => rightIds.includes(connection.parentId))
  expect(rightSupports).toHaveLength(2)
  expect(rightSupports[0].outlineEdge).toBe(rightSupports[1].outlineEdge)
  expect(validateProject(project)).toEqual([])
  return fill
}

describe('imported split-side rectangular opening', () => {
  it.each([false, true])('finds both upper faces without spanning the lower compartment (select all: %s)', selectAll => {
    const project = parseProject(fixture)
    expect(validateProject(project)).toEqual([])
    const holes = upperHoles(project, selectAll)
    expect(holes).toHaveLength(2)
    expect(holes.every(hole => hole.panel.customOutline?.length === 4)).toBe(true)
    for (const hole of holes) {
      expect(hole.panel.width).toBeCloseTo(project.panels.find(panel => panel.name === 'Top shelf')!.width, 4)
      expect(hole.panel.height).toBeCloseTo(project.panels.find(panel => panel.name === 'Left upper side')!.width, 4)
      expect(hole.boundaryIds.some(id => project.panels.find(panel => panel.id === id)!.name === 'Bottom shelf')).toBe(false)
    }
  })

  it('closes both faces with hardware on both split sections without moving the construction', () => {
    const source = parseProject(fixture), before = structuredClone(source), originalPanels = resolvePanels(source)
    const first = closePanelHole(source, upperIds(source), upperHoles(source)[0].id)
    expectUpperSupports(first.project, first.panelId)
    expect(first.project.panels.filter(panel => panel.id !== first.panelId)).toEqual(originalPanels)
    expect(first.project.connections.slice(0, source.connections.length)).toEqual(source.connections)
    const remaining = upperHoles(first.project)
    expect(remaining).toHaveLength(1)
    const second = closePanelHole(first.project, upperIds(source), remaining[0].id)
    expectUpperSupports(second.project, second.panelId)
    expect(upperHoles(second.project, true)).toEqual([])
    expect(source).toEqual(before)
    const saved = JSON.parse(JSON.stringify(second.project))
    expect(parseProject(saved)).toEqual(saved)
  })

  it('keeps the split-edge supports fitted when the upper shelf changes width after reload', () => {
    const source = parseProject(fixture)
    const closed = closePanelHole(source, upperIds(source), upperHoles(source)[0].id)
    const loaded = parseProject(JSON.parse(JSON.stringify(closed.project)))
    const top = loaded.panels.find(panel => panel.name === 'Top shelf')!
    const originalFill = loaded.panels.find(panel => panel.id === closed.panelId)!
    const resized = resizePanels(loaded, [top.id], { width: top.width + 80 })
    const fill = expectUpperSupports(resized, closed.panelId)
    expect(fill.width).toBeCloseTo(originalFill.width + 80, 4)
    expect(fill.height).toBeCloseTo(originalFill.height, 4)
    expect(resized.connections.map(connection => connection.id)).toEqual(loaded.connections.map(connection => connection.id))
  })
})
