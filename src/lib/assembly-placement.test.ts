import { describe, expect, it } from 'vitest'
import { createAssembly, disassembleAssembly, duplicateAssembly, getAssemblyAttachmentTargets, materializeAssemblies } from './assemblies'
import { reconcileAssemblyPlacement, samePanelPlacement } from './assembly-placement'
import { getPhysicalConnectors } from './connector-selection'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, parseProject, rotateProject, validateProject } from './model'
import type { Project } from './types'

function boxes(offset: number): Project {
  const loose = gridProject('Box', [350], [350], { depth: 350 })
  const original = createAssembly(loose, loose.panels.map(panel => panel.id), 'Box')
  const copied = duplicateAssembly(original, original.assemblies!.instances[0].id)
  const instances = copied.assemblies!.instances
  return materializeAssemblies({ ...copied, assemblies: { ...copied.assemblies!, instances: instances.map((instance, index) => index
    ? { ...instance, position: [instances[0].position[0] + offset, instances[0].position[1], instances[0].position[2]] } : instance) } })
}

describe('assembly placements requiring disassembly', () => {
  it.each([0, 35])('merges a shared panel and replaces occupied corners with complete T joints after %i° rotation', degrees => {
    const project = rotateProject(boxes(385), 'z', degrees)
    const snapshot = structuredClone(project)
    const movingIds = Object.values(project.assemblies!.instances[1].panelIds)
    const result = reconcileAssemblyPlacement(project, movingIds)
    expect(result.warning).toMatch(/Requires disassembly/)
    expect(result.project.panels).toHaveLength(7)
    expect(result.project.assemblies!.instances).toHaveLength(0)
    expect(result.project.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    expect(result.project.connections.filter(connection => connection.type === 't')).toHaveLength(4)
    expect(getPhysicalConnectors(result.project)).toHaveLength(12)
    expect(result.panelIds).toHaveLength(4)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(materializeAssemblies(result.project)).toEqual(result.project)
    expect(project).toEqual(snapshot)
  })

  it('preserves unrelated instances while reconciling overlapping parts', () => {
    const overlapping = boxes(385)
    const project = duplicateAssembly(overlapping, overlapping.assemblies!.instances[0].id)
    const unrelated = project.assemblies!.instances[2]
    const result = reconcileAssemblyPlacement(project, Object.values(project.assemblies!.instances[1].panelIds))
    expect(result.project.assemblies!.instances).toEqual([unrelated])
    expect(result.project.panels.filter(panel => Object.values(unrelated.panelIds).includes(panel.id)))
      .toEqual(project.panels.filter(panel => Object.values(unrelated.panelIds).includes(panel.id)))
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it('merges a fully duplicated assembly into the existing instance and preserves its finish', () => {
    const project = boxes(0)
    const fixed = project.assemblies!.instances[0]
    const result = reconcileAssemblyPlacement(project, Object.values(project.assemblies!.instances[1].panelIds))
    expect(result.project.panels).toHaveLength(4)
    expect(result.project.assemblies!.instances).toEqual([fixed])
    expect(result.project.panels).toEqual(project.panels.slice(0, 4))
    expect(getPhysicalConnectors(result.project)).toHaveLength(8)
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it('leaves unrelated preexisting validation errors and duplicate hardware unchanged', () => {
    const project = boxes(0)
    const parent = createPanel({ width: 200, height: 200, thickness: 25, position: [2000, 1000, 0] })
    const pair = attachPanel({ version: 1, name: 'Loose', panels: [parent], connections: [] }, parent.id, createPanel({ width: 200, height: 200 }),
      { type: '90', side: 'right', flip: false, offset: 0, inset: 0, count: 2, color: '#123456' })
    const connections = pair.connections.map(connection => ({ ...connection, role: 'support' as const }))
    connections.push({ ...connections[0], id: 'duplicate-hardware:0' })
    const combined = { ...project, panels: [...project.panels, ...pair.panels], connections: [...project.connections, ...connections] }
    const result = reconcileAssemblyPlacement(combined, Object.values(project.assemblies!.instances[1].panelIds))
    expect(result.project.connections.filter(connection => connections.some(original => original.id === connection.id))).toEqual(connections)
    expect(result.project.connectorOverrides).toBeUndefined()
    expect(validateProject(result.project).filter(issue => issue.severity === 'error').map(issue => issue.id)).toEqual(connections.map(connection => `${connection.id}-thickness`))
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it.each([false, true])('reconciles a shared side beside an existing linked corner (mixed loose corner: %s)', mixed => {
    const loose = gridProject('Box', [350], [350], { depth: 350 })
    const initial = createAssembly(loose, loose.panels.map(panel => panel.id), 'Box')
    const first = initial.assemblies!.instances[0]
    const linked = getAssemblyAttachmentTargets(initial, first.id).find(target => target.label === 'Top right' && !target.warning)!.project!
    const copied = duplicateAssembly(linked, first.id)
    const source = copied.assemblies!.instances[2]
    let project = materializeAssemblies({ ...copied, assemblies: { ...copied.assemblies!, instances: copied.assemblies!.instances.map(instance => instance.id === source.id
      ? { ...instance, position: [first.position[0] + 385, first.position[1], first.position[2]] } : instance) } })
    if (mixed) project = disassembleAssembly(project, first.id)
    const result = reconcileAssemblyPlacement(project, Object.values(source.panelIds))
    expect(result.project.panels).toHaveLength(10)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(materializeAssemblies(result.project)).toEqual(result.project)
  })

  it('rejects partial panel intersections instead of removing material', () => {
    const project = boxes(380)
    expect(() => reconcileAssemblyPlacement(project, Object.values(project.assemblies!.instances[1].panelIds))).toThrow(/overlap/)
  })

  it('rejects shared-panel placements when the panels are too thin for T connectors', () => {
    const project = boxes(385)
    const thin = { ...project, panels: project.panels.map(panel => ({ ...panel, thickness: 16 })), assemblies: { ...project.assemblies!, definitions: project.assemblies!.definitions.map(definition => ({ ...definition, panels: definition.panels.map(panel => ({ ...panel, thickness: 16 })) })) } }
    expect(() => reconcileAssemblyPlacement(thin, Object.values(project.assemblies!.instances[1].panelIds))).toThrow(/compatible shared joint/)
  })

  it('replaces complementary occupied corners with cross joints even without shared panels', () => {
    const horizontal = boxes(385)
    const project = materializeAssemblies({ ...horizontal, assemblies: { ...horizontal.assemblies!, instances: horizontal.assemblies!.instances.map((instance, index) => index
      ? { ...instance, position: [instance.position[0], instance.position[1] + 385, instance.position[2]] } : instance) } })
    const movingIds = Object.values(project.assemblies!.instances[1].panelIds)
    const result = reconcileAssemblyPlacement(project, movingIds)
    expect(result.project.panels).toHaveLength(8)
    expect(result.project.connections.filter(connection => connection.type === 'cross')).toHaveLength(3)
    expect(result.warning).toMatch(/Requires disassembly/)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    const thin = { ...project, panels: project.panels.map(panel => ({ ...panel, thickness: 16 })), assemblies: { ...project.assemblies!, definitions: project.assemblies!.definitions.map(definition => ({ ...definition, panels: definition.panels.map(panel => ({ ...panel, thickness: 16 })) })) } }
    expect(() => reconcileAssemblyPlacement(thin, movingIds)).toThrow(/compatible shared joint/)
  })

  it('recognizes equivalent box axes without treating nearby panels as duplicates', () => {
    const panel = createPanel({ width: 350, height: 200 })
    expect(samePanelPlacement(panel, { ...panel, rotation: [0, 0, Math.PI] })).toBe(true)
    expect(samePanelPlacement(panel, { ...panel, width: 200, height: 350, rotation: [0, 0, Math.PI / 2] })).toBe(true)
    expect(samePanelPlacement(panel, { ...panel, position: [panel.position[0] + 1, panel.position[1], panel.position[2]] })).toBe(false)
  })
})
