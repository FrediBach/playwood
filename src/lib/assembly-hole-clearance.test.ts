import { roundTripProject } from '../test/project-round-trip'
import { describe, expect, it } from 'vitest'
import { createAssembly, getAssemblyAttachmentTargets, materializeAssemblies } from './assemblies'
import { closePanelHole, findPanelHoles } from './close-holes'
import { installedHardware, overlappingHardware } from './connector-hardware-test-helpers'
import { connectorId, getPhysicalConnectors } from './connector-selection'
import { gridProject } from './example-geometry'
import { resolvePanels, rotateProject, validateProject } from './model'

describe('assembly hole connector clearance', () => {
  it('fits against materialized shared cross joints while retaining the neighboring linked instance', () => {
    const frame = gridProject('Linked boxes', [350], [350])
    const assembly = createAssembly(frame, frame.panels.map(panel => panel.id))
    const original = getAssemblyAttachmentTargets(assembly, assembly.assemblies!.instances[0].id)
      .find(target => target.project && !target.warning && target.project.assemblies!.links.length)!.project!
    const instance = original.assemblies!.instances[0]
    const ids = Object.values(instance.panelIds)
    const panels = resolvePanels(original)
    const hole = findPanelHoles(panels.filter(panel => ids.includes(panel.id)), panels)[0]
    const result = closePanelHole(original, ids, hole.id)
    expect(result.project.assemblies!.links).toEqual(original.assemblies!.links)
    expect(result.project.assemblies!.instances[1]).toEqual(original.assemblies!.instances[1])
    expect(overlappingHardware(result.project)).toEqual([])
    const loaded = roundTripProject(result.project)
    expect(materializeAssemblies(loaded)).toEqual(loaded)
    expect(validateProject(loaded)).toEqual([])
  })

  it('keeps the source definition consistent when clearance requires a single clamp on a short edge', () => {
    const frame = gridProject('Narrow box', [130], [350])
    const original = createAssembly(frame, frame.panels.map(panel => panel.id))
    const hole = findPanelHoles(resolvePanels(original))[0]
    const result = closePanelHole(original, original.panels.map(panel => panel.id), hole.id)
    const added = result.project.connections.filter(connection => connection.parentId === result.panelId || connection.childId === result.panelId)
    expect(added.some(connection => connection.count === 1)).toBe(true)
    expect(overlappingHardware(result.project)).toEqual([])
    const loaded = roundTripProject(result.project)
    expect(materializeAssemblies(loaded)).toEqual(loaded)
    expect(validateProject(loaded)).toEqual([])
  })

  it.each([0, 37])('retains installed hardware and saves closure slides after assembly materialization (%i degrees)', degrees => {
    const frame = gridProject('Box', [350], [350])
    let original = createAssembly(frame, frame.panels.map(panel => panel.id))
    original.connectorOverrides = Object.fromEntries(original.connections.flatMap((connection, index) => [
      [connectorId(connection.id, 0), { slide: 18, color: '#123456', ...(index === 0 ? { type: '105' as const } : {}) }],
      [connectorId(connection.id, 1), index === 1 ? { removed: true } : { slide: -18, material: 'metal' as const }],
    ]))
    if (degrees) original = rotateProject(original, 'y', degrees)
    const snapshot = structuredClone(original)
    const oldHardware = installedHardware(original)
    expect(overlappingHardware(original)).toEqual([])
    const holes = findPanelHoles(resolvePanels(original))
    let project = original
    for (const hole of holes) {
      project = closePanelHole(project, project.panels.map(panel => panel.id), hole.id).project
      expect(overlappingHardware(project)).toEqual([])
      const installed = installedHardware(project)
      for (const piece of oldHardware) {
        const retained = installed.find(candidate => candidate.id === piece.id)!
        expect(retained).toBeDefined()
        expect(retained.origin.distanceTo(piece.origin)).toBeLessThan(1e-7)
        expect(Math.abs(retained.orientation.dot(piece.orientation))).toBeCloseTo(1, 7)
        expect(retained.type).toBe(piece.type)
      }
      for (const [id, override] of Object.entries(original.connectorOverrides!)) expect(project.connectorOverrides?.[id]).toEqual(override)
      const oldIds = new Set(getPhysicalConnectors(original).map(piece => piece.id))
      expect(getPhysicalConnectors(project).some(piece => !oldIds.has(piece.id) && Math.abs(project.connectorOverrides?.[piece.id]?.slide ?? 0) > 1)).toBe(true)
      const loaded = roundTripProject(project)
      expect(loaded).toEqual(project)
      expect(materializeAssemblies(loaded)).toEqual(loaded)
      expect(overlappingHardware(loaded)).toEqual([])
      expect(validateProject(loaded)).toEqual([])
    }
    expect(original).toEqual(snapshot)
  })
})
