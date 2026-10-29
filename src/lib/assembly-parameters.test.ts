import { describe, expect, it } from 'vitest'
import { createAssembly, disassembleAssembly, duplicateAssembly, getAssemblyAttachmentTargets, makeAssemblyIndependent, materializeAssemblies, moveAssemblies, resetAssemblyParameterValues, updateAssemblyDefinition, updateAssemblyParameters, updateAssemblyParameterValues } from './assemblies'
import { getAssemblyParameterRange } from './assembly-parameters'
import { gridProject } from './example-geometry'
import { createPanel, getProjectBounds, parseProject, rotateProject, validateProject } from './model'
import type { AssemblyParameter, Panel, Project } from './types'

const binding = (panel: Panel, dimension: 'width' | 'height' | 'thickness', scale = 1, offset = 0) => ({ panelId: panel.id, dimension, scale, offset })
function box(cube = false): Project {
  const project = gridProject('Configurable box', [350], [350], { depth: 350 })
  const parameters: AssemblyParameter[] = cube
    ? [{ id: 'side', name: 'Side length', defaultValue: 350, bindings: project.panels.flatMap(panel => [binding(panel, 'width'), binding(panel, 'height')]) }]
    : [{ id: 'width', name: 'Width', defaultValue: 350, bindings: project.panels.filter(panel => panel.name.startsWith('Shelf')).map(panel => binding(panel, 'width')) },
      { id: 'height', name: 'Height', defaultValue: 350, bindings: project.panels.filter(panel => panel.name.startsWith('Upright')).map(panel => binding(panel, 'width')) },
      { id: 'depth', name: 'Depth', defaultValue: 350, bindings: project.panels.map(panel => binding(panel, 'height')) }]
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box', parameters)
}
function valid(project: Project) {
  expect(validateProject(project)).toEqual([])
  expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
}
function add(project: Project, label: string): Project {
  const target = getAssemblyAttachmentTargets(project, project.assemblies!.instances.at(-1)!.id).find(item => item.label === label)!
  expect(target.error).toBeUndefined()
  return target.project!
}

