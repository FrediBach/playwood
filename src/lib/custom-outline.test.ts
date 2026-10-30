import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, duplicatePanel, parseProject, projectToCsv, resolvePanels, rotateProject, validateProject } from './model'
import { createAssembly, duplicateAssembly, updateAssemblyDefinition } from './assemblies'
import { getSharedPanelFields, updateSelectedPanels } from './selection'
import { resizePanels } from './structure-edit'
import { copySelection } from './clipboard'
import { autoConnect } from './auto-connect'
import { findPanelHoles } from './close-holes'
import { gridProject } from './example-geometry'
import { parallelPanelCut, splitParallelPanels } from './parallel-panels'
import type { OutlinePoint, Project } from './types'

const outline: OutlinePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.6 }, { x: 0.6, y: 1 }, { x: 0, y: 1 }]
const project = (): Project => ({ version: 1, name: 'Outline study', connections: [], panels: [createPanel({ id: 'panel', width: 600, height: 400, customOutline: outline })] })

describe('custom outline project data', () => {
  it('round trips outlines without changing legacy panels', () => {
    const original = project()
    expect(parseProject(JSON.parse(JSON.stringify(original)))).toEqual(original)
    const loaded = parseProject(original)
    expect(loaded.panels[0].customOutline).toEqual(outline)
    expect(loaded.panels[0].customOutline).not.toBe(original.panels[0].customOutline)
    expect(parseProject({ ...original, panels: [createPanel()] }).panels[0].customOutline).toBeUndefined()
  })

  it.each([
    null, [], [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1.1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }],
  ])('rejects invalid outline input: %j', customOutline => {
    const original = project()
    expect(() => parseProject({ ...original, panels: [{ ...original.panels[0], customOutline }] })).toThrow(/outline/i)
  })

  it('preserves normalized coordinates through resizing, rotation, duplication and copying', () => {
    const original = project()
    const resized = resizePanels(original, ['panel'], { width: 1200, height: 600 })
    expect(resized.panels[0].customOutline).toEqual(outline)
    expect([resized.panels[0].width, resized.panels[0].height]).toEqual([1200, 600])
    const rotated = rotateProject(resized, 'z', 45)
    expect(rotated.panels[0].customOutline).toEqual(outline)
    const duplicated = duplicatePanel(rotated, 'panel')
    expect(duplicated.panels[1].customOutline).toEqual(outline)
    expect(duplicated.panels[1].customOutline).not.toBe(rotated.panels[0].customOutline)
    const copied = copySelection(duplicated, ['panel'])
    expect(copied.kind).toBe('panel')
    if (copied.kind === 'panel') expect(copied.panel.customOutline).toEqual(outline)
    expect(original.panels[0].width).toBe(600)
  })

  it('edits and removes outlines explicitly and compares cloned shared coordinates', () => {
    const original = project()
    const two = { ...original, panels: [original.panels[0], createPanel({ id: 'other', position: [2000, 400, 0], customOutline: structuredClone(outline) })] }
    expect(getSharedPanelFields(two.panels).has('customOutline')).toBe(true)
    const removed = updateSelectedPanels(two, ['panel', 'other'], { customOutline: undefined })
    expect(removed.panels.every(panel => panel.customOutline === undefined)).toBe(true)
    const edited = updateSelectedPanels(removed, ['panel'], { customOutline: outline })
    expect(edited.panels[0].customOutline).toEqual(outline)
    expect(edited.panels[1].customOutline).toBeUndefined()
    expect(getSharedPanelFields(edited.panels).has('customOutline')).toBe(false)
    expect(updateSelectedPanels(edited, ['panel'], { customOutline: structuredClone(outline) })).toBe(edited)
  })

  it('exports dimensioned vertices from the top left with rounding specified separately', () => {
    const original = project()
    original.panels[0].cornerRadius = 20
    const csv = projectToCsv(original)
    expect(csv).toContain('Custom outline points (mm, x/y from top left)')
    expect(csv).toContain('0/0; 600/0; 600/240; 360/400; 0/400')
    expect(csv).toContain('"20"')
  })

  it('updates linked assembly sources and removes their outlines without stale materialized shapes', () => {
    let assembled = gridProject('Box', [350], [350], { depth: 350 })
    assembled = createAssembly(assembled, assembled.panels.map(panel => panel.id), 'Box')
    const instance = assembled.assemblies!.instances[0]
    assembled = duplicateAssembly(assembled, instance.id)
    const definitionPanelId = Object.keys(instance.panelIds)[0]
    const edited = updateAssemblyDefinition(assembled, instance.id, { customOutline: outline }, [definitionPanelId])
    const affected = edited.assemblies!.instances.map(item => item.panelIds[definitionPanelId])
    expect(edited.panels.filter(panel => affected.includes(panel.id)).every(panel => JSON.stringify(panel.customOutline) === JSON.stringify(outline))).toBe(true)
    expect(parseProject(JSON.parse(JSON.stringify(edited)))).toEqual(edited)
    const tampered = structuredClone(edited)
    delete tampered.panels.find(panel => panel.id === affected[0])!.customOutline
    expect(() => parseProject(tampered)).toThrow('match their source')
    const removed = updateAssemblyDefinition(edited, instance.id, { customOutline: undefined }, [definitionPanelId])
    expect(removed.panels.every(panel => panel.customOutline === undefined)).toBe(true)
    expect(parseProject(JSON.parse(JSON.stringify(removed)))).toEqual(removed)
  })

  it('keeps custom shapes intact instead of applying rectangular stock splitting', () => {
    const original = project()
    original.panels.push(createPanel({ ...original.panels[0], id: 'other', position: [0, 400, 400] }))
    expect(parallelPanelCut(original.panels)).toBeUndefined()
    expect(() => splitParallelPanels(original, original.panels.map(panel => panel.id))).toThrow('custom outlines')
    const parent = createPanel({ width: 300, height: 300, position: [0, 500, 0] })
    const connected = attachPanel({ version: 1, name: 'T joint', panels: [parent], connections: [] }, parent.id, createPanel({ width: 300, height: 300 }), { side: 'top', type: 't', flip: false, offset: 0, inset: 0, color: '#e86536', count: 2 })
    const [left, divider, right] = resolvePanels(connected)
    const shelf = { ...left, customOutline: outline, height: left.height + right.height + 35, position: left.position.map((value, i) => (value + right.position[i]) / 2) as [number, number, number] }
    const continuous = { ...connected, panels: [shelf, divider], connections: [] }
    const result = autoConnect(continuous)
    expect(result.splits).toBe(0)
    expect(result.project.panels).toEqual(continuous.panels)
  })

  it('starts rectangular closing panels without inheriting a surrounding outline', () => {
    const box = gridProject('Box', [350], [350])
    box.panels = box.panels.map(panel => ({ ...panel, customOutline: outline }))
    const holes = findPanelHoles(resolvePanels(box))
    expect(holes.length).toBeGreaterThan(0)
    expect(holes.every(hole => hole.panel.customOutline === undefined)).toBe(true)
    expect(validateProject(project())).toEqual([])
  })
})
