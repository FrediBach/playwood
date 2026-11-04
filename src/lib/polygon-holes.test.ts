import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { closePanelHole, findPanelHoles } from './close-holes'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels, rotateProject, validateProject } from './model'
import { outlineConnectionAligned, outlineWorldPoints } from './outline-closures'
import { pentagonalFrame } from './outline-closure-test-fixtures'
import type { Panel, Project, Vec3 } from './types'

const seat = CONNECTOR_PROFILES['90'].seat
const pentagon: [number, number][] = [[-250, 100], [250, 100], [330, 400], [250, 700], [-250, 700]]
const concave: [number, number][] = [[0, 0], [600, 0], [600, 250], [250, 250], [250, 600], [0, 600]]

/** Position loose rim boards at their edge lines, leaving real corner seats. */
function polygonFrame(vertices: [number, number][]): Project {
  const points = vertices.map(([x, y]) => new Vector3(x, y, 0)), depth = new Vector3(0, 0, 1)
  const panels = points.map((start, index) => {
    const end = points[(index + 1) % points.length], tangent = end.clone().sub(start).normalize()
    const turn = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(tangent, depth, tangent.clone().cross(depth)))
    return createPanel({ id: `edge-${index}`, name: `Edge ${index}`, width: start.distanceTo(end) - seat * 2, height: 300,
      position: start.clone().add(end).multiplyScalar(0.5).toArray() as Vec3, rotation: [turn.x, turn.y, turn.z] })
  })
  return { version: 1, name: 'Polygon frame', panels, connections: [] }
}

function expectSupported(project: Project, panelId: string, boundaryIds: string[]) {
  const panel = project.panels.find(item => item.id === panelId)!
  const joints = project.connections.filter(connection => connection.childId === panelId && connection.outlineEdge !== undefined)
  expect(joints.map(joint => joint.parentId).sort()).toEqual([...boundaryIds].sort())
  expect(new Set(joints.map(joint => joint.outlineEdge)).size).toBe(panel.customOutline!.length)
  for (const joint of joints) expect(outlineConnectionAligned(project.panels.find(item => item.id === joint.parentId)!, panel, joint)).toBe(true)
  expect(validateProject(project)).toEqual([])
  return panel
}

