import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly } from './assemblies'
import { connectorId } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { attachPanel, createPanel, createStarterProject, resolvePanels, rotateProject, validateProject } from './model'
import { movePreviewResize, preparePreviewResize, type PreviewResizeSession } from './preview-resize'
import { gridProject } from './example-geometry'
import type { Project, Vec3 } from './types'

const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!
const near = (actual: number[], expected: number[], precision = 5) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], precision))
const along = (session: PreviewResizeSession, axis: Vec3) => session.handles.find(handle => new Vector3(...handle.direction).dot(new Vector3(...axis)) > 0.9999)!
const valid = (project: Project) => expect(validateProject(project).filter(issue => issue.severity === 'error' || issue.id.endsWith('-alignment'))).toEqual([])
const piecePosition = (project: Project, index = 0) => {
  const connection = project.connections[0]
  const rail = getConnectorRail(connection, resolvePanels(project), project.connections)!
  return new Vector3(...rail.placements[index].position).addScaledVector(new Vector3(...rail.tangent),
    connectorSlide(rail, index, project.connectorOverrides?.[connectorId(connection.id, index)]?.slide))
}

describe('preview structural resize handles', () => {
  it('offers four edge handles on a loose panel, keeps its opposite edge fixed, and preserves rotation and thickness', () => {
    const panel = createPanel({ width: 400, height: 300, position: [120, 500, 10], rotation: [0.2, 0.3, 0.4] })
    const project: Project = { version: 1, name: 'Panel', panels: [panel], connections: [] }
    const session = preparePreviewResize(project, { panelId: panel.id })!
    expect(session.handles).toHaveLength(4)
    const handle = session.handles.find(handle => handle.id === 'panel-width-positive')!
    const result = movePreviewResize(session, handle.id, 100)
    expect(result.limited).toBe(false)
    const resized = result.project.panels[0]
    expect(resized.width).toBe(500)
    expect(resized.height).toBe(panel.height)
    expect(resized.thickness).toBe(panel.thickness)
    expect(resized.rotation).toEqual(panel.rotation)
    const axis = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...panel.rotation)))
    near(new Vector3(...resized.position).addScaledVector(axis, -resized.width / 2).toArray(),
      new Vector3(...panel.position).addScaledVector(axis, -panel.width / 2).toArray())
    near(new Vector3(...resized.position).addScaledVector(axis, resized.width / 2).toArray(),
      new Vector3(...handle.position).addScaledVector(axis, 100).toArray())
    expect(project.panels[0]).toEqual(panel)
  })

  it('pulls a shelf to grow its supports while preserving the opposite boundary and all angles', () => {
    const project = createStarterProject()
    const panel = named(project, 'Top shelf')
    const session = preparePreviewResize(project, { panelId: panel.id })!
    const handle = along(session, [0, 1, 0])
    expect(handle).toBeDefined()
    const result = movePreviewResize(session, handle.id, 100)
    expect(result.limited).toBe(false)
    near(named(result.project, 'Top shelf').position, panel.position.map((value, index) => value + (index === 1 ? 100 : 0)))
    near(named(result.project, 'Bottom shelf').position, named(project, 'Bottom shelf').position)
    for (const old of resolvePanels(project)) near(named(result.project, old.name).rotation, old.rotation)
    valid(result.project)
  })

  it('extends the depth of all flush panels from one edge without moving the opposite edge', () => {
    const project = createStarterProject()
    const panel = named(project, 'Middle shelf')
    const session = preparePreviewResize(project, { panelId: panel.id })!
    const handle = session.handles.find(handle => handle.id === 'panel-height-positive')!
    const result = movePreviewResize(session, handle.id, 80)
    const direction = new Vector3(...handle.direction)
    for (const old of resolvePanels(project)) {
      const next = named(result.project, old.name)
      expect(next.height).toBeCloseTo(old.height + 80, 5)
      expect(new Vector3(...next.position).dot(direction) - next.height / 2)
        .toBeCloseTo(new Vector3(...old.position).dot(direction) - old.height / 2, 5)
    }
    valid(result.project)
  })

  it('pulls a physical connector in every offered direction by the requested distance without sliding its override', () => {
    const project = createStarterProject()
    const id = connectorId(project.connections[0].id, 0)
    const session = preparePreviewResize(project, { connectorId: id })!
    expect(session.handles.length).toBeGreaterThanOrEqual(4)
    const before = piecePosition(project)
    for (const handle of session.handles) for (const distance of [-30, 30]) {
      const result = movePreviewResize(session, handle.id, distance)
      expect(result.limited, handle.id).toBe(false)
      near(piecePosition(result.project).toArray(), before.clone().addScaledVector(new Vector3(...handle.direction), distance).toArray(), 4)
      expect(result.project.connectorOverrides).toEqual(project.connectorOverrides)
      expect(result.project.connections.map(connection => connection.type)).toEqual(project.connections.map(connection => connection.type))
      expect(result.project.panels.some((panel, index) => panel.width !== project.panels[index].width || panel.height !== project.panels[index].height)).toBe(true)
      for (const old of resolvePanels(project)) near(named(result.project, old.name).rotation, old.rotation)
      valid(result.project)
    }
  })

  it('keeps shared T/cross joints aligned when pulling a connector in a large grid', () => {
    const project = gridProject('Grid', Array(8).fill(350), Array(10).fill(300))
    const id = connectorId(project.connections[0].id, 0)
    const session = preparePreviewResize(project, { connectorId: id })!
    expect(session.handles.length).toBeGreaterThanOrEqual(4)
    const handle = along(session, [0, 1, 0])
    const result = movePreviewResize(session, handle.id, 30)
    expect(result.limited).toBe(false)
    expect(result.project.panels).toHaveLength(178)
    valid(result.project)
  })

  it.each(['105', '150'] as const)('preserves %s degree joints for rotated edge pulls', type => {
    const parent = createPanel({ width: 600, height: 400, position: [0, 500, 0] })
    let project = attachPanel({ version: 1, name: 'Angled', panels: [parent], connections: [] }, parent.id,
      createPanel({ width: 500, height: 400 }), { type, side: 'right', count: 2, color: '#eeeeee', flip: false, offset: 0, inset: 0 })
    project = rotateProject(project, 'y', 27)
    const session = preparePreviewResize(project, { panelId: parent.id })!
    const handle = session.handles.find(handle => handle.id === 'panel-height-positive')!
    const result = movePreviewResize(session, handle.id, 60)
    expect(result.limited).toBe(false)
    for (const old of resolvePanels(project)) near(resolvePanels(result.project).find(panel => panel.id === old.id)!.rotation, old.rotation)
    valid(result.project)
  })

  it('clamps a push to physical limits and every preview starts from the original snapshot', () => {
    const panel = createPanel({ width: 100, height: 400 })
    const project: Project = { version: 1, name: 'Limits', panels: [panel], connections: [] }
    const session = preparePreviewResize(project, { panelId: panel.id })!
    const handle = session.handles.find(handle => handle.id === 'panel-width-positive')!
    const result = movePreviewResize(session, handle.id, -200)
    expect(result.limited).toBe(true)
    expect(result.project.panels[0].width).toBeCloseTo(40, 3)
    expect(result.distance).toBeCloseTo(-60, 3)
    expect(movePreviewResize(session, handle.id, 50).project.panels[0].width).toBe(150)
    expect(movePreviewResize(session, handle.id, 0).project).toBe(project)
    expect(project.panels[0].width).toBe(100)
    expect(() => movePreviewResize(session, handle.id, NaN)).toThrow(/finite/)
  })

  it('omits handles for missing, hidden, removed and assembly-managed selections', () => {
    const project = createStarterProject()
    const panel = project.panels[0]
    expect(preparePreviewResize(project, {})).toBeNull()
    expect(preparePreviewResize(project, { panelId: 'missing' })).toBeNull()
    expect(preparePreviewResize(project, { panelId: panel.id, connectorId: 'missing' })).toBeNull()
    expect(preparePreviewResize({ ...project, panels: project.panels.map(item => ({ ...item, visible: false })) }, { panelId: panel.id })).toBeNull()
    const id = connectorId(project.connections[0].id, 0)
    expect(preparePreviewResize({ ...project, connectorOverrides: { [id]: { removed: true } } }, { connectorId: id })).toBeNull()
    const assembly = createAssembly(project, project.panels.map(panel => panel.id), 'Shelf')
    expect(preparePreviewResize(assembly, { panelId: panel.id })).toBeNull()
    expect(preparePreviewResize(assembly, { connectorId: id })).toBeNull()
  })
})
