import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { createPanel, getConnectorSeam, parseProject, validateProject } from './model'
import { connectClosingPanel } from './closure-connectors'
import { outlineConnectionAligned, outlineJointFrame, outlineWorldPoints, refitOutlineClosures } from './outline-closures'
import type { Panel, Project } from './types'
import { assertOutlineConnectionEdit } from './outline-connection-edits'
import { panelOutlineCorners } from './panel-shape'

/** Each rim board seats on one edge of a five-sided panel, including a diagonal. */
function polygonFixture(overrides: Partial<Panel> = {}) {
  const panel = createPanel({ id: 'fill', width: 500, height: 400, position: [0, 600, 200], customOutline: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.6 }, { x: 0.7, y: 1 }, { x: 0, y: 1 },
  ], ...overrides })
  const points = outlineWorldPoints(panel), depth = new Vector3(0, 0, 1)
  const panels: Panel[] = points.map((first, index) => {
    const last = points[(index + 1) % points.length], edge = last.clone().sub(first)
    const inward = edge.clone().normalize().cross(depth)
    const rotation = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(edge.clone().normalize(), depth, inward)))
    return createPanel({ id: `rim-${index}`, name: `Rim ${index}`, width: edge.length() - 50, height: 300,
      position: first.clone().add(last).multiplyScalar(0.5).addScaledVector(inward, -17.5).addScaledVector(depth, -167.5).toArray(),
      rotation: [rotation.x || 0, rotation.y || 0, rotation.z || 0] })
  })
  const project: Project = { version: 1, name: 'Polygon', panels, connections: [] }
  return { panel, project: connectClosingPanel(project, panel, panels.map(item => item.id)) }
}

