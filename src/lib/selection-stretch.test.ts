import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { roundTripProject } from '../test/project-round-trip'
import { createAssembly } from './assemblies'
import { closePanelHole, findPanelHoles } from './close-holes'
import { overlappingConnectorIds } from './connector-clearance'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { equalOpeningSelection } from './equal-opening-selection'
import { gridProject } from './example-geometry'
import { createPanel, getProjectBounds, moveProject, resolvePanels, rotateProject, validateProject } from './model'
import { moveSelectionStretch, prepareSelectionStretch } from './selection-stretch'
import { movePanels } from './structure-edit'
import { synthStorageShelfProject } from './synth-storage-shelf'
import type { Panel, Project, Vec3 } from './types'

const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!
const near = (actual: readonly number[], expected: readonly number[]) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 5))
const idsNamed = (project: Project, names: string[]) => names.map(name => named(project, name).id)
const upperCellIds = (project: Project) => idsNamed(project, ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'])
const synthIds = (project: Project) => project.panels.filter(panel => !panel.name.startsWith('Storage ')
  && !['Upright 1.1', 'Upright 2.1'].includes(panel.name)).map(panel => panel.id)
const along = (project: Project, ids: string[], direction: Vec3) => {
  const plan = prepareSelectionStretch(project, ids).find(item => new Vector3(...item.direction).dot(new Vector3(...direction)) > .99999)
  expect(plan, `Missing stretch direction ${direction}`).toBeDefined()
  return plan!
}
const sameGeometry = (actual: Panel, expected: Panel) => {
  near(actual.position, expected.position)
  near(actual.rotation, expected.rotation)
  expect(actual.width).toBeCloseTo(expected.width, 5)
  expect(actual.height).toBeCloseTo(expected.height, 5)
  expect(actual.thickness).toBe(expected.thickness)
}
const rigidSelection = (before: Project, after: Project, ids: string[], delta: Vec3) => {
  const moved = new Map(resolvePanels(after).map(panel => [panel.id, panel]))
  for (const panel of resolvePanels(before).filter(item => ids.includes(item.id))) {
    sameGeometry(moved.get(panel.id)!, { ...panel, position: panel.position.map((value, axis) => value + delta[axis]) as Vec3 })
  }
}

describe('selection boundary stretch', () => {
  it.each([-100, 100])('moves the selected synth stand by %s mm while only recutting its two lower uprights', distance => {
    const project = synthStorageShelfProject()
    const snapshot = JSON.stringify(project)
    const ids = synthIds(project)
    const plan = along(project, ids, [0, 1, 0])
    expect(plan.blocked).toBeUndefined()
    expect(new Set(plan.panelIds)).toEqual(new Set(idsNamed(project, ['Upright 1.1', 'Upright 2.1'])))
    const next = moveSelectionStretch(project, ids, plan, distance)
    rigidSelection(project, next, ids, [0, distance, 0])
    for (const panel of resolvePanels(project)) {
      const actual = named(next, panel.name)
      if (panel.name.startsWith('Storage ')) sameGeometry(actual, panel)
      if (plan.panelIds.includes(panel.id)) {
        expect(actual.width).toBeCloseTo(panel.width + distance, 5)
        expect(actual.height).toBeCloseTo(panel.height, 5)
        near(actual.position, [panel.position[0], panel.position[1] + distance / 2, panel.position[2]])
      }
    }
    expect(next.constraints).toEqual(project.constraints)
    expect(next.connections.map(({ id, parentId, childId, type, role }) => ({ id, parentId, childId, type, role })))
      .toEqual(project.connections.map(({ id, parentId, childId, type, role }) => ({ id, parentId, childId, type, role })))
    expect(next.connectorOverrides).toEqual(project.connectorOverrides)
    expect(getPhysicalConnectors(next).map(piece => piece.id)).toEqual(getPhysicalConnectors(project).map(piece => piece.id))
    expect(validateProject(next)).toEqual([])
    expect(overlappingConnectorIds(next).size).toBe(0)
    expect(roundTripProject(next)).toEqual(next)
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it.each([
    { axis: 'y', columns: [350], rows: [300, 300], names: ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'], direction: [0, 1, 0] as Vec3 },
    { axis: 'x', columns: [350, 350], rows: [300], names: ['Shelf 2.1', 'Shelf 2.2', 'Upright 2.1', 'Upright 3.1'], direction: [1, 0, 0] as Vec3 },
  ])('detects $axis stretching from ordinary connected geometry', ({ columns, rows, names, direction }) => {
    const project = gridProject('Two cells', columns, rows)
    const ids = idsNamed(project, names)
    const plan = along(project, ids, direction)
    expect(plan.blocked).toBeUndefined()
    expect(plan.panelIds).toHaveLength(2)
    const next = moveSelectionStretch(project, ids, plan, 80)
    rigidSelection(project, next, ids, direction.map(value => value * 80) as Vec3)
    for (const panel of resolvePanels(project).filter(item => !ids.includes(item.id) && !plan.panelIds.includes(item.id))) {
      sameGeometry(named(next, panel.name), panel)
    }
    expect(validateProject(next)).toEqual([])
  })

  it.each([true, false])('follows rotated construction axes (world Z: %s)', worldZ => {
    const source = gridProject('Rotated cells', [350], [300, 300])
    const project = worldZ ? rotateProject(source, 'x', 90) : rotateProject(rotateProject(source, 'z', 23), 'y', 31)
    const ids = upperCellIds(project)
    const upper = named(project, 'Shelf 1.3'), middle = named(project, 'Shelf 1.2')
    const direction = new Vector3(...upper.position).sub(new Vector3(...middle.position)).normalize().toArray() as Vec3
    const plan = along(project, ids, direction)
    const next = moveSelectionStretch(project, ids, plan, 75)
    rigidSelection(project, next, ids, direction.map(value => value * 75) as Vec3)
    sameGeometry(named(next, 'Shelf 1.1'), named(project, 'Shelf 1.1'))
    for (const name of ['Upright 1.1', 'Upright 2.1']) expect(named(next, name).width).toBeCloseTo(named(project, name).width + 75, 5)
    expect(validateProject(next)).toEqual([])
  })

  it('includes zero-count support branches in a shared cross-joint boundary', () => {
    const project = gridProject('Four cells', [350, 350], [300, 300])
    const ids = project.panels.filter(panel => panel.name.startsWith('Shelf ') ? !panel.name.endsWith('.1') : panel.name.endsWith('.2')).map(panel => panel.id)
    expect(project.connections.some(connection => connection.type === 'cross' && connection.count === 0)).toBe(true)
    expect(project.connections.some(connection => connection.role === 'support')).toBe(true)
    const plan = along(project, ids, [0, 1, 0])
    expect(new Set(plan.panelIds)).toEqual(new Set(idsNamed(project, ['Upright 1.1', 'Upright 2.1', 'Upright 3.1'])))
    const next = moveSelectionStretch(project, ids, plan, 60)
    rigidSelection(project, next, ids, [0, 60, 0])
    expect(validateProject(next)).toEqual([])
    for (const name of ['Shelf 1.1', 'Shelf 2.1']) sameGeometry(named(next, name), named(project, name))
  })

  it('moves separately supported selected components together without moving either base', () => {
    const first = gridProject('Left stack', [350], [300, 300])
    const second = moveProject(gridProject('Right stack', [350], [300, 300]), [1000, 0, 0])
    const ids = [...upperCellIds(first), ...upperCellIds(second)]
    const project: Project = { ...first, panels: [...first.panels, ...second.panels], connections: [...first.connections, ...second.connections] }
    const plan = along(project, ids, [0, 1, 0])
    expect(plan.panelIds).toHaveLength(4)
    const next = moveSelectionStretch(project, ids, plan, 75), byId = new Map(resolvePanels(next).map(panel => [panel.id, panel]))
    rigidSelection(project, next, ids, [0, 75, 0])
    for (const stack of [first, second]) {
      const base = named(stack, 'Shelf 1.1')
      sameGeometry(byId.get(base.id)!, base)
    }
    expect(validateProject(next)).toEqual([])
  })

  it('stretches supporting panels discovered from surface contact without boundary connectors', () => {
    const base = createPanel({ name: 'Base', width: 400, height: 300, position: [0, 9, 0], rotation: [-Math.PI / 2, 0, 0] })
    const left = createPanel({ name: 'Left support', width: 300, height: 300, position: [-191, 168, 0], rotation: [0, Math.PI / 2, 0] })
    const right = createPanel({ name: 'Right support', width: 300, height: 300, position: [191, 168, 0], rotation: [0, Math.PI / 2, 0] })
    const top = createPanel({ name: 'Top', width: 400, height: 300, position: [0, 327, 0], rotation: [-Math.PI / 2, 0, 0] })
    const lip = createPanel({ name: 'Lip', width: 400, height: 50, position: [0, 361, 141] })
    const project: Project = { version: 1, name: 'Contact supports', panels: [base, left, right, top, lip], connections: [] }
    const ids = [top.id, lip.id], plan = along(project, ids, [0, 1, 0])
    expect(new Set(plan.panelIds)).toEqual(new Set([left.id, right.id]))
    const next = moveSelectionStretch(project, ids, plan, 50)
    rigidSelection(project, next, ids, [0, 50, 0])
    sameGeometry(named(next, base.name), base)
    for (const support of [left, right]) {
      const actual = named(next, support.name)
      expect(actual.height).toBeCloseTo(350, 5)
      expect(actual.position[1] - actual.height / 2).toBeCloseTo(18, 5)
      expect(actual.position[1] + actual.height / 2).toBeCloseTo(named(next, top.name).position[1] - 9, 5)
    }
    expect(next.connections).toEqual([])
    expect(validateProject(next)).toEqual([])
  })

  it('preserves custom hardware fractions when a closing wall lengthens its vertical rails', () => {
    const source = gridProject('Backed cells', [350], [300, 300])
    const lowerIds = idsNamed(source, ['Shelf 1.1', 'Shelf 1.2', 'Upright 1.1', 'Upright 2.1'])
    const opening = findPanelHoles(resolvePanels(source).filter(panel => lowerIds.includes(panel.id)), resolvePanels(source))[0]
    const closed = closePanelHole(source, lowerIds, opening.id)
    const panels = resolvePanels(closed.project)
    const piece = getPhysicalConnectors(closed.project).find(item => {
      if (![item.connection.parentId, item.connection.childId].includes(closed.panelId)) return false
      return Math.abs(getConnectorRail(item.connection, panels, closed.project.connections)!.tangent[1]) > .99999
    })!
    expect(piece).toBeDefined()
    const rail = getConnectorRail(piece.connection, panels, closed.project.connections)!
    const slide = rail.lower + (rail.upper - rail.lower) * .25 - rail.along[piece.index]
    const project: Project = { ...closed.project, connectorOverrides: { ...closed.project.connectorOverrides, [piece.id]: { slide, color: '#292b27' } } }
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    const next = moveSelectionStretch(project, ids, plan, 100)
    const connection = next.connections.find(item => item.id === piece.connection.id)!
    const after = getConnectorRail(connection, resolvePanels(next), next.connections)!
    expect(after.upper - after.lower).toBeCloseTo(rail.upper - rail.lower + 100, 5)
    const fraction = (after.along[piece.index] + connectorSlide(after, piece.index, next.connectorOverrides?.[piece.id]?.slide) - after.lower) / (after.upper - after.lower)
    expect(fraction).toBeCloseTo(.25, 6)
    expect(next.connectorOverrides?.[piece.id]?.color).toBe('#292b27')
    expect(next.connectorOverrides?.[piece.id]?.slide).not.toBeCloseTo(slide, 5)
    rigidSelection(project, next, ids, [0, 100, 0])
    sameGeometry(named(next, 'Shelf 1.1'), named(project, 'Shelf 1.1'))
    expect(validateProject(next)).toEqual([])
    expect(overlappingConnectorIds(next).size).toBe(0)
  })

  it.each(['fixed cut', 'fixed position', 'equal openings'] as const)('retains a blocking %s rule instead of deforming the rest', kind => {
    const source = gridProject('Constrained cells', [350], [300, 300])
    const span = named(source, 'Upright 1.1'), selected = named(source, 'Shelf 1.2')
    const project: Project = { ...source, constraints: [kind === 'fixed cut'
      ? { id: 'fixed-cut', enabled: true, kind: 'dimension', panelId: span.id, dimension: 'width', value: span.width }
      : kind === 'fixed position'
        ? { id: 'fixed-position', enabled: true, kind: 'position', panelId: selected.id, axis: 'y', reference: 'center', value: selected.position[1] }
        : equalOpeningSelection(resolvePanels(source), idsNamed(source, ['Shelf 1.1', 'Shelf 1.2', 'Shelf 1.3']), 'equal')!] }
    const snapshot = JSON.stringify(project)
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    expect(plan.blocked).toBeDefined()
    expect(() => moveSelectionStretch(project, ids, plan, 50)).toThrow()
    expect(() => moveSelectionStretch(project, ids, plan, -50)).toThrow()
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it.each([-310, 3700])('rejects a %s mm synth move beyond stock limits without changing the cabinet', distance => {
    const project = synthStorageShelfProject(), ids = synthIds(project)
    const snapshot = JSON.stringify(project)
    const plan = along(project, ids, [0, 1, 0])
    expect(() => moveSelectionStretch(project, ids, plan, distance)).toThrow()
    expect(JSON.stringify(project)).toBe(snapshot)
    expect(validateProject(project)).toEqual([])
  })

  it('allows movement within a saved cut range and rejects movement beyond it', () => {
    const source = gridProject('Cut range', [350], [300, 300]), span = named(source, 'Upright 1.1')
    const project: Project = { ...source, constraints: [{ id: 'range', kind: 'dimension', enabled: true, panelId: span.id,
      dimension: 'width', relation: 'range', min: 250, max: 350 }] }
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    for (const distance of [-40, 40]) {
      const next = moveSelectionStretch(project, ids, plan, distance)
      expect(named(next, span.name).width).toBeCloseTo(span.width + distance, 5)
      expect(validateProject(next)).toEqual([])
    }
    for (const distance of [-60, 60]) expect(() => moveSelectionStretch(project, ids, plan, distance)).toThrow()
  })

  it('respects the build space ceiling', () => {
    const source = gridProject('Build space', [350], [300, 300]), bounds = getProjectBounds(resolvePanels(source))
    const project: Project = { ...source, spaceConstraint: { enabled: true, width: bounds.max[0] - bounds.min[0] + 100,
      height: bounds.max[1] + 50, depth: bounds.max[2] - bounds.min[2] + 100, centerX: 0, centerZ: 0 } }
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    expect(validateProject(moveSelectionStretch(project, ids, plan, 40))).toEqual([])
    expect(() => moveSelectionStretch(project, ids, plan, 60)).toThrow(/space|limit/i)
  })

  it.each([true, false])('stops before an unselected obstacle even when its visibility is %s', visible => {
    const source = gridProject('Obstacle', [350], [300, 300])
    const top = named(source, 'Shelf 1.3')
    const obstacle = createPanel({ name: 'Obstacle', width: top.width, height: top.height, rotation: top.rotation,
      position: [top.position[0], top.position[1] + 100, top.position[2]], visible })
    const project: Project = { ...source, panels: [...source.panels, obstacle] }
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    expect(plan.blocked).toBeUndefined()
    const clear = moveSelectionStretch(project, ids, plan, 50)
    sameGeometry(named(clear, 'Obstacle'), obstacle)
    expect(() => moveSelectionStretch(project, ids, plan, 100)).toThrow(/overlap|collision|obstacle|clearance/i)
    expect(() => moveSelectionStretch(project, ids, plan, 200)).toThrow(/overlap|collision|obstacle|clearance/i)
  })

  it('rejects hardware collisions even when every panel still fits', () => {
    const project = gridProject('Hardware clearance', [350], [300, 300])
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    const unchecked = movePanels(project, ids, [0, -240, 0])
    expect(validateProject(unchecked)).toEqual([])
    expect(overlappingConnectorIds(unchecked).size).toBeGreaterThan(0)
    expect(() => moveSelectionStretch(project, ids, plan, -240)).toThrow(/hardware|connector|clearance/i)
    expect(overlappingConnectorIds(moveSelectionStretch(project, ids, plan, -180)).size).toBe(0)
  })

  it('allows an existing overlap to improve but rejects making it worse', () => {
    const source = gridProject('Existing overlap', [350], [300, 300]), top = named(source, 'Shelf 1.3')
    const obstacle = createPanel({ name: 'Existing obstacle', width: top.width, height: top.height, rotation: top.rotation,
      position: [top.position[0], top.position[1] + 10, top.position[2]] })
    const project: Project = { ...source, panels: [...source.panels, obstacle] }, snapshot = JSON.stringify(project)
    expect(validateProject(project).some(issue => issue.id.includes('collision'))).toBe(true)
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    const improved = moveSelectionStretch(project, ids, plan, -40)
    sameGeometry(named(improved, obstacle.name), obstacle)
    expect(validateProject(improved)).toEqual([])
    expect(() => moveSelectionStretch(project, ids, plan, 5)).toThrow(/overlap|collision|obstacle|clearance/i)
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('preserves unrelated existing overlaps without blocking a valid stretch', () => {
    const source = gridProject('Unrelated overlap', [350], [300, 300])
    const first = createPanel({ name: 'First loose panel', position: [4000, 1000, 0] })
    const second = createPanel({ name: 'Second loose panel', position: [...first.position] })
    const project: Project = { ...source, panels: [...source.panels, first, second] }
    const ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    const next = moveSelectionStretch(project, ids, plan, 60)
    sameGeometry(named(next, first.name), first)
    sameGeometry(named(next, second.name), second)
    expect(validateProject(next)).toEqual(validateProject(project))
  })

  it('does not offer a valid stretch through a custom-outline boundary panel', () => {
    const source = gridProject('Shaped boundary', [350], [300, 300]), span = named(source, 'Upright 1.1')
    const project: Project = { ...source, panels: source.panels.map(panel => panel.id === span.id
      ? { ...panel, customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .2, y: 1 }] }
      : panel) }
    const ids = upperCellIds(project), snapshot = JSON.stringify(project)
    for (const plan of prepareSelectionStretch(project, ids)) {
      expect(plan.blocked).toBeDefined()
      expect(() => moveSelectionStretch(project, ids, plan, 30)).toThrow()
    }
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('does not offer stretch handles for missing, whole-construction, or disconnected selections', () => {
    const project = gridProject('Selection scope', [350], [300, 300])
    expect(prepareSelectionStretch(project, [])).toEqual([])
    expect(prepareSelectionStretch(project, [project.panels[0].id])).toEqual([])
    expect(prepareSelectionStretch(project, [project.panels[0].id, 'missing'])).toEqual([])
    expect(prepareSelectionStretch(project, project.panels.map(panel => panel.id))).toEqual([])
    const loose = createPanel({ position: [4000, 1000, 0] })
    const disconnected: Project = { ...project, panels: [...project.panels, loose] }
    expect(prepareSelectionStretch(disconnected, [...upperCellIds(project), loose.id])).toEqual([])
  })

  it('keeps linked assembly members protected', () => {
    const source = gridProject('Managed cells', [350], [300, 300])
    const project = createAssembly(source, source.panels.map(panel => panel.id), 'Managed cells')
    const snapshot = JSON.stringify(project), ids = upperCellIds(project)
    const plans = prepareSelectionStretch(project, ids)
    for (const plan of plans) {
      expect(plan.blocked).toBeDefined()
      expect(() => moveSelectionStretch(project, ids, plan, 50)).toThrow()
    }
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('does not remove a surface support beneath an unselected managed assembly', () => {
    const ordinary = gridProject('Ordinary stack', [350], [300, 300])
    const top = named(ordinary, 'Shelf 1.3'), height = getProjectBounds([top]).max[1]
    const box = moveProject(gridProject('Managed box', [100], [100], { depth: 100 }), [0, height, 0])
    const combined: Project = { ...ordinary, panels: [...ordinary.panels, ...box.panels], connections: [...ordinary.connections, ...box.connections] }
    const project = createAssembly(combined, box.panels.map(panel => panel.id), 'Managed box')
    const snapshot = JSON.stringify(project), ids = upperCellIds(project), plan = along(project, ids, [0, 1, 0])
    expect(plan.blocked).toBeDefined()
    expect(() => moveSelectionStretch(project, ids, plan, -50)).toThrow(/surface support/)
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it('requires a current source and finite distance without mutating a prepared snapshot', () => {
    const project = gridProject('Snapshot', [350], [300, 300]), ids = upperCellIds(project)
    const snapshot = JSON.stringify(project), plan = along(project, ids, [0, 1, 0])
    expect(moveSelectionStretch(project, ids, plan, 0)).toBe(project)
    expect(() => moveSelectionStretch(project, ids, plan, NaN)).toThrow(/finite/i)
    expect(() => moveSelectionStretch(project, ids, plan, Infinity)).toThrow(/finite/i)
    const next = moveSelectionStretch(project, ids, plan, 50)
    expect(() => moveSelectionStretch(next, ids, plan, 50)).toThrow()
    expect(JSON.stringify(project)).toBe(snapshot)
  })
})
