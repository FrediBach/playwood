import { describe, expect, it } from 'vitest'
import { autoConnect } from './auto-connect'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { createExampleProject } from './example-library'
import type { ConnectorType, Project } from './types'

function joint(type: ConnectorType = '90', width = 300): Project {
  const parent = createPanel({ width, height: 300, position: [0, 500, 0] })
  return attachPanel({ version: 1, name: 'Auto connect', panels: [parent], connections: [] }, parent.id, createPanel({ width, height: 300 }), { side: 'top', type, flip: false, offset: 0, inset: 0, color: '#e86536', count: 2 })
}
const strip = (project: Project): Project => ({ ...project, panels: resolvePanels(project), connections: [] })

describe('auto-add connectors', () => {
  it.each(['90', '105', '150', 't', 'cross'] as const)('recognizes %s joints without moving panels, and is repeatable', type => {
    const loose = strip(joint(type))
    const before = structuredClone(loose)
    const result = autoConnect(loose)
    expect(result.joints).toBe(1)
    expect(result.connectors).toBe(2)
    expect(result.project.connections.every(connection => connection.type === type && connection.role === 'support')).toBe(true)
    expect(result.project.panels).toEqual(before.panels)
    expect(loose).toEqual(before)
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
    expect(autoConnect(result.project).joints).toBe(0)
    expect(parseProject(JSON.parse(JSON.stringify(result.project))).panels).toEqual(before.panels)
  })

  it('closes all four joints of a box, including globally rotated panels', () => {
    const loose = strip(rotateProject(createExampleProject('cube'), 'y', 37))
    const result = autoConnect(loose)
    expect(result.joints).toBe(4)
    expect(result.connectors).toBe(8)
    expect(result.project.panels).toEqual(loose.panels)
    expect(autoConnect(result.project).joints).toBe(0)
  })

  it('preserves existing connectors and only fills missing joints', () => {
    const box = createExampleProject('cube')
    const partial = { ...box, connections: box.connections.slice(0, 2) }
    const result = autoConnect(partial)
    expect(result.joints).toBe(2)
    expect(result.project.connections.slice(0, 2)).toEqual(partial.connections)
  })

  it('uses a single connector on short shared edges', () => {
    const result = autoConnect(strip(joint('90', 60)))
    expect(result.joints).toBe(1)
    expect(result.connectors).toBe(1)
  })

  it('skips incompatible thickness, misalignment and insufficient clearance', () => {
    const loose = strip(joint())
    for (const patch of [{ thickness: 25 }, { position: [0, 0, 0] as [number, number, number] }, { width: 20 }]) {
      const modified = { ...loose, panels: loose.panels.map((panel, i) => i === 1 ? { ...panel, ...patch } : panel) }
      expect(autoConnect(modified).joints).toBe(0)
    }
  })

  it('scopes multiple selections to their members and a single selection to its neighbors', () => {
    const original = createExampleProject('cube')
    const box = strip(original)
    const pair = [original.connections[0].parentId, original.connections[0].childId]
    expect(autoConnect(box, pair).joints).toBe(1)
    expect(autoConnect(box, [pair[0]]).joints).toBe(2)
    expect(autoConnect({ ...box, panels: box.panels.map(panel => ({ ...panel, visible: false })) }).joints).toBe(0)
  })
})

function continuousT(): Project {
  const source = joint('t')
  const [left, divider, right] = resolvePanels(source)
  const shelf = { ...left, name: 'Continuous shelf', height: left.height + right.height + 35, position: left.position.map((v, i) => (v + right.position[i]) / 2) as [number, number, number] }
  return { ...source, panels: [shelf, divider], connections: [] }
}

describe('interior T joints', () => {
  it('splits a continuous panel around the connector and preserves outer bounds and the divider', () => {
    const original = continuousT()
    const before = structuredClone(original)
    const result = autoConnect(original)
    expect(result.splits).toBe(1)
    expect(result.joints).toBe(1)
    expect(result.connectors).toBe(2)
    expect(result.project.panels).toHaveLength(3)
    const [left, divider, right] = result.project.panels
    expect(left.height + right.height + 35).toBe(before.panels[0].height)
    expect(left.position[1] - left.height / 2).toBe(before.panels[0].position[1] - before.panels[0].height / 2)
    expect(right.position[1] + right.height / 2).toBe(before.panels[0].position[1] + before.panels[0].height / 2)
    expect(divider).toEqual(before.panels[1])
    expect(left.id).toBe(before.panels[0].id)
    expect(right.color).toBe(left.color)
    expect(original).toEqual(before)
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(autoConnect(result.project).joints).toBe(0)
  })

  it('works on rotated designs and with only the divider selected', () => {
    const original = rotateProject(rotateProject(continuousT(), 'x', 90), 'y', 28)
    const result = autoConnect(original, [original.panels[1].id])
    expect(result.splits).toBe(1)
    expect(result.project.panels[1]).toEqual(original.panels[1])
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('retains a connection on the far end of the split panel', () => {
    const original = continuousT(), shelf = original.panels[0]
    const connected = attachPanel(original, shelf.id, createPanel(), { side: 'top', type: '90', flip: true, offset: 0, inset: 0, color: '#e86536', count: 2 })
    const before = resolvePanels(connected)
    const result = autoConnect(connected)
    expect(result.splits).toBe(1)
    expect(resolvePanels(result.project).find(p => p.id === before[2].id)).toEqual(before[2])
    expect(result.project.connections[0].id).toBe(connected.connections[0].id)
    expect(result.project.connections[0].parentId).toBe(result.addedPanelIds[0])
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('does not cut panels for incompatible thickness, gaps, or selection', () => {
    const original = continuousT()
    expect(autoConnect(original, ['unrelated']).splits).toBe(0)
    for (const thickness of [16, 25]) expect(autoConnect({ ...original, panels: original.panels.map(panel => ({ ...panel, thickness })) }).splits).toBe(0)
    const shifted = { ...original, panels: original.panels.map((panel, i) => i ? { ...panel, position: [panel.position[0], panel.position[1], panel.position[2] + 10] as [number, number, number] } : panel) }
    expect(autoConnect(shifted).splits).toBe(0)
  })
})
