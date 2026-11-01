import { describe, expect, it } from 'vitest'
import { rescaleAssemblies } from './assembly-rescale'
import { createAssembly, disassembleAssembly, duplicateAssembly, getAssemblyAttachmentTargets, materializeAssemblies, moveAssemblies, updateAssemblyParameterValues } from './assemblies'
import { gridProject } from './example-geometry'
import { parseProject, rotateProject, validateProject } from './model'
import { resizePanelDimensions } from './structure-edit'
import { getRescaleValues, rescaleProject } from './project-rescale'
import type { AssemblyParameter, Panel, Project } from './types'

function box(configurable = false): Project {
  const project = gridProject('Box', [350], [350], { depth: 350 })
  const parameters: AssemblyParameter[] = configurable ? [{ id: 'side', name: 'Side', defaultValue: 350,
    bindings: project.panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({ panelId: panel.id, dimension, scale: 1, offset: 0 }))) }] : []
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box', parameters)
}

function affineBox(offset = 0, closed = false): Project {
  const project = gridProject('Affine module', [700 + offset], [350], { depth: 300, ...(closed ? {} : { omitShelves: [[0, 1] as [number, number]] }) })
  return createAssembly(project, project.panels.map(panel => panel.id), 'Affine module', [{ id: 'side', name: 'Side', defaultValue: 350,
    bindings: project.panels.map(panel => ({ panelId: panel.id, dimension: 'width',
      scale: panel.name.startsWith('Shelf') ? 2 : 1, offset: panel.name.startsWith('Shelf') ? offset : 0 })) }])
}

const resize = (from: number, to: number) => (project: Project): Project => {
  const patches: Record<string, Partial<Pick<Panel, 'width' | 'height'>>> = {}
  for (const panel of project.panels) for (const field of ['width', 'height'] as const) {
    if (Math.abs(panel[field] - from) < 1e-5) (patches[panel.id] ??= {})[field] = to
  }
  return resizePanelDimensions(project, patches)
}
const valid = (project: Project) => {
  expect(validateProject(project)).toEqual([])
  expect(() => parseProject(JSON.parse(JSON.stringify(project)))).not.toThrow()
  const rebuilt = materializeAssemblies(project)
  expect(rebuilt.assemblies).toEqual(project.assemblies)
  expect(rebuilt.connections).toEqual(project.connections)
  expect(rebuilt.panels).toHaveLength(project.panels.length)
  for (const panel of rebuilt.panels) {
    const actual = project.panels.find(item => item.id === panel.id)!
    expect({ ...panel, position: actual.position }).toEqual(actual)
    panel.position.forEach((value, index) => expect(value).toBeCloseTo(actual.position[index], 8))
  }
}

