import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { createAssembly, duplicateAssembly, materializeAssemblies, updateAssemblyFinish } from './assemblies'
import { getConnectorRail } from './connector-movement'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import type { Panel, Project, Vec3 } from './types'

function cornerWithContinuation() {
  const parent = createPanel({ id: 'green', name: 'Large green top', width: 600, height: 400, position: [0, 700, 0], rotation: [-Math.PI / 2, 0, 0] })
  const source = attachPanel({ version: 1, name: 'Neighboring tops', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'upright', name: 'Upright', width: 300, height: 250 }),
    { side: 'top', type: 't', flip: true, offset: 0, inset: 0, color: '#222222', count: 2 })
  const panels = resolvePanels(source)
  const continuation = { ...panels[2], id: 'white', name: 'Small white top' }
  const project: Project = { ...source, panels: [panels[0], panels[1], continuation], connections: [{ ...source.connections[0], type: '90' }] }
  return { project, selected: [parent.id, continuation.id], uprightId: panels[1].id }
}

function expectSamePanels(before: Project, after: Project) {
  const expected = resolvePanels(before)
  const actual = resolvePanels(after)
  expect(actual.map(panel => panel.id)).toEqual(expected.map(panel => panel.id))
  for (const panel of expected) {
    const next = actual.find(item => item.id === panel.id)!
    expect({ ...next, position: panel.position, rotation: panel.rotation }).toEqual(panel)
    next.position.forEach((value, index) => expect(value).toBeCloseTo(panel.position[index], 7))
    const originalRotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
    const nextRotation = new Quaternion().setFromEuler(new Euler(...next.rotation))
    expect(originalRotation.angleTo(nextRotation)).toBeLessThan(1e-6)
  }
}

function expectCompleteUpgrade(before: Project, after: ReturnType<typeof autoConnect>, type: 't' | 'cross') {
  expect(after.joints).toBe(1)
  expect(after.connectors).toBe(2)
  expect(after.splits).toBe(0)
  expect(after.addedPanelIds).toEqual([])
  expect(after.project.connections).toHaveLength(type === 't' ? 2 : 3)
  expect(after.project.connections.every(connection => connection.type === type)).toBe(true)
  expect(getPhysicalConnectors(after.project).map(connector => connector.type)).toEqual([type, type])
  expectSamePanels(before, after.project)
  expect(validateProject(after.project)).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(after.project)))).toEqual(after.project)
}

