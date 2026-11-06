import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createPanel, duplicatePanel, parseProject, projectToCsv } from './model'
import { createAssembly, duplicateAssembly, resetAssemblyFinish, updateAssemblyDefinition, updateAssemblyFinish } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { copySelection, getPasteTargets } from './clipboard'
import { gridProject } from './example-geometry'
import { MATERIALS } from './materials'
import type { Material, Project } from './types'

const project = (material: Material): Project => ({
  version: 1, name: 'Panel material study', connections: [],
  panels: [createPanel({ id: 'source', material, width: 250, height: 250, position: [-1000, 500, 0], finishCoverage: 0.35 })],
})
const saved = (value: Project) => roundTripProject(value)

describe.each(['osb', 'nazena'] as const)('%s panels', material => {
  it('uses its catalogue color and round trips natural, tinted, and solid finishes', () => {
    const source = project(material)
    expect(source.panels[0].color).toBe(MATERIALS.find(item => item.id === material)!.color)
    for (const finishCoverage of [undefined, 0, 0.35, 1]) {
      const next = { ...source, panels: source.panels.map(panel => ({ ...panel, finishCoverage })) }
      expect(saved(next)).toEqual(next)
    }
  })

  it('keeps the finish when duplicating or copying a panel into an attachment', () => {
    const source = project(material), before = structuredClone(source)
    const expected = { material, color: source.panels[0].color, finishCoverage: 0.35 }
    const duplicate = duplicatePanel(source, 'source')
    expect(duplicate.panels[1]).toMatchObject(expected)
    expect(duplicate.panels[1].id).not.toBe('source')
    const target = createPanel({ id: 'target', position: [0, 500, 0] })
    const copied = copySelection(source, ['source'])
    const pasted = getPasteTargets({ ...source, panels: [...source.panels, target] }, ['target'], copied).find(item => item.project)?.project
    expect(pasted).toBeDefined()
    expect(pasted!.panels[2]).toMatchObject(expected)
    expect(saved(pasted!)).toEqual(pasted)
    expect(source).toEqual(before)
  })

  it('retains material names and coverage in the cutting list', () => {
    const csv = projectToCsv(project(material))
    const row = csv.split('\r\n')[1].split(',').map(cell => cell.slice(1, -1))
    expect(row.slice(5, 8)).toEqual([material, createPanel({ material }).color, '35'])
  })

  it('supports shared designs, per-instance overrides, duplicate instances, and assembly files', () => {
    const box = gridProject('Box', [350], [350], { depth: 350 })
    const original = createAssembly(box, box.panels.map(panel => panel.id))
    const instance = original.assemblies!.instances[0]
    const shared = updateAssemblyDefinition(original, instance.id, { material, color: createPanel({ material }).color })
    const copied = duplicateAssembly(shared, instance.id)
    const otherMaterial = material === 'osb' ? 'nazena' : 'osb'
    const overridden = updateAssemblyFinish(copied, instance.id, { material: otherMaterial, finishCoverage: 0.6 })
    const own = new Set(Object.values(instance.panelIds))
    expect(overridden.panels.filter(panel => own.has(panel.id)).every(panel => panel.material === otherMaterial && panel.finishCoverage === 0.6)).toBe(true)
    expect(overridden.panels.filter(panel => !own.has(panel.id)).every(panel => panel.material === material)).toBe(true)
    expect(saved(overridden)).toEqual(overridden)
    const exported = parseAssemblyFile(JSON.parse(JSON.stringify(createAssemblyFile(overridden, instance.id))))
    expect(exported.panels.every(panel => panel.material === otherMaterial && panel.finishCoverage === 0.6)).toBe(true)
    const anotherCopy = duplicateAssembly(overridden, instance.id)
    expect(anotherCopy.assemblies!.instances.at(-1)!.finish).toEqual({ material: otherMaterial, finishCoverage: 0.6 })
    expect(saved(anotherCopy)).toEqual(anotherCopy)
    const reset = resetAssemblyFinish(overridden, instance.id, 'material')
    expect(reset.panels.every(panel => panel.material === material)).toBe(true)
    expect(reset.assemblies!.instances[0].finish).toEqual({ finishCoverage: 0.6 })
  })
})

describe('panel material compatibility', () => {
  it.each(['birch', 'oak', 'walnut', 'mdf', 'painted'] as const)('keeps legacy %s panels unchanged', material => {
    const legacy = project(material)
    delete legacy.panels[0].finishCoverage
    expect(saved(legacy)).toEqual(legacy)
  })

  it('still rejects unsupported material identifiers in panels and assembly overrides', () => {
    const invalid = project('osb')
    Object.assign(invalid.panels[0], { material: 'textile' })
    expect(() => parseProject(invalid)).toThrow(/material/)
    const box = gridProject('Box', [350], [350], { depth: 350 })
    const assembly = createAssembly(box, box.panels.map(panel => panel.id))
    const instance = assembly.assemblies!.instances[0]
    expect(() => updateAssemblyFinish(assembly, instance.id, { material: 'textile' as Material })).toThrow(/material/)
    Object.assign(instance, { finish: { material: 'textile' } })
    expect(() => parseProject(assembly)).toThrow(/material/)
  })
})