describe('assembly rescaling', () => {
  it('keeps rotated copies linked to their resized source', () => {
    const base = box()
    let project = duplicateAssembly(base, base.assemblies!.instances[0].id)
    project = moveAssemblies(project, [project.assemblies!.instances[1].id], [500, 0, 0])
    project = rotateProject(project, 'z', 35)
    const before = structuredClone(project)
    const result = rescaleAssemblies(project, resize(350, 420))
    expect(result.panels.every(panel => panel.width === 420 && panel.height === 420)).toBe(true)
    expect(result.assemblies!.definitions.map(definition => definition.id)).toEqual(project.assemblies!.definitions.map(definition => definition.id))
    expect(result.assemblies!.instances.map(instance => instance.panelIds)).toEqual(project.assemblies!.instances.map(instance => instance.panelIds))
    expect(result.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(project).toEqual(before)
    valid(result)
  })

  it('resizes a shared corner without disassembling its instances', () => {
    const base = box()
    const project = getAssemblyAttachmentTargets(base, base.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const result = rescaleAssemblies(project, resize(350, 420))
    expect(result.assemblies!.links).toEqual(project.assemblies!.links)
    expect(result.assemblies!.instances).toHaveLength(2)
    expect(result.panels.every(panel => panel.width === 420 && panel.height === 420)).toBe(true)
    valid(result)
  })

  it.each([false, true])('keeps a closed loop connected with disassembled corner = %s', disassembled => {
    let project = box()
    for (const label of ['Top right', 'Bottom right', 'Bottom left']) {
      project = getAssemblyAttachmentTargets(project, project.assemblies!.instances.at(-1)!.id).find(target => target.label === label)!.project!
    }
    if (disassembled) project = disassembleAssembly(project, project.assemblies!.instances[0].id)
    project = rotateProject(project, 'z', 35)
    const result = rescaleAssemblies(project, resize(350, 420))
    expect(result.assemblies!.links).toEqual(project.assemblies!.links)
    expect(result.assemblies!.instances).toHaveLength(disassembled ? 3 : 4)
    expect(result.panels.every(panel => panel.width === 420 && panel.height === 420)).toBe(true)
    valid(result)
  })

  it('keeps physical corners connected when panel stock thickness changes', () => {
    const base = box()
    const project = getAssemblyAttachmentTargets(base, base.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const result = rescaleAssemblies(project, input => resizePanelDimensions(input,
      Object.fromEntries(input.panels.map(panel => [panel.id, { thickness: 19 }]))))
    expect(result.panels.every(panel => panel.thickness === 19)).toBe(true)
    expect(result.assemblies!.links).toEqual(project.assemblies!.links)
    valid(result)
  })

  it('updates defaults while retaining separately configured instance values', () => {
    const base = box(true), first = base.assemblies!.instances[0]
    let project = duplicateAssembly(base, first.id)
    const second = project.assemblies!.instances[1]
    project = moveAssemblies(project, [second.id], [1000, 0, 0])
    project = updateAssemblyParameterValues(project, second.id, { side: 500 })
    const result = rescaleAssemblies(project, resize(350, 420))
    expect(result.assemblies!.definitions[0].parameters![0].defaultValue).toBe(420)
    expect(result.assemblies!.instances[1].parameterValues).toEqual({ side: 500 })
    expect(result.panels.filter(panel => Object.values(first.panelIds).includes(panel.id)).every(panel => panel.width === 420)).toBe(true)
    expect(result.panels.filter(panel => Object.values(second.panelIds).includes(panel.id)).every(panel => panel.width === 500)).toBe(true)
    valid(result)
    valid(updateAssemblyParameterValues(result, first.id, { side: 450 }))
  })

  it('updates an instance override without changing an unrelated source default', () => {
    const base = box(true), instance = base.assemblies!.instances[0]
    const project = updateAssemblyParameterValues(base, instance.id, { side: 500 })
    const result = rescaleAssemblies(project, resize(500, 600))
    expect(result.assemblies!.definitions[0].parameters![0].defaultValue).toBe(350)
    expect(result.assemblies!.instances[0].parameterValues).toEqual({ side: 600 })
    expect(result.panels.every(panel => panel.width === 600 && panel.height === 600)).toBe(true)
    valid(result)
  })

  it('rejects changes that contradict an existing parameter relationship atomically', () => {
    const project = box(true), before = structuredClone(project)
    expect(() => rescaleAssemblies(project, input => resizePanelDimensions(input,
      Object.fromEntries(input.panels.filter(panel => panel.name.startsWith('Shelf')).map(panel => [panel.id, { width: 420 }]))))).toThrow(/editable value|shared assembly/)
    expect(project).toEqual(before)
  })

  it.each([0, 20])('propagates a repeated dimension to a unique affine dimension with offset %i', offset => {
    const project = affineBox(offset)
    expect(getRescaleValues(project).some(value => value.value === 700 + offset)).toBe(false)
    expect(getRescaleValues(project).find(value => value.id === 'dimension:350')!.max).toBe((4000 - offset) / 2)
    const result = rescaleProject(project, { 'dimension:350': 400 })
    expect(result.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 400)).toBe(true)
    expect(result.panels.find(panel => panel.name.startsWith('Shelf'))!.width).toBe(800 + offset)
    expect(result.assemblies!.definitions[0].parameters![0].defaultValue).toBe(400)
    valid(result)
  })

  it('expands affine bindings for an instance override while preserving the default', () => {
    const base = affineBox(20), instance = base.assemblies!.instances[0]
    const project = updateAssemblyParameterValues(base, instance.id, { side: 500 })
    const result = rescaleProject(project, { 'dimension:500': 600 })
    expect(result.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 600)).toBe(true)
    expect(result.panels.find(panel => panel.name.startsWith('Shelf'))!.width).toBe(1220)
    expect(result.assemblies!.definitions[0].parameters![0].defaultValue).toBe(350)
    expect(result.assemblies!.instances[0].parameterValues).toEqual({ side: 600 })
    valid(result)
  })

  it('rejects two explicit changes that request contradictory parameter values', () => {
    const project = affineBox(0, true), before = structuredClone(project)
    expect(() => rescaleProject(project, { 'dimension:350': 400, 'dimension:700': 850 })).toThrow(/conflict|related|same editable value/i)
    expect(project).toEqual(before)
  })
})
