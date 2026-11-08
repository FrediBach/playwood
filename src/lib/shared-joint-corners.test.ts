import { describe, expect, it } from 'vitest'
import { createAssembly } from './assemblies'
import { autoConnect } from './auto-connect'
import { attachPanel, createPanel, resolvePanels, rotateProject, validateProject } from './model'
import { getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { overlappingHardware } from './connector-hardware-test-helpers'
import { roundTripProject } from '../test/project-round-trip'
import { synthStorageShelfProject } from './synth-storage-shelf'
import type { Project } from './types'

const fixture = (shortDepth = 300) => {
  const parent = createPanel({ width: 600, height: 300 })
  const project = attachPanel({ version: 1, name: 'Shared edge extension', panels: [parent], connections: [] }, parent.id,
    createPanel({ width: 600, height: 300 }),
    { type: 't', side: 'top', flip: false, offset: 0, inset: 0, count: 2, color: '#123456' })
  project.panels[2] = { ...project.panels[2], width: shortDepth }
  return { ...project, panels: resolvePanels(project) }
}

const supplemental = (project: Project) => project.connections.filter(connection => connection.type === '90' && connection.role === 'support')

describe('exposed corners beyond shared joints', () => {
  it.each([0, 37])('adds two end clamps without moving shared hardware (rotation %i)', angle => {
    const project = angle ? rotateProject(fixture(), 'y', angle) : fixture()
    const snapshot = structuredClone(project)
    const selected = [project.panels[0].id, project.panels[1].id]
    const result = autoConnect(project, selected)
    expect(result.joints).toBe(1)
    expect(result.connectors).toBe(2)
    expect(result.project.connections).toEqual(expect.arrayContaining(project.connections))
    expect(result.project.panels).toEqual(project.panels)
    expect(supplemental(result.project)).toHaveLength(1)
    expect(supplemental(result.project)[0].color).toBe('#123456')
    expect(validateProject(result.project)).toEqual([])
    expect(overlappingHardware(result.project)).toEqual([])
    expect(autoConnect(result.project, selected).connectors).toBe(0)
    expect(roundTripProject(result.project)).toEqual(result.project)
    expect(project).toEqual(snapshot)
  })

  it('skips full-depth third panels, insufficient exposed stock, and unrelated selections', () => {
    expect(autoConnect(fixture(600)).connectors).toBe(0)
    expect(autoConnect(fixture(550)).connectors).toBe(0)
    const project = fixture()
    expect(autoConnect(project, [project.panels[2].id]).connectors).toBe(0)
  })

  it('handles a one-ended extension and single-panel selection without changing existing overrides', () => {
    const project = fixture()
    project.connections[1] = { ...project.connections[1], offset: -150 }
    project.panels = resolvePanels(project)
    project.connectorOverrides = { [JSON.stringify([project.connections[0].id, 0])]: { color: '#654321', slide: 5 } }
    const result = autoConnect(project, [project.panels[0].id])
    expect(result.connectors).toBe(1)
    expect(result.project.connectorOverrides).toMatchObject(project.connectorOverrides)
    expect(overlappingHardware(result.project)).toEqual([])
    expect(autoConnect(result.project).connectors).toBe(0)
  })

  it('respects hidden blocking stock and skips managed assembly corners', () => {
    const full = fixture(600)
    full.panels[2] = { ...full.panels[2], visible: false }
    expect(autoConnect(full).connectors).toBe(0)
    const project = fixture()
    const managed = createAssembly(project, project.panels.map(panel => panel.id), 'Shared corner')
    expect(autoConnect(managed).project).toEqual(managed)
  })

  it('installs two front top outer corners on the storage library variant', () => {
    const project = synthStorageShelfProject()
    const panels = resolvePanels(project)
    const corners = getPhysicalConnectors(project).filter(piece => piece.connection.type === '90'
      && piece.connection.role === 'support'
      && [piece.connection.parentId, piece.connection.childId].every(id => panels.find(panel => panel.id === id)!.name.startsWith('Storage ')))
    expect(corners).toHaveLength(2)
    for (const piece of corners) {
      const rail = getConnectorRail(piece.connection, panels, project.connections)!
      const slide = connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
      const position = rail.placements[piece.index].position.map((value, axis) => value + rail.tangent[axis] * slide)
      expect(position[1]).toBeCloseTo(679)
      expect(position[2]).toBeGreaterThan(350)
      expect(Math.abs(position[0])).toBeCloseTo(467.5)
    }
    expect(overlappingHardware(project)).toEqual([])
    expect(autoConnect(project).connectors).toBe(0)
  })
})
