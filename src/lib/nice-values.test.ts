import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createAssembly, getAssemblyAttachmentTargets, updateAssemblyParameterValues } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { gridProject } from './example-geometry'
import { createPanel, createStarterProject, duplicatePanel, getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { DEFAULT_NICE_VALUES, getNiceValueStep, roundNiceValue, roundPanelDraft } from './nice-values'
import { getRescaleValues, rescaleProject } from './project-rescale'
import type { Project } from './types'

const niceValues = { enabled: true, step: 10 }
const singlePanel = (patch: Parameters<typeof createPanel>[0] = {}): Project => ({
  version: 1, name: 'Nice cuts', panels: [createPanel({ width: 112, height: 158, ...patch })], connections: [],
})

describe('nice measurement rounding', () => {
  it('rounds either way to the closest multiple, including exact ties and decimal steps', () => {
    expect(roundNiceValue(8, 10)).toBe(10)
    expect(roundNiceValue(112, 10)).toBe(110)
    expect(roundNiceValue(115, 10)).toBe(120)
    expect(roundNiceValue(-112, 10)).toBe(-110)
    expect(roundNiceValue(112, 5)).toBe(110)
    expect(roundNiceValue(114, 2.5)).toBe(115)
    expect(roundNiceValue(3.6, 1.2)).toBe(3.6)
    expect(roundNiceValue(110, 10)).toBe(110)
  })

  it('chooses a legal multiple at bounds and rejects ranges containing none', () => {
    expect(roundNiceValue(8, 10, 3, 100)).toBe(10)
    expect(roundNiceValue(41, 25, 40, 4000)).toBe(50)
    expect(roundNiceValue(97, 10, 0, 97)).toBe(90)
    expect(() => roundNiceValue(18, 10, 16, 19)).toThrow(/No multiple/)
    for (const step of [0, -10, Infinity, NaN]) expect(() => roundNiceValue(100, step)).toThrow()
    expect(() => roundNiceValue(Infinity, 10)).toThrow()
  })

  it('leaves legacy and disabled projects unrounded', () => {
    expect(getNiceValueStep()).toBeUndefined()
    expect(getNiceValueStep(DEFAULT_NICE_VALUES)).toBeUndefined()
    expect(getNiceValueStep(niceValues)).toBe(10)
    const project = singlePanel()
    expect(parseProject(project).niceValues).toBeUndefined()
    expect(rescaleProject(project, {})).toBe(project)
  })

  it('prepares new panel defaults and perforations together before attachment', () => {
    const panel = createPanel({ width: 600, height: 360, pattern: 'slots', holeSize: 24, holeSpacing: 31, cornerRadius: 179 })
    const original = structuredClone(panel)
    const draft = roundPanelDraft(panel, { enabled: true, step: 25 })
    expect(draft).toMatchObject({ width: 600, height: 350, cornerRadius: 175, holeSize: 25, holeSpacing: 50, thickness: 18 })
    expect(panel).toEqual(original)
    expect(roundPanelDraft(panel)).toBe(panel)
    expect(roundPanelDraft(draft, { enabled: true, step: 25 })).toBe(draft)
    expect(() => parseProject(singlePanel(draft))).not.toThrow()
  })
})

describe('enabling nice values', () => {
  it('rounds unique sizes and active surface details without changing thickness or identities', () => {
    const project = singlePanel({ width: 112, height: 158, cornerRadius: 8, pattern: 'pegboard', holeSize: 12, holeSpacing: 48 })
    const original = structuredClone(project)
    expect(getRescaleValues(project)).toEqual([])
    const next = rescaleProject(project, {}, niceValues)
    expect(next.niceValues).toEqual(niceValues)
    expect(next.panels[0]).toMatchObject({ id: project.panels[0].id, width: 110, height: 160, cornerRadius: 10, holeSize: 10, holeSpacing: 50, thickness: 18 })
    expect(project).toEqual(original)
    expect(validateProject(next)).toEqual([])
    expect(parseProject(next)).toEqual(next)
  })

  it('includes hidden panels and keeps inactive surface defaults untouched', () => {
    const project = singlePanel({ visible: false })
    const next = rescaleProject(project, {}, niceValues)
    expect(next.panels[0]).toMatchObject({ width: 110, height: 160, visible: false, holeSize: 12, holeSpacing: 48 })
    expect(duplicatePanel(next, next.panels[0].id).niceValues).toEqual(niceValues)
  })

  it('fits rounded surface details to the rounded cuts and retains material between openings', () => {
    const project = singlePanel({ width: 99, height: 360, cornerRadius: 49, pattern: 'slots', holeSize: 24, holeSpacing: 31 })
    const next = rescaleProject(project, {}, { enabled: true, step: 25 })
    expect(next.panels[0]).toMatchObject({ width: 100, height: 350, cornerRadius: 50, holeSize: 25, holeSpacing: 50 })
    expect(validateProject(next)).toEqual([])
    expect(parseProject(next)).toEqual(next)
  })

  it('applies a user replacement before rounding its target without cascading through another measurement', () => {
    const project: Project = { version: 1, name: 'Multiple cuts', connections: [], panels: [
      createPanel({ width: 112, height: 112 }), createPanel({ width: 158, height: 158, position: [1000, 1000, 0] }),
    ] }
    const next = rescaleProject(project, { 'dimension:112': 158 }, niceValues)
    expect(next.panels.map(panel => panel.width)).toEqual([160, 160])
  })

  it('retains joints, stock thickness, fixed hardware, and grounding on the connected shelf', () => {
    const project = rescaleProject(createStarterProject(), { 'dimension:1100': 1102, 'dimension:360': 362 })
    const next = rescaleProject(project, {}, niceValues)
    expect(next.panels.every(panel => Math.abs(panel.width / 10 - Math.round(panel.width / 10)) < 1e-6
      && Math.abs(panel.height / 10 - Math.round(panel.height / 10)) < 1e-6)).toBe(true)
    expect(next.panels.map(panel => panel.thickness)).toEqual(project.panels.map(panel => panel.thickness))
    expect(next.connections.map(connection => [connection.id, connection.type, connection.count]))
      .toEqual(project.connections.map(connection => [connection.id, connection.type, connection.count]))
    expect(getProjectBounds(resolvePanels(next)).min[1]).toBeCloseTo(getProjectBounds(resolvePanels(project)).min[1])
    expect(validateProject(next)).toEqual([])
    expect(parseProject(next)).toEqual(next)
  })

  it('updates linked assembly sources and preserves links and instance controls after reload', () => {
    const plain = gridProject('Module', [353], [353], { depth: 353 })
    const base = createAssembly(plain, plain.panels.map(panel => panel.id), 'Module', [{
      id: 'side', name: 'Side', defaultValue: 353,
      bindings: plain.panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({ panelId: panel.id, dimension, scale: 1, offset: 0 }))),
    }])
    const project = getAssemblyAttachmentTargets(base, base.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const next = rescaleProject(project, {}, niceValues)
    expect(next.panels.every(panel => panel.width === 350 && panel.height === 350)).toBe(true)
    expect(next.assemblies!.links).toEqual(project.assemblies!.links)
    expect(next.assemblies!.definitions[0].parameters![0].defaultValue).toBe(350)
    expect(validateProject(next)).toEqual([])
    expect(parseProject(next)).toEqual(next)
    expect(() => updateAssemblyParameterValues(next, next.assemblies!.instances[0].id, { side: 370 })).not.toThrow()
    const exported = createAssemblyFile(next, next.assemblies!.instances[0].id)
    expect(exported).not.toHaveProperty('niceValues')
    expect(parseAssemblyFile(exported).panels.every(panel => panel.width === 350 && panel.height === 350)).toBe(true)
  })

  it('rejects conflicting saved measurements without enabling or partially rescaling', () => {
    const project = singlePanel()
    project.constraints = [{ id: 'width', kind: 'dimension', panelId: project.panels[0].id, dimension: 'width', value: 112, enabled: true }]
    const original = structuredClone(project)
    expect(() => rescaleProject(project, {}, niceValues)).toThrow()
    expect(project).toEqual(original)
    expect(project.niceValues).toBeUndefined()
  })

  it('rerounds on step changes, disables without resizing, and preserves exact no-ops', () => {
    const enabled = rescaleProject(singlePanel(), {}, { enabled: true, step: 5 })
    expect(enabled.panels[0].width).toBe(110)
    const changed = rescaleProject(enabled, {}, { enabled: true, step: 25 })
    expect(changed.panels[0].width).toBe(100)
    expect(changed.panels[0].height).toBe(150)
    expect(rescaleProject(changed, {}, { enabled: true, step: 25 })).toBe(changed)
    const disabled = rescaleProject(changed, {}, { enabled: false, step: 25 })
    expect(disabled.panels).toBe(changed.panels)
    expect(disabled.niceValues).toEqual({ enabled: false, step: 25 })
    expect(rescaleProject(createStarterProject('blank'), {}, niceValues).niceValues).toEqual(niceValues)
  })

  it('rounds later manual rescale targets while retaining exact stock thickness', () => {
    const project = rescaleProject(createStarterProject(), {}, niceValues)
    const next = rescaleProject(project, { 'dimension:360': 372, 'thickness:18': 19 })
    expect(next.panels.every(panel => panel.height === 370 && panel.thickness === 19)).toBe(true)
    expect(next.niceValues).toEqual(niceValues)
  })
})

describe('nice-value project compatibility', () => {
  it('round-trips enabled and disabled settings without rounding derived geometry on load', () => {
    for (const enabled of [false, true]) {
      const project = { ...singlePanel(), niceValues: { enabled, step: 2.5 } }
      expect(roundTripProject(project)).toEqual(project)
    }
  })

  it('rejects malformed settings rather than silently enabling a different step', () => {
    const project = singlePanel()
    for (const invalid of [null, [], true, {}, { enabled: 'true', step: 10 }, { enabled: true },
      { enabled: true, step: '10' }, ...[0, -1, 101, Infinity, NaN].map(step => ({ enabled: true, step }))]) {
      expect(() => parseProject({ ...project, niceValues: invalid })).toThrow(/Nice values/)
    }
    expect(() => rescaleProject(project, {}, { enabled: true, step: 0 })).toThrow(/Nice values/)
  })
})
