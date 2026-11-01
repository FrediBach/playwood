import { describe, expect, it } from 'vitest'
import { addCustomColor, ensureProjectPalette, getColorUsage, getProjectPalette, MAX_CUSTOM_COLORS, parseCustomColors, removeCustomColor, updateCustomColor } from './custom-colors'
import { COLORS, MATERIALS } from './materials'
import { createPanel, createStarterProject, parseProject } from './model'
import { createAssembly, duplicateAssembly, updateAssemblyFinish } from './assemblies'
import { gridProject } from './example-geometry'
import type { PaletteColor, Project } from './types'

const swatch = (color = '#123456', name = 'Ocean', id = 'ocean'): PaletteColor => ({ id, name, color })
const saved = (project: Project) => parseProject(JSON.parse(JSON.stringify(project)))
const withColor = (): Project => ({ ...createStarterProject('blank'), customColors: [swatch()] })

function coloredAssemblies() {
  const box = gridProject('Box', [350], [350])
  const colored = { ...box, panels: box.panels.map(panel => ({ ...panel, color: '#123456' })), connections: box.connections.map(connection => ({ ...connection, color: '#123456' })) }
  const assembly = createAssembly(colored, colored.panels.map(panel => panel.id))
  const first = assembly.assemblies!.instances[0]
  const duplicated = duplicateAssembly(assembly, first.id)
  const overridden = updateAssemblyFinish(duplicated, first.id, { color: '#654321', finishCoverage: 0.4 })
  return ensureProjectPalette({ ...overridden, panels: [...overridden.panels, createPanel({ color: '#123456', position: [5000, 400, 0] })] })
}

