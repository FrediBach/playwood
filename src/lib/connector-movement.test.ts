import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector3 } from 'three'
import { createPanel, parseProject, resolvePanels } from './model'
import { connectorId, editConnectors } from './connector-selection'
import { connectorSlide, getConnectorKeyboardSlides, getConnectorRail } from './connector-movement'
import type { Project } from './types'

const camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100)
camera.position.set(0, 0, 5)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()
const fixture = (): Project => ({ version: 1, name: 'Rail', panels: [createPanel({ id: 'a', position: [0, 0, 0] }), createPanel({ id: 'b' })],
  connections: [{ id: 'joint', parentId: 'a', childId: 'b', type: '90', side: 'top', offset: 0, inset: 0, flip: false, color: '#ffffff', count: 1 }] })
const id = connectorId('joint', 0)
const move = (project: Project, key = 'ArrowRight', shiftKey = false) => getConnectorKeyboardSlides(project, resolvePanels(project), [id], { camera, key, shiftKey, viewport: { width: 800, height: 800 } })

describe('connector keyboard sliding', () => {
  it('uses panel increments, ignores perpendicular arrows, and persists without moving panels', () => {
    const project = fixture()
    expect(move(project)).toEqual({ [id]: 10 })
    expect(move(project, 'ArrowLeft', true)).toEqual({ [id]: -100 })
    expect(move(project, 'ArrowUp')).toEqual({})
    const edited = editConnectors(project, [id], { slide: 10 })
    expect(move(edited)).toEqual({ [id]: 20 })
    expect(resolvePanels(edited)).toEqual(resolvePanels(project))
    expect(parseProject(JSON.parse(JSON.stringify(edited))).connectorOverrides).toEqual(edited.connectorOverrides)
    expect(() => parseProject({ ...project, connectorOverrides: { [id]: { slide: 'bad' } } })).toThrow()
  })
  it('clamps to panel overlap and rounded corners, including quarter-turned children', () => {
    const project = fixture()
    project.panels[1].width = 140
    project.panels[1].cornerRadius = 20
    expect(move(editConnectors(project, [id], { slide: 25 }))).toEqual({ [id]: 30 })
    expect(move(editConnectors(project, [id], { slide: 30 }))).toEqual({})
    project.connections[0].quarterTurn = true
    const rail = getConnectorRail(project.connections[0], resolvePanels(project), project.connections)!
    expect(rail.upper).toBe(140)
    expect(connectorSlide(rail, 0, 200)).toBe(140)
  })
  it('skips hidden, removed, or tightly fitted hardware and respects neighbors', () => {
    const project = fixture()
    expect(move(editConnectors(project, [id], { removed: true }))).toEqual({})
    project.panels[1].visible = false
    expect(move(project)).toEqual({})
    project.panels[1].visible = true
    project.panels[1].width = 40
    expect(move(project)).toEqual({})
    project.panels[1].width = 140
    project.connections[0].count = 2
    expect(move(project, 'ArrowRight', true)).toEqual({ [id]: 60 })
    expect(move(editConnectors(project, [connectorId('joint', 1)], { removed: true }), 'ArrowRight', true)).toEqual({ [id]: 100 })
  })
  it('uses rotated seam directions and the shortest T joint branch', () => {
    const project = fixture()
    project.panels[0].rotation = [0, 0, Math.PI / 2]
    expect(move(project)).toEqual({})
    expect(move(project, 'ArrowUp')).toEqual({ [id]: 10 })
    project.connections[0].type = 't'
    project.connections[0].id = 'joint:0'
    project.panels.push(createPanel({ id: 'c', width: 80 }))
    project.connections.push({ ...project.connections[0], id: 'joint:1', childId: 'c', count: 0 })
    const rail = getConnectorRail(project.connections[0], resolvePanels(project), project.connections)!
    expect(rail.upper - rail.lower).toBe(40)
    expect(new Vector3(...rail.tangent).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-8)
  })
})
