import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { autoConnect } from './auto-connect'
import { getAutoConnectFit } from './auto-connect-fit'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import type { Project } from './types'

function bench(height = 388): Project {
  let project: Project = { version: 1, name: 'Bench corner', panels: [
    createPanel({ id: 'top', name: 'Bench top', width: 1200, height: 400, position: [450, 417.5, -217.5], rotation: [-Math.PI / 2, 0, 0] }),
    createPanel({ id: 'side', name: 'Bench side', width: 400, height: 400, position: [-167.5, 200, -217.5], rotation: [0, Math.PI / 2, 0] }),
    createPanel({ id: 'small', name: 'Small side panel', width: 300, height, position: [0, height / 2, 0] }),
  ], connections: [] }
  project = autoConnect(project, ['top', 'side']).project
  return autoConnect(project, ['side', 'small']).project
}

const positions = (project: Project) => getPhysicalConnectors(project).map(piece => {
  const rail = getConnectorRail(piece.connection, resolvePanels(project), project.connections)!
  return { id: piece.id, position: new Vector3(...rail.placements[piece.index].position).addScaledVector(new Vector3(...rail.tangent),
    connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)) }
})

describe('automatic connector fit proposals', () => {
  it('connects an exactly fitted small bench panel to the top', () => {
    const project = bench(400)
    expect(project.connections).toHaveLength(2)
    const result = autoConnect(project, ['small', 'top'])
    expect(result.joints).toBe(1)
    expect(result.project.panels).toEqual(project.panels)
    expect(validateProject(result.project)).toEqual([])
  })

  it.each([false, true])('offers a precise height correction, leaving the bottom, other panels and hardware fixed (rotated: %s)', rotated => {
    const project = rotated ? rotateProject(bench(), 'y', 31) : bench()
    const before = structuredClone(project)
    expect(project.connections).toHaveLength(2)
    expect(autoConnect(project, ['small', 'top']).joints).toBe(0)
    const fit = getAutoConnectFit(project, ['small', 'top'])!
    expect(fit).not.toBeNull()
    expect(fit.adjustment).toMatchObject({ panelId: 'small', targetPanelId: 'top', dimension: 'height', before: 388, after: 400 })
    expect(fit.result.joints).toBe(1)
    const resized = resolvePanels(fit.result.project).find(panel => panel.id === 'small')!
    expect(resized.position[1] - resized.height / 2).toBeCloseTo(0, 7)
    for (const panel of resolvePanels(project).filter(panel => panel.id !== 'small')) expect(resolvePanels(fit.result.project).find(item => item.id === panel.id)).toEqual(panel)
    const afterPositions = positions(fit.result.project)
    for (const piece of positions(project)) expect(afterPositions.find(item => item.id === piece.id)!.position.distanceTo(piece.position)).toBeLessThan(1e-6)
    expect(validateProject(fit.result.project)).toEqual([])
    expect(parseProject(JSON.parse(JSON.stringify(fit.result.project)))).toEqual(JSON.parse(JSON.stringify(fit.result.project)))
    expect(project).toEqual(before)
    expect(getAutoConnectFit(fit.result.project, ['small', 'top'])).toBeNull()
  })

  it('limits proposals to selected panels and small adjustments', () => {
    expect(getAutoConnectFit(bench(), ['small'])?.adjustment.panelId).toBe('small')
    expect(getAutoConnectFit(bench(), ['missing'])).toBeNull()
    expect(getAutoConnectFit(bench(330), ['small'])).toBeNull()
    expect(getAutoConnectFit(bench(400), ['small'])).toBeNull()
  })

  it('offers to shorten an oversized panel when existing hardware still fits', () => {
    const project = bench(412)
    const before = structuredClone(project)
    const fit = getAutoConnectFit(project, ['small'])!
    expect(fit.adjustment).toMatchObject({ panelId: 'small', dimension: 'height', before: 412, after: 400 })
    expect(fit.adjustment.distance).toBeCloseTo(-12, 7)
    const resized = fit.result.project.panels.find(panel => panel.id === 'small')!
    expect(resized.position[1] - resized.height / 2).toBeCloseTo(0)
    const after = positions(fit.result.project)
    for (const piece of positions(project)) expect(after.find(item => item.id === piece.id)!.position.distanceTo(piece.position)).toBeLessThan(1e-6)
    expect(getAutoConnectFit(fit.result.project, ['small'])).toBeNull()
    expect(validateProject(fit.result.project)).toEqual([])
    expect(project).toEqual(before)
  })

  it('rejects collisions and unsupported panel thickness', () => {
    const original = bench()
    const blocked = { ...original, panels: [...original.panels, createPanel({ id: 'obstacle', width: 60, height: 6, position: [0, 397, 0] })] }
    expect(getAutoConnectFit(blocked, ['small'])).toBeNull()
    const thick = { ...original, panels: original.panels.map(panel => panel.id === 'small' ? { ...panel, thickness: 25 } : panel) }
    expect(getAutoConnectFit(thick, ['small'])).toBeNull()
  })
})