describe('outline edge supports', () => {
  it('keeps a full clamp on the straight portion left by acute outline fillets', () => {
    const { panel, project } = polygonFixture({ width: 400, height: 200 * Math.sqrt(3), customOutline: [
      { x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 },
    ] })
    const rounded = { ...panel, cornerRadius: 150 }
    const candidate = { ...project, panels: project.panels.map(item => item.id === panel.id ? rounded : item) }
    const corners = panelOutlineCorners(rounded)
    const straight = Math.hypot(corners[1].entry.x - corners[0].exit.x, corners[1].entry.y - corners[0].exit.y)
    expect(straight).toBeCloseTo(60.5180417165)
    const joint = project.connections.find(connection => connection.outlineEdge === 0)!
    const parent = project.panels.find(item => item.id === joint.parentId)!
    const seam = getConnectorSeam(joint, parent, rounded)
    expect(seam.upper - seam.lower).toBeCloseTo(straight - 40)
    expect(() => assertOutlineConnectionEdit(project, candidate)).toThrow('fitted outline joint')
    expect(validateProject(candidate).filter(issue => issue.id.endsWith('-overlap'))).toHaveLength(3)
    const onePerEdge = { ...candidate, connections: candidate.connections.map(connection => ({ ...connection, count: 1 })) }
    expect(assertOutlineConnectionEdit(project, onePerEdge)).toBe(onePerEdge)
    expect(validateProject(onePerEdge)).toEqual([])
  })

  it('fits hardware to every actual polygon edge and persists the edge references', () => {
    const { panel, project } = polygonFixture()
    expect(project.connections).toHaveLength(5)
    expect(new Set(project.connections.map(connection => connection.outlineEdge))).toEqual(new Set([0, 1, 2, 3, 4]))
    expect(validateProject(project)).toEqual([])
    expect(roundTripProject(project)).toEqual(project)
    const joint = project.connections.find(connection => connection.outlineEdge === 2)!
    const parent = project.panels.find(item => item.id === joint.parentId)!
    const seam = getConnectorSeam(joint, parent, panel)
    expect(seam.upper - seam.lower).toBeCloseTo(Math.hypot(150, 160) - 90)
  })

  it('rebuilds the vertices from moved rim edges instead of stretching their old proportions', () => {
    const { panel, project } = polygonFixture(), before = structuredClone(project)
    const joint = project.connections.find(connection => connection.outlineEdge === 0)!
    const parent = project.panels.find(item => item.id === joint.parentId)!
    const delta = outlineJointFrame(parent, joint).inward.multiplyScalar(-80)
    const moved = project.panels.map(item => item.id === parent.id ? { ...item, position: new Vector3(...item.position).add(delta).toArray() } : item)
    const fitted = refitOutlineClosures(moved, project.connections)
    const result = fitted.find(item => item.id === panel.id)!
    expect(result.height).toBeCloseTo(480)
    expect(result.customOutline![2].y).toBeCloseTo(320 / 480)
    expect(result.customOutline![2].y).not.toBeCloseTo(panel.customOutline![2].y)
    expect(project).toEqual(before)
    expect(project.connections.every(connection => outlineConnectionAligned(fitted.find(item => item.id === connection.parentId)!, result, connection))).toBe(true)
  })

  it('rejects a rim that no longer shares a plane and keeps the source immutable', () => {
    const { project } = polygonFixture(), before = structuredClone(project)
    const changed = project.panels.map((panel, index) => index === 0 ? { ...panel, position: [panel.position[0], panel.position[1], panel.position[2] + 10] as [number, number, number] } : panel)
    expect(() => refitOutlineClosures(changed, project.connections)).toThrow('one plane')
    expect(project).toEqual(before)
  })

  it('keeps two inline rim boards attached to the same outline edge', () => {
    const { panel, project } = polygonFixture(), original = project.panels[0]
    const originalJoint = project.connections.find(connection => connection.parentId === original.id)!
    const frame = outlineJointFrame(original, originalJoint), width = (original.width - 35) / 2
    const split = [-1, 1].map(sign => createPanel({ ...original, id: `${original.id}:${sign}`, width,
      position: new Vector3(...original.position).addScaledVector(frame.tangent, sign * (width + 35) / 2).toArray() }))
    const rims = [...project.panels.filter(item => item.id !== original.id && item.id !== panel.id), ...split]
    const fitted = connectClosingPanel({ ...project, panels: rims, connections: [] }, panel, rims.map(item => item.id))
    expect(fitted.connections.filter(connection => connection.outlineEdge === 0)).toHaveLength(2)
    const shifted = fitted.panels.map(item => split.some(part => part.id === item.id)
      ? { ...item, position: new Vector3(...item.position).addScaledVector(frame.inward, -20).toArray() } : item)
    const result = refitOutlineClosures(shifted, fitted.connections)
    expect(result.find(item => item.id === panel.id)!.height).toBeCloseTo(panel.height + 20)
    expect(validateProject({ ...fitted, panels: result })).toEqual([])
    const mismatched = shifted.map(item => item.id === split[0].id ? { ...item, position: new Vector3(...item.position).addScaledVector(frame.inward, -5).toArray() } : item)
    expect(() => refitOutlineClosures(mismatched, fitted.connections)).toThrow('surrounding edges')
  })

  it.each([{ outlineEdge: 1.5 }, { outlineEdge: 5 }, { role: undefined }, { type: '105' }, { quarterTurn: true }, { inset: 2 }])('rejects malformed saved edge supports: %s', patch => {
    const { project } = polygonFixture()
    expect(() => parseProject({ ...project, connections: project.connections.map((connection, index) => index ? connection : { ...connection, ...patch }) })).toThrow('outline edge')
  })

  it('rejects manual outline edits, rectangle reset, and rim rotation without detaching', () => {
    const { panel, project } = polygonFixture()
    for (const customOutline of [undefined, panel.customOutline!.map((point, index) => index === 2 ? { ...point, y: 0.5 } : point)]) {
      const edited = { ...project, panels: project.panels.map(item => item.id === panel.id ? { ...item, customOutline } : item) }
      expect(() => assertOutlineConnectionEdit(project, edited)).toThrow('detach')
    }
    const turned = { ...project, panels: project.panels.map((item, index) => index ? item : { ...item, rotation: [0, 0, 0] as [number, number, number] }) }
    expect(() => assertOutlineConnectionEdit(project, turned)).toThrow('detach')
    expect(assertOutlineConnectionEdit(project, { ...project, connections: [] })).toMatchObject({ connections: [] })
  })

  it('allows unchanged imported joint problems and finish edits while rejecting worsened geometry', () => {
    const { project, panel } = polygonFixture()
    const imported = { ...project, panels: project.panels.map(item => item.id === panel.id ? { ...item, width: item.width + 1 } : item) }
    const finish = { ...imported, panels: imported.panels.map(item => ({ ...item, color: '#123456' })) }
    expect(assertOutlineConnectionEdit(imported, finish)).toBe(finish)
    const changed = { ...finish, panels: finish.panels.map(item => item.id === panel.id ? { ...item, width: item.width + 1 } : item) }
    expect(() => assertOutlineConnectionEdit(imported, changed)).toThrow('detach')
  })
})
