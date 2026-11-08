import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { roundTripProject } from '../test/project-round-trip'
import { createAssembly } from './assemblies'
import { getConnectStrokeCandidate, type ConnectStroke } from './connect-stroke'
import { installedHardware, overlappingHardware } from './connector-hardware-test-helpers'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { connectorId, editConnectors, getPhysicalConnectors } from './connector-selection'
import { attachPanel, createPanel, resolvePanels, rotateProject, validateProject } from './model'
import type { ConnectorType, Project, Vec3 } from './types'

function joint(type: ConnectorType = '90', width = 400): Project {
  const parent = createPanel({ width, height: 300, position: [0, 500, 0] })
  return attachPanel({ version: 1, name: 'Draw connection', panels: [parent], connections: [] }, parent.id,
    createPanel({ width, height: 300 }), { side: 'top', type, flip: false, offset: 0, inset: 0, color: '#123456', count: 2 })
}

function strokeFor(project: Project, along = 0): ConnectStroke {
  const connection = project.connections[0]
  const rail = getConnectorRail(connection, resolvePanels(project), project.connections)!
  const point = new Vector3(...rail.placements[0].position).addScaledVector(new Vector3(...rail.tangent), along - rail.along[0]).toArray() as Vec3
  return { startPanelId: connection.parentId, endPanelId: connection.childId, start: point, end: point }
}

const strip = (project: Project): Project => ({ ...project, panels: resolvePanels(project), connections: [] })

