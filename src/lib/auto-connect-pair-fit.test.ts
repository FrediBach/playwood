import { roundTripProject } from '../test/project-round-trip'
import { Vector3 } from 'three'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, resolvePanels, rotateProject, validateProject } from './model'
import { resizePanelEdge } from './structure-edit'
import { getAutoConnectFit } from './auto-connect-fit'
import { autoConnect } from './auto-connect'
import type { Project } from './types'

function gap(): Project {
  let project: Project = { version: 1, name: 'Angled gap', panels: [createPanel({ id: 'lower', name: 'Lower slope', width: 300, height: 400, position: [0, 700, 0] })], connections: [] }
  const options = { type: '150' as const, side: 'top' as const, flip: false, offset: 0, inset: 0, count: 2, color: '#222222' }
  project = attachPanel(project, 'lower', createPanel({ id: 'upper', name: 'Upper slope', width: 300, height: 200 }), options)
  const missing = project.connections[0].id
  project = attachPanel(project, 'lower', createPanel({ id: 'base', width: 300, height: 300 }), { ...options, side: 'bottom', type: '90' })
  project = attachPanel(project, 'upper', createPanel({ id: 'top', width: 300, height: 300 }), { ...options, type: '105' })
  project = { ...project, panels: resolvePanels(project), connections: project.connections.filter(connection => connection.id !== missing) }
  project = resizePanelEdge(project, 'lower', 'height', 1, -20, true)
  return resizePanelEdge(project, 'upper', 'height', -1, -30, true)
}

describe('coordinated auto-connect fit', () => {
  it.each([false, true])('closes an angled gap by resizing both branches and retaining their outer joints (rotated: %s)', rotated => {
    const project = rotated ? rotateProject(gap(), 'y', 31) : gap()
    const before = structuredClone(project)
    expect(autoConnect(project, ['lower', 'upper']).joints).toBe(0)
    const fit = getAutoConnectFit(project, ['lower', 'upper'])
    expect(fit).not.toBeNull()
    expect(fit!.adjustments).toHaveLength(2)
    const panels = resolvePanels(fit!.result.project)
    expect(panels.find(panel => panel.id === 'lower')!.height).toBeCloseTo(400, 5)
    expect(panels.find(panel => panel.id === 'upper')!.height).toBeCloseTo(200, 5)
    for (const panel of resolvePanels(project).filter(panel => ['base', 'top'].includes(panel.id))) {
      const after = panels.find(item => item.id === panel.id)!
      expect({ ...after, position: panel.position }).toEqual(panel)
      after.position.forEach((value, axis) => expect(value).toBeCloseTo(panel.position[axis], 6))
    }
    const hardware = (source: Project) => new Map(getPhysicalConnectors(source).map(piece => {
      const rail = getConnectorRail(piece.connection, resolvePanels(source), source.connections)!
      return [piece.id, new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent), connectorSlide(rail, piece.index, source.connectorOverrides?.[piece.id]?.slide))]
    }))
    const afterHardware = hardware(fit!.result.project)
    for (const [id, position] of hardware(project)) expect(afterHardware.get(id)!.distanceTo(position)).toBeLessThan(1e-6)
    expect(fit!.result.connectors).toBe(2)
    expect(validateProject(fit!.result.project)).toEqual([])
    expect(roundTripProject(fit!.result.project).connections).toEqual(fit!.result.project.connections)
    expect(project).toEqual(before)
    expect(getAutoConnectFit(fit!.result.project, ['lower', 'upper'])).toBeNull()
  })

  it('can find the partner from one selected branch', () => {
    expect(getAutoConnectFit(gap(), ['lower'])?.adjustments).toHaveLength(2)
    expect(getAutoConnectFit(gap(), ['missing'])).toBeNull()
  })

  it('rejects hidden partners, distant gaps and new collisions', () => {
    const hidden = gap()
    hidden.panels = hidden.panels.map(panel => panel.id === 'upper' ? { ...panel, visible: false } : panel)
    expect(getAutoConnectFit(hidden, ['lower', 'upper'])).toBeNull()
    const distant = resizePanelEdge(gap(), 'lower', 'height', 1, -110, true)
    expect(getAutoConnectFit(distant, ['lower', 'upper'])).toBeNull()
    const blocked = gap()
    blocked.panels.push(createPanel({ id: 'obstacle', width: 100, height: 10, position: [0, 895, 0] }))
    expect(getAutoConnectFit(blocked, ['lower', 'upper'])).toBeNull()
  })

  it('rejects conflicting dimensions without changing the source', () => {
    const project = gap()
    project.constraints = [{ id: 'fixed', kind: 'dimension', panelId: 'lower', dimension: 'height', value: 380, enabled: true }]
    const before = structuredClone(project)
    expect(getAutoConnectFit(project, ['lower', 'upper'])).toBeNull()
    expect(project).toEqual(before)
  })
})
