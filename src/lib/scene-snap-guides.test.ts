import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, resolvePanels } from './model'
import { getPhysicalConnectors } from './connector-selection'
import { getSceneSnapGuides } from './scene-snap-guides'
import { snapTargets } from './preview-snap'
import type { Vec3 } from './types'

const moving = createPanel({ id: 'moving', width: 400, height: 300, thickness: 18, position: [0, 400, 0] })
const target = createPanel({ id: 'target', width: 200, height: 100, thickness: 18, position: [500, 600, 0] })
const props = { panels: [moving, target, createPanel({ id: 'hidden', visible: false })], connections: [] }
const selection = { connectorSelection: false, activePanelIds: ['moving'], activeConnectorIds: [] }

describe('scene snap guide sources and targets', () => {
  it('uses visible selected panel boundaries as sources and other visible panels as targets, in millimeters', () => {
    expect(getSceneSnapGuides(props, selection, null)).toEqual({
      sources: [[-200, 250, -9], [200, 550, 9]],
      targets: [[400, 550, -9], [600, 650, 9]],
      direction: [0, 0, 0],
    })
  })

  it('uses the current resize handle position for keyboard feedback', () => {
    const position: Vec3 = [220, 400, 0]
    const guides = getSceneSnapGuides({ ...props, resizeHandles: [{ id: 'width', position }] }, selection, { handleId: 'width', direction: [1, 0, 0] })
    expect(guides.sources).toEqual([position])
    expect(guides.direction).toEqual([1, 0, 0])
  })

  it('prioritizes a pointer probe over keyboard feedback and an explicit direction', () => {
    const snapProbe = { position: [200, 500, 0] as Vec3, direction: [0, 1, 0] as Vec3 }
    const guides = getSceneSnapGuides({ ...props, snapProbe, snapDirection: [0, 0, 1], resizeHandles: [{ id: 'width', position: [220, 400, 0] }] }, selection, { handleId: 'width', direction: [1, 0, 0] })
    expect(guides.sources).toEqual([snapProbe.position])
    expect(guides.direction).toEqual(snapProbe.direction)
  })

  it('falls back to panel boundaries when a resize handle disappears', () => {
    const guides = getSceneSnapGuides({ ...props, snapDirection: [0, 0, 1] }, selection, { handleId: 'missing', direction: [1, 0, 0] })
    expect(guides.sources).toEqual([[-200, 250, -9], [200, 550, 9]])
    expect(guides.direction).toEqual([0, 0, 1])
  })

  it('uses physical connector centers, including per-piece slides, in connector mode', () => {
    const project = createStarterProject('shelf')
    const pieces = getPhysicalConnectors(project)
    const selectedId = pieces[0].id
    project.connectorOverrides = { [selectedId]: { slide: 10 } }
    const resolved = { ...project, panels: resolvePanels(project) }
    const guides = getSceneSnapGuides(resolved, { connectorSelection: true, activePanelIds: [], activeConnectorIds: [selectedId] }, null)
    expect(guides.sources).toEqual(snapTargets(resolved, [], pieces.slice(1).map(piece => piece.id), true))
    expect(guides.sources).toHaveLength(1)
    expect(guides.targets).toEqual(snapTargets(resolved, [], [selectedId], true))
    expect(guides.targets.length).toBeGreaterThan(0)
  })
})