describe('assembly instance parameters', () => {
  it('rejects creation defaults that grow into an unrelated panel without changing the project', () => {
    const source = gridProject('Box', [350], [350])
    const project = { ...source, panels: [...source.panels, createPanel({ width: 100, height: 100, position: [320, 9, 0], rotation: [-Math.PI / 2, 0, 0] })] }
    const before = JSON.stringify(project)
    const parameters = [{ id: 'side', name: 'Side', defaultValue: 700, bindings: source.panels.flatMap(panel => [binding(panel, 'width'), binding(panel, 'height')]) }]
    expect(validateProject(project)).toEqual([])
    expect(() => createAssembly(project, source.panels.map(panel => panel.id), 'Box', parameters)).toThrow(/overlap/)
    expect(JSON.stringify(project)).toBe(before)
  })

  it('drives every cube dimension with one value while retaining its floor and hardware', () => {
    const project = box(true), instance = project.assemblies!.instances[0]
    const resized = updateAssemblyParameterValues(project, instance.id, { side: 500 })
    expect(resized.panels.every(panel => panel.width === 500 && panel.height === 500)).toBe(true)
    expect(resized.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(getProjectBounds(resized.panels).min[1]).toBeCloseTo(getProjectBounds(project.panels).min[1])
    expect(resized.assemblies!.definitions[0]).toBe(project.assemblies!.definitions[0])
    valid(resized)
  })

  it('applies width, height, and depth together and leaves a sibling at its own defaults', () => {
    const original = box(), id = original.assemblies!.instances[0].id
    let project = duplicateAssembly(original, id)
    const second = project.assemblies!.instances[1]
    project = moveAssemblies(project, [second.id], [500, 0, 0])
    const resized = updateAssemblyParameterValues(project, second.id, { width: 700, height: 250, depth: 420 })
    for (const panel of resized.panels.filter(panel => Object.values(second.panelIds).includes(panel.id))) {
      expect(panel.width).toBe(panel.name.startsWith('Shelf') ? 700 : 250)
      expect(panel.height).toBe(420)
    }
    expect(resized.panels.slice(0, 4)).toEqual(project.panels.slice(0, 4))
    expect(updateAssemblyParameterValues(resized, second.id, { width: 700 })).toBe(resized)
    valid(resized)
    const reset = resetAssemblyParameterValues(resized, second.id)
    expect(reset.assemblies!.instances[1].parameterValues).toBeUndefined()
    expect(reset.panels.every(panel => panel.width === 350 && panel.height === 350)).toBe(true)
    valid(reset)
  })

  it('pins unchanged controls when a different control shares a panel and preserves affine relationships', () => {
    let project = box()
    const id = project.assemblies!.instances[0].id
    const parameters = structuredClone(project.assemblies!.definitions[0].parameters!)
    parameters[0].defaultValue = 175
    parameters[0].bindings.forEach(item => { item.scale = 2 })
    parameters[1].defaultValue = 300
    parameters[1].bindings.forEach(item => { item.offset = 50 })
    project = updateAssemblyParameters(project, id, parameters)
    project = updateAssemblyParameterValues(project, id, { width: 250, depth: 400 })
    project = updateAssemblyParameterValues(project, id, { height: 200 })
    expect(project.panels.filter(panel => panel.name.startsWith('Shelf')).every(panel => panel.width === 500)).toBe(true)
    expect(project.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 250)).toBe(true)
    expect(project.panels.every(panel => panel.height === 400)).toBe(true)
    expect(getAssemblyParameterRange(parameters[0])).toEqual({ min: 20, max: 2000 })
    valid(project)
  })

  it('preserves configured geometry through rotation, duplication, independence, and disassembly', () => {
    let project = box(), id = project.assemblies!.instances[0].id
    project = updateAssemblyParameterValues(project, id, { width: 600, height: 260, depth: 420 })
    project = rotateProject(project, 'z', 45)
    const rotated = updateAssemblyParameterValues(project, id, { width: 550 })
    expect(rotated.assemblies!.instances[0].rotation).toEqual(project.assemblies!.instances[0].rotation)
    valid(rotated)
    const copy = duplicateAssembly(rotated, id), second = copy.assemblies!.instances[1]
    expect(second.parameterValues).toEqual(copy.assemblies!.instances[0].parameterValues)
    expect(second.parameterValues).not.toBe(copy.assemblies!.instances[0].parameterValues)
    valid(copy)
    const independent = makeAssemblyIndependent(copy, second.id)
    expect(independent.panels).toEqual(copy.panels)
    valid(independent)
    const loose = disassembleAssembly(independent, second.id)
    expect(loose.panels).toEqual(copy.panels)
    valid(loose)
  })

  it('repositions a linked neighbor using configured ports and rejects incompatible depth', () => {
    const project = add(box(), 'Top right'), id = project.assemblies!.instances[0].id
    const resized = updateAssemblyParameterValues(project, id, { width: 450, height: 500 })
    expect(resized.assemblies!.links).toEqual(project.assemblies!.links)
    expect(resized.assemblies!.instances[1].position).not.toEqual(project.assemblies!.instances[1].position)
    expect(resized.assemblies!.instances[1].parameterValues).toBeUndefined()
    valid(resized)
    const saved = JSON.stringify(resized)
    valid(updateAssemblyParameterValues(resized, id, { depth: 450 }))
    expect(() => updateAssemblyParameterValues(resized, id, { depth: 60 })).toThrow(/shared edge|connected/)
    expect(JSON.stringify(resized)).toBe(saved)
  })

  it('rejects an incompatible single-instance edit in a closed connection loop atomically', () => {
    const project = add(add(add(box(), 'Top right'), 'Bottom right'), 'Bottom left')
    const before = JSON.stringify(project)
    expect(() => updateAssemblyParameterValues(project, project.assemblies!.instances[0].id, { width: 600, height: 600 })).toThrow(/align|corners|overlap/)
    expect(JSON.stringify(project)).toBe(before)
    valid(project)
  })

  it('authors shared defaults while preserving overrides and protects controlled source dimensions', () => {
    const base = box(), id = base.assemblies!.instances[0].id
    let project = duplicateAssembly(base, id), second = project.assemblies!.instances[1]
    project = moveAssemblies(project, [second.id], [500, 0, 0])
    project = updateAssemblyParameterValues(project, second.id, { width: 500 })
    const parameters = structuredClone(project.assemblies!.definitions[0].parameters!)
    parameters[0].defaultValue = 450
    project = updateAssemblyParameters(project, id, parameters)
    expect(project.panels.filter(panel => panel.name.startsWith('Shelf')).map(panel => panel.width)).toEqual([450, 450, 500, 500])
    expect(() => updateAssemblyDefinition(project, id, { width: 700 })).toThrow(/controlled/)
    const colored = updateAssemblyDefinition(project, id, { color: '#123456' })
    expect(colored.panels.every(panel => panel.color === '#123456')).toBe(true)
    valid(colored)
    const removed = updateAssemblyParameters(colored, id, parameters.filter(parameter => parameter.id !== 'width'))
    expect(removed.assemblies!.instances[1].parameterValues).toBeUndefined()
    valid(removed)
  })

  it('checks physical thickness limits and rejects invalid ranges or inconsistent target constraints', () => {
    let project = box(), id = project.assemblies!.instances[0].id
    const definition = project.assemblies!.definitions[0]
    project = updateAssemblyParameters(project, id, [...definition.parameters!, { id: 'thickness', name: 'Thickness', defaultValue: 18, bindings: definition.panels.map(panel => binding(panel, 'thickness')) }])
    const thinner = updateAssemblyParameterValues(project, id, { thickness: 16 })
    expect(thinner.panels.every(panel => panel.thickness === 16)).toBe(true)
    valid(thinner)
    for (const values of [{ width: NaN }, { depth: 39 }, { height: Infinity }, { thickness: 15 }, { missing: 500 }]) expect(() => updateAssemblyParameterValues(project, id, values)).toThrow()
    const invalid = structuredClone(project.assemblies!.definitions[0].parameters!)
    invalid[0].bindings[0].offset = 1
    expect(() => updateAssemblyParameters(project, id, invalid)).toThrow(/cannot move|connected/)
  })

  it('rejects malformed saved control metadata and materialized geometry mismatches', () => {
    const project = box()
    const mutate = (change: (copy: Project) => void) => { const copy = structuredClone(project); change(copy); expect(() => parseProject(copy)).toThrow() }
    mutate(copy => { copy.assemblies!.definitions[0].parameters![0].bindings[0].panelId = 'missing' })
    mutate(copy => { copy.assemblies!.definitions[0].parameters![0].bindings[0].scale = 0 })
    mutate(copy => { copy.assemblies!.definitions[0].parameters![1].bindings.push(copy.assemblies!.definitions[0].parameters![0].bindings[0]) })
    mutate(copy => { copy.assemblies!.definitions[0].parameters![0].name = ' ' })
    mutate(copy => { copy.assemblies!.instances[0].parameterValues = { removed: 350 } })
    mutate(copy => { copy.assemblies!.instances[0].parameterValues = { width: 500 } })
  })

  it('treats prototype-like identifiers as ordinary own keys', () => {
    let project = box(), id = project.assemblies!.instances[0].id
    const parameters = structuredClone(project.assemblies!.definitions[0].parameters!)
    parameters[0].id = '__proto__'; parameters[1].id = 'constructor'
    project = updateAssemblyParameters(project, id, parameters)
    project = updateAssemblyParameterValues(project, id, Object.fromEntries([['__proto__', 500], ['constructor', 250]]))
    expect(project.panels.filter(panel => panel.name.startsWith('Shelf')).every(panel => panel.width === 500)).toBe(true)
    expect(project.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 250)).toBe(true)
    valid(project)
    expect(materializeAssemblies(project)).toEqual(project)
  })
})
