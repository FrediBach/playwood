import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createAssembly, materializeAssemblies } from './assemblies'
import { changeConnectorType } from './connector-type-edit'
import { connectorId, editConnectors, getPhysicalConnectors } from './connector-selection'
import { attachPanel, createPanel, createStarterProject, parseProject, resolvePanels, validateProject } from './model'
import type { Panel, Project, Side } from './types'

const orientation = (panel: Panel) => new Quaternion().setFromEuler(new Euler(...panel.rotation))
const normal = (panel: Panel) => new Vector3(0, 0, 1).applyQuaternion(orientation(panel))
function shelfWithBack() {
  const base = createPanel({ id: 'base', name: 'Base', width: 800, height: 500, position: [0, 600, 0], rotation: [-Math.PI / 2, 0, 0] })
  const back = createPanel({ id: 'back', name: 'Back', width: 800, height: 400 })
  const top = createPanel({ id: 'top', name: 'Top', width: 800, height: 300 })
  const options = { side: 'top' as const, type: '90' as const, offset: 0, inset: 0, flip: false, color: '#ff0000', count: 2 }
  let project: Project = { version: 1, name: 'Shelf with back', panels: [base], connections: [] }
  project = attachPanel(project, base.id, back, options)
  project = attachPanel(project, back.id, top, options)
  return project
}

