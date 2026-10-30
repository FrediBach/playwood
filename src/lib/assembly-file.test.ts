import { describe, expect, it } from 'vitest'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { ASSEMBLY_LIBRARY, insertAssemblyDefinition } from './assembly-library'
import { duplicateAssembly, getAssemblyAttachmentTargets, updateAssemblyFinish, updateAssemblyParameterValues } from './assemblies'
import { getInsertionTargets } from './clipboard'
import { createExampleProject } from './example-library'
import { createStarterProject, getProjectBounds, parseProject, validateProject } from './model'

describe('assembly files', () => {
  it.each(ASSEMBLY_LIBRARY)('$name round trips into an existing build as an independent design', example => {
    const source = example.create()
    const snapshot = structuredClone(source)
    const file = createAssemblyFile(source, source.assemblies!.instances[0].id)
    const definition = parseAssemblyFile(JSON.parse(JSON.stringify(file)))
    expect(definition).toEqual({ ...file.definition, id: definition.id })
    expect(definition.id).not.toBe(file.definition.id)
    const original = createStarterProject('shelf')
    const inserted = insertAssemblyDefinition(original, definition)
    expect(inserted.name).toBe(original.name)
    for (const panel of original.panels) expect(inserted.panels).toContainEqual(panel)
    const again = insertAssemblyDefinition(inserted, parseAssemblyFile(file))
    expect(again.assemblies!.definitions).toHaveLength(2)
    expect(new Set(again.panels.map(panel => panel.id)).size).toBe(again.panels.length)
    expect(parseProject(JSON.parse(JSON.stringify(again)))).toEqual(again)
    expect(validateProject(again)).toEqual([])
    expect(source).toEqual(snapshot)
  })

  it('preserves configured values and finish as editable defaults without exporting neighbors', () => {
    let project = createExampleProject('assembly-cube')
    const instance = project.assemblies!.instances[0]
    project = duplicateAssembly(project, instance.id)
    project = updateAssemblyParameterValues(project, instance.id, { 'side-length': 450 })
    project = updateAssemblyFinish(project, instance.id, { color: '#123456', material: 'painted' })
    const definition = parseAssemblyFile(createAssemblyFile(project, instance.id))
    expect(definition.panels).toHaveLength(4)
    expect(definition.panels.every(panel => panel.width === 450 && panel.height === 450 && panel.color === '#123456' && panel.material === 'painted')).toBe(true)
    expect(definition.parameters![0].defaultValue).toBe(450)
    const imported = insertAssemblyDefinition({ version: 1, name: 'Empty', panels: [], connections: [] }, definition)
    expect(getProjectBounds(imported.panels).min[1]).toBeCloseTo(0)
    const resized = updateAssemblyParameterValues(imported, imported.assemblies!.instances[0].id, { 'side-length': 500 })
    expect(resized.panels.every(panel => panel.width === 500 && panel.height === 500)).toBe(true)
    expect(parseProject(JSON.parse(JSON.stringify(resized)))).toEqual(resized)
  })

  it('restores standalone corners when exporting an assembly connected to a neighbor', () => {
    const source = createExampleProject('assembly-cube')
    const instance = source.assemblies!.instances[0]
    const attached = getAssemblyAttachmentTargets(source, instance.id).find(target => target.project && !target.warning)!.project!
    const definition = parseAssemblyFile(createAssemblyFile(attached, instance.id))
    expect(definition.connections.map(connection => connection.type)).toEqual(['90', '90', '90', '90'])
    expect(definition.ports).toHaveLength(4)
    const targets = getInsertionTargets(source, Object.values(instance.panelIds), { kind: 'assembly', definition, instance: { ...instance, definitionId: definition.id } })
    expect(targets.some(target => target.project)).toBe(true)
    const placed = targets.find(target => target.project && !target.warning)!.project!
    expect(placed.assemblies!.definitions).toHaveLength(2)
    expect(parseProject(JSON.parse(JSON.stringify(placed)))).toEqual(placed)
  })

  it('rejects wrong files, unsupported versions and broken references before insertion', () => {
    const source = createExampleProject('assembly-cube')
    const file = createAssemblyFile(source, source.assemblies!.instances[0].id)
    expect(() => parseAssemblyFile(source)).toThrow(/assembly file/)
    expect(() => parseAssemblyFile(null)).toThrow(/assembly file/)
    expect(() => parseAssemblyFile({ ...file, version: 2 })).toThrow(/version/)
    const badPort = structuredClone(file)
    badPort.definition.ports[0].connectionId = 'missing'
    expect(() => parseAssemblyFile(badPort)).toThrow(/corner/)
    const badParameter = structuredClone(file)
    badParameter.definition.parameters![0].bindings[0].panelId = 'missing'
    expect(() => parseAssemblyFile(badParameter)).toThrow(/missing panel/)
    const badDimension = structuredClone(file)
    badDimension.definition.panels[0].width = -1
    expect(() => parseAssemblyFile(badDimension)).toThrow()
  })
})