describe('polygon opening discovery', () => {
  it.each([false, true])('finds and closes both five-sided faces (rotated: %s)', rotated => {
    const source = rotated ? rotateProject(rotateProject(pentagonalFrame(), 'y', 31), 'z', 17) : pentagonalFrame()
    const holes = findPanelHoles(resolvePanels(source))
    expect(holes.map(hole => hole.label)).toEqual(['Back', 'Front'])
    expect(holes.every(hole => hole.panel.customOutline?.length === 5)).toBe(true)
    const first = closePanelHole(source, source.panels.map(panel => panel.id), holes[0].id)
    expectSupported(first.project, first.panelId, source.panels.map(panel => panel.id))
    const remaining = findPanelHoles(resolvePanels(first.project))
    expect(remaining.map(hole => hole.label)).toEqual(['Front'])
    const second = closePanelHole(first.project, source.panels.map(panel => panel.id), remaining[0].id)
    expectSupported(second.project, second.panelId, source.panels.map(panel => panel.id))
    expect(findPanelHoles(resolvePanels(second.project))).toEqual([])
  })

  it('finds a triangular opening without inventing a fourth side', () => {
    const source = polygonFrame([[0, 0], [700, 0], [350, 600]])
    const holes = findPanelHoles(source.panels)
    expect(holes).toHaveLength(2)
    expect(holes.every(hole => hole.panel.customOutline?.length === 3)).toBe(true)
    const result = closePanelHole(source, source.panels.map(panel => panel.id), holes[0].id)
    expectSupported(result.project, result.panelId, source.panels.map(panel => panel.id))
  })

  it('retains the inward corner of an L-shaped opening instead of filling its convex hull', () => {
    const source = polygonFrame(concave)
    const holes = findPanelHoles(source.panels)
    expect(holes).toHaveLength(2)
    const result = closePanelHole(source, source.panels.map(panel => panel.id), holes[0].id)
    const fill = expectSupported(result.project, result.panelId, source.panels.map(panel => panel.id))
    const points = outlineWorldPoints(fill)
    expect(points).toHaveLength(6)
    expect(points.some(point => Math.abs(point.x - 232.5) < 1e-5 && Math.abs(point.y - 232.5) < 1e-5)).toBe(true)
    const area = Math.abs(points.reduce((sum, point, i) => sum + point.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * point.y, 0)) / 2
    expect(area).toBeCloseTo(565 * 565 - 350 * 350, 5)
  })

  it('keeps both inline rim boards on one outline edge without selecting the outside branch', () => {
    const source = polygonFrame(pentagon), original = source.panels.at(-1)!
    const tangent = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...original.rotation)))
    const width = (original.width - seat * 2) / 2
    const halves = [-1, 1].map(sign => ({ ...original, id: `split-${sign}`, width,
      position: new Vector3(...original.position).addScaledVector(tangent, sign * (width + seat * 2) / 2).toArray() as Vec3 }))
    const branch = createPanel({ id: 'outside-branch', name: 'Outside branch', width: 265, height: 300,
      position: [-400, 400, 0], rotation: [Math.PI / 2, 0, 0] })
    const selected = [...source.panels.slice(0, -1), ...halves]
    const project = { ...source, panels: [...selected, branch] }
    const holes = findPanelHoles(selected, project.panels)
    expect(holes).toHaveLength(2)
    expect(holes.every(hole => hole.boundaryIds.length === 6 && hole.panel.customOutline?.length === 5)).toBe(true)
    const result = closePanelHole(project, selected.map(panel => panel.id), holes[0].id)
    expectSupported(result.project, result.panelId, selected.map(panel => panel.id))
    const splitJoints = result.project.connections.filter(joint => halves.some(panel => panel.id === joint.parentId))
    expect(splitJoints).toHaveLength(2)
    expect(splitJoints[0].outlineEdge).toBe(splitJoints[1].outlineEdge)
  })

  it('requires every visible rim edge and does not bridge gaps beyond connector seats', () => {
    const source = polygonFrame(pentagon)
    for (const panel of source.panels) {
      expect(findPanelHoles(source.panels.filter(item => item !== panel))).toEqual([])
      expect(findPanelHoles(source.panels.map(item => item === panel ? { ...item, visible: false } : item))).toEqual([])
    }
    const short = source.panels.map((panel, index) => index ? panel : { ...panel, width: panel.width - 20 })
    expect(findPanelHoles(short)).toEqual([])
    const nonplanar = source.panels.map((panel, index) => index ? panel : { ...panel, position: [panel.position[0], panel.position[1], 10] as Vec3 })
    expect(findPanelHoles(nonplanar)).toEqual([])
  })

  it('rejects ambiguous overlapping rim boards rather than choosing one silently', () => {
    const source = polygonFrame(pentagon)
    const duplicate = { ...source.panels[0], id: 'duplicate-rim' }
    expect(findPanelHoles([...source.panels, duplicate])).toEqual([])
    expect(findPanelHoles([...source.panels, duplicate, { ...duplicate, id: 'third-rim' }])).toEqual([])
  })

  it.each([true, false])('blocks occupied faces with outside-selection obstacles (visible: %s)', visible => {
    const source = polygonFrame(pentagon)
    const front = findPanelHoles(source.panels).find(hole => hole.label === 'Front')!
    const obstacle = createPanel({ id: 'obstacle', width: 80, height: 80, position: front.panel.position, rotation: front.panel.rotation, visible })
    expect(findPanelHoles(source.panels, [...source.panels, obstacle]).map(hole => hole.label)).toEqual(['Back'])
    const interior = { ...obstacle, position: [obstacle.position[0], obstacle.position[1], 140] as Vec3 }
    expect(findPanelHoles(source.panels, [...source.panels, interior]).map(hole => hole.label)).toEqual(['Back'])
  })

  it('distinguishes an obstacle in the concave notch from one inside the actual opening', () => {
    const source = polygonFrame(concave)
    const obstacle: Panel = createPanel({ id: 'obstacle', width: 80, height: 80, position: [450, 450, 167.5], visible: false })
    expect(findPanelHoles(source.panels, [...source.panels, obstacle])).toHaveLength(2)
    expect(findPanelHoles(source.panels, [...source.panels, { ...obstacle, position: [100, 100, 167.5] }]).map(hole => hole.label)).toEqual(['Back'])
  })
})