describe('changing connector joint angles', () => {
  it('opens a 90° back to 150° and carries its top with it while the base stays fixed', () => {
    const project = shelfWithBack(), snapshot = structuredClone(project)
    const before = resolvePanels(project)
    const selected = getPhysicalConnectors(project).filter(piece => piece.connection.childId === 'back')
    const next = changeConnectorType(project, selected.map(piece => piece.id), '150')
    const after = resolvePanels(next)
    expect(after[0]).toEqual(before[0])
    for (const index of [1, 2]) {
      expect(normal(before[index]).angleTo(normal(after[index]))).toBeCloseTo(Math.PI / 3, 8)
      expect(after[index].position[2]).toBeLessThan(before[index].position[2])
    }
    const relativeTop = (panels: Panel[]) => new Vector3(...panels[2].position).sub(new Vector3(...panels[1].position))
      .applyQuaternion(orientation(panels[1]).invert()).toArray()
    relativeTop(after).forEach((value, index) => expect(value).toBeCloseTo(relativeTop(before)[index], 8))
    expect(orientation(after[1]).invert().multiply(orientation(after[2])).angleTo(
      orientation(before[1]).invert().multiply(orientation(before[2])))).toBeCloseTo(0, 7)
    expect(next.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(after.map(panel => panel.id)).toEqual(before.map(panel => panel.id))
    expect(getPhysicalConnectors(next).map(piece => piece.type)).toEqual(['150', '150', '90', '90'])
    expect(validateProject(next)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next)
    expect(project).toEqual(snapshot)
  })

  it('updates all clamps on a selected seam, retaining colors, slides and removed hardware', () => {
    let project = shelfWithBack()
    const pieces = getPhysicalConnectors(project)
    project = editConnectors(project, [pieces[0].id], { color: '#0000ff', slide: 25, material: 'metal' })
    project = editConnectors(project, [pieces[1].id], { removed: true, type: 'cross', material: 'metal' })
    project = { ...project, connections: project.connections.map(connection => ({ ...connection, material: 'metal' })) }
    const next = changeConnectorType(project, [pieces[0].id], '150')
    expect(getPhysicalConnectors(next)[0]).toMatchObject({ id: pieces[0].id, type: '150', color: '#0000ff', material: 'plastic' })
    expect(next.connectorOverrides?.[pieces[0].id]).toMatchObject({ slide: 25 })
    expect(next.connectorOverrides?.[pieces[1].id]).toMatchObject({ removed: true, material: 'plastic' })
    expect(next.connectorOverrides?.[pieces[1].id].type).toBeUndefined()
    const restored = changeConnectorType(next, [pieces[0].id], '90')
    expect(getPhysicalConnectors(restored)[0].material).toBe('plastic')
    expect(getPhysicalConnectors(restored).slice(1).every(piece => piece.material === 'metal')).toBe(true)
    expect(resolvePanels(restored)).toEqual(resolvePanels(project))
  })

  it.each(['left', 'right', 'top', 'bottom', 'front', 'back'] as Side[])('respects rotated parents, flip and quarter-turn on the %s side', side => {
    for (const flip of [false, true]) {
      let project = shelfWithBack()
      project = { ...project, panels: project.panels.slice(0, 2).map(panel => ({ ...panel, rotation: [0.2, 0.4, 0.3] })),
        connections: [{ ...project.connections[0], side, flip, quarterTurn: true }],
      }
      const before = resolvePanels(project)
      const next = changeConnectorType(project, [getPhysicalConnectors(project)[0].id], '105')
      const after = resolvePanels(next)
      expect(after[0]).toEqual(before[0])
      expect(normal(before[1]).angleTo(normal(after[1]))).toBeCloseTo(Math.PI / 12, 8)
      expect(next.connections[0]).toMatchObject({ type: '105', side, flip, quarterTurn: true })
      expect(validateProject(next).filter(issue => issue.severity === 'error')).toEqual([])
    }
  })

  it('changes multiple joints atomically and leaves an unrelated branch alone', () => {
    let project = shelfWithBack()
    project = attachPanel(project, 'base', createPanel({ id: 'side', width: 300, height: 500 }), {
      side: 'left', type: '90', offset: 0, inset: 0, flip: true, color: '#ff0000', count: 2,
    })
    const pieces = getPhysicalConnectors(project)
    const next = changeConnectorType(project, [pieces[0].id, pieces[2].id], '150')
    expect(next.connections.map(connection => connection.type)).toEqual(['150', '150', '90'])
    expect(resolvePanels(next).at(-1)).toEqual(resolvePanels(project).at(-1))
    expect(validateProject(next)).toEqual([])
  })

  it('rejects broken supports in a closed frame without changing the source', () => {
    const project = createStarterProject('shelf'), snapshot = structuredClone(project)
    expect(() => changeConnectorType(project, [getPhysicalConnectors(project)[0].id], '150')).toThrow(/support joint/)
    expect(project).toEqual(snapshot)
  })

  it('rejects replacing occupied T branches with an angle, but retains per-piece T/cross upgrades', () => {
    const project = createStarterProject('shelf')
    const tee = getPhysicalConnectors(project).find(piece => piece.type === 't')!
    expect(() => changeConnectorType(project, [tee.id], '150')).toThrow(/T or Cross branches/)
    const corner = getPhysicalConnectors(project)[0]
    const upgraded = changeConnectorType(project, [corner.id], 'cross')
    expect(resolvePanels(upgraded)).toEqual(resolvePanels(project))
    expect(getPhysicalConnectors(upgraded).filter(piece => piece.type === 'cross')).toHaveLength(1)
    expect(resolvePanels(changeConnectorType(upgraded, [corner.id], '90'))).toEqual(resolvePanels(project))
  })

  it('rejects new panel collisions and keeps saved constraints and build space', () => {
    const project = shelfWithBack(), id = getPhysicalConnectors(project)[0].id
    const tilted = changeConnectorType(project, [id], '150')
    const obstacle = createPanel({ ...tilted.panels[1], id: 'obstacle', name: 'Obstacle', width: 50, height: 50 })
    const blocked = { ...project, panels: [...project.panels, obstacle] }
    expect(validateProject(blocked).filter(issue => issue.id.startsWith('collision-'))).toEqual([])
    expect(() => changeConnectorType(blocked, [id], '150')).toThrow(/overlaps/)
    const constrained: Project = { ...project, constraints: [{ id: 'height', kind: 'floor', enabled: true,
      panelId: 'back', reference: 'center', value: resolvePanels(project)[1].position[1] }] }
    expect(() => changeConnectorType(constrained, [id], '150')).toThrow(/constraint/)
    expect(() => changeConnectorType({ ...project, spaceConstraint: {
      enabled: true, width: 2000, height: 2000, depth: 600, centerX: 0, centerZ: 0,
    } }, [id], '150')).toThrow(/build space/)
  })

  it('protects linked sources but allows an ordinary extension on a stationary assembly panel', () => {
    const base = shelfWithBack()
    const assembly = createAssembly(base, base.panels.map(panel => panel.id), 'Shelf')
    expect(() => changeConnectorType(assembly, [getPhysicalConnectors(assembly)[0].id], '150')).toThrow(/Disassemble/)
    const withExtension = attachPanel(assembly, 'top', createPanel({ id: 'extension', width: 800, height: 200 }), {
      side: 'top', type: '90', offset: 0, inset: 0, flip: false, color: '#ff0000', count: 2,
    })
    const id = connectorId(withExtension.connections.at(-1)!.id, 0)
    const next = changeConnectorType(withExtension, [id], '150')
    expect(next.assemblies).toEqual(assembly.assemblies)
    const rebuilt = resolvePanels(materializeAssemblies(next))
    for (const panel of resolvePanels(next)) expect(rebuilt.find(candidate => candidate.id === panel.id)).toEqual(panel)
  })
})
