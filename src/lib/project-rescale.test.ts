import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { workstationProject } from './platform-examples'
import { createAssembly, getAssemblyAttachmentTargets, updateAssemblyParameterValues } from './assemblies'
import { gridProject } from './example-geometry'
import type { Project } from './types'

const valid = (project: Project) => {
  expect(validateProject(project)).toEqual([])
  expect(() => roundTripProject(project)).not.toThrow()
}
const change = (project: Project, value: number, target: number, kind = 'dimension') => {
  const entry = getRescaleValues(project).find(item => item.kind === kind && item.value === value)!
  expect(entry).toBeDefined()
  return rescaleProject(project, { [entry.id]: target })
}

describe('project repeated values', () => {
  it('groups matching local axes, includes hidden panels, and omits unused pattern settings', () => {
    const project: Project = { version: 1, name: 'Cuts', connections: [], panels: [
      createPanel({ width: 600, height: 360 }),
      createPanel({ width: 360, height: 420, visible: false, position: [2000, 0, 0] }),
    ] }
    const values = getRescaleValues(project)
    expect(values.map(({ kind, value, count }) => ({ kind, value, count }))).toEqual([
      { kind: 'dimension', value: 360, count: 2 }, { kind: 'thickness', value: 18, count: 2 },
    ])
    const next = change(project, 360, 450)
    expect(next.panels.map(panel => [panel.width, panel.height])).toEqual([[600, 450], [450, 420]])
    expect(next.panels[1].visible).toBe(false)
  })

  it('intersects thickness limits with the existing hardware', () => {
    expect(getRescaleValues(createStarterProject()).find(value => value.kind === 'thickness')).toMatchObject({ min: 18, max: 19 })
    const loose: Project = { version: 1, name: 'Loose', connections: [], panels: [createPanel(), createPanel({ position: [2000, 0, 0] })] }
    expect(getRescaleValues(loose).find(value => value.kind === 'thickness')).toMatchObject({ min: 3, max: 100 })
  })

  it('matches solver roundoff without merging distinct dimensions', () => {
    const project: Project = { version: 1, name: 'Cuts', connections: [], panels: [
      createPanel({ width: 360.00000001, height: 500 }), createPanel({ width: 360, height: 500.001 }),
    ] }
    expect(getRescaleValues(project).filter(value => value.kind === 'dimension')).toMatchObject([{ value: 360, count: 2 }])
  })
})

