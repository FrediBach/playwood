import { describe, expect, it } from 'vitest'
import { createAssembly, disassembleAssembly, duplicateAssembly, getAssemblyAttachmentTargets, makeAssemblyIndependent, materializeAssemblies, updateAssemblyDefinition } from './assemblies'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, parseProject, resolvePanels, validateProject } from './model'
import { movePreviewDrag, preparePreviewDrag } from './preview-drag'
import { getPhysicalConnectors } from './connector-selection'
import type { AttachmentOptions, Project, Vec3 } from './types'

const options: AttachmentOptions = { type: '90', side: 'right', flip: false, offset: 0, inset: 0, color: '#e75a35', count: 2 }
function corner(type: AttachmentOptions['type'] = '90') {
  const parent = createPanel({ id: 'fixed', name: 'Fixed panel', width: 400, height: 400, position: [0, 500, 0] })
  return attachPanel({ version: 1, name: 'Drag test', panels: [parent], connections: [] }, parent.id,
    createPanel({ id: 'moving', name: 'Moving panel', width: 400, height: 400 }), { ...options, type })
}
function box() {
  const project = gridProject('Box', [350], [350], { depth: 350 })
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box')
}
function position(project: Project, id: string) { return resolvePanels(project).find(panel => panel.id === id)!.position }
function expectVector(actual: Vec3, expected: Vec3) { actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 6)) }
function errors(project: Project) { return validateProject(project).filter(issue => issue.severity === 'error') }

