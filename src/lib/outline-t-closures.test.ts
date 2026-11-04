import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { connectClosingPanel } from './closure-connectors'
import { findPanelHoles } from './close-holes'
import { CONNECTOR_PROFILES } from './connector-profile'
import { installedHardware, overlappingHardware } from './connector-hardware-test-helpers'
import { gridProject } from './example-geometry'
import { createPanel, getConnectorPlacements, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { assertOutlineConnectionEdit } from './outline-connection-edits'
import { outlineConnectionAligned, outlineJointFrame } from './outline-closures'
import { resizePanels } from './structure-edit'
import type { Connection, Project } from './types'

const rectangle = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

function outlineT(flip = false): Project {
  const parent = createPanel({ id: 'rim', width: 300, height: 300, position: [0, 500, 0] })
  const children = [0, 1].map(index => {
    const sign = (index ? -1 : 1) * (flip ? -1 : 1)
    return createPanel({ id: `fill-${index}`, width: 400, height: 300, rotation: [-Math.PI / 2, 0, 0],
      position: [0, 667.5, sign * 167.5], customOutline: rectangle })
  })
  const connections: Connection[] = children.map((child, index) => ({ id: `outline-t:${index}`, parentId: parent.id, childId: child.id,
    type: 't', role: 'support', side: 'top', inset: 0, offset: 0, flip, count: index ? 0 : 2, color: '#123456',
    outlineEdge: (index ? -1 : 1) * (flip ? -1 : 1) > 0 ? 0 : 2 }))
  return { version: 1, name: 'Outline T', panels: [parent, ...children], connections }
}

describe('shared T joints between fitted outlines', () => {
  it.each([false, true])('seats the rim in the CAD stem and the two outline edges in opposing slots (flip: %s)', flip => {
    const original = outlineT(flip)
    const project = rotateProject(rotateProject(original, 'y', 31), 'z', 17)
    const parent = project.panels[0], children = project.panels.slice(1)
    const poses = project.connections.map((connection, index) => getConnectorPlacements({ ...connection, count: 1 }, parent, children[index])[0])
    const turn = new Quaternion().setFromEuler(new Euler(...poses[0].rotation))
    const origin = new Vector3(...poses[0].position)
    const stem = new Vector3(0, 0, 1).applyQuaternion(turn)
    const straight = new Vector3(1, 0, 0).applyQuaternion(turn)
    const seat = CONNECTOR_PROFILES.t.seat
    const rimTop = new Vector3(0, parent.height / 2, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...parent.rotation))).add(new Vector3(...parent.position))
    expect(origin.clone().addScaledVector(stem, seat).distanceTo(rimTop)).toBeLessThan(1e-7)
    for (const [index, connection] of project.connections.entries()) {
      const frame = outlineJointFrame(parent, connection)
      expect(origin.clone().addScaledVector(straight, index ? -seat : seat).distanceTo(frame.point)).toBeLessThan(1e-7)
      expect(outlineConnectionAligned(parent, children[index], connection)).toBe(true)
      expect(new Vector3(...poses[index].position).distanceTo(origin)).toBeLessThan(1e-7)
      expect(Math.abs(new Quaternion().setFromEuler(new Euler(...poses[index].rotation)).dot(turn))).toBeCloseTo(1, 7)
    }
    expect(validateProject(project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(installedHardware(project)).toHaveLength(2)
  })

  it.each(['mixed', 'partial', 'incomplete', 'duplicate-child', 'cross'])('rejects a malformed saved outline T: %s', kind => {
    const project = outlineT()
    if (kind === 'mixed') delete project.connections[1].outlineEdge
    if (kind === 'partial') project.connections.forEach(connection => { connection.partial = true })
    if (kind === 'incomplete') project.connections.pop()
    if (kind === 'duplicate-child') project.connections[1].childId = project.connections[0].childId
    if (kind === 'cross') project.connections.forEach(connection => { connection.type = 'cross' })
    expect(() => parseProject(project)).toThrow(/outline edge|joint/i)
    expect(validateProject(project).some(issue => issue.severity === 'error')).toBe(true)
  })

  it('requires T-compatible stock on both custom children, including the zero-count branch', () => {
    const project = outlineT()
    const thinner = { ...project, panels: project.panels.map(panel => panel.id === 'fill-1' ? { ...panel, thickness: 16 } : panel) }
    expect(() => assertOutlineConnectionEdit(project, thinner)).toThrow('fitted outline joint')
    expect(validateProject(thinner).some(issue => issue.id.endsWith('-thickness'))).toBe(true)
  })

  it('uses one shared T when both individual rails fit two clamps but their common span fits only one', () => {
    const source = outlineT()
    const parent = source.panels[0]
    const children = source.panels.slice(1).map((child, index) => ({ ...child, width: 200,
      position: [index ? 70 : -70, child.position[1], child.position[2]] as [number, number, number] }))
    let project: Project = { ...source, panels: [parent], connections: [] }
    for (const child of children) project = connectClosingPanel(project, child, [parent.id])
    expect(project.connections.map(connection => connection.type)).toEqual(['t', 't'])
    expect(project.connections.map(connection => connection.count)).toEqual([1, 0])
    expect(installedHardware(project)).toHaveLength(1)
    expect(validateProject(project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
  })

  it('reshapes both adjoining outlines when their shared rim is resized', () => {
    const frame = gridProject('Two openings', [350, 350], [350])
    const holes = findPanelHoles(resolvePanels(frame)).filter(hole => hole.label.startsWith('Front'))
    expect(holes).toHaveLength(2)
    let project = frame
    const fills = holes.map((hole, index) => createPanel({ ...hole.panel, id: `fill-${index}`, customOutline: rectangle }))
    for (const [index, hole] of holes.entries()) project = connectClosingPanel(project, fills[index], hole.boundaryIds)
    const shared = project.connections.filter(connection => connection.type === 't' && connection.outlineEdge !== undefined)
    expect(shared).toHaveLength(2)
    expect(new Set(shared.map(connection => connection.childId)).size).toBe(2)
    expect(overlappingHardware(project)).toEqual([])
    const parent = project.panels.find(panel => panel.id === shared[0].parentId)!
    const resized = resizePanels(project, [parent.id], { width: parent.width + 80 })
    for (const fill of fills) {
      const updated = resized.panels.find(panel => panel.id === fill.id)!
      expect(updated.height).toBeCloseTo(fill.height + 80, 6)
      for (const joint of resized.connections.filter(connection => connection.childId === fill.id)) {
        expect(outlineConnectionAligned(resized.panels.find(panel => panel.id === joint.parentId)!, updated, joint)).toBe(true)
      }
    }
    expect(resized.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(validateProject(resized)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(resized)))).toEqual(resized)
  })
})
