import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly } from './assemblies'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { extendPanelToGround, getPanelGroundExtension } from './extend-to-ground'
import { attachPanel, createPanel, createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import type { Panel, Project } from './types'

const projectOf = (...panels: Panel[]): Project => ({ version: 1, name: 'Ground extension', panels, connections: [] })
const hardwarePositions = (project: Project) => getPhysicalConnectors(project).map(piece => {
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
  return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
    connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)).toArray()
})
const near = (actual: number[], expected: number[]) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5))

describe('extend a panel to ground', () => {
  it('extends only the lower edge without rounding the cut size or changing the source', () => {
    const panel = createPanel({ width: 420, height: 300, position: [20, 497.25, 40], cornerRadius: 20 })
    const project = projectOf(panel)
    const before = structuredClone(project)
    const result = extendPanelToGround(project, panel.id)
    const fitted = resolvePanels(result.project)[0]
    expect(result.dimension).toBe('height')
    expect(result.distance).toBeCloseTo(347.25)
    expect(fitted.height).toBeCloseTo(647.25)
    expect(getProjectBounds([fitted]).min[1]).toBeCloseTo(0)
    expect(getProjectBounds([fitted]).max[1]).toBeCloseTo(getProjectBounds([panel]).max[1])
    expect(fitted.width).toBe(panel.width)
    expect(fitted.thickness).toBe(panel.thickness)
    expect(fitted.cornerRadius).toBe(panel.cornerRadius)
    expect(project).toEqual(before)
    expect(getPanelGroundExtension(result.project, panel.id).reason).toMatch(/already reaches/)
  })

  it.each([0, 27, 180])('accounts for connector seats on an attached desk leg at %s degrees', degrees => {
    const project = rotateProject(createStarterProject('desk'), 'y', degrees)
    const before = resolvePanels(project)
    const selected = before.find(panel => panel.name === 'Left side')!
    expect(getProjectBounds([selected]).min[1]).toBeCloseTo(22.5)
    const result = extendPanelToGround(project, selected.id)
    const fitted = resolvePanels(result.project).find(panel => panel.id === selected.id)!
    expect(result.dimension).toBe('width')
    expect(result.distance).toBeCloseTo(22.5)
    expect(fitted.width).toBeCloseTo(722.5)
    expect(getProjectBounds([fitted]).min[1]).toBeCloseTo(0)
    expect(getProjectBounds([fitted]).max[1]).toBeCloseTo(getProjectBounds([selected]).max[1])
    for (const panel of before.filter(panel => panel.id !== selected.id)) {
      const next = resolvePanels(result.project).find(item => item.id === panel.id)!
      expect(next).toEqual(panel)
    }
    hardwarePositions(result.project).forEach((position, index) => near(position, hardwarePositions(project)[index]))
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('preserves a vertical seam and the exact positions of its slid connectors', () => {
    const parent = createPanel({ width: 400, height: 400, position: [0, 500, 0] })
    const child = createPanel({ width: 300, height: 260 })
    const source = attachPanel(projectOf(parent), parent.id, child, { type: '90', side: 'right', flip: false, offset: 15, inset: 0, count: 2, color: '#ffffff' })
    const piece = getPhysicalConnectors(source)[0]
    const project = { ...source, connectorOverrides: { [piece.id]: { slide: 15, color: '#123456' } } }
    const selected = resolvePanels(project).find(panel => panel.id === child.id)!
    const result = extendPanelToGround(project, child.id)
    expect(result.dimension).toBe('height')
    expect(getProjectBounds([resolvePanels(result.project).find(panel => panel.id === child.id)!]).min[1]).toBeCloseTo(0)
    expect(resolvePanels(result.project)[0]).toEqual(resolvePanels(project)[0])
    expect(result.project.connections[0].offset).toBeCloseTo(project.connections[0].offset - result.distance / 2)
    expect(result.project.connectorOverrides?.[piece.id]?.color).toBe('#123456')
    hardwarePositions(result.project).forEach((position, index) => near(position, hardwarePositions(project)[index]))
    expect(getProjectBounds([resolvePanels(result.project).find(panel => panel.id === child.id)!]).max[1]).toBeCloseTo(getProjectBounds([selected]).max[1])
    expect(validateProject(result.project).filter(issue => issue.severity === 'error')).toEqual([])
  })

  it('handles reversed vertical axes and an explicit ground height', () => {
    const panel = createPanel({ width: 200, height: 300, rotation: [0, 0, Math.PI], position: [0, 400, 0] })
    const result = extendPanelToGround(projectOf(panel), panel.id, -100)
    const fitted = resolvePanels(result.project)[0]
    expect(fitted.height).toBeCloseTo(650)
    expect(getProjectBounds([fitted]).min[1]).toBeCloseTo(-100)
    const axis = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation)))
    near(new Vector3(...panel.position).addScaledVector(axis, -panel.height / 2).toArray(),
      new Vector3(...fitted.position).addScaledVector(axis, -fitted.height / 2).toArray())
  })

  it('rejects horizontal, tilted, custom, hidden, missing and already grounded panels', () => {
    const cases: [Partial<Panel>, RegExp][] = [
      [{ rotation: [-Math.PI / 2, 0, 0] }, /vertical/],
      [{ rotation: [0.2, 0.3, 0.4] }, /vertical/],
      [{ customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, /rectangular/],
      [{ visible: false }, /visible/],
      [{ position: [0, 180, 0] }, /already reaches/],
      [{ position: [0, 100, 0] }, /already extends below/],
      [{ position: [0, 4500, 0] }, /4,000/],
    ]
    for (const [patch, reason] of cases) {
      const panel = createPanel(patch)
      const fit = getPanelGroundExtension(projectOf(panel), panel.id)
      expect(fit.result).toBeUndefined()
      expect(fit.reason).toMatch(reason)
    }
    expect(getPanelGroundExtension(projectOf(), 'missing').reason).toMatch(/visible/)
    const panel = createPanel()
    expect(() => extendPanelToGround(projectOf(panel), panel.id, NaN)).toThrow(/finite/)
  })

  it('does not grow through another panel, including hidden obstacles', () => {
    const panel = createPanel({ width: 300, height: 200, position: [0, 400, 0] })
    const obstacle = createPanel({ width: 500, height: 500, position: [0, 100, 0], rotation: [-Math.PI / 2, 0, 0], visible: false, name: 'Lower shelf' })
    const project = projectOf(panel, obstacle)
    const fit = getPanelGroundExtension(project, panel.id)
    expect(fit.result).toBeUndefined()
    expect(fit.reason).toMatch(/overlaps Lower shelf/)
    expect(project.panels[0]).toEqual(panel)
  })

  it('respects assembly ownership and a joint on the edge that would move', () => {
    const project = createStarterProject('desk')
    const leg = resolvePanels(project).find(panel => panel.name === 'Left side')!
    const assembled = createAssembly(project, project.panels.map(panel => panel.id), 'Desk')
    expect(getPanelGroundExtension(assembled, leg.id).reason).toMatch(/assembly source/)
    const parent = createPanel({ width: 400, height: 400, position: [0, 700, 0] })
    const child = createPanel({ width: 400, height: 300 })
    const connected = attachPanel(projectOf(parent), parent.id, child, { type: '90', side: 'bottom', flip: false, offset: 0, inset: 0, count: 2, color: '#ffffff' })
    expect(getPanelGroundExtension(connected, parent.id).result).toBeUndefined()
  })
})
