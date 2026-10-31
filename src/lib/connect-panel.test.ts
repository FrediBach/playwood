import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { connectSelectedConnectors, getConnectorPanelFit } from './connect-panel'
import { connectorId, editConnectors, getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { createAssembly } from './assemblies'
import type { Project } from './types'

function fixture(type: 't' | 'cross' = 't', count = 2) {
  const parent = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
  let project = attachPanel({ version: 1, name: 'Connect panel', panels: [parent], connections: [] }, parent.id, createPanel({ width: 300, height: 300 }),
    { type: '90', side: 'right', flip: false, offset: 0, inset: 0, count, color: '#ff0000' })
  const ids = getPhysicalConnectors(project).map(piece => piece.id)
  project = editConnectors(project, ids, { type })
  return { project, ids }
}

function positions(project: Project) {
  const panels = resolvePanels(project).map(p => ({ ...p, visible: true }))
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)).toArray()
  })
}
function expectSamePositions(a: number[][], b: number[][]) {
  expect(a).toHaveLength(b.length)
  for (const position of a) expect(b.some(other => new Vector3(...position).distanceTo(new Vector3(...other)) < 1e-6)).toBe(true)
}

describe('connect selected connectors with a panel', () => {
  it('fills free T openings, keeps physical hardware and existing panels stationary, and round-trips', () => {
    const { project, ids } = fixture()
    const before = structuredClone(project)
    const result = connectSelectedConnectors(project, ids)
    expect(project).toEqual(before)
    expect(result.project.panels).toHaveLength(3)
    expect(resolvePanels(result.project).slice(0, 2)).toEqual(resolvePanels(project))
    expectSamePositions(positions(result.project), positions(project))
    expect(getPhysicalConnectors(result.project).every(piece => piece.type === 't' && piece.color === '#ff0000')).toBe(true)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(getConnectorPanelFit(result.project, getPhysicalConnectors(result.project).map(piece => piece.id)).result).toBeUndefined()
  })

  it('fits globally rotated and slid connectors, preserving unselected pieces and list membership', () => {
    let { project, ids } = fixture('t', 3)
    project = rotateProject(rotateProject(project, 'x', 31), 'y', 47)
    project = editConnectors(project, [ids[0]], { slide: 30, color: '#0000ff' })
    project = { ...project, connectorOrder: ids, listGroups: [{ id: 'g', kind: 'connectors', name: 'Corners', itemIds: [ids[0], ids[1]] }] }
    const result = connectSelectedConnectors(project, ids.slice(0, 2))
    expectSamePositions(positions(result.project), positions(project))
    expect(getPhysicalConnectors(result.project).find(piece => piece.id === ids[2])).toEqual(getPhysicalConnectors(project)[2])
    expect(result.project.connectorOrder?.[2]).toBe(ids[2])
    expect(result.project.listGroups?.[0].itemIds.every(id => getPhysicalConnectors(result.project).some(piece => piece.id === id))).toBe(true)
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('allows cross openings to be filled one plane at a time', () => {
    const { project, ids } = fixture('cross')
    const first = connectSelectedConnectors(project, ids)
    expect(validateProject(first.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(first.project)))).toEqual(first.project)
    const second = connectSelectedConnectors(first.project, getPhysicalConnectors(first.project).map(piece => piece.id))
    expect(second.project.panels).toHaveLength(4)
    expect(validateProject(second.project)).toEqual([])
    expectSamePositions(positions(second.project), positions(project))
    expect(getConnectorPanelFit(second.project, getPhysicalConnectors(second.project).map(piece => piece.id)).result).toBeUndefined()
  })

  it('sizes a panel between opposed openings, including rotated designs', () => {
    const a = fixture(), b = fixture()
    // Point the second corner back toward the first across a 630 mm gap.
    const right = { ...b.project, panels: b.project.panels.map(p => ({ ...p, position: [1000, 500, 0] as [number, number, number] })),
      connections: b.project.connections.map(c => ({ ...c, side: 'left' as const })) }
    let project: Project = { ...a.project, panels: [...a.project.panels, ...right.panels], connections: [...a.project.connections, ...right.connections], connectorOverrides: { ...a.project.connectorOverrides, ...right.connectorOverrides } }
    project = rotateProject(rotateProject(project, 'y', 32), 'z', 18)
    const result = connectSelectedConnectors(project, [...a.ids, ...b.ids])
    expect(result.project.panels.at(-1)!.width).toBeCloseTo(630)
    expect(result.project.panels.at(-1)!.height).toBeCloseTo(300)
    expect(validateProject(result.project)).toEqual([])
    expectSamePositions(positions(result.project), positions(project))
  })

  it('fills the remaining opening after replacing a complete T with cross hardware', () => {
    const parent = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
    let project = attachPanel({ version: 1, name: 'T', panels: [parent], connections: [] }, parent.id, createPanel({ width: 300, height: 300 }),
      { type: 't', side: 'top', flip: true, offset: 0, inset: 0, count: 2, color: '#ff0000' })
    const ids = getPhysicalConnectors(project).map(piece => piece.id)
    project = editConnectors(project, ids, { type: 'cross' })
    const result = connectSelectedConnectors(project, ids)
    expect(result.project.panels).toHaveLength(4)
    expect(validateProject(result.project)).toEqual([])
    expectSamePositions(positions(result.project), positions(project))
  })

  it('rejects incompatible hardware in the new panel span but allows an unselected open T slot', () => {
    const { project, ids } = fixture('t', 3)
    const selected = [ids[0], ids[2]]
    expect(getConnectorPanelFit(project, selected).result).toBeDefined()
    expect(getConnectorPanelFit(editConnectors(project, [ids[1]], { type: '150' }), selected).result).toBeUndefined()
  })

  it('rejects occupied slots, stale selections, incompatible stock and collisions including hidden panels', () => {
    const { project, ids } = fixture()
    expect(getConnectorPanelFit(project, ids.slice(0, 1)).result).toBeUndefined()
    expect(getConnectorPanelFit(project, [...ids, 'missing']).result).toBeUndefined()
    expect(getConnectorPanelFit(editConnectors(project, ids, { type: '90' }), ids).result).toBeUndefined()
    expect(getConnectorPanelFit(editConnectors(project, [ids[0]], { removed: true }), ids).result).toBeUndefined()
    for (const patch of [{ thickness: 16 }, { visible: false }, { customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }]) {
      expect(getConnectorPanelFit({ ...project, panels: project.panels.map(p => ({ ...p, ...patch })) }, ids).result).toBeUndefined()
    }
    const fit = connectSelectedConnectors(project, ids)
    const obstacle = { ...fit.project.panels.at(-1)!, id: 'obstacle', visible: false }
    expect(getConnectorPanelFit({ ...project, panels: [...project.panels, obstacle] }, ids).result).toBeUndefined()
  })

  it('rejects noncoplanar openings and openings on different parallel edges', () => {
    const a = fixture(), b = fixture()
    for (const offset of [[0, 0, 10], [10, 0, 0]]) {
      const other = { ...b.project, panels: b.project.panels.map(panel => ({ ...panel, position: panel.position.map((v, axis) => v + offset[axis]) as [number, number, number] })) }
      const project = { ...a.project, panels: [...a.project.panels, ...other.panels], connections: [...a.project.connections, ...other.connections], connectorOverrides: { ...a.project.connectorOverrides, ...other.connectorOverrides } }
      expect(getConnectorPanelFit(project, [a.ids[0], b.ids[1]]).result).toBeUndefined()
    }
  })

  it('bakes affected assemblies and reports them while preserving their parts', () => {
    const fixtureProject = fixture()
    const project = createAssembly(fixtureProject.project, fixtureProject.project.panels.map(p => p.id), 'Corner')
    const ids = getPhysicalConnectors(project).map(piece => piece.id)
    const upgraded = editConnectors(project, ids, { type: 't' })
    const result = connectSelectedConnectors(upgraded, ids)
    expect(result.disassembledNames).toEqual(['Corner'])
    expect(result.project.assemblies?.instances).toHaveLength(0)
    expectSamePositions(positions(result.project), positions(upgraded))
    expect(validateProject(result.project)).toEqual([])
  })

  it('validates partial branch indices and does not accept malformed complete joints', () => {
    const { project, ids } = fixture('cross')
    const result = connectSelectedConnectors(project, ids).project
    const partial = result.connections.filter(c => c.partial)
    expect(partial.length).toBeGreaterThan(0)
    const invalid = { ...result, connections: result.connections.map(c => c.partial ? { ...c, partial: false } : c) }
    expect(() => parseProject(invalid)).toThrow('incomplete')
    const missingBase = { ...result, connections: result.connections.filter(c => c.id !== partial[0].id) }
    expect(() => parseProject(missingBase)).toThrow('incomplete')
    expect(connectorId(partial[0].id, 0)).toBe(getPhysicalConnectors(result)[0].id)
  })
})