describe('named project panel palette', () => {
  it('includes preset and material finishes without changing old project geometry', () => {
    const project = createStarterProject()
    const palette = getProjectPalette(project)
    expect(new Set(palette.map(option => option.color)).size).toBe(palette.length)
    for (const material of MATERIALS) {
      expect(palette.some(option => option.color === material.color)).toBe(true)
      expect(palette.some(option => option.color === createPanel({ material: material.id }).color)).toBe(true)
    }
    expect(ensureProjectPalette(project)).toBe(project)
    expect(saved(project)).toEqual(project)
  })

  it('adds a named unused swatch without changing panels and keeps its ID through edits and round trips', () => {
    const original = createStarterProject()
    const added = addCustomColor(original, { name: '  Ocean  ', color: '#ABCDEF' })
    const color = added.customColors![0]
    expect(color).toEqual({ id: expect.any(String), name: 'Ocean', color: '#abcdef' })
    expect(added.panels).toBe(original.panels)
    expect(added.connections).toBe(original.connections)
    expect(original.customColors).toBeUndefined()
    const renamed = updateCustomColor(added, color.id, { name: 'Deep ocean' })
    expect(renamed.panels).toBe(added.panels)
    expect(renamed.customColors![0]).toEqual({ ...color, name: 'Deep ocean' })
    expect(added.customColors![0].name).toBe('Ocean')
    expect(saved(renamed)).toEqual(renamed)
    expect(updateCustomColor(renamed, color.id, { name: 'Deep ocean', color: '#ABCDEF' })).toBe(renamed)
    expect(removeCustomColor(renamed, color.id).customColors).toEqual([])
  })

  it('migrates old hex swatches with stable names and IDs, deduplicating presets and uppercase values', () => {
    const project = parseProject({ ...createStarterProject('blank'), customColors: ['#ABCDEF', '#abcdef', '#112233', COLORS[0].color.toUpperCase()] })
    expect(project.customColors).toEqual([
      { id: 'custom:#abcdef', name: 'Custom #abcdef', color: '#abcdef' },
      { id: 'custom:#112233', name: 'Custom #112233', color: '#112233' },
    ])
    expect(saved(project)).toEqual(project)
    expect(parseCustomColors(['#abcdef'])).toEqual(project.customColors!.slice(0, 1))
  })

  it.each([null, '#123456', {}, [null], [123456], ['red'], ['#123'], ['#12345678'], ['#gggggg'],
    [swatch('#123456', '')], [swatch('#123456', 'x'.repeat(61))], [swatch('#123456', 'Ocean', '')],
    [swatch('#123456', 'Ocean', 'stock:fake')], [swatch('#123456', 'Ocean', 'x'.repeat(121))],
    [swatch(), swatch('#654321', 'Other')], [swatch(), swatch('#123456', 'Duplicate', 'other')],
    [swatch(COLORS[0].color)], [swatch(), '#654321'], [swatch('red')],
  ])('rejects malformed imported palette %j', customColors => {
    expect(() => parseProject({ ...createStarterProject('blank'), customColors })).toThrow()
  })

  it('rejects duplicate colors and invalid edits without mutating the project', () => {
    const project = withColor(), original = structuredClone(project)
    expect(() => addCustomColor(project, { name: 'Other', color: '#123456' })).toThrow(/already in the palette/)
    expect(() => addCustomColor(project, { name: 'Preset', color: COLORS[0].color })).toThrow(/already in the palette/)
    expect(() => updateCustomColor(project, 'ocean', { color: COLORS[0].color })).toThrow(/already in the palette/)
    expect(() => updateCustomColor(project, 'ocean', { name: ' ' })).toThrow(/Color names/)
    expect(() => updateCustomColor(project, 'stock:#123456', { name: 'Changed' })).toThrow(/custom color/)
    expect(() => removeCustomColor(project, 'missing')).toThrow(/custom color/)
    expect(project).toEqual(original)
  })

  it('adopts old panel, hidden source, and instance override finishes, excluding connector-only colors', () => {
    const project = coloredAssemblies()
    expect(project.customColors?.map(option => option.color).sort()).toEqual(['#123456', '#654321'])
    expect(ensureProjectPalette(project)).toBe(project)
    const onlyOverride = updateAssemblyFinish(project, project.assemblies!.instances[1].id, { color: '#654321' })
    const withoutLoose = { ...onlyOverride, panels: onlyOverride.panels.filter(panel => panel.position[0] !== 5000), customColors: undefined }
    const adopted = ensureProjectPalette(withoutLoose)
    expect(getColorUsage(adopted, '#123456')).toMatchObject({ panelCount: 0, definitionPanelCount: 4, instanceCount: 0, inUse: true })
    expect(getColorUsage(adopted, '#654321')).toMatchObject({ panelCount: 8, instanceCount: 2, inUse: true })
    expect(saved(adopted)).toEqual(adopted)
    const stockProject = createStarterProject()
    const connectorOnly = { ...stockProject, connections: stockProject.connections.map(connection => ({ ...connection, color: '#010203' })) }
    expect(ensureProjectPalette(connectorOnly)).toBe(connectorOnly)
  })

  it('edits a color across panels and assembly sources/overrides while retaining connector finishes and immutable history', () => {
    const project = coloredAssemblies(), original = structuredClone(project)
    const source = project.customColors!.find(option => option.color === '#123456')!
    const override = project.customColors!.find(option => option.color === '#654321')!
    const changed = updateCustomColor(project, source.id, { name: 'Blue', color: '#ABCDEF' })
    expect(getColorUsage(changed, '#123456').inUse).toBe(false)
    expect(changed.assemblies!.definitions[0].panels.every(panel => panel.color === '#abcdef')).toBe(true)
    expect(changed.panels.filter(panel => panel.color === '#abcdef')).toHaveLength(5)
    expect(changed.panels.filter(panel => panel.color === '#654321')).toHaveLength(4)
    expect(changed.connections).toBe(project.connections)
    expect(changed.assemblies!.definitions[0].connections).toBe(project.assemblies!.definitions[0].connections)
    const updatedOverride = updateCustomColor(changed, override.id, { color: '#fedcba' })
    expect(updatedOverride.assemblies!.instances[0].finish).toEqual({ color: '#fedcba', finishCoverage: 0.4 })
    expect(updatedOverride.panels.filter(panel => panel.color === '#fedcba')).toHaveLength(4)
    expect(saved(updatedOverride)).toEqual(updatedOverride)
    expect(project).toEqual(original)
  })

  it('requires an existing replacement for used colors and removes every source reference before deletion', () => {
    const project = coloredAssemblies(), original = structuredClone(project)
    const color = project.customColors!.find(option => option.color === '#123456')!
    expect(() => removeCustomColor(project, color.id)).toThrow(/replacement/)
    expect(() => removeCustomColor(project, color.id, color.color)).toThrow(/remaining palette/)
    expect(() => removeCustomColor(project, color.id, '#010203')).toThrow(/remaining palette/)
    const removed = removeCustomColor(project, color.id, COLORS[1].color)
    expect(getColorUsage(removed, color.color).inUse).toBe(false)
    expect(removed.customColors!.some(option => option.id === color.id)).toBe(false)
    expect(removed.assemblies!.definitions[0].panels.every(panel => panel.color === COLORS[1].color)).toBe(true)
    expect(ensureProjectPalette(removed)).toBe(removed)
    expect(removed.connections).toBe(project.connections)
    expect(saved(removed)).toEqual(removed)
    expect(project).toEqual(original)
  })

  it('adopts more than the explicit-add limit and can still save, edit, and remove those colors', () => {
    const project: Project = { ...createStarterProject('blank'), panels: Array.from({ length: MAX_CUSTOM_COLORS + 1 }, (_, index) => createPanel({ color: `#${index.toString(16).padStart(6, '0')}` })) }
    const adopted = ensureProjectPalette(project)
    expect(adopted.customColors).toHaveLength(MAX_CUSTOM_COLORS + 1)
    expect(saved(adopted)).toEqual(adopted)
    expect(() => addCustomColor(adopted, { name: 'More', color: '#abcdef' })).toThrow(/100 custom colors/)
    const renamed = updateCustomColor(adopted, adopted.customColors![0].id, { name: 'Ink' })
    expect(renamed.customColors![0].name).toBe('Ink')
    expect(removeCustomColor(renamed, renamed.customColors![0].id, COLORS[0].color).customColors).toHaveLength(MAX_CUSTOM_COLORS)
  })
})