describe('smart project rescaling', () => {
  it('changes all repeated cuts simultaneously and keeps the floor, joints, IDs and metadata', () => {
    const project = createStarterProject(), before = structuredClone(project)
    project.customColors = [{ id: 'finish', name: 'My finish', color: '#123456' }]
    project.listGroups = [{ id: 'cuts', kind: 'panels', name: 'Cuts', itemIds: project.panels.map(panel => panel.id) }]
    const next = rescaleProject(project, { 'dimension:1100': 1250, 'dimension:360': 420 })
    for (const panel of next.panels) {
      expect(panel.height).toBeCloseTo(420)
      if (panel.name.includes('shelf')) expect(panel.width).toBeCloseTo(1250)
    }
    expect(next.panels.map(panel => panel.id)).toEqual(project.panels.map(panel => panel.id))
    expect(next.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(next.customColors).toEqual(project.customColors)
    expect(next.listGroups).toEqual(project.listGroups)
    expect(getProjectBounds(resolvePanels(next)).min[1]).toBeCloseTo(getProjectBounds(resolvePanels(project)).min[1])
    expect(project.panels).toEqual(before.panels)
    valid(next)
  })

  it('uses original values for replacements without cascading into another row', () => {
    const project: Project = { version: 1, name: 'Cuts', connections: [], panels: [
      createPanel({ width: 400, height: 400 }), createPanel({ width: 600, height: 600, position: [2000, 0, 0] }),
    ] }
    const next = rescaleProject(project, { 'dimension:400': 600, 'dimension:600': 800 })
    expect(next.panels.map(panel => panel.width)).toEqual([600, 800])
    valid(next)
  })

  it('resizes a rotated structure and retains its panel angles', () => {
    const project = rotateProject(rotateProject(createStarterProject(), 'z', 33), 'y', 27)
    const next = change(project, 360, 420)
    next.panels.forEach((panel, index) => panel.rotation.forEach((angle, axis) => expect(angle).toBeCloseTo(resolvePanels(project)[index].rotation[axis])))
    valid(next)
  })

  it('adapts fitted inserts when repeated structural depths change', () => {
    const project = workstationProject()
    const worktop = project.panels.find(panel => panel.name === 'Worktop')!
    const next = change(project, worktop.height, worktop.height + 50)
    for (const panel of project.panels.filter(item => item.name.includes('insert shelf'))) {
      // Each shelf spans half the opening, on either side of its divider.
      expect(next.panels.find(item => item.id === panel.id)!.height).toBeCloseTo(panel.height + 25)
    }
    valid(next)
  })

  it('changes physical thickness while keeping touching inserts supported', () => {
    const project = workstationProject(), next = change(project, 18, 19, 'thickness')
    expect(next.panels.filter(panel => project.panels.find(before => before.id === panel.id)!.thickness === 18).every(panel => panel.thickness === 19)).toBe(true)
    valid(next)
  })

  it('updates radius and perforation details together, preserving outlines', () => {
    const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.8, y: 1 }, { x: 0, y: 1 }]
    const project: Project = { version: 1, name: 'Perforated', connections: [], panels: [
      createPanel({ width: 600, height: 400, pattern: 'pegboard', holeSize: 12, holeSpacing: 48, cornerRadius: 10, customOutline: outline }),
      createPanel({ width: 600, height: 400, pattern: 'pegboard', holeSize: 12, holeSpacing: 48, cornerRadius: 10, position: [2000, 0, 0] }),
    ] }
    const next = rescaleProject(project, { 'cornerRadius:10': 20, 'holeSize:12': 50, 'holeSpacing:48': 60 })
    expect(next.panels.every(panel => panel.cornerRadius === 20 && panel.holeSize === 50 && panel.holeSpacing === 60)).toBe(true)
    expect(next.panels[0].customOutline).toEqual(outline)
    valid(next)
  })

  it('preserves linked assembly definitions and their editable values after reload', () => {
    const plain = gridProject('Module', [350], [350], { depth: 350 })
    const base = createAssembly(plain, plain.panels.map(panel => panel.id), 'Module', [{ id: 'side', name: 'Side', defaultValue: 350,
      bindings: plain.panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({ panelId: panel.id, dimension, scale: 1, offset: 0 }))) }])
    const project = getAssemblyAttachmentTargets(base, base.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const next = change(project, 350, 420)
    expect(next.assemblies!.links).toEqual(project.assemblies!.links)
    expect(next.assemblies!.definitions[0].parameters![0].defaultValue).toBe(420)
    expect(next.panels.every(panel => panel.width === 420 && panel.height === 420)).toBe(true)
    valid(next)
    expect(() => updateAssemblyParameterValues(next, next.assemblies!.instances[0].id, { side: 450 })).not.toThrow()
  })

  it('rejects invalid and stale edits atomically and preserves exact no-ops', () => {
    const project = createStarterProject(), before = structuredClone(project)
    for (const value of [NaN, Infinity, 0, 4001]) expect(() => change(project, 360, value)).toThrow()
    expect(() => change(project, 18, 20, 'thickness')).toThrow(/between 18 and 19/)
    expect(() => rescaleProject(project, { stale: 400 })).toThrow(/no longer available/)
    expect(rescaleProject(project, {})).toBe(project)
    expect(change(project, 360, 360)).toBe(project)
    expect(project).toEqual(before)
  })

  it('explains conflicting structural targets in terms of rescaling', () => {
    const project = workstationProject(), before = structuredClone(project)
    expect(() => rescaleProject(project, { 'dimension:735': 785, 'dimension:752': 852 }))
      .toThrow('These values conflict with the existing connections or fitted inserts. Adjust related measurements together to keep the creation connected.')
    expect(project).toEqual(before)
  })
})
