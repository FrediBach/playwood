import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { closePanelHole, findPanelHoles } from './close-holes'
import { parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { outlineConnectionAligned, outlineWorldPoints } from './outline-closures'
import { pentagonalFrame } from './outline-closure-test-fixtures'
import { getRescaleValues, rescaleProject } from './project-rescale'
import { movePanels, resizePanels } from './structure-edit'
import type { Project, Vec3 } from './types'

function filledFrame(rotated = false) {
  const project = rotated ? rotateProject(rotateProject(pentagonalFrame(), 'y', 31), 'z', 17) : pentagonalFrame()
  const hole = findPanelHoles(resolvePanels(project))[0]
  expect(hole).toBeDefined()
  return closePanelHole(project, project.panels.map(panel => panel.id), hole.id)
}

function expectFitted(project: Project, panelId: string) {
  const panels = resolvePanels(project), panel = panels.find(item => item.id === panelId)!
  const connections = project.connections.filter(connection => connection.childId === panelId)
  expect(connections).toHaveLength(5)
  expect(new Set(connections.map(connection => connection.outlineEdge)).size).toBe(5)
  for (const connection of connections) expect(outlineConnectionAligned(panels.find(item => item.id === connection.parentId)!, panel, connection)).toBe(true)
  expect(validateProject(project)).toEqual([])
  const serialized = JSON.parse(JSON.stringify(project))
  expect(parseProject(serialized)).toEqual(serialized)
  return panel
}

describe('fitted outline constraints', () => {
  it.each([false, true])('reshapes all five edges when a surrounding cut grows (rotated: %s)', rotated => {
    const { project, panelId } = filledFrame(rotated)
    const snapshot = structuredClone(project)
    const original = project.panels.find(panel => panel.id === panelId)!
    const top = project.panels.find(panel => panel.id === 'rim-3')!
    const next = resizePanels(parseProject(JSON.parse(JSON.stringify(project))), [top.id], { width: top.width + 100 })
    const fill = expectFitted(next, panelId)
    expect(next.panels.find(panel => panel.id === top.id)!.width).toBeCloseTo(top.width + 100, 5)
    expect(fill.customOutline).not.toEqual(original.customOutline)
    expect(outlineWorldPoints(fill).some((point, index) => point.distanceTo(outlineWorldPoints(original)[index]) > 10)).toBe(true)
    expect(next.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(project).toEqual(snapshot)
  })

  it('moves the complete frame and its fitted outline together without changing cuts', () => {
    const { project, panelId } = filledFrame()
    const delta: Vec3 = [100, 50, -75]
    const next = movePanels(project, project.panels.map(panel => panel.id), delta)
    const fill = expectFitted(next, panelId), original = project.panels.find(panel => panel.id === panelId)!
    expect(new Vector3(...fill.position).distanceTo(new Vector3(...original.position).add(new Vector3(...delta)))).toBeLessThan(1e-5)
    expect(fill.width).toBeCloseTo(original.width, 5)
    expect(fill.height).toBeCloseTo(original.height, 5)
    fill.customOutline!.forEach((point, index) => {
      expect(point.x).toBeCloseTo(original.customOutline![index].x, 6)
      expect(point.y).toBeCloseTo(original.customOutline![index].y, 6)
    })
  })

  it('keeps the closing face seated when repeated depth measurements are rescaled', () => {
    const { project, panelId } = filledFrame()
    const depth = getRescaleValues(project).find(value => value.kind === 'dimension' && value.value === 300)!
    expect(depth).toBeDefined()
    const next = rescaleProject(project, { [depth.id]: 360 })
    const fill = expectFitted(next, panelId), original = project.panels.find(panel => panel.id === panelId)!
    expect(fill.width).toBeCloseTo(original.width, 5)
    expect(fill.height).toBeCloseTo(original.height, 5)
    for (const panel of next.panels.filter(panel => panel.id !== panelId)) expect(panel.height).toBeCloseTo(360, 5)
  })

  it('resizes prescribed stock thickness on the fitted panel with its surrounding frame', () => {
    const { project, panelId } = filledFrame()
    const thickness = getRescaleValues(project).find(value => value.kind === 'thickness')!
    const next = rescaleProject(project, { [thickness.id]: 19 })
    expectFitted(next, panelId)
    expect(next.panels.every(panel => panel.thickness === 19)).toBe(true)
  })

  it('rejects a detached resize request on the fitted outline without changing the source', () => {
    const { project, panelId } = filledFrame()
    const snapshot = structuredClone(project)
    const fill = project.panels.find(panel => panel.id === panelId)!
    expect(() => resizePanels(project, [panelId], { width: fill.width + 50 })).toThrow('surrounding panels')
    expect(() => movePanels(project, [panelId], [0, 10, 0])).toThrow('surrounding panels')
    expect(project).toEqual(snapshot)
  })

  it('keeps an explicit cut requirement on the fitted panel during boundary edits', () => {
    const { project, panelId } = filledFrame()
    const fill = project.panels.find(panel => panel.id === panelId)!
    const constrained: Project = { ...project, constraints: [{ id: 'fixed-fill', kind: 'dimension', panelId, dimension: 'width', value: fill.width, enabled: true }] }
    const top = constrained.panels.find(panel => panel.id === 'rim-3')!
    expect(() => resizePanels(constrained, [top.id], { width: top.width + 100 })).toThrow(/width: exactly/)
    expect(constrained.panels).toEqual(project.panels)
  })
})