describe('drawing a connector between positioned panels', () => {
  it.each(['90', '105', '150'] as const)('infers one %s connector at the drawn seam position without moving stock', type => {
    const attached = joint(type), project = strip(attached), before = structuredClone(project)
    const stroke = strokeFor(attached, 55)
    const result = getConnectStrokeCandidate(project, stroke)
    expect(result.reason).toBe('')
    expect(result.type).toBe(type)
    expect(new Vector3(...result.position!).distanceTo(new Vector3(...stroke.start))).toBeLessThan(1e-6)
    expect(result.candidate!.connections).toHaveLength(1)
    expect(result.candidate!.connections[0]).toMatchObject({ type, count: 1, role: 'support' })
    expect(getPhysicalConnectors(result.candidate!)).toHaveLength(1)
    expect(resolvePanels(result.candidate!)).toEqual(resolvePanels(project))
    expect(validateProject(result.candidate!).filter(issue => issue.severity === 'error')).toEqual([])
    expect(roundTripProject(result.candidate!)).toEqual(result.candidate)
    expect(project).toEqual(before)
  })

  it('uses world hit positions on rotated construction and accepts either draw direction', () => {
    const attached = rotateProject(rotateProject(joint('105'), 'x', 22), 'y', 37)
    const stroke = strokeFor(attached, -64), project = strip(attached)
    const forward = getConnectStrokeCandidate(project, stroke)
    const reverse = getConnectStrokeCandidate(project, { startPanelId: stroke.endPanelId, endPanelId: stroke.startPanelId, start: stroke.end, end: stroke.start })
    expect(forward.reason).toBe('')
    expect(reverse.reason).toBe('')
    for (const result of [forward, reverse]) {
      expect(new Vector3(...result.position!).distanceTo(new Vector3(...stroke.start))).toBeLessThan(1e-6)
      expect(resolvePanels(result.candidate!)).toEqual(resolvePanels(project))
    }
  })

  it.each(['90', 't', 'cross'] as const)('adds exactly one piece to an existing %s seam, retaining old IDs, slides and removals', type => {
    const attached = joint(type)
    const first = attached.connections[0]
    const base = editConnectors(editConnectors(attached, [connectorId(first.id, 0)], { slide: 15, color: '#abcdef' }),
      [connectorId(first.id, 1)], { removed: true })
    const before = structuredClone(base), oldHardware = installedHardware(base)
    const stroke = strokeFor(base, 33)
    if (type !== '90') {
      stroke.startPanelId = base.connections[0].childId
      stroke.endPanelId = base.connections.at(-1)!.childId
    }
    const result = getConnectStrokeCandidate(base, stroke)
    expect(result.reason).toBe('')
    expect(result.candidate!.connections).toHaveLength(base.connections.length)
    expect(result.candidate!.connections.map(connection => connection.id)).toEqual(base.connections.map(connection => connection.id))
    expect(result.candidate!.connections[0].count).toBe(first.count + 1)
    expect(result.connectorId).toBe(connectorId(first.id, first.count))
    expect(result.candidate!.connectorOverrides?.[connectorId(first.id, 1)]?.removed).toBe(true)
    const nextHardware = installedHardware(result.candidate!)
    expect(nextHardware).toHaveLength(oldHardware.length + 1)
    for (const old of oldHardware) expect(nextHardware.find(piece => piece.id === old.id)!.origin.distanceTo(old.origin)).toBeLessThan(1e-6)
    expect(overlappingHardware(result.candidate!)).toEqual([])
    expect(resolvePanels(result.candidate!)).toEqual(resolvePanels(base))
    expect(roundTripProject(result.candidate!)).toEqual(result.candidate)
    expect(base).toEqual(before)
  })

  it('averages the endpoints along the seam and keeps nearby clearance snapping visible', () => {
    const project = joint()
    const center = strokeFor(project, 0), start = strokeFor(project, -30), end = strokeFor(project, 90)
    const result = getConnectStrokeCandidate(project, { ...center, start: start.start, end: end.end })
    expect(result.reason).toBe('')
    const rail = getConnectorRail(result.candidate!.connections[0], resolvePanels(project), result.candidate!.connections)!
    const index = project.connections[0].count
    expect(rail.along[index] + connectorSlide(rail, index, result.candidate!.connectorOverrides?.[result.connectorId!]?.slide)).toBeCloseTo(30)
    const crowded = getConnectStrokeCandidate(project, strokeFor(project, 155))
    expect(crowded.reason).toBe('')
    expect(new Vector3(...crowded.position!).distanceTo(new Vector3(...strokeFor(project, 155).start))).toBeLessThanOrEqual(20 + 1e-6)
  })

  it('rejects occupied positions instead of relocating hardware far along the seam', () => {
    const project = joint(), before = structuredClone(project)
    const result = getConnectStrokeCandidate(project, strokeFor(project, 180))
    expect(result.candidate).toBeNull()
    expect(result.reason).toMatch(/occupies|room/)
    expect(project).toEqual(before)
  })

  it('rejects same or hidden panels, invalid coordinates, assembly ownership and unsupported thickness', () => {
    const attached = joint(), project = strip(attached), stroke = strokeFor(attached)
    expect(getConnectStrokeCandidate(project, { ...stroke, endPanelId: stroke.startPanelId }).reason).toMatch(/different/)
    expect(getConnectStrokeCandidate(project, { ...stroke, start: [NaN, 0, 0] }).candidate).toBeNull()
    expect(getConnectStrokeCandidate({ ...project, panels: project.panels.map(panel => ({ ...panel, visible: false })) }, stroke).reason).toMatch(/visible/)
    expect(getConnectStrokeCandidate({ ...project, panels: project.panels.map(panel => ({ ...panel, thickness: 25 })) }, stroke).reason).toMatch(/16–19/)
    const assembly = createAssembly(attached, attached.panels.map(panel => panel.id), 'Corner')
    expect(getConnectStrokeCandidate(assembly, strokeFor(assembly)).reason).toMatch(/Disassemble/)
  })

  it('rejects misalignment, a short rail and unsupported custom outlines without changing stock', () => {
    const attached = joint(), project = strip(attached), stroke = strokeFor(attached)
    const moved = { ...project, panels: project.panels.map((panel, index) => index ? { ...panel, position: [panel.position[0], panel.position[1] + 5, panel.position[2]] as Vec3 } : panel) }
    expect(getConnectStrokeCandidate(moved, stroke).reason).toMatch(/No compatible/)
    const short = joint('90', 30)
    expect(getConnectStrokeCandidate(strip(short), strokeFor(short)).candidate).toBeNull()
    const outline = { ...project, panels: project.panels.map(panel => ({ ...panel, customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] })) }
    expect(getConnectStrokeCandidate(outline, stroke).reason).toMatch(/rectangular/)
    expect(getConnectStrokeCandidate(project, strokeFor(attached, 250)).reason).toMatch(/closer/)
  })

  it('checks hidden unrelated stock at the new connector and leaves unrelated diagnostics alone', () => {
    const attached = joint(), stroke = strokeFor(attached), project = strip(attached)
    const obstacle = createPanel({ name: 'Hidden obstacle', width: 50, height: 50, thickness: 18, visible: false, position: stroke.start })
    const blocked = getConnectStrokeCandidate({ ...project, panels: [...project.panels, obstacle] }, stroke)
    expect(blocked.candidate).toBeNull()
    expect(blocked.reason).toMatch(/Hidden obstacle/)
    const far = { ...obstacle, position: [3000, 500, 0] as Vec3 }
    const unrelated = { ...project, panels: [...project.panels, far, { ...far, id: 'another-obstacle' }] }
    expect(getConnectStrokeCandidate(unrelated, stroke).reason).toBe('')
  })

  it('does not create T upgrades or cut panels and respects existing joint storage limits', () => {
    const attached = joint('t'), project = strip(attached), before = structuredClone(project)
    const result = getConnectStrokeCandidate(project, strokeFor(attached))
    expect(result.candidate!.connections).toHaveLength(1)
    expect(result.candidate!.connections[0].type).toBe('90')
    expect(result.candidate!.panels).toEqual(project.panels)
    expect(project).toEqual(before)
    const partial = { ...attached, connections: attached.connections.map(connection => ({ ...connection, partial: true })) }
    expect(getConnectStrokeCandidate(partial, strokeFor(partial)).reason).toMatch(/Complete/)
    const full = joint('90', 1000)
    full.connections = full.connections.map(connection => ({ ...connection, count: 20 }))
    expect(getConnectStrokeCandidate(full, strokeFor(full)).reason).toMatch(/maximum of 20/)
  })
})