describe('auto-connect upgrades existing joints', () => {
  it('joins two selected coplanar panels through their unselected upright, replacing the corner clamps', () => {
    const { project, selected } = cornerWithContinuation()
    const before = structuredClone(project)
    expect(validateProject(project)).toEqual([])
    const result = autoConnect(project, selected)
    expectCompleteUpgrade(before, result, 't')
    expect(project).toEqual(before)
    const repeated = autoConnect(result.project, selected)
    expect(repeated.joints).toBe(0)
    expect(repeated.connectors).toBe(0)
    expect(repeated.project).toEqual(result.project)
  })

  it('promotes an existing T to a cross when the opposite branch is added', () => {
    const parent = createPanel({ id: 'parent', width: 300, height: 300, position: [0, 700, 0] })
    const cross = attachPanel({ version: 1, name: 'Fourth branch', panels: [parent], connections: [] }, parent.id,
      createPanel({ width: 300, height: 300 }),
      { side: 'top', type: 'cross', flip: false, offset: 0, inset: 0, color: '#222222', count: 2 })
    const panels = resolvePanels(cross)
    const project: Project = { ...cross, panels, connections: [
      { ...cross.connections[0], type: 't' },
      { ...cross.connections[2], id: cross.connections[1].id, type: 't' },
    ] }
    expect(validateProject(project)).toEqual([])
    const result = autoConnect(project, [parent.id, panels[2].id])
    expectCompleteUpgrade(project, result, 'cross')
    expect(autoConnect(result.project).joints).toBe(0)
  })

  it('fits a continuation whose width and height axes are exchanged', () => {
    const fixture = cornerWithContinuation()
    const project = { ...fixture.project, panels: fixture.project.panels.map(panel => {
      if (panel.id !== fixture.selected[1]) return panel
      const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)))
      return { ...panel, width: panel.height, height: panel.width, rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
    }) }
    const result = autoConnect(project, fixture.selected)
    expectCompleteUpgrade(project, result, 't')
    expect(result.project.connections.some(connection => connection.quarterTurn)).toBe(true)
  })

  it('fits different panel lengths and along-edge offsets within the overlap shared by all three panels', () => {
    const fixture = cornerWithContinuation()
    const project = { ...fixture.project, panels: fixture.project.panels.map(panel => panel.id === 'white'
      ? { ...panel, width: 140, cornerRadius: 10, position: [90, panel.position[1], panel.position[2]] as Vec3 }
      : panel.id === 'upright' ? { ...panel, cornerRadius: 20 } : { ...panel, cornerRadius: 35 }) }
    const result = autoConnect(project, fixture.selected)
    expectCompleteUpgrade(project, result, 't')
    const connection = result.project.connections.find(item => item.count > 0)!
    const rail = getConnectorRail(connection, resolvePanels(result.project), result.project.connections)!
    expect(rail.placements).toHaveLength(2)
    // White's straight edge spans x=30..150, upright's x=-130..130.
    // Every 40 mm clamp must therefore be centered within x=50..110.
    for (const placement of rail.placements) {
      expect(placement.position[0]).toBeGreaterThanOrEqual(50 - 1e-7)
      expect(placement.position[0]).toBeLessThanOrEqual(110 + 1e-7)
    }
    expect(Math.abs(rail.placements[0].position[0] - rail.placements[1].position[0])).toBeGreaterThanOrEqual(40)
  })

  it('uses one replacement clamp when the common straight overlap is too short for two', () => {
    const fixture = cornerWithContinuation()
    const project = { ...fixture.project, panels: fixture.project.panels.map(panel => panel.id === 'white'
      ? { ...panel, width: 70, cornerRadius: 10 } : panel) }
    const result = autoConnect(project, fixture.selected)
    expect(result.joints).toBe(1)
    expect(result.connectors).toBe(1)
    expect(getPhysicalConnectors(result.project).map(connector => connector.type)).toEqual(['t'])
    expectSamePanels(project, result.project)
    expect(validateProject(result.project)).toEqual([])
    expect(autoConnect(result.project, fixture.selected).joints).toBe(0)
  })

  it('keeps other joints and the poses of panels driven by the upgraded joint', () => {
    const fixture = cornerWithContinuation()
    let project = attachPanel(fixture.project, fixture.uprightId,
      createPanel({ id: 'descendant', width: 240, height: 160 }),
      { side: 'top', type: '90', flip: false, offset: 0, inset: 0, color: '#123456', count: 2 })
    const farParent = createPanel({ id: 'far-parent', width: 300, height: 300, position: [1500, 700, 0] })
    const unrelated = attachPanel({ version: 1, name: 'Unrelated', panels: [farParent], connections: [] }, farParent.id,
      createPanel({ id: 'far-child', width: 300, height: 300 }),
      { side: 'top', type: '90', flip: false, offset: 0, inset: 0, color: '#654321', count: 2 })
    project = { ...project, panels: [...project.panels, ...unrelated.panels], connections: [...project.connections, ...unrelated.connections] }
    const before = structuredClone(project)
    const keptConnections = project.connections.slice(1)
    expect(validateProject(project)).toEqual([])
    const result = autoConnect(project, fixture.selected)
    expect(result.joints).toBe(1)
    expect(result.project.connections).toHaveLength(4)
    for (const connection of keptConnections) expect(result.project.connections).toContainEqual(connection)
    expectSamePanels(before, result.project)
    expect(project).toEqual(before)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it('upgrades an assembly corner without changing its copied instance or losing the result on reload', () => {
    const fixture = cornerWithContinuation()
    const continuation = fixture.project.panels.find(panel => panel.id === 'white')!
    const corner = { ...fixture.project, panels: fixture.project.panels.filter(panel => panel.id !== continuation.id) }
    const original = createAssembly(corner, corner.panels.map(panel => panel.id), 'Green corner')
    const affected = original.assemblies!.instances[0]
    let project = duplicateAssembly(original, affected.id)
    project = updateAssemblyFinish(project, affected.id, { color: '#456789', material: 'oak' })
    project = { ...project, panels: [...project.panels, continuation] }
    const before = structuredClone(project)
    const copy = project.assemblies!.instances[1]
    const copyConnections = project.connections.filter(connection => Object.values(copy.connectionIds!).includes(connection.id))
    const result = autoConnect(project, fixture.selected)
    expect(result.joints).toBe(1)
    expect(result.upgrades).toBe(1)
    expect(result.disassembledNames).toEqual(['Green corner'])
    expect(result.project.assemblies!.instances).toEqual([copy])
    expect(result.project.assemblies!.definitions).toEqual(before.assemblies!.definitions)
    for (const connection of copyConnections) expect(result.project.connections).toContainEqual(connection)
    expectSamePanels(before, result.project)
    expect(validateProject(result.project)).toEqual([])
    const loaded = parseProject(JSON.parse(JSON.stringify(result.project)))
    expect(loaded).toEqual(result.project)
    const rebuilt = materializeAssemblies(loaded)
    expect(new Map(rebuilt.panels.map(panel => [panel.id, panel]))).toEqual(new Map(result.project.panels.map(panel => [panel.id, panel])))
    expect(new Map(rebuilt.connections.map(connection => [connection.id, connection]))).toEqual(new Map(result.project.connections.map(connection => [connection.id, connection])))
    expect(autoConnect(loaded, fixture.selected).joints).toBe(0)
    expect(project).toEqual(before)
  })

  it('finds the shared joint after world rotation and a half-turn of the loose panel', () => {
    const fixture = cornerWithContinuation()
    const halfTurn = { ...fixture.project, panels: fixture.project.panels.map(panel => {
      if (panel.id !== 'white') return panel
      const rotation = new Euler().setFromQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI)))
      return { ...panel, rotation: [rotation.x, rotation.y, rotation.z] as Vec3 }
    }) }
    const project = rotateProject(rotateProject(halfTurn, 'y', 37), 'x', 23)
    const result = autoConnect(project, fixture.selected)
    expectCompleteUpgrade(project, result, 't')
    expect(autoConnect(result.project, fixture.selected).joints).toBe(0)
  })

  it('rejects pairwise overlaps that leave no common clamp position across all members', () => {
    const fixture = cornerWithContinuation()
    const project = { ...fixture.project,
      panels: fixture.project.panels.map(panel => panel.id === 'white'
        ? { ...panel, width: 100, position: [100, panel.position[1], panel.position[2]] as Vec3 }
        : panel.id === 'upright' ? { ...panel, width: 100 } : panel),
      connections: fixture.project.connections.map(connection => ({ ...connection, offset: -100 })),
    }
    expect(validateProject(project)).toEqual([])
    const before = structuredClone(project)
    const result = autoConnect(project, fixture.selected)
    expect(result.joints).toBe(0)
    expect(result.project).toEqual(before)
    expect(project).toEqual(before)
  })

  it('carries individual finishes to replacement hardware while clearing old slide, type and removal overrides', () => {
    const fixture = cornerWithContinuation()
    const old = fixture.project.connections[0]
    const project = { ...fixture.project, connectorOverrides: {
      [connectorId(old.id, 0)]: { color: '#ff0000', removed: true },
      [connectorId(old.id, 1)]: { color: '#0000ff', type: '105' as const, slide: -30 },
    } }
    const before = structuredClone(project)
    const result = autoConnect(project, fixture.selected)
    expectCompleteUpgrade(project, result, 't')
    expect(getPhysicalConnectors(result.project).map(piece => piece.color)).toEqual(['#0000ff', '#0000ff'])
    expect(Object.values(result.project.connectorOverrides!)).toEqual([{ color: '#0000ff' }, { color: '#0000ff' }])
    expect(result.project.connectorOverrides![connectorId(old.id, 0)]).toBeUndefined()
    expect(result.project.connectorOverrides![connectorId(old.id, 1)]).toBeUndefined()
    expect(project).toEqual(before)
  })

  it.each([[false, true], [true, true], [false, false], [true, false]])('respects nearby hardware at its slid position and preserves its overrides (removed: %s, visible: %s)', (removed, visible) => {
    const fixture = cornerWithContinuation()
    // This separate corner has default clamp centers 80 mm away. Sliding its
    // second clamp back by 80 mm puts it directly on the proposed T hardware.
    const nearbyPanels = fixture.project.panels.filter(panel => panel.id !== 'white').map(panel => ({
      ...panel, visible, id: `nearby-${panel.id}`, position: [panel.position[0] + 80, panel.position[1], panel.position[2]] as Vec3,
    }))
    const nearbyConnection = { ...fixture.project.connections[0], id: 'nearby:0', parentId: 'nearby-green', childId: 'nearby-upright' }
    const nearbyOverride = { slide: -80, color: '#abcdef', removed }
    const key = connectorId(nearbyConnection.id, 1)
    const project = { ...fixture.project, panels: [...fixture.project.panels, ...nearbyPanels],
      connections: [...fixture.project.connections, nearbyConnection], connectorOverrides: { [key]: nearbyOverride },
    }
    const before = structuredClone(project)
    const result = autoConnect(project, fixture.selected)
    expect(result.project.connections).toContainEqual(nearbyConnection)
    expect(result.project.connectorOverrides![key]).toEqual(nearbyOverride)
    expectSamePanels(before, result.project)
    expect(project).toEqual(before)
    if (removed) {
      expect(result.joints).toBe(1)
      expect(result.project.connections.filter(connection => connection.type === 't')).toHaveLength(2)
    } else {
      expect(result.joints).toBe(0)
      expect(result.project).toEqual(before)
    }
  })

  it.each(['misaligned', 'thick', 'hidden upright', 'missing upright', 'unrelated selection'] as const)
    ('leaves an unsuitable upgrade unchanged: %s', condition => {
      const fixture = cornerWithContinuation()
      let project = fixture.project
      let selected = fixture.selected
      if (condition === 'misaligned') project = { ...project, panels: project.panels.map(panel => panel.id === 'white'
        ? { ...panel, position: [panel.position[0], panel.position[1] + 5, panel.position[2]] as Vec3 } : panel) }
      if (condition === 'thick') project = { ...project, panels: project.panels.map(panel => panel.id === 'white' ? { ...panel, thickness: 25 } : panel) }
      if (condition === 'hidden upright') project = { ...project, panels: project.panels.map(panel => panel.id === fixture.uprightId ? { ...panel, visible: false } : panel) }
      if (condition === 'missing upright') project = { ...project, panels: project.panels.filter(panel => panel.id !== fixture.uprightId), connections: [] }
      if (condition === 'unrelated selection') {
        const unrelated: Panel = createPanel({ id: 'unrelated', position: [2000, 700, 0] })
        project = { ...project, panels: [...project.panels, unrelated] }
        selected = ['green', unrelated.id]
      }
      const before = structuredClone(project)
      const result = autoConnect(project, selected)
      expect(result.joints).toBe(0)
      expect(result.connectors).toBe(0)
      expect(result.project).toEqual(before)
      expect(project).toEqual(before)
    })
})
