import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createAssembly } from './assemblies'
import { closePanelHole, findPanelHoles } from './close-holes'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { gridProject } from './example-geometry'
import { createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { moveStructureRepeat, prepareStructureRepeat } from './structure-repeat'
import type { Project, Vec3 } from './types'

const box = () => gridProject('Repeat box', [350], [350], { connectorColor: '#222222' })
const top = (project: Project) => project.panels.find(panel => panel.name === 'Shelf 1.2')!

describe('structure repeat', () => {
  it('shares the boundary panel, installs complete joints, and preserves the source and unrelated parts', () => {
    const original = box()
    const unrelated = createPanel({ position: [-2000, 1000, 0] })
    original.panels.push(unrelated)
    const snapshot = structuredClone(original)
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch)
    expect(session.pitch).toBeCloseTo(385)
    expect(session.panelIds).toHaveLength(4)
    expect(result).toMatchObject({ count: 1, limited: false })
    expect(result.distance).toBeCloseTo(385)
    expect(result.selectedPanelId).not.toBe(top(original).id)
    expect(result.project.panels).toHaveLength(8)
    expect(result.project.panels.find(panel => panel.id === unrelated.id)).toEqual(unrelated)
    expect(getPhysicalConnectors(result.project)).toHaveLength(12)
    expect(getPhysicalConnectors(result.project).filter(connector => connector.type === 't')).toHaveLength(4)
    expect(getPhysicalConnectors(result.project).every(connector => connector.color === '#222222')).toBe(true)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(original).toEqual(snapshot)
    expect(resolvePanels(result.project).filter(panel => original.panels.some(source => source.id === panel.id)))
      .toEqual(resolvePanels(original))
  })

  it('snaps to full cells, preserves preview identities on retraction, and never removes original panels', () => {
    const original = box()
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    expect(moveStructureRepeat(session, session.pitch * .49).project).toBe(original)
    const first = moveStructureRepeat(session, session.pitch * .51)
    const second = moveStructureRepeat(session, session.pitch * 2.1)
    expect(second.project.panels).toHaveLength(10)
    expect(second.count).toBe(2)
    expect(validateProject(second.project)).toEqual([])
    expect(moveStructureRepeat(session, session.pitch).project).toBe(first.project)
    expect(moveStructureRepeat(session, -session.pitch).project).toBe(original)
    expect(moveStructureRepeat(session, session.pitch * 2).project).toBe(second.project)
    const continued = prepareStructureRepeat(second.project, second.selectedPanelId, [1, 0, 0])
    const third = moveStructureRepeat(continued, continued.pitch)
    expect(third.count).toBe(1)
    expect(third.project.panels).toHaveLength(13)
    expect(validateProject(third.project)).toEqual([])
  })

  it('copies outside corner quantities and individual hardware without changing untouched original corners', () => {
    const original = box()
    const initial = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const outside = original.connections.filter(connection => [connection.parentId, connection.childId].includes(initial.leadingId))
    const untouched = original.connections.find(connection => !outside.includes(connection))!
    original.connections = original.connections.map(connection => connection.id === outside[0].id ? { ...connection, count: 1, color: '#111111' }
      : connection.id === outside[1].id ? { ...connection, count: 3, color: '#333333' } : connection)
    original.connectorOverrides = {
      [connectorId(outside[0].id, 0)]: { color: '#123456', material: 'metal', slide: 23 },
      [connectorId(outside[1].id, 0)]: { color: '#abcdef', slide: 12 },
      [connectorId(outside[1].id, 1)]: { removed: true },
      [connectorId(outside[1].id, 2)]: { color: '#654321', type: '105', material: 'plastic', slide: -8 },
      [connectorId(untouched.id, 0)]: { color: '#fedcba', material: 'metal', slide: 11 },
    }
    expect(validateProject(original)).toEqual([])
    const snapshot = structuredClone(original)
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch)
    expect(result.count).toBe(1)
    const outsideCopies = result.project.connections.filter(connection => connection.type === '90' && !original.connections.some(source => source.id === connection.id))
    expect(outsideCopies).toHaveLength(2)
    for (const copied of outsideCopies) {
      const source = original.connections.find(connection => connection.color === copied.color)!
      expect(copied.count).toBe(source.count)
      for (let index = 0; index < source.count; index++) {
        expect(result.project.connectorOverrides?.[connectorId(copied.id, index)])
          .toEqual(original.connectorOverrides[connectorId(source.id, index)])
      }
      const physical = (project: Project, id: string) => getPhysicalConnectors(project).filter(piece => piece.connection.id === id)
        .map(({ index, type, color, material }) => ({ index, type, color, material }))
      expect(physical(result.project, copied.id)).toEqual(physical(original, source.id))
    }
    expect(result.project.connections.find(connection => connection.id === untouched.id)).toEqual(untouched)
    expect(result.project.connectorOverrides?.[connectorId(untouched.id, 0)]).toEqual(original.connectorOverrides[connectorId(untouched.id, 0)])
    expect(getPhysicalConnectors(result.project)).toHaveLength(11)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
    expect(original).toEqual(snapshot)
  })

  it.each([1, -1])('repeats a rotated compartment along direction %i', sign => {
    const original = rotateProject(box(), 'z', 35)
    const axis = new Vector3(sign, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, 0, 35 * Math.PI / 180)))
    const session = prepareStructureRepeat(original, top(original).id, axis.toArray())
    const result = moveStructureRepeat(session, session.pitch * 2)
    expect(result.count).toBe(2)
    expect(result.project.panels).toHaveLength(10)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it('repeats vertically when pulling a side panel along the compartment height', () => {
    const original = box()
    const side = original.panels.find(panel => panel.name === 'Upright 2.1')!
    const session = prepareStructureRepeat(original, side.id, [0, 1, 0])
    expect(moveStructureRepeat(session, session.pitch * 2).count).toBe(2)
    expect(validateProject(moveStructureRepeat(session, session.pitch).project)).toEqual([])
  })

  it.each([1, -1])('repeats outward from a horizontal boundary along its normal (%i)', sign => {
    const original = box()
    const selected = sign > 0 ? top(original) : original.panels.find(panel => panel.name === 'Shelf 1.1')!
    const session = prepareStructureRepeat(original, selected.id, [0, sign, 0])
    expect(session.pitch).toBeCloseTo(385)
    const result = moveStructureRepeat(session, session.pitch * 2)
    expect(result.count).toBe(2)
    expect(result.project.panels).toHaveLength(10)
    expect(validateProject(result.project)).toEqual([])
    const continued = prepareStructureRepeat(result.project, result.selectedPanelId, [0, sign, 0])
    expect(moveStructureRepeat(continued, continued.pitch).count).toBe(1)
    expect(() => prepareStructureRepeat(original, selected.id, [0, -sign, 0])).toThrow('behind the pulled face')
  })

  it.each([1, -1])('repeats connected depth bays through the open face (%i), including reload and continuation', sign => {
    const original = box(), snapshot = structuredClone(original)
    const session = prepareStructureRepeat(original, top(original).id, [0, 0, sign])
    expect(session.pitch).toBeCloseTo(385)
    const first = moveStructureRepeat(session, session.pitch)
    expect(first.count, first.reason).toBe(1)
    expect(first.project.panels).toHaveLength(9)
    expect(getPhysicalConnectors(first.project)).toHaveLength(24)
    const divider = first.project.panels.find(panel => panel.name === 'Depth divider 1')!
    const joints = new Map<string, Set<string>>()
    for (const connection of first.project.connections) {
      const key = connection.id.replace(/:\d+$/, ''), members = joints.get(key) ?? new Set<string>()
      members.add(connection.parentId); members.add(connection.childId); joints.set(key, members)
    }
    expect([...joints.values()].filter(members => members.has(divider.id))).toHaveLength(4)
    for (const members of [...joints.values()].filter(members => members.has(divider.id))) {
      expect(members.size).toBe(3)
      expect(original.panels.filter(panel => members.has(panel.id))).toHaveLength(1)
    }
    expect(validateProject(first.project)).toEqual([])
    expect(resolvePanels(first.project).filter(panel => original.panels.some(source => source.id === panel.id))).toEqual(resolvePanels(original))
    const second = moveStructureRepeat(session, session.pitch * 2)
    expect(second.count, second.reason).toBe(2)
    expect(second.project.panels).toHaveLength(14)
    expect(getPhysicalConnectors(second.project)).toHaveLength(40)
    expect(moveStructureRepeat(session, 0).project).toBe(original)
    expect(moveStructureRepeat(session, session.pitch).project).toBe(first.project)
    const reloaded = parseProject(JSON.parse(JSON.stringify(second.project)))
    expect(reloaded).toEqual(second.project)
    const continued = prepareStructureRepeat(reloaded, second.selectedPanelId, [0, 0, sign])
    const third = moveStructureRepeat(continued, continued.pitch)
    expect(third.count, third.reason).toBe(1)
    expect(third.project.panels).toHaveLength(19)
    expect(validateProject(third.project)).toEqual([])
    expect(original).toEqual(snapshot)
  })

  it.each([
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ] as Vec3[])('repeats a rotated cell along its local direction %j', (...coordinates) => {
    const local = coordinates as Vec3
    const original = rotateProject(rotateProject(box(), 'y', 37), 'z', 23)
    const selected = local[1] < 0 ? original.panels.find(panel => panel.name === 'Shelf 1.1')! : top(original)
    const direction = new Vector3(...local).applyAxisAngle(new Vector3(0, 1, 0), 37 * Math.PI / 180)
      .applyAxisAngle(new Vector3(0, 0, 1), 23 * Math.PI / 180).toArray()
    const session = prepareStructureRepeat(original, selected.id, direction)
    const result = moveStructureRepeat(session, session.pitch * 2)
    expect(result.count, result.reason).toBe(2)
    expect(result.project.panels).toHaveLength(local[2] ? 14 : 10)
    expect(validateProject(result.project)).toEqual([])
    const reloaded = parseProject(JSON.parse(JSON.stringify(result.project)))
    const continued = prepareStructureRepeat(reloaded, result.selectedPanelId, direction)
    expect(moveStructureRepeat(continued, continued.pitch).count).toBe(1)
  })

  it('repeats one bay in depth beside another bay without changing its existing panels or joints', () => {
    const original = gridProject('Neighbors', [350, 350], [350], { connectorColor: '#222222' })
    const session = prepareStructureRepeat(original, top(original).id, [0, 0, 1])
    const result = moveStructureRepeat(session, session.pitch)
    expect(result.count, result.reason).toBe(1)
    expect(result.project.panels).toHaveLength(12)
    expect(resolvePanels(result.project).filter(panel => original.panels.some(source => source.id === panel.id))).toEqual(resolvePanels(original))
    expect(result.project.connections.filter(connection => original.connections.some(source => source.id === connection.id))).toEqual(original.connections)
    expect(validateProject(result.project)).toEqual([])
    expect(() => prepareStructureRepeat(result.project, result.selectedPanelId, [-1, 0, 0])).toThrow('open, empty rectangular compartments')
  })

  it('retains the last complete depth bay before a hidden obstacle and counts its divider toward document limits', () => {
    const original = box()
    original.panels.push(createPanel({ width: 200, height: 200, position: [0, 394, 900], visible: false }))
    const session = prepareStructureRepeat(original, top(original).id, [0, 0, 1])
    const result = moveStructureRepeat(session, session.pitch * 3)
    expect(result.count, result.reason).toBe(1)
    expect(result.limited).toBe(true)
    expect(result.reason).toMatch(/overlap/i)
    const crowded = box()
    crowded.panels.push(...Array.from({ length: 192 }, (_, index) => createPanel({ width: 40, height: 40, position: [20000 + index * 50, 1000, 0] })))
    const crowdedSession = prepareStructureRepeat(crowded, top(crowded).id, [0, 0, 1])
    expect(moveStructureRepeat(crowdedSession, crowdedSession.pitch)).toMatchObject({ project: crowded, count: 0, limited: true, reason: expect.stringContaining('200 panels') })
  })

  it('uses the actual depth for rectangular bays and rejects partly connected tiny depth sections', () => {
    const original = gridProject('Wide bay', [200], [450], { depth: 600 })
    const session = prepareStructureRepeat(original, top(original).id, [0, 0, 1])
    expect(session.pitch).toBeCloseTo(635)
    const result = moveStructureRepeat(session, session.pitch)
    expect(result.count, result.reason).toBe(1)
    expect(validateProject(result.project)).toEqual([])
    const tiny = gridProject('Tiny', [80], [80], { depth: 80 })
    const tinySession = prepareStructureRepeat(tiny, top(tiny).id, [0, 0, 1])
    const rejected = moveStructureRepeat(tinySession, tinySession.pitch)
    expect(rejected).toMatchObject({ project: tiny, count: 0, limited: true })
    expect(rejected.reason).toContain('connect all four divider edges')
  })

  it('rejects ambiguous, unsupported, and unconnected source compartments', () => {
    const stacked = gridProject('Stacked', [350], [350, 350])
    expect(() => prepareStructureRepeat(stacked, top(stacked).id, [1, 0, 0])).toThrow('more than one compartment')
    const original = box()
    expect(() => prepareStructureRepeat(original, top(original).id, [1, 1, 1])).toThrow('complete rectangular compartment')
    const thin = { ...original, panels: original.panels.map(panel => ({ ...panel, thickness: 16 })) }
    expect(() => prepareStructureRepeat(thin, top(thin).id, [1, 0, 0])).toThrow('18–19')
    const assembly = createAssembly(original, original.panels.map(panel => panel.id))
    expect(() => prepareStructureRepeat(assembly, top(assembly).id, [1, 0, 0])).toThrow('Disassemble')
    const custom = { ...original, panels: original.panels.map(panel => panel.id === top(original).id
      ? { ...panel, customOutline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] } : panel) }
    expect(() => prepareStructureRepeat(custom, top(custom).id, [1, 0, 0])).toThrow('rectangular panels')
    const inserts = { ...original, panels: original.panels.map(panel => panel.id === top(original).id
      ? { ...panel, trofastInserts: [{ id: 'insert', itemId: 'box', colorId: 'white', x: 175, y: 175, face: 1 as const }] } : panel) }
    expect(() => prepareStructureRepeat(inserts, top(inserts).id, [1, 0, 0])).toThrow('TROFAST')
    const unconnected = { ...original, panels: resolvePanels(original), connections: [] }
    expect(() => prepareStructureRepeat(unconnected, top(unconnected).id, [1, 0, 0])).toThrow('Connect all four corners')
  })

  it('stops at the last whole compartment before an obstacle, including hidden panels', () => {
    const original = box()
    const obstruction = createPanel({ width: 200, height: 200, position: [900, 394, 0], rotation: [-Math.PI / 2, 0, 0], visible: false })
    original.panels.push(obstruction)
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch * 3)
    expect(result.count).toBe(1)
    expect(result.limited).toBe(true)
    expect(result.reason).toMatch(/overlap/i)
    expect(moveStructureRepeat(session, session.pitch).limited).toBe(false)
    expect(moveStructureRepeat(session, 0).project).toBe(original)
  })

  it('rejects a closing face or internal shelf without rejecting adjacent grid compartments', () => {
    const original = box()
    const opening = findPanelHoles(resolvePanels(original))[0]
    const closed = closePanelHole(original, original.panels.map(panel => panel.id), opening.id).project
    expect(() => prepareStructureRepeat(closed, top(closed).id, [1, 0, 0])).toThrow('open, empty rectangular compartments')
    const shelf = createPanel({ width: 300, height: 300, position: [0, 200, 0], rotation: [-Math.PI / 2, 0, 0], visible: false })
    const filled = { ...original, panels: [...original.panels, shelf] }
    expect(() => prepareStructureRepeat(filled, top(filled).id, [1, 0, 0])).toThrow('open, empty rectangular compartments')
    const neighbors = gridProject('Neighbors', [350, 350], [350])
    const selected = neighbors.panels.find(panel => panel.name === 'Shelf 2.2')!
    const session = prepareStructureRepeat(neighbors, selected.id, [1, 0, 0])
    expect(moveStructureRepeat(session, session.pitch).count).toBe(1)
  })

  it('copies internal constraints without absolute floor rules or external relationships', () => {
    const original = box()
    const selected = top(original)
    const opposite = original.panels.find(panel => panel.name === 'Shelf 1.1')!
    const unrelated = createPanel({ width: 350, position: [-2000, 1000, 0] })
    original.panels.push(unrelated)
    original.constraints = [
      { id: 'width', enabled: true, kind: 'dimension', panelId: selected.id, dimension: 'width', value: 350 },
      { id: 'equal', enabled: true, kind: 'equal-dimension', panelIds: [selected.id, opposite.id], dimension: 'width' },
      { id: 'floor', enabled: true, kind: 'floor', panelId: selected.id, reference: 'center', value: resolvePanels(original).find(panel => panel.id === selected.id)!.position[1] },
      { id: 'outside', enabled: true, kind: 'equal-dimension', panelIds: [selected.id, unrelated.id], dimension: 'width' },
    ]
    const session = prepareStructureRepeat(original, selected.id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch * 2)
    expect(result.count).toBe(2)
    expect(result.project.constraints).toHaveLength(8)
    expect(result.project.constraints!.filter(rule => rule.kind === 'floor')).toHaveLength(1)
    expect(result.project.constraints!.slice(0, 4)).toEqual(original.constraints)
    expect(validateProject(result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(result.project)))).toEqual(result.project)
  })

  it('does not introduce another violated constraint from an imported source', () => {
    const original = box()
    original.constraints = [{ id: 'width', enabled: true, kind: 'dimension', panelId: top(original).id, dimension: 'width', value: 400 }]
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch)
    expect(result).toMatchObject({ count: 0, limited: true, project: original })
    expect(result.reason).toMatch(/400|constraint/i)
  })

  it('limits growth to a project that survives export and reload', () => {
    const original = box()
    const filler = Array.from({ length: 194 }, (_, index) => createPanel({ width: 40, height: 40, position: [20000 + index * 50, 1000, 0] as Vec3 }))
    original.panels.push(...filler)
    const session = prepareStructureRepeat(original, top(original).id, [1, 0, 0])
    const result = moveStructureRepeat(session, session.pitch)
    expect(result).toMatchObject({ count: 0, limited: true, project: original })
    expect(result.reason).toContain('200 panels')
  })
})
