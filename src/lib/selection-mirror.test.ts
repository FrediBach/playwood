import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { createAssembly, duplicateAssembly, getAssemblyAttachmentTargets, materializeAssemblies } from './assemblies'
import { gridProject } from './example-geometry'
import { attachPanel, createPanel, createStarterProject, getConnectorPlacements, getProjectBounds, parseProject, resolvePanels } from './model'
import { mirrorSelection } from './selection-mirror'
import type { Project, RotationAxis, Side } from './types'

function expectMirror(before: Project, after: Project, axis: RotationAxis) {
  const original = resolvePanels(before), current = resolvePanels(after)
  const bounds = getProjectBounds(original)
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const reflect = (point: Vector3) => point.setComponent(index, bounds.min[index] + bounds.max[index] - point.getComponent(index))
  original.forEach(panel => {
    const other = current.find(item => item.id === panel.id)!
    // Arbitrary points in the cut plane test both orientation and asymmetric outlines.
    for (const local of [[0, 0, 0], [37, -59, 0], [-102, 84, 0]]) {
      const expected = reflect(new Vector3(...local).applyEuler(new Euler(...panel.rotation)).add(new Vector3(...panel.position)))
      const actual = new Vector3(...local).applyEuler(new Euler(...other.rotation)).add(new Vector3(...other.position))
      expect(actual.distanceTo(expected)).toBeLessThan(0.001)
    }
  })
  before.connections.forEach(connection => {
    const next = after.connections.find(item => item.id === connection.id)!
    const poses = getConnectorPlacements(connection, original.find(p => p.id === connection.parentId)!, original.find(p => p.id === connection.childId)!)
    getConnectorPlacements(next, current.find(p => p.id === next.parentId)!, current.find(p => p.id === next.childId)!).forEach((pose, i) => {
      expect(new Vector3(...pose.position).distanceTo(reflect(new Vector3(...poses[i].position)))).toBeLessThan(0.001)
    })
  })
}

const box = () => {
  const project = gridProject('Box', [350], [500], { depth: 300 })
  return createAssembly(project, project.panels.map(panel => panel.id), 'Box')
}

describe('selection mirroring', () => {
  it.each(['x', 'y', 'z'] as const)('mirrors connected geometry on %s and reverses on the second press', axis => {
    const project = createStarterProject('shelf'), snapshot = structuredClone(project)
    const ids = project.panels.map(panel => panel.id)
    const next = mirrorSelection(project, ids, axis)
    expectMirror(project, next, axis)
    const restored = mirrorSelection(next, ids, axis)
    expectMirror(next, restored, axis)
    resolvePanels(restored).forEach((panel, i) => panel.position.forEach((value, j) => expect(value).toBeCloseTo(resolvePanels(project)[i].position[j], 5)))
    expect(restored.connections).toEqual(project.connections)
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    expect(project).toEqual(snapshot)
  })

  it.each(['left', 'right', 'top', 'bottom', 'front', 'back'] as Side[])('preserves %s driving joints, angles and quarter turns', side => {
    for (const type of ['90', '105', '150', 't', 'cross'] as const) {
      const parent = createPanel({ id: 'parent', rotation: [0.2, 0.4, -0.3] })
      let project: Project = { version: 1, name: 'Joint', panels: [parent], connections: [] }
      project = attachPanel(project, parent.id, createPanel({ id: 'child' }), { type, side, offset: 30, inset: 0, flip: false, color: '#123456', count: 2 })
      project = { ...project, connections: project.connections.map(connection => ({ ...connection, quarterTurn: true })) }
      expectMirror(project, mirrorSelection(project, project.panels.map(p => p.id), 'x'), 'x')
    }
  })

  it('preserves custom cuts and unselected panels without mutation', () => {
    const panel = createPanel({ id: 'shape', rotation: [0.3, 0.6, 0.2], customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.3, y: 1 }] })
    const other = createPanel({ id: 'other', position: [2000, 500, 0] })
    const project: Project = { version: 1, name: 'Shape', panels: [panel, other], connections: [] }
    const next = mirrorSelection(project, [panel.id], 'z')
    expectMirror({ ...project, panels: [panel] }, { ...next, panels: [next.panels[0]] }, 'z')
    expect(next.panels[0].customOutline).toEqual(panel.customOutline)
    expect(next.panels[1]).toBe(other)
    expect(mirrorSelection(project, [], 'x')).toBe(project)
    expect(mirrorSelection(project, ['missing'], 'x')).toBe(project)
  })

  it('forks a selected assembly source, retaining IDs, links and reload compatibility', () => {
    const original = box()
    const project = duplicateAssembly(original, original.assemblies!.instances[0].id)
    const selected = project.assemblies!.instances[0], ids = Object.values(selected.panelIds)
    const next = mirrorSelection(project, ids, 'x')
    expect(next.assemblies!.instances[0].panelIds).toBe(selected.panelIds)
    expect(next.assemblies!.instances[0].definitionId).not.toBe(selected.definitionId)
    expect(next.assemblies!.instances[1]).toBe(project.assemblies!.instances[1])
    expect(next.assemblies!.definitions[0]).toBe(project.assemblies!.definitions[0])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    const rebuilt = materializeAssemblies(next)
    rebuilt.panels.forEach(panel => panel.position.forEach((value, j) => expect(value).toBeCloseTo(next.panels.find(p => p.id === panel.id)!.position[j], 5)))
    const linked = getAssemblyAttachmentTargets(original, selected.id).find(target => target.label === 'Top right' && target.project)!.project!
    const mirrored = mirrorSelection(linked, linked.panels.map(p => p.id), 'z')
    expectMirror(linked, mirrored, 'z')
    expect(parseProject(JSON.parse(JSON.stringify(mirrored)))).toEqual(mirrored)
  })

  it('mirrors insert faces horizontally and rejects turning an installed box upside down', () => {
    const panel = createPanel({ id: 'top', width: 1000, height: 600, position: [0, 750, 0], rotation: [-Math.PI / 2, 0, 0],
      trofastInserts: [{ id: 'box', itemId: 'plastic-medium', colorId: 'white', x: 350, y: 300, face: 1 }] })
    const project: Project = { version: 1, name: 'Insert', panels: [panel], connections: [] }
    const mirrored = mirrorSelection(project, [panel.id], 'x')
    expect(mirrored.panels[0].trofastInserts![0]).toEqual({ ...panel.trofastInserts![0], face: -1 })
    expect(parseProject(JSON.parse(JSON.stringify(mirrored)))).toEqual(mirrored)
    expect(() => mirrorSelection(project, [panel.id], 'y')).toThrow(/upward/)
  })

  it('rejects partial selections and saved floor constraints atomically', () => {
    const project = box(), snapshot = structuredClone(project)
    expect(() => mirrorSelection(project, [project.panels[0].id], 'x')).toThrow(/whole assembly/)
    const shelf = createStarterProject('shelf')
    expect(() => mirrorSelection(shelf, [shelf.panels[0].id], 'x')).toThrow(/all connected/)
    const constrained: Project = { version: 1, name: 'Floor', connections: [], panels: [createPanel({ id: 'a', position: [-1000, 400, 0] }), createPanel({ id: 'b', position: [1000, 800, 0] })], constraints: [{ id: 'floor', kind: 'floor', panelId: 'a', reference: 'center', value: 400, enabled: true }] }
    expect(() => mirrorSelection(constrained, ['a', 'b'], 'y')).toThrow()
    expect(project).toEqual(snapshot)
  })
})
