import { describe, expect, it } from 'vitest'
import { createPanel, parseProject, projectToCsv } from './model'
import { getSharedPanelFields, updateSelectedPanels } from './selection'
import { createAssembly, duplicateAssembly, resetAssemblyFinish, updateAssemblyDefinition, updateAssemblyFinish } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { gridProject } from './example-geometry'
import type { Panel, Project } from './types'

const project = (...panels: Partial<Panel>[]): Project => ({
  version: 1, name: 'Finish study', connections: [],
  panels: panels.map((panel, index) => createPanel({ id: String(index), ...panel })),
})
const saved = (value: Project) => parseProject(JSON.parse(JSON.stringify(value)))
function box() {
  const base = gridProject('Box', [350], [350], { depth: 350 })
  return createAssembly(base, base.panels.map(panel => panel.id))
}

describe('panel finish coverage', () => {
  it('keeps older projects unchanged and round trips natural, partial, and solid finishes', () => {
    const legacy = project({})
    expect(saved(legacy)).toEqual(legacy)
    expect(saved(legacy).panels[0].finishCoverage).toBeUndefined()
    const finished = project({ finishCoverage: 0 }, { finishCoverage: 0.45 }, { finishCoverage: 1 })
    expect(saved(finished)).toEqual(finished)
  })

  it.each([-0.01, 1.01, NaN, Infinity, '0.5', null])('rejects invalid imported coverage %s', value => {
    const invalid = project({})
    Object.assign(invalid.panels[0], { finishCoverage: value })
    expect(() => parseProject(invalid)).toThrow(/finish coverage/)
  })

  it('treats absent coverage as natural and bulk edits shared coverage without changing color', () => {
    const base = project({ color: '#112233' }, { color: '#445566', finishCoverage: 0 })
    expect(getSharedPanelFields(base.panels).has('finishCoverage')).toBe(true)
    expect(updateSelectedPanels(base, ['0', '1'], { finishCoverage: 0 })).toBe(base)
    const changed = updateSelectedPanels(base, ['0', '1'], { finishCoverage: 0.6 })
    expect(changed.panels.map(panel => panel.finishCoverage)).toEqual([0.6, 0.6])
    expect(changed.panels.map(panel => panel.color)).toEqual(['#112233', '#445566'])
    expect(saved(changed)).toEqual(changed)
    const mixed = project({ finishCoverage: 0.4 }, { finishCoverage: 0.8 })
    expect(getSharedPanelFields(mixed.panels).has('finishCoverage')).toBe(false)
    expect(updateSelectedPanels(mixed, ['0', '1'], { finishCoverage: 1 })).toBe(mixed)
  })

  it('includes percentage coverage in the cutting list, including painted material', () => {
    const csv = projectToCsv(project({}, { finishCoverage: 0.45 }, { finishCoverage: 1 }, { material: 'painted' }))
    const rows = csv.split('\r\n').map(row => row.replace(/^\uFEFF/, '').split(',').map(cell => cell.slice(1, -1)))
    expect(rows[0][7]).toBe('Finish coverage (%)')
    expect(rows.slice(1).map(row => row[7])).toEqual(['0', '45', '100', '100'])
  })
})

describe('assembly finish coverage', () => {
  it('preserves instance coverage through source edits, copying, export, and resets', () => {
    const initial = box(), instance = initial.assemblies!.instances[0]
    const withCopy = duplicateAssembly(initial, instance.id)
    const overridden = updateAssemblyFinish(withCopy, instance.id, { color: '#123456', finishCoverage: 0.75 })
    const edited = updateAssemblyDefinition(overridden, instance.id, { finishCoverage: 0.25 })
    const own = new Set(Object.values(instance.panelIds))
    expect(edited.panels.filter(panel => own.has(panel.id)).every(panel => panel.finishCoverage === 0.75)).toBe(true)
    expect(edited.panels.filter(panel => !own.has(panel.id)).every(panel => panel.finishCoverage === 0.25)).toBe(true)
    expect(saved(edited)).toEqual(edited)
    const definition = parseAssemblyFile(createAssemblyFile(edited, instance.id))
    expect(definition.panels.every(panel => panel.finishCoverage === 0.75 && panel.color === '#123456')).toBe(true)
    const copied = duplicateAssembly(edited, instance.id)
    expect(copied.assemblies!.instances.at(-1)!.finish).toEqual({ color: '#123456', finishCoverage: 0.75 })
    expect(saved(copied)).toEqual(copied)
    const reset = resetAssemblyFinish(edited, instance.id)
    expect(reset.panels.every(panel => panel.finishCoverage === 0.25)).toBe(true)
    expect(reset.assemblies!.instances[0].finish).toBeUndefined()
  })

  it('resets individual finish properties without clearing the other overrides', () => {
    const base = box(), instance = base.assemblies!.instances[0]
    const edited = updateAssemblyFinish(base, instance.id, { color: '#123456', finishCoverage: 1 })
    const resetColor = resetAssemblyFinish(edited, instance.id, 'color')
    expect(resetColor.assemblies!.instances[0].finish).toEqual({ finishCoverage: 1 })
    expect(resetColor.panels.every(panel => panel.finishCoverage === 1 && panel.color !== '#123456')).toBe(true)
    const resetCoverage = resetAssemblyFinish(edited, instance.id, 'finishCoverage')
    expect(resetCoverage.assemblies!.instances[0].finish).toEqual({ color: '#123456' })
    expect(resetCoverage.panels.every(panel => panel.finishCoverage === undefined && panel.color === '#123456')).toBe(true)
    expect(saved(resetColor)).toEqual(resetColor)
    expect(saved(resetCoverage)).toEqual(resetCoverage)
    expect(resetAssemblyFinish(resetCoverage, instance.id, 'color').assemblies!.instances[0].finish).toBeUndefined()
    expect(resetAssemblyFinish(resetCoverage, instance.id, 'finishCoverage')).toBe(resetCoverage)
  })

  it('rejects invalid overrides and disagreement with materialized panel finishes', () => {
    const base = box(), instance = base.assemblies!.instances[0]
    for (const finishCoverage of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => updateAssemblyFinish(base, instance.id, { finishCoverage })).toThrow(/finish coverage/)
      const invalid = structuredClone(base)
      invalid.assemblies!.instances[0].finish = { finishCoverage }
      expect(() => parseProject(invalid)).toThrow(/finish coverage/)
    }
    const finished = updateAssemblyFinish(base, instance.id, { finishCoverage: 0.6 })
    finished.panels[0].finishCoverage = 0.5
    expect(() => parseProject(finished)).toThrow(/match their source/)
  })
})
