import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly } from './assemblies'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { attachPanel, createPanel, createStarterProject, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { movePreviewResize, preparePreviewResize, type PreviewResizeSession } from './preview-resize'
import { gridProject } from './example-geometry'
import { moveStructureRepeat, prepareStructureRepeat } from './structure-repeat'
import type { Project, Vec3 } from './types'
import connectedCorner from './fixtures/everyday-shelf-connected-corner.json'
import cornerShelf from './fixtures/everyday-shelf-corner.json'
import everydayShelf from './fixtures/everyday-shelf.json'

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
  it('retains a blocked edge and identifies its fixed panel without unrelated furniture', () => {
    const panel = createPanel({ width: 400, height: 300, position: [0, 500, 0] })
    const unrelated = createPanel({ position: [3000, 500, 0] })
    const project: Project = { version: 1, name: 'Fixed width', panels: [panel, unrelated], connections: [],
      constraints: [{ id: 'fixed', kind: 'dimension', enabled: true, panelId: panel.id, dimension: 'width', value: 400 }] }
    const session = preparePreviewResize(project, { panelId: panel.id })!
    for (const id of ['panel-width-positive', 'panel-width-negative']) {
      const handle = session.handles.find(handle => handle.id === id)!
      expect(handle.blocked?.panelIds).toEqual([panel.id])
      expect(handle.blocked?.connectorIds).toEqual([])
      expect(movePreviewResize(session, id, 10).project).toBe(project)
      expect(movePreviewResize(session, id, -10).project).toBe(project)
    }
    expect(session.handles.find(handle => handle.id === 'panel-height-positive')?.blocked).toBeUndefined()
  })

  it('extends the corner shelf independently with every installed connector fixed', () => {
    const project = parseProject(cornerShelf)
    // Keep connected growth genuinely blocked now that imported-loop roundoff
    // no longer blocks this fixture by itself.
    const neighbor = named(project, 'Left side copy')
    project.constraints = [{ id: 'fixed-neighbor', kind: 'dimension', enabled: true, panelId: neighbor.id, dimension: 'height', value: neighbor.height }]
    const panel = named(project, 'Right side copy')
    const session = preparePreviewResize(project, { panelId: panel.id })!
    const handle = along(session, [-1, 0, 0])
    expect(handle.repeatOnly).toBe(true)
    expect(handle.blocked?.panelIds).toContain(neighbor.id)
    expect(handle.blocked?.connectorIds.length).toBeGreaterThan(0)
    expect(movePreviewResize(session, handle.id, 100).project).toBe(project)
    const result = movePreviewResize(session, handle.id, 100, true)
    expect(result.limited).toBe(false)
    expect(named(result.project, panel.name).height).toBeCloseTo(panel.height + 100)
    for (const original of resolvePanels(project).filter(item => item.id !== panel.id)) {
      const next = named(result.project, original.name)
      near(next.position, original.position)
      expect(next.width).toBeCloseTo(original.width, 5)
      expect(next.height).toBeCloseTo(original.height, 5)
    }
    const positions = (value: Project) => getPhysicalConnectors(value).map(piece => {
      const rail = getConnectorRail(piece.connection, resolvePanels(value), value.connections)!
      return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
        connectorSlide(rail, piece.index, value.connectorOverrides?.[piece.id]?.slide)).toArray()
    })
    positions(result.project).forEach((position, index) => near(position, positions(project)[index]))
    valid(result.project)
  })

  it('keeps repeat arrows available when a saved dimension fixes the source panel', () => {
    const original = gridProject('Fixed cube', [350], [350])
    const panel = named(original, 'Shelf 1.2')
    const project: Project = { ...original, constraints: [{ id: 'fixed-width', enabled: true, kind: 'dimension', panelId: panel.id, dimension: 'width', value: panel.width }] }
    const handle = along(preparePreviewResize(project, { panelId: panel.id })!, [1, 0, 0])
    expect(handle.repeatOnly).toBe(true)
    const repeat = prepareStructureRepeat(project, panel.id, handle.direction)
    const result = moveStructureRepeat(repeat, repeat.pitch)
    expect(result.count).toBe(1)
    expect(result.project.panels.find(item => item.id === panel.id)!.width).toBe(panel.width)
    expect(result.project.constraints).toHaveLength(2)
    valid(result.project)
  })

  it.each([
    { direction: [0, 1, 0] as Vec3, added: 3, edge: false },
    { direction: [0, 0, 1] as Vec3, added: 5, edge: true },
    { direction: [0, 0, -1] as Vec3, added: 5, edge: true },
  ])('offers a repeat handle along $direction even when every cut is fixed', ({ direction, added, edge }) => {
    const original = gridProject('Fixed cube', [350], [350])
    const panel = named(original, 'Shelf 1.2')
    const project: Project = { ...original, constraints: original.panels.flatMap(item => (['width', 'height'] as const).map(dimension => ({
      id: `${item.id}-${dimension}`, enabled: true, kind: 'dimension' as const, panelId: item.id, dimension, value: item[dimension],
    }))) }
    const handle = along(preparePreviewResize(project, { panelId: panel.id })!, direction)
    expect(handle).toMatchObject({ repeatOnly: true, panelHandle: true, panelEdge: edge })
    const repeat = prepareStructureRepeat(project, panel.id, handle.direction)
    const result = moveStructureRepeat(repeat, repeat.pitch)
    expect(result.count).toBe(1)
    expect(result.project.panels).toHaveLength(project.panels.length + added)
    for (const originalPanel of resolvePanels(project)) {
      expect(resolvePanels(result.project).find(item => item.id === originalPanel.id)).toEqual(originalPanel)
    }
    valid(result.project)
  })

  it.each([false, true])('resizes only one panel with fixed hardware (rotated: %s)', rotated => {
    const source = createStarterProject()
    const project = rotated ? rotateProject(source, 'y', 27) : source
    const selected = named(project, 'Middle shelf')
    const session = preparePreviewResize(project, { panelId: selected.id })!
    const positions = (value: Project) => getPhysicalConnectors(value).map(piece => {
      const rail = getConnectorRail(piece.connection, resolvePanels(value), value.connections)!
      return new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
        connectorSlide(rail, piece.index, value.connectorOverrides?.[piece.id]?.slide)).toArray()
    })
    const result = movePreviewResize(session, 'panel-height-positive', 80, true)
    expect(result.limited).toBe(false)
    expect(named(result.project, selected.name).height).toBeCloseTo(selected.height + 80)
    for (const old of resolvePanels(project).filter(panel => panel.id !== selected.id)) {
      const next = named(result.project, old.name)
      near(next.position, old.position)
      expect(next.width).toBeCloseTo(old.width)
      expect(next.height).toBeCloseTo(old.height)
    }
    positions(result.project).forEach((value, index) => near(value, positions(project)[index]))
    valid(result.project)
    const shrink = movePreviewResize(preparePreviewResize(result.project, { panelId: selected.id })!, 'panel-height-positive', -40, true)
    expect(shrink.limited).toBe(false)
    expect(named(shrink.project, selected.name).height).toBeCloseTo(selected.height + 40)
    positions(shrink.project).forEach((value, index) => near(value, positions(project)[index]))
    const blocked = movePreviewResize(session, 'panel-height-positive', -100, true)
    expect(blocked.limited).toBe(true)
    positions(blocked.project).forEach((value, index) => near(value, positions(project)[index]))
    const normal = session.handles.find(handle => handle.id.startsWith('panel-normal'))!
    expect(movePreviewResize(session, normal.id, 80, true).distance).toBe(0)
  })

  it.each([
    { distance: 200, rotated: false }, { distance: -80, rotated: false },
    { distance: 200, rotated: true }, { distance: -80, rotated: true },
  ])('preserves everyday shelf setbacks for a $distance mm edge pull (rotated: $rotated)', ({ distance, rotated }) => {
    const loaded = parseProject(everydayShelf)
    const project = rotated ? rotateProject(rotateProject(loaded, 'y', 27), 'z', 15) : loaded
    const before = resolvePanels(project)
    const selected = named(project, 'Right upper side')
    const session = preparePreviewResize(project, { panelId: selected.id })!
    const handle = session.handles.find(handle => handle.id === 'panel-height-negative')!
    const result = movePreviewResize(session, handle.id, distance)
    expect(result.limited).toBe(false)
    const direction = new Vector3(...handle.direction)
    for (const old of before.filter(panel => panel.height > 300)) {
      const next = result.project.panels.find(panel => panel.id === old.id)!
      expect(next.height, old.name).toBeCloseTo(old.height + distance, 4)
      near(new Vector3(...next.position).sub(new Vector3(...old.position)).toArray(), direction.clone().multiplyScalar(distance / 2).toArray(), 4)
    }
    for (const old of before) {
      const next = result.project.panels.find(panel => panel.id === old.id)!
      expect(next.width, old.name).toBeCloseTo(old.width, 4)
      expect(next.thickness).toBe(old.thickness)
      near(next.rotation, old.rotation)
      expect(next.customOutline).toEqual(old.customOutline)
    }
    expect(result.project.connections.map(connection => connection.offset)).toEqual(project.connections.map(connection => connection.offset))
    for (const piece of getPhysicalConnectors(project)) {
      const oldRail = getConnectorRail(piece.connection, before, project.connections)!
      const connection = result.project.connections.find(item => item.id === piece.connection.id)!
      const newRail = getConnectorRail(connection, result.project.panels, result.project.connections)!
      const fraction = (rail: typeof oldRail, source: Project) => (rail.along[piece.index]
        + connectorSlide(rail, piece.index, source.connectorOverrides?.[piece.id]?.slide) - rail.lower) / (rail.upper - rail.lower)
      expect(fraction(newRail, result.project)).toBeCloseTo(fraction(oldRail, project), 7)
      const { slide: _oldSlide, ...oldAppearance } = project.connectorOverrides?.[piece.id] ?? {}
      const { slide: _newSlide, ...newAppearance } = result.project.connectorOverrides?.[piece.id] ?? {}
      expect(newAppearance).toEqual(oldAppearance)
    }
  })
  it('offers four edge handles on a loose panel, keeps its opposite edge fixed, and preserves rotation and thickness', () => {
    const panel = createPanel({ width: 400, height: 300, position: [120, 500, 10], rotation: [0.2, 0.3, 0.4] })
    const project: Project = { version: 1, name: 'Panel', panels: [panel], connections: [] }
    const session = preparePreviewResize(project, { panelId: panel.id })!
    expect(session.handles.filter(handle => !handle.blocked)).toHaveLength(4)
    expect(session.handles.filter(handle => handle.blocked)).toHaveLength(2)
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
    for (const handle of session.handles.filter(handle => !handle.blocked)) for (const distance of [-30, 30]) {
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

  it('omits handles for missing, hidden and removed selections, and grays assembly-managed directions', () => {
    const project = createStarterProject()
    const panel = project.panels[0]
    expect(preparePreviewResize(project, {})).toBeNull()
    expect(preparePreviewResize(project, { panelId: 'missing' })).toBeNull()
    expect(preparePreviewResize(project, { panelId: panel.id, connectorId: 'missing' })).toBeNull()
    expect(preparePreviewResize({ ...project, panels: project.panels.map(item => ({ ...item, visible: false })) }, { panelId: panel.id })).toBeNull()
    const id = connectorId(project.connections[0].id, 0)
    expect(preparePreviewResize({ ...project, connectorOverrides: { [id]: { removed: true } } }, { connectorId: id })).toBeNull()
    const assembly = createAssembly(project, project.panels.map(panel => panel.id), 'Shelf')
    expect(preparePreviewResize(assembly, { panelId: panel.id })!.handles.every(handle => !!handle.blocked)).toBe(true)
    expect(preparePreviewResize(assembly, { connectorId: id })!.handles.every(handle => !!handle.blocked)).toBe(true)
  })
})


describe('connected corner shelf resize precision', () => {
  it.each([0, 31])('resizes either wing without losing closed joints after rotation by %s degrees', angle => {
    const source = parseProject(connectedCorner)
    const project = angle ? rotateProject(source, 'y', angle) : source
    const before = structuredClone(project)
    for (const name of ['Bottom shelf copy', 'Top shelf']) for (const distance of [1, 100, 1000]) {
      const panel = named(project, name)
      const session = preparePreviewResize(project, { panelId: panel.id })!
      const handle = session.handles.find(handle => handle.id === 'panel-height-negative')!
      expect(handle).toBeDefined()
      expect(handle.repeatOnly).not.toBe(true)
      const result = movePreviewResize(session, handle.id, distance)
      expect(result.limited).toBe(false)
      const next = named(result.project, name)
      expect(next.height).toBeCloseTo(panel.height + distance, 5)
      near(new Vector3(...next.position).addScaledVector(new Vector3(...handle.direction), -next.height / 2).toArray(),
        new Vector3(...panel.position).addScaledVector(new Vector3(...handle.direction), -panel.height / 2).toArray(), 5)
      for (const original of resolvePanels(project)) {
        const current = named(result.project, original.name)
        near(current.rotation, original.rotation, 5)
        expect(current.thickness).toBe(original.thickness)
      }
      expect(result.project.connections.map(c => c.id)).toEqual(project.connections.map(c => c.id))
      valid(result.project)
    }
    expect(project).toEqual(before)
  })
})
