import { describe, expect, it } from 'vitest'
import { ASSEMBLY_LIBRARY, insertLibraryAssembly } from './assembly-library'
import { duplicateAssembly, getAssemblyAttachmentTargets, resetAssemblyParameterValues, updateAssemblyParameterValues } from './assemblies'
import { createExampleProject } from './example-library'
import { createStarterProject, getProjectBounds, parseProject, validateProject } from './model'

describe('reusable assembly collection', () => {
  it.each(ASSEMBLY_LIBRARY)('$name can be opened, inserted, duplicated, and saved', example => {
    const template = createExampleProject(example.id)
    expect(template.assemblies?.definitions).toHaveLength(1)
    expect(template.assemblies?.instances).toHaveLength(1)
    const hasCorners = template.connections.some(connection => connection.type === '90')
    expect(template.assemblies!.definitions[0].ports.length > 0).toBe(hasCorners)
    const original = createStarterProject('shelf')
    const snapshot = structuredClone(original)
    const inserted = insertLibraryAssembly(original, example.id)
    expect(original).toEqual(snapshot)
    expect(inserted.name).toBe(original.name)
    for (const panel of original.panels) expect(inserted.panels).toContainEqual(panel)
    const instance = inserted.assemblies!.instances[0]
    const duplicated = duplicateAssembly(inserted, instance.id)
    expect(duplicated.assemblies!.definitions).toHaveLength(1)
    expect(duplicated.assemblies!.instances).toHaveLength(2)
    expect(parseProject(JSON.parse(JSON.stringify(duplicated)))).toEqual(duplicated)
    expect(validateProject(duplicated).filter(issue => issue.severity === 'error' || issue.id.startsWith('collision'))).toEqual([])
    expect(getAssemblyAttachmentTargets(template, template.assemblies!.instances[0].id).some(target => target.project)).toBe(hasCorners)
  })
})

describe('angled reference modules', () => {
  it.each(ASSEMBLY_LIBRARY.filter(example => example.category === 'Angled modules'))('$name closes all six joints using the angled hardware', example => {
    const project = example.create()
    expect(project.panels).toHaveLength(6)
    expect(project.connections).toHaveLength(6)
    expect(project.connections.filter(connection => connection.type === '105')).toHaveLength(4)
    expect(project.connections.filter(connection => connection.type === '150')).toHaveLength(2)
    expect(project.connections.reduce((total, connection) => total + connection.count, 0)).toBe(12)
    expect(project.assemblies!.definitions[0].connections.filter(connection => connection.role === 'support')).toHaveLength(1)
    expect(validateProject(project).filter(issue => issue.severity === 'error' || /collision|alignment/.test(issue.id))).toEqual([])
  })
})

describe('configurable library modules', () => {
  const modules = ASSEMBLY_LIBRARY.filter(example => example.category !== 'Angled modules')

  it.each(modules)('$name exposes every cut span and depth with unchanged defaults', example => {
    const project = example.create()
    const definition = project.assemblies!.definitions[0]
    const parameters = definition.parameters!
    const bindings = parameters.flatMap(parameter => parameter.bindings)
    expect(bindings).toHaveLength(definition.panels.length * 2)
    expect(new Set(bindings.map(binding => `${binding.panelId}/${binding.dimension}`)).size).toBe(bindings.length)
    for (const parameter of parameters) for (const binding of parameter.bindings) {
      const panel = definition.panels.find(item => item.id === binding.panelId)!
      expect(parameter.defaultValue * binding.scale + binding.offset).toBeCloseTo(panel[binding.dimension])
    }
    const instance = project.assemblies!.instances[0]
    const values = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.defaultValue + 50]))
    const configured = updateAssemblyParameterValues(project, instance.id, values)
    expect(configured.assemblies!.definitions[0]).toEqual(definition)
    expect(configured.connections).toHaveLength(project.connections.length)
    for (const parameter of parameters) for (const binding of parameter.bindings) {
      const panel = configured.panels.find(item => item.id === instance.panelIds[binding.panelId])!
      expect(panel[binding.dimension]).toBeCloseTo(values[parameter.id] * binding.scale + binding.offset)
    }
    expect(validateProject(configured)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(configured)))).toEqual(configured)
  })

  it('changes a cube side with one value while retaining its connectors and floor height', () => {
    const project = createExampleProject('assembly-cube')
    const instance = project.assemblies!.instances[0]
    expect(project.assemblies!.definitions[0].parameters?.map(parameter => parameter.name)).toEqual(['Side length'])
    const configured = updateAssemblyParameterValues(project, instance.id, { 'side-length': 450 })
    expect(configured.panels.every(panel => panel.width === 450 && panel.height === 450 && panel.thickness === 18)).toBe(true)
    expect(configured.connections.map(connection => [connection.id, connection.type, connection.count]))
      .toEqual(project.connections.map(connection => [connection.id, connection.type, connection.count]))
    const before = getProjectBounds(project.panels), after = getProjectBounds(configured.panels)
    expect(after.width - before.width).toBeCloseTo(100)
    expect(after.height - before.height).toBeCloseTo(100)
    expect(after.depth - before.depth).toBeCloseTo(100)
    expect(after.min[1]).toBeCloseTo(before.min[1])
    expect(validateProject(configured)).toEqual([])
  })

  it('configures wide shelf width, height and depth independently and resets to source defaults', () => {
    const project = createExampleProject('assembly-wide-box')
    const instance = project.assemblies!.instances[0]
    expect(project.assemblies!.definitions[0].parameters?.map(parameter => parameter.name)).toEqual(['Width', 'Height', 'Depth'])
    const wide = updateAssemblyParameterValues(project, instance.id, { width: 820 })
    const taller = updateAssemblyParameterValues(wide, instance.id, { height: 410 })
    const configured = updateAssemblyParameterValues(taller, instance.id, { depth: 280 })
    expect(configured.panels.filter(panel => panel.name.startsWith('Shelf')).every(panel => panel.width === 820 && panel.height === 280)).toBe(true)
    expect(configured.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 410 && panel.height === 280)).toBe(true)
    expect(configured.panels.every(panel => panel.thickness === 18)).toBe(true)
    expect(validateProject(configured)).toEqual([])
    const reset = resetAssemblyParameterValues(configured, instance.id)
    expect(reset.panels).toEqual(project.panels)
    expect(reset.connections).toEqual(project.connections)
  })

  it('lets a cubby column change without resizing the next column', () => {
    const project = createExampleProject('assembly-double-cubby')
    const instance = project.assemblies!.instances[0]
    const configured = updateAssemblyParameterValues(project, instance.id, { 'width-1': 500 })
    expect(configured.panels.filter(panel => panel.name.startsWith('Shelf 1.')).every(panel => panel.width === 500)).toBe(true)
    expect(configured.panels.filter(panel => panel.name.startsWith('Shelf 2.')).every(panel => panel.width === 350)).toBe(true)
    expect(configured.panels.filter(panel => panel.name.startsWith('Upright')).every(panel => panel.width === 350)).toBe(true)
    expect(configured.panels.every(panel => panel.height === 350)).toBe(true)
    expect(validateProject(configured)).toEqual([])
  })
})
