import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import fixture from './__fixtures__/panel-merge.json'
import { mergePanels } from './panel-merge'
import { createPanel, parseProject, resolvePanels, rotateProject } from './model'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import type { Project } from './types'

const pair = (): Project => ({ version: 1, name: 'Merge', panels: [createPanel({ id: 'a', width: 300, height: 300, position: [0, 0, 0] }), createPanel({ id: 'b', width: 300, height: 300, position: [335, 0, 0] })], connections: [] })
const positions = (project: Project) => getPhysicalConnectors(project).map(piece => {
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
  return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
})
describe('merge panels', () => {
  it.each([0, 37, 90])('fills a gap in a frame rotated %s degrees and round trips', angle => {
    const source = rotateProject(pair(), 'z', angle), snapshot = structuredClone(source)
    const next = mergePanels(source, ['a', 'b'])
    expect(next.panels).toHaveLength(1)
    expect(next.panels[0].width).toBeCloseTo(635)
    expect(roundTripProject(next).panels[0].width).toBeCloseTo(635)
    expect(source).toEqual(snapshot)
  })
  it('merges vertically and preserves the first selected identity', () => {
    const source = pair(); source.panels[1].position = [0, 335, 0]
    const next = mergePanels(source, ['b', 'a'])
    expect(next.panels[0].id).toBe('b')
    expect(next.panels[0].height).toBe(635)
  })
  it.each([false, true])('merges the supplied front panels without moving other panels or hardware (reverse: %s)', reverse => {
    const source = parseProject(fixture), snapshot = structuredClone(source)
    const ids = ['62c43893-6d06-4bf7-9a9f-6a9327225b62', '1c89806e-c968-435d-9a76-97bfae6f41cb']
    if (reverse) ids.reverse()
    const next = mergePanels(source, ids)
    expect(next.panels).toHaveLength(source.panels.length - 1)
    expect(next.panels.find(panel => panel.id === ids[0])!.width).toBeCloseTo(635)
    for (const panel of resolvePanels(next).filter(panel => !ids.includes(panel.id))) {
      const original = resolvePanels(source).find(item => item.id === panel.id)!
      expect(new Vector3(...panel.position).distanceTo(new Vector3(...original.position))).toBeLessThan(0.001)
    }
    const hardware = positions(source)
    positions(next).forEach((position, index) => expect(position.distanceTo(hardware[index])).toBeLessThan(0.001))
    expect(() => roundTripProject(next)).not.toThrow()
    expect(source).toEqual(snapshot)
  })
  it.each(['plane', 'alignment', 'overlap', 'finish', 'size', 'constraint', 'obstacle'])('rejects incompatible %s without changing the source', reason => {
    const source = pair()
    if (reason === 'plane') source.panels[1].position[2] = 10
    if (reason === 'alignment') source.panels[1].position[1] = 10
    if (reason === 'overlap') source.panels[1].position[0] = 200
    if (reason === 'finish') source.panels[1].color = '#123456'
    if (reason === 'size') source.panels[1].position[0] = 4500
    if (reason === 'constraint') source.constraints = [{ id: 'lock', kind: 'dimension', panelId: 'a', dimension: 'width', value: 300, enabled: true }]
    if (reason === 'obstacle') source.panels.push(createPanel({ id: 'obstacle', width: 40, height: 100, position: [167.5, 0, 0], rotation: [0, Math.PI / 2, 0] }))
    const snapshot = structuredClone(source)
    expect(() => mergePanels(source, ['a', 'b'])).toThrow()
    expect(source).toEqual(snapshot)
  })
})
