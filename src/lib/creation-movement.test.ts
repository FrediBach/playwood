import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { createStarterProject, moveProject, resolvePanels, rotateProject, validateProject } from './model'
import { createAssembly, materializeAssemblies } from './assemblies'
import { getRoomLayout } from '../components/room-layout'

describe('whole creation movement', () => {
  it('translates connected and hidden panels without changing joints, and round-trips', () => {
    const project = rotateProject(createStarterProject('shelf'), 'y', 45)
    project.panels[0].visible = false
    const before = resolvePanels(project)
    const moved = moveProject(project, [340, -120, -570])
    resolvePanels(moved).forEach((panel, i) => {
      panel.position.forEach((value, axis) => expect(value).toBeCloseTo(before[i].position[axis] + [340, -120, -570][axis], 6))
      expect(panel.rotation).toEqual(before[i].rotation)
    })
    expect(moved.connections).toEqual(project.connections)
    expect(moved.panels[0].visible).toBe(false)
    expect(validateProject(moved)).toEqual(validateProject(project))
    expect(roundTripProject(moved)).toEqual(moved)
    expect(moveProject(project, [0, 0, 0])).toBe(project)
    expect(() => moveProject(project, [NaN, 0, 0])).toThrow()
  })

  it('moves reusable instance origins without altering their definitions', () => {
    const source = createStarterProject('shelf')
    const project = createAssembly(source, source.panels.map(panel => panel.id), 'Shelf')
    const moved = moveProject(project, [300, 100, -500])
    expect(moved.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    expect(moved.assemblies!.instances[0].position).toEqual(project.assemblies!.instances[0].position.map((v, i) => v + [300, 100, -500][i]))
    const materialized = materializeAssemblies(moved)
    resolvePanels(materialized).forEach((panel, i) => panel.position.forEach((v, axis) => expect(v).toBeCloseTo(resolvePanels(moved)[i].position[axis], 6)))
  })

  it('keeps room furnishings and walls stationary when the creation moves', () => {
    const bounds = new Box3(new Vector3(-1, 0, -0.2), new Vector3(1, 2, 0.2))
    const before = getRoomLayout(bounds)
    const after = getRoomLayout(bounds.clone().translate(new Vector3(2, 1, -0.5)))
    for (const key of Object.keys(before) as (keyof typeof before)[]) expect(after[key]).toBeCloseTo(before[key], 10)
  })
})
