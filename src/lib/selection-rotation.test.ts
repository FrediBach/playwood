import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly, duplicateAssembly, getAssemblyAttachmentTargets, materializeAssemblies, updateAssemblyFinish } from './assemblies'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, createStarterProject, getConnectorPlacements, getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { rotateSelection } from './selection-rotation'
import type { Panel, Project, RotationAxis, Vec3 } from './types'

const axes: RotationAxis[] = ['x', 'y', 'z']
const orientation = (item: Pick<Panel, 'rotation'>) => new Quaternion().setFromEuler(new Euler(...item.rotation))
const turnFor = (axis: RotationAxis) => new Quaternion().setFromAxisAngle(new Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), Math.PI / 2)
const closePosition = (actual: Vec3, expected: Vec3) => expect(new Vector3(...actual).distanceTo(new Vector3(...expected))).toBeLessThan(0.001)
const centerOf = (panels: Panel[]) => {
  const bounds = getProjectBounds(panels)
  return new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(0.5)
}
const box = () => {
  const project = gridProject('Box', [350], [500], { depth: 300 })
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box')
}

describe('selection rotation', () => {
  it('uses world axes for successive mixed turns and leaves other panels untouched', () => {
    const panel = createPanel({ id: 'selected', position: [120, 250, -80], rotation: [0.2, 0.4, 0.1] })
    const other = createPanel({ id: 'other', position: [2000, 300, 0] })
    const project: Project = { version: 1, name: 'Rotation', panels: [panel, other], connections: [] }
    const snapshot = structuredClone(project)
    let next = project
    let expected = orientation(panel)
    for (const axis of ['x', 'z', 'y'] as const) {
      next = rotateSelection(next, [panel.id], axis)
      expected = turnFor(axis).multiply(expected)
      expect(Math.abs(orientation(next.panels[0]).dot(expected))).toBeCloseTo(1, 8)
      closePosition(next.panels[0].position, panel.position)
      expect(next.panels[1]).toBe(other)
    }
    expect(project).toEqual(snapshot)
  })

  it.each(axes)('returns a connected group to its original pose after four %s turns', axis => {
    const project = createStarterProject('shelf')
    const ids = project.panels.map(panel => panel.id)
    let next = project
    for (let i = 0; i < 4; i++) next = rotateSelection(next, ids, axis)
    const original = resolvePanels(project)
    resolvePanels(next).forEach((panel, i) => {
      closePosition(panel.position, original[i].position)
      expect(Math.abs(orientation(panel).dot(orientation(original[i])))).toBeCloseTo(1, 8)
    })
  })

  it('rotates complete connected panels and connectors together without lifting the selection', () => {
    const project = createStarterProject('shelf')
    const before = resolvePanels(project)
    const center = centerOf(before)
    const turn = turnFor('x')
    const next = rotateSelection(project, before.map(panel => panel.id), 'x')
    const after = resolvePanels(next)
    expect(centerOf(after).distanceTo(center)).toBeLessThan(0.001)
    expect(getProjectBounds(after).min[1]).not.toBeCloseTo(getProjectBounds(before).min[1], 3)
    after.forEach((panel, i) => {
      closePosition(panel.position, new Vector3(...before[i].position).sub(center).applyQuaternion(turn).add(center).toArray() as Vec3)
      expect(Math.abs(orientation(panel).dot(turn.clone().multiply(orientation(before[i]))))).toBeCloseTo(1, 8)
    })
    for (const connection of project.connections) {
      const placements = (panels: Panel[]) => getConnectorPlacements(connection, panels.find(panel => panel.id === connection.parentId)!, panels.find(panel => panel.id === connection.childId)!)
      const original = placements(before)
      placements(after).forEach((pose, i) => {
        closePosition(pose.position, new Vector3(...original[i].position).sub(center).applyQuaternion(turn).add(center).toArray() as Vec3)
        expect(Math.abs(orientation(pose).dot(turn.clone().multiply(orientation(original[i]))))).toBeCloseTo(1, 8)
      })
    }
    expect(next.connections).toBe(project.connections)
    expect(validateProject(next)).toEqual(validateProject(project))
  })

  it.each([undefined, 'support'] as const)('rejects a selection crossing a %s joint without changing the project', role => {
    const parent = createPanel({ id: 'parent' })
    const initial: Project = { version: 1, name: 'Joint', panels: [parent], connections: [] }
    const attached = attachPanel(initial, parent.id, createPanel({ id: 'child' }), { side: 'right', type: '90', offset: 0, inset: 0, flip: false, color: '#123456', count: 2 })
    const project = { ...attached, connections: attached.connections.map(connection => ({ ...connection, role })) }
    const snapshot = structuredClone(project)
    for (const id of ['parent', 'child']) expect(() => rotateSelection(project, [id], 'z')).toThrow(/Select all connected.*detach/)
    expect(project).toEqual(snapshot)
  })

  it('requires the complete instance and preserves an unselected duplicate and shared source', () => {
    const initial = box()
    let project = duplicateAssembly(initial, initial.assemblies!.instances[0].id)
    const instance = project.assemblies!.instances[0]
    project = updateAssemblyFinish(project, instance.id, { color: '#123456', material: 'oak' })
    const ids = Object.values(instance.panelIds)
    expect(() => rotateSelection(project, [ids[0]], 'z')).toThrow(/whole assembly/)
    const snapshot = structuredClone(project)
    const next = rotateSelection(rotateSelection(project, ids, 'x'), ids, 'z')
    const selected = next.assemblies!.instances[0]
    expect(Math.abs(orientation(selected).dot(turnFor('z').multiply(turnFor('x')).multiply(orientation(instance))))).toBeCloseTo(1, 8)
    expect(selected.finish).toBe(project.assemblies!.instances[0].finish)
    expect(next.assemblies!.instances[1]).toBe(project.assemblies!.instances[1])
    expect(next.assemblies!.definitions).toBe(project.assemblies!.definitions)
    expect(next.connections).toBe(project.connections)
    for (const panel of project.panels.filter(panel => !ids.includes(panel.id))) expect(next.panels.find(item => item.id === panel.id)).toBe(panel)
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    const rebuilt = materializeAssemblies(next)
    next.panels.forEach(panel => {
      const current = rebuilt.panels.find(item => item.id === panel.id)!
      closePosition(current.position, panel.position)
      expect(Math.abs(orientation(current).dot(orientation(panel)))).toBeCloseTo(1, 8)
    })
    expect(project).toEqual(snapshot)
  })

  it('rotates linked assemblies when all are selected and rejects leaving a neighbor behind', () => {
    const initial = box()
    const project = getAssemblyAttachmentTargets(initial, initial.assemblies!.instances[0].id).find(target => target.label === 'Top right' && target.project)!.project!
    expect(project.assemblies!.instances).toHaveLength(2)
    expect(() => rotateSelection(project, Object.values(project.assemblies!.instances[0].panelIds), 'y')).toThrow(/Select all connected/)
    const next = rotateSelection(project, project.panels.map(panel => panel.id), 'y')
    expect(next.assemblies!.links).toBe(project.assemblies!.links)
    expect(validateProject(next)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
  })

  it('preserves no-op selections and rejects invalid angles or out-of-range placement atomically', () => {
    const project = box()
    expect(rotateSelection(project, [], 'x')).toBe(project)
    expect(rotateSelection(project, ['missing'], 'x')).toBe(project)
    expect(rotateSelection(project, project.panels.map(panel => panel.id), 'z', 360)).toBe(project)
    expect(() => rotateSelection(project, [], 'x', NaN)).toThrow(/finite angle/)
    const nearLimit: Project = { version: 1, name: 'At limit', connections: [], panels: [
      createPanel({ id: 'a', position: [99900, 0, -500] }),
      createPanel({ id: 'b', position: [99900, 0, 500] }),
    ] }
    const snapshot = structuredClone(nearLimit)
    expect(() => rotateSelection(nearLimit, ['a', 'b'], 'y')).toThrow(/placement limits/)
    expect(nearLimit).toEqual(snapshot)
  })
})
