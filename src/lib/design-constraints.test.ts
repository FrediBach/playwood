import { describe, expect, it } from 'vitest'
import { copyDesignConstraints, designConstraintCoordinate, designConstraintLimits, describeDesignConstraintRequirement, evaluateDesignConstraints, measureDesignConstraint } from './design-constraints'
import { createPanel, duplicatePanel, moveProject, parseProject, removePanel, resolvePanels, rotateProject, validateProject } from './model'
import { copySelection, getPasteTargets } from './clipboard'
import { createAssembly, disassembleAssembly, duplicateAssembly, makeAssemblyIndependent, moveAssemblies, removeAssembly, updateAssemblyParameterValues } from './assemblies'
import { createAssemblyFile, parseAssemblyFile } from './assembly-file'
import { createExampleProject } from './example-library'
import { reconcileAssemblyPlacement } from './assembly-placement'
import type { DesignConstraint, Project } from './types'

const project = (): Project => ({ version: 1, name: 'Rules', panels: [
  createPanel({ id: 'a', name: 'Lower shelf', width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [0, 791, 0] }),
  createPanel({ id: 'b', name: 'Upper shelf', width: 600, height: 300, thickness: 18, rotation: [-Math.PI / 2, 0, 0], position: [0, 1009, 0], visible: false }),
], connections: [] })
const floor: DesignConstraint = { id: 'floor', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', value: 800 }
const dimension: DesignConstraint = { id: 'width', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', value: 600 }
const equal: DesignConstraint = { id: 'same-height', enabled: true, kind: 'equal-dimension', panelIds: ['a', 'b'], dimension: 'height' }
const gap: DesignConstraint = { id: 'gap', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'minimum', value: 200 }

describe('design rule measurements', () => {
  it('measures real world surfaces including thickness, hidden panels and a 90 degree turn', () => {
    const source = project()
    expect(designConstraintCoordinate(source.panels[0], 'min')).toBeCloseTo(782)
    expect(evaluateDesignConstraints([floor, dimension, equal, gap], source.panels).map(result => result.violation)).toEqual([0, 0, 0, 0])
    expect(measureDesignConstraint(gap, source.panels).actual).toBeCloseTo(200)
    const lowered = source.panels.map(panel => panel.id === 'b' ? { ...panel, position: [0, 999, 0] as [number, number, number] } : panel)
    expect(measureDesignConstraint(gap, lowered).violation).toBeCloseTo(10)
    expect(measureDesignConstraint({ ...gap, panelIds: ['b', 'a'] }, source.panels).actual).toBeCloseTo(-236)
  })

  it('distinguishes exact from minimum gaps, and elevation from local cut height', () => {
    const source = project()
    expect(measureDesignConstraint({ ...gap, value: 180 }, source.panels).violation).toBe(0)
    expect(measureDesignConstraint({ ...gap, relation: 'exact', value: 180 }, source.panels).violation).toBeCloseTo(20)
    const level: DesignConstraint = { id: 'level', enabled: true, kind: 'level', panelIds: ['a', 'b'], references: ['max', 'max'] }
    expect(measureDesignConstraint(equal, source.panels).violation).toBe(0)
    expect(measureDesignConstraint(level, source.panels).violation).toBeCloseTo(218)
    expect(measureDesignConstraint({ ...floor, value: 800.05 }, source.panels).violation).toBe(0)
  })

  it.each([floor, dimension, gap])('measures minimum, maximum and both limits for $kind', rule => {
    const panels = project().panels
    const actual = measureDesignConstraint(rule, panels).actual
    const { value: originalValue, ...identity } = rule
    expect(originalValue).toBe(actual)
    const minimum = { ...identity, relation: 'minimum', value: actual - 20 } as DesignConstraint
    const maximum = { ...identity, relation: 'maximum', value: actual + 20 } as DesignConstraint
    const range = { ...identity, relation: 'range', min: actual - 20, max: actual + 20 } as DesignConstraint
    expect(evaluateDesignConstraints([minimum, maximum, range], panels).map(row => row.violation)).toEqual([0, 0, 0])
    expect(measureDesignConstraint({ ...minimum, value: actual + 20 } as DesignConstraint, panels)).toMatchObject({ target: actual + 20, violation: 20 })
    expect(measureDesignConstraint({ ...maximum, value: actual - 20 } as DesignConstraint, panels)).toMatchObject({ target: actual - 20, violation: 20 })
    expect(measureDesignConstraint({ ...range, min: actual + 20, max: actual + 30 } as DesignConstraint, panels)).toMatchObject({ target: actual + 20, violation: 20 })
    expect(measureDesignConstraint({ ...range, min: actual - 30, max: actual - 20 } as DesignConstraint, panels)).toMatchObject({ target: actual - 20, violation: 20 })
    expect(measureDesignConstraint({ ...range, min: actual, max: actual } as DesignConstraint, panels).violation).toBe(0)
    expect(measureDesignConstraint({ ...minimum, value: actual + .05 } as DesignConstraint, panels).violation).toBe(0)
    expect(measureDesignConstraint({ ...maximum, value: actual - .05 } as DesignConstraint, panels).violation).toBe(0)
  })

  it('describes each bound without presenting slack as an exact target', () => {
    expect(designConstraintLimits(floor)).toEqual({ min: 800, max: 800 })
    expect(designConstraintLimits(equal)).toEqual({ min: 0, max: 0 })
    expect(describeDesignConstraintRequirement(floor)).toBe('exactly 800 mm')
    expect(describeDesignConstraintRequirement(gap)).toBe('at least 200 mm')
    expect(describeDesignConstraintRequirement({ ...gap, relation: 'maximum' })).toBe('at most 200 mm')
    const range: DesignConstraint = { id: 'range', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', relation: 'range', min: 500, max: 700 }
    expect(describeDesignConstraintRequirement(range)).toBe('between 500 mm and 700 mm')
    expect(measureDesignConstraint(range, project().panels)).toMatchObject({ actual: 600, target: 600, violation: 0 })
  })

  it('explains unsupported geometry while retaining local dimension rules', () => {
    const tilted = project().panels.map(panel => ({ ...panel, rotation: [0, 0, Math.PI / 4] as [number, number, number] }))
    expect(measureDesignConstraint(floor, tilted).issue).toContain('world axes')
    expect(measureDesignConstraint(dimension, tilted).violation).toBe(0)
    const outlined = project().panels.map(panel => ({ ...panel, customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }))
    expect(measureDesignConstraint(gap, outlined).issue).toContain('rectangular outline')
    expect(measureDesignConstraint(equal, outlined).violation).toBe(0)
  })
})

describe('design rule persistence', () => {
  it('retains legacy projects and round-trips every rule kind without storing measurements', () => {
    const original = project()
    expect(parseProject(JSON.parse(JSON.stringify(original)))).toEqual(original)
    const source = { ...original, constraints: [floor, dimension, equal, gap, { id: 'level', kind: 'level', enabled: false, panelIds: ['a', 'b'], references: ['min', 'max'] } as DesignConstraint] }
    expect(parseProject(JSON.parse(JSON.stringify(source)))).toEqual(source)
    expect(parseProject({ ...original, constraints: [] }).constraints).toEqual([])
  })

  it('accepts valid unsatisfied requirements for review and only reports enabled rules', () => {
    const source = parseProject({ ...project(), constraints: [{ ...floor, value: 900 }, { ...gap, enabled: false, value: 500 }] })
    const issues = validateProject(source).filter(issue => issue.id.startsWith('constraint-'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ id: 'constraint-floor', panelIds: ['a'], severity: 'error' })
    expect(issues[0].message).toContain('800 mm')
    expect(source.panels).toEqual(project().panels)
  })

  it('round-trips all numeric requirement modes while retaining legacy exact rules', () => {
    const constraints: DesignConstraint[] = [floor, dimension, gap,
      { ...floor, id: 'floor-min', relation: 'minimum', value: 700 },
      { ...floor, id: 'floor-max', relation: 'maximum', value: 900 },
      { id: 'floor-range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 700, max: 900 },
      { ...dimension, id: 'width-exact', relation: 'exact' },
      { ...dimension, id: 'width-min', relation: 'minimum', value: 500 },
      { ...dimension, id: 'width-max', relation: 'maximum', value: 700 },
      { id: 'width-range', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', relation: 'range', min: 500, max: 700 },
      { ...gap, id: 'gap-max', relation: 'maximum', value: 300 },
      { id: 'gap-range', enabled: false, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 100, max: 300 },
    ]
    const source = { ...project(), constraints }
    const parsed = parseProject(JSON.parse(JSON.stringify(source)))
    expect(parsed).toEqual(source)
    expect(parsed.constraints![0]).not.toHaveProperty('relation')
    expect(parsed.constraints![1]).not.toHaveProperty('relation')
    expect(parsed.panels).toEqual(source.panels)
  })

  it('accepts inclusive equal endpoints as a range and keeps disabled range settings', () => {
    const range = { id: 'range', enabled: false, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 800, max: 800 }
    const source = parseProject({ ...project(), constraints: [range] })
    expect(source.constraints).toEqual([range])
    expect(validateProject(source).filter(issue => issue.id.startsWith('constraint-'))).toEqual([])
  })

  it.each([
    [{ ...floor, panelId: 'missing' }], [floor, floor], [{ ...floor, enabled: 'yes' }], [{ ...floor, value: Infinity }],
    [{ ...floor, reference: 'left' }], [{ ...gap, panelIds: ['a', 'a'] }], [{ ...gap, axis: 'w' }],
    [{ ...gap, relation: 'approximately' }], [{ ...equal, dimension: 'thickness' }], [{ ...floor, kind: 'future-kind' }],
    [{ ...floor, relation: 'approximately' }], [{ ...floor, relation: 'range', min: 700, max: 900 }],
    [{ ...gap, relation: undefined }], [{ ...dimension, relation: 'maximum', value: 4001 }],
    [{ ...floor, min: 700 }], [{ ...dimension, relation: 'maximum', max: 800 }],
    [{ id: 'range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 900, max: 800 }],
    [{ id: 'range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 700 }],
    [{ id: 'range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: -1, max: 800 }],
    [{ id: 'range', enabled: true, kind: 'floor', panelId: 'a', reference: 'max', relation: 'range', min: 700, max: 100001 }],
    [{ id: 'range', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', relation: 'range', min: 39, max: 600 }],
    [{ id: 'range', enabled: true, kind: 'dimension', panelId: 'a', dimension: 'width', relation: 'range', min: 600, max: Infinity }],
    [{ id: 'range', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 100, max: '200' }],
    [{ id: 'range', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 100, max: 200001 }],
    [{ ...equal, relation: 'maximum', value: 200 }],
  ].map(constraints => ({ constraints })))('rejects malformed or dangling serialized rules $constraints', ({ constraints }) => {
    expect(() => parseProject({ ...project(), constraints })).toThrow()
  })
})

describe('design rule lifecycle', () => {
  it('removes incident rules with deleted panels, retaining immutable history snapshots', () => {
    const source = { ...project(), constraints: [floor, dimension, equal, gap] }
    const before = structuredClone(source)
    const next = removePanel(source, 'a')
    expect(next.constraints).toEqual([])
    expect(source).toEqual(before)
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
  })

  it('keeps floor references fixed during whole-project moves and rejects unsupported rotations', () => {
    const source = { ...project(), constraints: [floor] }
    expect(moveProject(source, [100, 0, 0]).panels[0].position[0]).toBe(100)
    expect(() => moveProject(source, [0, 100, 0])).toThrow('above floor')
    expect(() => rotateProject(source, 'z', 45)).toThrow('world axes')
    expect(source.panels[0].position).toEqual([0, 791, 0])
  })

  it('duplicates dimensions and wholly copied relations with fresh IDs, excluding floor and external rules', () => {
    const source = { ...project(), constraints: [floor, dimension, equal, gap] }
    const next = duplicatePanel(source, 'a')
    expect(next.constraints).toHaveLength(5)
    expect(next.constraints!.at(-1)).toMatchObject({ kind: 'dimension', panelId: next.panels.at(-1)!.id })
    expect(next.constraints!.at(-1)!.id).not.toBe(dimension.id)
    const rules = copyDesignConstraints(source.constraints, new Map([['a', 'copy-a'], ['b', 'copy-b']]))
    expect(rules.map(rule => rule.kind)).toEqual(['dimension', 'equal-dimension', 'gap'])
    expect(rules[2]).toMatchObject({ panelIds: ['copy-a', 'copy-b'], axis: 'y' })
  })

  it('copies both endpoints without changing range semantics or the source', () => {
    const range: DesignConstraint = { id: 'range', enabled: true, kind: 'gap', panelIds: ['a', 'b'], axis: 'y', relation: 'range', min: 180, max: 240 }
    const source = structuredClone(range)
    const copied = copyDesignConstraints([range], new Map([['a', 'copy-a'], ['b', 'copy-b']]))
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatchObject({ kind: 'gap', relation: 'range', min: 180, max: 240, panelIds: ['copy-a', 'copy-b'] })
    expect(copied[0].id).not.toBe(range.id)
    expect(range).toEqual(source)
    expect(copyDesignConstraints([range], new Map([['a', 'copy-a']]))).toEqual([])
  })

  it('snapshots dimension rules in the clipboard and remaps a pasted panel', () => {
    const source = { ...project(), constraints: [floor, dimension, equal] }
    const copied = copySelection(source, ['a'])
    source.constraints[1] = { ...dimension, value: 700 }
    const target = { ...project(), panels: [createPanel({ id: 'target', width: 600, height: 600, position: [0, 1000, 0] })] }
    const candidate = getPasteTargets(target, ['target'], copied).find(candidate => candidate.project)?.project
    expect(candidate).toBeDefined()
    expect(candidate!.constraints).toHaveLength(1)
    expect(candidate!.constraints![0]).toMatchObject({ kind: 'dimension', value: 600, panelId: candidate!.panels.at(-1)!.id })
    expect(parseProject(JSON.parse(JSON.stringify(candidate)))).toEqual(candidate)
  })

  it('preserves rules through assembly independence and disassembly, and removes them on deletion', () => {
    const initial = createExampleProject('cube')
    const base = createAssembly(initial, initial.panels.map(panel => panel.id), 'Box')
    const instance = base.assemblies!.instances[0], panelId = Object.values(instance.panelIds)[0]
    const panel = base.panels.find(panel => panel.id === panelId)!
    const source: Project = { ...base, constraints: [{ ...dimension, panelId, value: panel.width }] }
    const independent = makeAssemblyIndependent(source, instance.id)
    expect(independent.constraints).toEqual(source.constraints)
    expect(disassembleAssembly(independent, instance.id).constraints).toEqual(source.constraints)
    expect(removeAssembly(source, instance.id).constraints).toEqual([])
    const duplicate = duplicateAssembly(source, instance.id)
    expect(duplicate.constraints).toHaveLength(2)
    expect(duplicate.constraints![1]).toMatchObject({ panelId: Object.values(duplicate.assemblies!.instances[1].panelIds)[0] })
    expect(parseProject(JSON.parse(JSON.stringify(duplicate)))).toEqual(duplicate)
    const file = createAssemblyFile(source, instance.id)
    expect(file.definition).not.toHaveProperty('constraints')
    expect(parseAssemblyFile(file)).not.toHaveProperty('constraints')
  })

  it('rejects shared-panel merges that would lose or reinterpret rule references', () => {
    const source = project()
    const duplicate = { ...source.panels[0], id: 'copy', rotation: [Math.PI / 2, 0, 0] as [number, number, number] }
    const next: Project = { ...source, panels: [...source.panels, duplicate], constraints: [{ ...dimension, panelId: 'copy' }] }
    expect(() => reconcileAssemblyPlacement(next, ['copy'])).toThrow('merge panels referenced by a design rule')
    expect(next.panels).toHaveLength(3)
    expect(resolvePanels(next).at(-1)!.id).toBe('copy')
  })

  it('validates configured instance geometry and does not worsen imported violations with stable IDs', () => {
    const base = createExampleProject('assembly-wide-box'), instance = base.assemblies!.instances[0]
    const panel = base.panels.find(panel => panel.name.startsWith('Shelf'))!
    const source: Project = { ...base, constraints: [{ ...dimension, panelId: panel.id, value: panel.width }] }
    const before = structuredClone(source)
    expect(() => updateAssemblyParameterValues(source, instance.id, { width: panel.width + 100 })).toThrow('width')
    expect(source).toEqual(before)
    const violated: Project = { ...base, constraints: [{ ...dimension, panelId: panel.id, value: panel.width + 100 }] }
    expect(() => updateAssemblyParameterValues(violated, instance.id, { width: panel.width - 100 })).toThrow('width')
    expect(updateAssemblyParameterValues(violated, instance.id, { width: panel.width + 50 }).panels.find(item => item.id === panel.id)!.width).toBe(panel.width + 50)
    const grounded: Project = { ...base, constraints: [{ ...floor, panelId: panel.id, value: designConstraintCoordinate(panel, 'max') }] }
    expect(() => moveAssemblies(grounded, [instance.id], [0, 10, 0])).toThrow('above floor')
  })
})
