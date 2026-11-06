import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/everyday-shelf-angled-opening.json'
import { closePanelHole, findClosingPanelHoles } from './close-holes'
import { connectClosingPanel } from './closure-connectors'
import { installedHardware, overlappingHardware } from './connector-hardware-test-helpers'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { gridProject } from './example-geometry'
import { parseProject, rotateProject, validateProject } from './model'
import type { Project } from './types'

const angledNames = ['Right side', 'Right upper side', 'Panel 8', 'Panel 10', 'Panel 11', 'Panel 12']
const upperNames = ['Top shelf', 'Middle shelf', 'Left upper side', 'Right upper side', 'Right upper side (section)']

function expectRetainedHardware(original: Project, candidate: Project) {
  const after = new Map(installedHardware(candidate).map(piece => [piece.id, piece]))
  for (const piece of installedHardware(original)) {
    const retained = after.get(piece.id)
    expect(retained, `Retain original piece ${piece.id}`).toBeDefined()
    expect(retained!.type).toBe(piece.type)
    expect(retained!.origin.distanceTo(piece.origin)).toBeLessThan(.0001)
    expect(Math.abs(retained!.orientation.dot(piece.orientation))).toBeCloseTo(1, 8)
  }
}

function closeFace(project: Project, label: string, names?: string[]) {
  const ids = project.panels.filter(panel => !names || names.includes(panel.name)).map(panel => panel.id)
  const hole = findClosingPanelHoles(project, ids).find(candidate => candidate.label.startsWith(label))
  expect(hole).toBeDefined()
  return closePanelHole(project, ids, hole!.id).project
}

describe('closing-panel hardware clearance', () => {
  it.each(['Front', 'Back'])('slides all new %s cap clamps clear of original rectangular corner hardware', label => {
    const source = gridProject('Box', [350], [350]), snapshot = structuredClone(source)
    expect(overlappingHardware(source)).toEqual([])
    const closed = closeFace(source, label)
    expect(overlappingHardware(closed)).toEqual([])
    expectRetainedHardware(source, closed)
    expect(getPhysicalConnectors(closed)).toHaveLength(getPhysicalConnectors(source).length + 8)
    expect(validateProject(closed)).toEqual([])
    const loaded = roundTripProject(closed)
    expect(overlappingHardware(loaded)).toEqual([])
    expect(installedHardware(loaded).map(piece => piece.origin.toArray())).toEqual(installedHardware(closed).map(piece => piece.origin.toArray()))
    expect(source).toEqual(snapshot)
  })

  it.each([
    { label: 'Front', rectangleFirst: true }, { label: 'Front', rectangleFirst: false },
    { label: 'Back', rectangleFirst: true }, { label: 'Back', rectangleFirst: false },
  ])('clears the imported split and angled $label openings (rectangle first: $rectangleFirst)', ({ label, rectangleFirst }) => {
    const source = parseProject(fixture), snapshot = structuredClone(source)
    const existingOverlaps = overlappingHardware(source)
    let project = source
    for (const names of rectangleFirst ? [upperNames, angledNames] : [angledNames, upperNames]) {
      project = closeFace(project, label, names)
      expect(overlappingHardware(project)).toEqual(existingOverlaps)
      expectRetainedHardware(source, project)
    }
    const loaded = roundTripProject(project)
    expect(overlappingHardware(loaded)).toEqual(existingOverlaps)
    expectRetainedHardware(source, loaded)
    expect(source).toEqual(snapshot)
  })

  it('uses installed slides, removed pieces and visual hardware types on rotated rims', () => {
    const base = gridProject('Customized box', [350], [350])
    base.connectorOverrides = Object.fromEntries(base.connections.flatMap(connection => [
      [connectorId(connection.id, 0), { color: '#123456', material: 'metal' as const, slide: 28 }],
      [connectorId(connection.id, 1), { type: '105' as const, slide: -18 }],
    ]))
    base.connectorOverrides![connectorId(base.connections[0].id, 0)] = { removed: true }
    const source = rotateProject(rotateProject(base, 'y', 37), 'z', 23), snapshot = structuredClone(source)
    expect(overlappingHardware(source)).toEqual([])
    const ids = source.panels.map(panel => panel.id), hole = findClosingPanelHoles(source, ids)[0]
    const closed = closePanelHole(source, ids, hole.id).project
    expect(overlappingHardware(closed)).toEqual([])
    expectRetainedHardware(source, closed)
    for (const [id, override] of Object.entries(source.connectorOverrides!)) expect(closed.connectorOverrides?.[id]).toEqual(override)
    expect(source).toEqual(snapshot)
  })

  it('includes hardware attached to hidden panels when fitting a closure', () => {
    const base = gridProject('Hidden hardware', [350], [350]), ids = base.panels.map(panel => panel.id)
    const hole = findClosingPanelHoles(base, ids)[0]
    const source = { ...base, panels: base.panels.map((panel, index) => index ? panel : { ...panel, visible: false }) }
    const closed = connectClosingPanel(source, { ...hole.panel, id: crypto.randomUUID() }, hole.boundaryIds)
    expect(overlappingHardware(closed)).toEqual([])
    expectRetainedHardware(source, closed)
    expect(closed.panels.find(panel => panel.id === ids[0])?.visible).toBe(false)
  })

  it('keeps promoted T hardware clear when filling neighboring rectangular compartments', () => {
    const source = gridProject('Cubbies', [350, 350], [350, 350])
    expect(overlappingHardware(source)).toEqual([])
    let project = source
    for (let index = 0; index < 4; index++) {
      project = closeFace(project, 'Front')
      expect(overlappingHardware(project)).toEqual([])
      expectRetainedHardware(source, project)
      expect(validateProject(project)).toEqual([])
    }
    const oldT = getPhysicalConnectors(source).filter(piece => piece.type === 't').length
    expect(getPhysicalConnectors(project).filter(piece => piece.type === 't')).toHaveLength(oldT + 8)
  })

  it('rejects an opening whose rails cannot fit clear hardware, leaving the original intact', () => {
    const source = gridProject('Narrow opening', [80], [350]), snapshot = structuredClone(source)
    expect(overlappingHardware(source)).toEqual([])
    const ids = source.panels.map(panel => panel.id), hole = findClosingPanelHoles(source, ids)[0]
    expect(hole).toBeDefined()
    expect(() => closePanelHole(source, ids, hole.id)).toThrow()
    expect(source).toEqual(snapshot)
  })

  it('uses one clamp on short rectangular edges when two cannot clear the corners', () => {
    const source = gridProject('Short edges', [120], [350])
    const closed = closeFace(source, 'Front')
    const added = closed.connections.filter(connection => !source.connections.some(old => old.id === connection.id))
    expect(added.map(connection => connection.count).sort()).toEqual([1, 1, 2, 2])
    expect(overlappingHardware(closed)).toEqual([])
    expectRetainedHardware(source, closed)
    expect(validateProject(closed)).toEqual([])
    expect(roundTripProject(closed)).toEqual(closed)
  })
})
