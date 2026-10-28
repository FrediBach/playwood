import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { EXAMPLE_LIBRARY } from './example-library'
import { createPanel, createStarterProject, getConnectorPlacements, getProjectBounds, parseProject, projectToCsv, resolvePanels, rotateProject, validateProject } from './model'
import type { Panel, Project, RotationAxis, Vec3 } from './types'

const axes: RotationAxis[] = ['x', 'y', 'z']
const vector = (value: Vec3) => new Vector3(...value)
const orientation = (panel: Pick<Panel, 'rotation'>) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
// Euler conversion near quarter turns introduces sub-micron floating-point noise.
const closeVector = (actual: Vector3, expected: Vector3) => expect(actual.distanceTo(expected)).toBeLessThan(0.001)

describe('whole-creation rotation', () => {
  it.each(axes)('swaps the correct dimensions for a quarter turn around %s without sinking the base', axis => {
    const project = createStarterProject('shelf')
    const before = getProjectBounds(resolvePanels(project))
    const after = getProjectBounds(resolvePanels(rotateProject(project, axis, 90)))
    const expected = axis === 'x' ? [before.width, before.depth, before.height]
      : axis === 'y' ? [before.depth, before.height, before.width] : [before.height, before.width, before.depth]
    ;[after.width, after.height, after.depth].forEach((value, i) => expect(value).toBeCloseTo(expected[i], 3))
    expect(after.min[1]).toBeCloseTo(before.min[1], 3)
    for (const i of [0, 2]) expect(after.min[i] + after.max[i]).toBeCloseTo(before.min[i] + before.max[i], 3)
    expect(validateProject(rotateProject(project, axis, 90))).toEqual(validateProject(project))
  })

  it('makes a 45-degree diagonal without changing the panel size or base height', () => {
    const project: Project = { version: 1, name: 'Square', connections: [], panels: [createPanel({ width: 400, height: 400, position: [120, 250, -80] })] }
    const turned = rotateProject(project, 'z', 45)
    const bounds = getProjectBounds(turned.panels)
    expect(bounds.width).toBeCloseTo(400 * Math.SQRT2, 3)
    expect(bounds.height).toBeCloseTo(400 * Math.SQRT2, 3)
    expect(bounds.min[1]).toBeCloseTo(50, 3)
    expect(turned.panels[0].width).toBe(400)
    expect(turned.panels[0].height).toBe(400)
  })

  it.each(EXAMPLE_LIBRARY.map(example => [example.name, example.create] as const))('keeps every panel and CAD connector rigidly aligned in %s', (_name, create) => {
    const project = create()
    const before = resolvePanels(project)
    const snapshot = JSON.stringify(project)
    for (const axis of axes) for (const angle of [-90, 45, 90]) {
      const turned = rotateProject(project, axis, angle)
      const after = resolvePanels(turned)
      const turn = new Quaternion().setFromAxisAngle(new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), angle * Math.PI / 180)
      const translation = vector(after[0].position).sub(vector(before[0].position).applyQuaternion(turn))
      const expectedPoint = (position: Vec3) => vector(position).applyQuaternion(turn).add(translation)
      const expectPose = (actual: Pick<Panel, 'position' | 'rotation'>, original: Pick<Panel, 'position' | 'rotation'>) => {
        closeVector(vector(actual.position), expectedPoint(original.position))
        expect(Math.abs(orientation(actual).dot(turn.clone().multiply(orientation(original))))).toBeCloseTo(1, 8)
      }
      after.forEach((panel, i) => expectPose(panel, before[i]))
      expect(turned.connections).toEqual(project.connections)
      for (const connection of project.connections) {
        const placements = (panels: Panel[]) => getConnectorPlacements(connection, panels.find(p => p.id === connection.parentId)!, panels.find(p => p.id === connection.childId)!)
        const original = placements(before)
        placements(after).forEach((pose, i) => expectPose(pose, original[i]))
      }
      expect(projectToCsv(turned)).toBe(projectToCsv(project))
    }
    expect(JSON.stringify(project)).toBe(snapshot)
  })

  it.each(axes)('returns to the original pose after four quarter turns around %s', axis => {
    const project = createStarterProject('shelf')
    let turned = project
    for (let i = 0; i < 4; i++) turned = rotateProject(turned, axis, 90)
    resolvePanels(turned).forEach((panel, i) => {
      const original = resolvePanels(project)[i]
      closeVector(vector(panel.position), vector(original.position))
      expect(Math.abs(orientation(panel).dot(orientation(original)))).toBeCloseTo(1, 8)
    })
  })

  it('includes hidden and unconnected panels, and survives project export/import', () => {
    const original = createStarterProject('shelf')
    original.panels.push(createPanel({ id: 'free', visible: false, position: [1500, 700, 250], rotation: [0.2, 0.4, 0.1] }))
    const turned = rotateProject(original, 'z', -45)
    const extra = turned.panels.at(-1)!
    expect(extra.visible).toBe(false)
    expect(extra.position).not.toEqual(original.panels.at(-1)!.position)
    expect(turned.panels.map(p => p.id)).toEqual(original.panels.map(p => p.id))
    const imported = parseProject(JSON.parse(JSON.stringify(turned)))
    expect(resolvePanels(imported)).toEqual(resolvePanels(turned))
    expect(validateProject(imported)).toEqual(validateProject(original))
  })

  it('leaves empty creations and full turns unchanged', () => {
    const empty = createStarterProject('blank')
    expect(rotateProject(empty, 'z', 90)).toBe(empty)
    const project = createStarterProject('shelf')
    expect(rotateProject(project, 'x', 360)).toBe(project)
    expect(() => rotateProject(project, 'y', NaN)).toThrow('finite angle')
  })
})
