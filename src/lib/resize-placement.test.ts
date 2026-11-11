import { describe, expect, it } from 'vitest'
import { createAssembly, materializeAssemblies } from './assemblies'
import { createPanel, createStarterProject, getProjectBounds, moveProject, resolvePanels, rotateProject } from './model'
import { assertResizePlacement, createResizePlacementIntent, finishResizePlacement } from './resize-placement'
import type { Project } from './types'

const source = (): Project => ({ version: 1, name: 'Placement', connections: [], panels: [
  createPanel({ id: 'a', width: 200, height: 200, position: [-300, 200, 50] }),
  createPanel({ id: 'b', width: 200, height: 200, position: [300, 400, 50] }),
] })

function expectAnchors(before: Project, after: Project) {
  const a = getProjectBounds(resolvePanels(before)), b = getProjectBounds(resolvePanels(after))
  expect(b.min[1]).toBeCloseTo(a.min[1], 6)
  for (const axis of [0, 2]) expect(b.min[axis] + b.max[axis]).toBeCloseTo(a.min[axis] + a.max[axis], 6)
}

describe('resize final placement', () => {
  it('preserves envelope references when another panel becomes the lowest panel', () => {
    const project = source(), saved = structuredClone(project)
    const intent = createResizePlacementIntent(project, 'world')
    const candidate = { ...project, panels: project.panels.map(panel => panel.id === 'b' ? { ...panel, height: 1000, width: 500 } : panel) }
    const result = finishResizePlacement(project, candidate, intent)
    expect(result.panels[1].position[1] - result.panels[1].height / 2).toBeCloseTo(100)
    expectAnchors(project, result)
    expect(project).toEqual(saved)
    expect(Object.isFrozen(intent.bounds.min)).toBe(true)
    expect(Object.isFrozen(intent.references)).toBe(true)
    expect(() => assertResizePlacement(intent, moveProject(result, [1, 0, 0]))).toThrow(/placement reference/)
  })

  it('leaves enabled authored axes to the domain solver and ignores paused rules', () => {
    const project = source()
    project.constraints = [
      { id: 'floor', kind: 'floor', enabled: true, panelId: 'a', reference: 'min', value: 100 },
      { id: 'x', kind: 'position', enabled: true, panelId: 'a', axis: 'x', reference: 'center', value: -300 },
      { id: 'z', kind: 'position', enabled: false, panelId: 'a', axis: 'z', reference: 'center', value: 50 },
    ]
    const intent = createResizePlacementIntent(project, 'world')
    expect(intent.references).toEqual(['authored', 'authored', 'center'])
    const candidate = { ...project, panels: project.panels.map(panel => ({ ...panel, width: 400, thickness: 30 })) }
    const result = finishResizePlacement(project, candidate, intent)
    expect(result.panels.map(panel => panel.position)).toEqual(project.panels.map(panel => panel.position))
  })

  it('translates rotated assembly instances with their panels without modifying shared definitions', () => {
    const base = createStarterProject()
    const project = rotateProject(createAssembly(base, base.panels.map(panel => panel.id), 'Shelf'), 'z', 27)
    const saved = structuredClone(project)
    const candidate = moveProject(project, [150, 250, -350])
    const result = finishResizePlacement(project, candidate, createResizePlacementIntent(project, 'world'))
    expectAnchors(project, result)
    expect(result.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    expect(result.assemblies!.instances[0].panelIds).toEqual(project.assemblies!.instances[0].panelIds)
    const rebuilt = materializeAssemblies(result)
    for (const panel of rebuilt.panels) {
      const actual = result.panels.find(item => item.id === panel.id)!
      panel.position.forEach((value, axis) => expect(value).toBeCloseTo(actual.position[axis], 6))
    }
    expect(project).toEqual(saved)
  })

  it('finalizes source-local geometry after thickness changes', () => {
    const project = source()
    project.panels[0].rotation = [-Math.PI / 2, 0, 0]
    const candidate = { ...project, panels: project.panels.map(panel => ({ ...panel, thickness: 30, height: 300 })) }
    const result = finishResizePlacement(project, candidate, createResizePlacementIntent(project, 'assembly-local'))
    expectAnchors(project, result)
    expect(result.panels.every(panel => panel.thickness === 30)).toBe(true)
  })

  it('rejects stale sources, changed identities and world ownership in local placement', () => {
    const project = source(), intent = createResizePlacementIntent(project, 'world')
    expect(() => finishResizePlacement(structuredClone(project), project, intent)).toThrow(/project changed/)
    expect(() => finishResizePlacement(project, { ...project, panels: project.panels.slice(1) }, intent)).toThrow(/panels defining/)
    const base = createStarterProject()
    const assembly = createAssembly(base, base.panels.map(panel => panel.id), 'Shelf')
    expect(() => createResizePlacementIntent(assembly, 'assembly-local')).toThrow(/isolated assembly/)
    expect(() => finishResizePlacement(base, assembly, createResizePlacementIntent(base, 'assembly-local'))).toThrow(/isolated assembly/)
  })
})
