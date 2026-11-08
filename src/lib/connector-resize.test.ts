import { describe, expect, it } from 'vitest'
import { roundTripProject } from '../test/project-round-trip'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import { resizePanels } from './structure-edit'
import { synthShelfProject } from './synth-shelf'
import type { Project } from './types'

function positions(project: Project) {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  return getPhysicalConnectors(project).filter(piece => piece.connection.type === '150').map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const along = rail.along[piece.index] + connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide)
    return { id: piece.id, fraction: (along - rail.lower) / (rail.upper - rail.lower) }
  })
}

describe('connector placement during connected resizing', () => {
  it.each([600, 1200])('scales the optimized synth shelf hardware proportionally at width %i', width => {
    const source = synthShelfProject()
    const snapshot = structuredClone(source)
    const next = resizePanels(source, [source.panels[0].id], { width })
    const before = positions(source), after = positions(next)
    expect(after.map(piece => piece.id)).toEqual(before.map(piece => piece.id))
    after.forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
    expect(source).toEqual(snapshot)
    expect(roundTripProject(next)).toEqual(next)
    const restored = resizePanels(next, [source.panels[0].id], { width: 900 })
    positions(restored).forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
  })

  it('rejects shrinking when the scaled distribution would crowd installed pieces', () => {
    const source = synthShelfProject()
    const snapshot = structuredClone(source)
    expect(() => resizePanels(source, [source.panels[0].id], { width: 200 })).toThrow('crowd connectors')
    expect(source).toEqual(snapshot)
  })

  it('scales hidden hardware and removed-piece positions without losing appearance overrides', () => {
    const source = synthShelfProject()
    source.panels = source.panels.map(panel => ({ ...panel, visible: false }))
    const key = Object.keys(source.connectorOverrides!)[0]
    source.connectorOverrides![key] = { ...source.connectorOverrides![key], removed: true, color: '#123456' }
    const next = resizePanels(source, [source.panels[0].id], { width: 1200 })
    expect(next.connectorOverrides![key]).toMatchObject({ removed: true, color: '#123456' })
    expect(next.connectorOverrides![key].slide).toBeCloseTo(70 * 1160 / 860)
    const before = positions(source)
    positions(next).forEach((piece, index) => expect(piece.fraction).toBeCloseTo(before[index].fraction, 7))
  })
})