describe('preview dragging', () => {
  it('moves only the selected panel, releases boundary joints and leaves the original untouched', () => {
    const original = attachPanel(corner(), 'moving', createPanel({ id: 'descendant', width: 400, height: 400 }), { ...options, side: 'left' })
    const snapshot = structuredClone(original)
    const session = preparePreviewDrag(original, ['moving'])!
    const first = movePreviewDrag(session, [50, 40, 30], 0)
    const second = movePreviewDrag(session, [100, 80, 60], 0)
    expectVector(position(first.project, 'moving'), position(original, 'moving').map((value, axis) => value + [50, 40, 30][axis]) as Vec3)
    expectVector(position(second.project, 'moving'), position(original, 'moving').map((value, axis) => value + [100, 80, 60][axis]) as Vec3)
    expect(position(second.project, 'fixed')).toEqual(position(original, 'fixed'))
    expect(position(second.project, 'descendant')).toEqual(position(original, 'descendant'))
    expect(second.project.connections).toEqual([])
    expect(original).toEqual(snapshot)
  })

  it.each(['90', '105', '150'] as const)('snaps compatible %s° joints, persists valid hardware, and releases outside the radius', type => {
    const attached = corner(type)
    const loose = { ...attached, connections: [] }
    const session = preparePreviewDrag(loose, ['moving'])!
    const result = movePreviewDrag(session, [8, 0, 4], 20)
    expect(result.snap).not.toBeNull()
    expectVector(position(result.project, 'moving'), position(attached, 'moving'))
    expect(position(result.project, 'fixed')).toEqual(position(attached, 'fixed'))
    expect(result.project.connections).toHaveLength(1)
    expect(result.project.connections[0].type).toBe(type)
    expect(errors(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    const released = movePreviewDrag(session, [60, 0, 60], 20)
    expect(released.snap).toBeNull()
    expect(released.project.connections).toEqual([])
  })

  it('can snap when the selected panel supplies the parent edge', () => {
    const original = corner()
    const session = preparePreviewDrag({ ...original, connections: [] }, ['fixed'])!
    const snapped = movePreviewDrag(session, [5, 0, 8], 20)
    expect(snapped.snap).not.toBeNull()
    expectVector(position(snapped.project, 'fixed'), position(original, 'fixed'))
    expectVector(position(snapped.project, 'moving'), position(original, 'moving'))
  })

  it('keeps a free seam offset and never snaps a distant or incompatible face', () => {
    const original = corner()
    const session = preparePreviewDrag({ ...original, connections: [] }, ['moving'])!
    const snapped = movePreviewDrag(session, [5, 90, 8], 20)
    expect(snapped.snap).not.toBeNull()
    expectVector(position(snapped.project, 'moving'), position(original, 'moving').map((value, axis) => value + (axis === 1 ? 90 : 0)) as Vec3)
    expect(movePreviewDrag(session, [0, 0, 100], 20).snap).toBeNull()
    const incompatible = { ...original, connections: [], panels: original.panels.map(panel => panel.id === 'moving' ? { ...panel, thickness: 25 } : panel) }
    expect(movePreviewDrag(preparePreviewDrag(incompatible, ['moving'])!, [5, 0, 5], 20).snap).toBeNull()
  })

  it('ignores hidden targets and occupied connector positions', () => {
    const original = corner()
    const hidden = { ...original, connections: [], panels: original.panels.map(panel => panel.id === 'fixed' ? { ...panel, visible: false } : panel) }
    expect(movePreviewDrag(preparePreviewDrag(hidden, ['moving'])!, [5, 0, 5], 20).snap).toBeNull()
    const duplicate = { ...original.panels[1], id: 'duplicate' }
    const occupied = { ...original, panels: [...original.panels, duplicate] }
    expect(movePreviewDrag(preparePreviewDrag(occupied, [duplicate.id])!, [5, 0, 5], 20).snap).toBeNull()
  })

  it('releases complete shared T hardware instead of leaving invalid branches', () => {
    const original = corner('t')
    const session = preparePreviewDrag(original, ['moving'])!
    expect(movePreviewDrag(session, [80, 0, 0], 0).project.connections).toEqual([])
    expect(errors(session.project)).toEqual([])
    for (const panel of original.panels.filter(panel => panel.id !== 'moving')) expect(position(session.project, panel.id)).toEqual(position(original, panel.id))
  })

  it('moves a whole assembly rigidly and preserves its source and instance identity', () => {
    const initial = box()
    const original = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const source = original.assemblies!.instances[1]
    const selected = Object.values(source.panelIds)
    const session = preparePreviewDrag(original, selected)!
    const moved = movePreviewDrag(session, [100, 40, -20], 0).project
    expect(moved.assemblies!.definitions).toEqual(original.assemblies!.definitions)
    expect(moved.assemblies!.instances[0]).toEqual(original.assemblies!.instances[0])
    expect(moved.assemblies!.instances[1].id).toBe(source.id)
    for (const panel of original.panels) expectVector(position(moved, panel.id), panel.position.map((value, axis) => value + (selected.includes(panel.id) ? [100, 40, -20][axis] : 0)) as Vec3)
    expect(errors(moved)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
    expect(preparePreviewDrag(original, [selected[0]])).toBeNull()
  })

  it('snaps onto a shared panel with a warning, and restores the instances when dragged away', () => {
    const initial = box()
    const project = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const before = structuredClone(project)
    const source = project.assemblies!.instances[1]
    const selected = Object.values(source.panelIds)
    const session = preparePreviewDrag(project, selected)!
    const target = session.assemblyTargets.find(candidate => candidate.snap.warning && candidate.project.panels.length === 7)
    expect(target).toBeDefined()
    const snapped = movePreviewDrag(session, target!.delta, 20)
    expect(snapped.snap?.warning).toMatch(/disassembl/i)
    expect(snapped.project.panels).toHaveLength(7)
    expect(snapped.project.assemblies!.instances).toHaveLength(0)
    expect(snapped.project.assemblies!.definitions).toEqual(project.assemblies!.definitions)
    expect(snapped.snap!.panelIds).toHaveLength(4)
    expect(snapped.snap!.panelIds.every(id => snapped.project.panels.some(panel => panel.id === id))).toBe(true)
    expect(validateProject(snapped.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(snapped.project)))).toEqual(snapped.project)
    expect(materializeAssemblies(snapped.project)).toEqual(snapped.project)
    const released = movePreviewDrag(session, [1000, 200, 1000], 20)
    expect(released.snap).toBeNull()
    expect(released.project.panels).toHaveLength(8)
    expect(released.project.assemblies!.instances.map(instance => instance.id)).toEqual(project.assemblies!.instances.map(instance => instance.id))
    expect(parseProject(JSON.parse(JSON.stringify(released.project)))).toEqual(released.project)
    expect(project).toEqual(before)
  })

  it('merges a fully overlapping assembly without retaining duplicate panels or hardware', () => {
    const initial = box()
    const project = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const source = project.assemblies!.instances[1]
    const fixed = project.assemblies!.instances[0]
    const session = preparePreviewDrag(project, Object.values(source.panelIds))!
    const delta = fixed.position.map((value, axis) => value - source.position[axis]) as Vec3
    const snapped = movePreviewDrag(session, delta, 20)
    expect(snapped.snap?.warning).toMatch(/disassembl/i)
    expect(snapped.project.panels).toHaveLength(4)
    expect(new Set(snapped.project.panels.map(panel => panel.id))).toEqual(new Set(Object.values(fixed.panelIds)))
    expect(getPhysicalConnectors(snapped.project)).toHaveLength(getPhysicalConnectors(initial).length)
    expect(snapped.project.assemblies!.definitions).toEqual(initial.assemblies!.definitions)
    expect(validateProject(snapped.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(snapped.project)))).toEqual(snapped.project)
    expect(materializeAssemblies(snapped.project)).toEqual(snapped.project)
  })

  it('disconnects linked assemblies in place, then snaps back to their shared corners', () => {
    const initial = box()
    const original = getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const source = original.assemblies!.instances[1]
    const session = preparePreviewDrag(original, Object.values(source.panelIds))!
    expect(session.project.assemblies!.links).toEqual([])
    expect(session.project.assemblies!.instances).toEqual(original.assemblies!.instances)
    expect(errors(session.project)).toEqual([])
    const free = movePreviewDrag(session, [100, 40, 20], 0).project
    expect(free.assemblies!.instances[0]).toEqual(original.assemblies!.instances[0])
    expect(parseProject(JSON.parse(JSON.stringify(free)))).toEqual(free)
    const snapped = movePreviewDrag(session, [5, 0, 4], 20)
    expect(snapped.snap).not.toBeNull()
    expect(snapped.project.assemblies!.links).toHaveLength(original.assemblies!.links.length)
    expectVector(snapped.project.assemblies!.instances[1].position, source.position)
    expect(errors(snapped.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(snapped.project)))).toEqual(snapped.project)
  })

  it('excludes assembly corners whose endpoint panels are hidden', () => {
    const initial = box()
    const copied = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const targetId = copied.assemblies!.instances[0].id
    const original = makeAssemblyIndependent(copied, targetId)
    const source = original.assemblies!.instances[1]
    const selected = Object.values(source.panelIds)
    const visible = preparePreviewDrag(original, selected)!
    const candidate = visible.assemblyTargets[0]
    expect(candidate).toBeDefined()
    const link = candidate.project.assemblies!.links.find(item => item.a.instanceId === targetId || item.b.instanceId === targetId)!
    const endpoint = link.a.instanceId === targetId ? link.a : link.b
    const target = original.assemblies!.instances[0]
    const definition = original.assemblies!.definitions.find(item => item.id === target.definitionId)!
    const connectionId = definition.ports.find(port => port.id === endpoint.portId)!.connectionId
    const panelId = definition.connections.find(connection => connection.id === connectionId)!.parentId
    const partlyHidden = updateAssemblyDefinition(original, targetId, { visible: false }, [panelId])
    expect(preparePreviewDrag(partlyHidden, selected)!.assemblyTargets.some(item => item.snap.label === candidate.snap.label)).toBe(false)
    const hidden = updateAssemblyDefinition(original, targetId, { visible: false })
    const session = preparePreviewDrag(hidden, selected)!
    expect(session.assemblyTargets).toEqual([])
    expect(movePreviewDrag(session, candidate.delta, 20).snap).toBeNull()
  })

  it('restores neighboring loose corners when disconnecting a mixed assembly link', () => {
    const initial = box()
    const linked = getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const original = disassembleAssembly(linked, linked.assemblies!.instances[0].id)
    const source = original.assemblies!.instances[0]
    const session = preparePreviewDrag(original, Object.values(source.panelIds))!
    const moved = movePreviewDrag(session, [150, 0, 0], 0).project
    expect(moved.assemblies!.links).toEqual([])
    expect(moved.assemblies!.loosePorts).toEqual([])
    expect(errors(moved)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  })

  it('snaps an assembly to a loose panel while retaining valid source metadata', () => {
    const initial = corner()
    const assembled = createAssembly(initial, initial.panels.map(panel => panel.id), 'Corner')
    const instance = assembled.assemblies!.instances[0]
    const withTarget = attachPanel(assembled, 'fixed', createPanel({ id: 'loose', width: 400, height: 400 }), { ...options, side: 'top' })
    const project = { ...withTarget, connections: assembled.connections }
    const session = preparePreviewDrag(project, Object.values(instance.panelIds))!
    const snapped = movePreviewDrag(session, [5, 0, 5], 20)
    expect(snapped.snap).not.toBeNull()
    expect(snapped.project.connections).toHaveLength(assembled.connections.length + 1)
    expect(snapped.project.assemblies!.definitions).toEqual(assembled.assemblies!.definitions)
    expect(snapped.project.assemblies!.instances[0].id).toBe(instance.id)
    expectVector(position(snapped.project, 'loose'), position(project, 'loose'))
    expect(errors(snapped.project)).toEqual([])
    const serialized = JSON.parse(JSON.stringify(snapped.project))
    expect(parseProject(serialized)).toEqual(serialized)
  })

  it('preserves links wholly inside a multi-assembly selection', () => {
    const initial = box()
    const original = getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const session = preparePreviewDrag(original, original.panels.map(panel => panel.id))!
    const moved = movePreviewDrag(session, [100, 50, 30], 0).project
    expect(moved.assemblies!.links).toEqual(original.assemblies!.links)
    expect(moved.connections).toEqual(original.connections)
    expect(errors(moved)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  })

  it('releases a loose panel from an assembly corner without moving its neighbors', () => {
    const initial = box()
    const linked = getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id).find(target => target.label === 'Top right')!.project!
    const original = disassembleAssembly(linked, linked.assemblies!.instances[0].id)
    const selected = original.assemblies!.loosePorts![0].connection.parentId
    const session = preparePreviewDrag(original, [selected])!
    const moved = movePreviewDrag(session, [-150, 0, 0], 0).project
    expect(moved.assemblies!.links).toEqual([])
    expect(moved.assemblies!.instances).toEqual(original.assemblies!.instances)
    for (const panel of original.panels.filter(panel => panel.id !== selected)) expectVector(position(moved, panel.id), position(original, panel.id))
    expect(errors(moved)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(moved)))).toEqual(moved)
  })

  it('rejects non-finite and out-of-range movement atomically', () => {
    const original = corner()
    const session = preparePreviewDrag(original, ['moving'])!
    expect(() => movePreviewDrag(session, [NaN, 0, 0])).toThrow(/finite/)
    expect(() => movePreviewDrag(session, [100001, 0, 0])).toThrow(/limits/)
    expect(preparePreviewDrag(original, [])).toBeNull()
  })
})

