import optimizedShelf from '../../resources/library-3d/user-projects/three-tier-synth-shelf.json'
import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { roundTripProject } from '../test/project-round-trip'
import { overlappingHardware } from './connector-hardware-test-helpers'
import { getPhysicalConnectors } from './connector-selection'
import { getProjectBounds, parseProject, resolvePanels, validateProject } from './model'
import { synthShelfProject } from './synth-shelf'

describe('three-tier synth shelf', () => {
  it('preserves the supplied optimized project and returns independent copies', () => {
    const project = synthShelfProject()
    expect(project).toEqual(parseProject(structuredClone(optimizedShelf)))
    expect(project.panels).toHaveLength(16)
    expect(getPhysicalConnectors(project)).toHaveLength(40)
    const second = synthShelfProject()
    project.panels[0].height = 1000
    const key = Object.keys(project.connectorOverrides!)[0]
    project.connectorOverrides![key].slide = 0
    expect(second).toEqual(parseProject(structuredClone(optimizedShelf)))
  })

  it('has three descending 30° trays with raised front stops and a grounded base', () => {
    const project = synthShelfProject()
    const panels = resolvePanels(project)
    const trays = panels.filter(panel => panel.name.startsWith('Synth tray'))
    expect(trays).toHaveLength(3)
    const base = panels.find(panel => panel.name === 'Deep floor base')!
    const baseBounds = getProjectBounds([base])
    expect(baseBounds.min[1]).toBeCloseTo(0)
    for (const [index, tray] of trays.entries()) {
      expect([tray.width, tray.thickness]).toEqual([900, 18])
      expect(tray.height).toBeCloseTo(343.16, 1)
      const front = new Vector3(0, -1, 0).applyEuler(new Euler(...tray.rotation))
      expect(front.y).toBeCloseTo(-0.5)
      expect(front.z).toBeCloseTo(Math.sqrt(3) / 2)
      const stop = panels.find(panel => panel.name === `Front stopper ${index + 1}`)!
      expect(stop.position[2]).toBeGreaterThan(tray.position[2])
      const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...tray.rotation))
      normal.multiplyScalar(Math.sign(normal.y))
      expect(new Vector3(...stop.position).sub(new Vector3(...tray.position)).dot(normal)).toBeGreaterThan(40)
      const bounds = getProjectBounds([tray, stop])
      expect(bounds.min[1]).toBeGreaterThan(baseBounds.max[1] + 100)
      if (index) expect(tray.position[1] - trays[index - 1].position[1]).toBeCloseTo(385, 1)
    }
  })

  it('connects every panel, fits all hardware and preserves joints through saving', () => {
    const project = synthShelfProject()
    expect(validateProject(project)).toEqual([])
    expect(overlappingHardware(project)).toEqual([])
    const reached = new Set([project.panels[0].id])
    for (let i = 0; i < project.panels.length; i++) {
      for (const joint of project.connections) {
        if (reached.has(joint.parentId)) reached.add(joint.childId)
        if (reached.has(joint.childId)) reached.add(joint.parentId)
      }
    }
    expect(reached.size).toBe(project.panels.length)
    const hardware = getPhysicalConnectors(project)
    expect(hardware.filter(piece => piece.connection.type === '150')).toHaveLength(15)
    expect(roundTripProject(project)).toEqual(project)
  })
})
