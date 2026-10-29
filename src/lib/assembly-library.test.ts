import { describe, expect, it } from 'vitest'
import { ASSEMBLY_LIBRARY, insertLibraryAssembly } from './assembly-library'
import { duplicateAssembly, getAssemblyAttachmentTargets } from './assemblies'
import { createExampleProject } from './example-library'
import { createStarterProject, parseProject, validateProject } from './model'

describe('reusable assembly collection', () => {
  it.each(ASSEMBLY_LIBRARY)('$name can be opened, inserted, duplicated, and saved', example => {
    const template = createExampleProject(example.id)
    expect(template.assemblies?.definitions).toHaveLength(1)
    expect(template.assemblies?.instances).toHaveLength(1)
    expect(template.assemblies!.definitions[0].ports.length).toBeGreaterThan(0)
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
    expect(getAssemblyAttachmentTargets(template, template.assemblies!.instances[0].id).some(target => target.project)).toBe(true)
  })
})
