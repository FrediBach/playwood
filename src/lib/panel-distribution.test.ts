import { roundTripProject } from '../test/project-round-trip'
import importedShelf from '../../tests/fixtures/everyday-shelf-distribution.json'
import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { createPanel, parseProject, resolvePanels, validateProject } from './model'
import { gridProject } from './example-geometry'
import { closePanelHole, findPanelHoles } from './close-holes'
import { movePanels } from './structure-edit'
import { createAssembly } from './assemblies'
import { distributePanels, panelDistribution } from './panel-distribution'
import type { Project, Vec3 } from './types'

const fixture = (rotation: Vec3 = [0, 0, 0]): Project => ({ version: 1, name: 'Distribution', connections: [],
  panels: [0, 100, 700, 1000].map((distance, index) => createPanel({ id: `p${index}`, width: 200, height: 200, thickness: [18, 30, 12, 18][index], rotation,
    position: new Vector3(25 * index, 0, distance).applyEuler(new Euler(...rotation)).add(new Vector3(0, 500, 0)).toArray() as Vec3 })) })
const ids = (project: Project) => project.panels.map(panel => panel.id)

function expectGaps(project: Project, selected: string[]) {
  const panels = resolvePanels(project).filter(panel => selected.includes(panel.id))
  const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...panels[0].rotation))
  const ordered = panels.map(panel => ({ panel, at: new Vector3(...panel.position).dot(normal) })).sort((a, b) => a.at - b.at)
  const gaps = ordered.slice(1).map((item, index) => item.at - item.panel.thickness / 2 - ordered[index].at - ordered[index].panel.thickness / 2)
  gaps.forEach(gap => expect(gap).toBeCloseTo(gaps[0], 5))
}

describe('parallel panel distribution', () => {
  it.each<Vec3>([[0, 0, 0], [-Math.PI / 2, 0, 0], [0, Math.PI / 2, 0], [0.3, 0.7, 0.2]])('equalizes clear gaps for rotation %j', (...rotation) => {
    const project = fixture(rotation as Vec3), snapshot = structuredClone(project)
    const next = distributePanels(project, ids(project).reverse())
    expectGaps(next, ids(project))
    for (const index of [0, 3]) next.panels[index].position.forEach((value, axis) => expect(value).toBeCloseTo(project.panels[index].position[axis], 6))
    next.panels.forEach((panel, index) => {
      expect(panel.rotation).toEqual(project.panels[index].rotation)
      expect(panel.width).toBe(project.panels[index].width)
      const localDelta = new Vector3(...panel.position).sub(new Vector3(...project.panels[index].position)).applyQuaternion(new Quaternion().setFromEuler(new Euler(...rotation)).invert())
      expect(localDelta.x).toBeCloseTo(0, 6)
      expect(localDelta.y).toBeCloseTo(0, 6)
    })
    expect(distributePanels(next, ids(next))).toBe(next)
    expect(project).toEqual(snapshot)
  })

  it('accepts opposite normals and in-plane rotation, and rejects nonparallel or undersized selections', () => {
    const project = fixture()
    project.panels[1].rotation = [Math.PI, 0, 0.4]
    expectGaps(distributePanels(project, ids(project)), ids(project))
    expect(panelDistribution(project.panels.slice(0, 2))).toBeUndefined()
    project.panels[1].rotation = [0.2, 0, 0]
    expect(() => distributePanels(project, ids(project))).toThrow(/parallel/)
    expect(() => distributePanels(project, ['missing', ...ids(project)])).toThrow(/missing/)
  })

  it('resizes connected uprights while keeping end shelves, joints and selected cut sizes', () => {
    const project = gridProject('Shelves', [500], [250, 500, 350])
    const selected = project.panels.filter(panel => panel.name.startsWith('Shelf')).map(panel => panel.id)
    const snapshot = structuredClone(project)
    const next = distributePanels(project, selected)
    expectGaps(next, selected)
    expect(validateProject(next)).toEqual([])
    expect(next.connections.map(c => c.id)).toEqual(project.connections.map(c => c.id))
    expect(project).toEqual(snapshot)
    const assembled = createAssembly(project, ids(project))
    expect(() => distributePanels(assembled, selected)).toThrow(/assembl/)
  })

  it('distributes three shelves with fitted backs and a neighboring bay', () => {
    let project = gridProject('Backed shelves', [350, 700], [500, 350])
    const selected = project.panels.filter(panel => panel.name.startsWith('Shelf 2.')).map(panel => panel.id)
    for (let count = 0; count < 4; count++) {
      const hole = findPanelHoles(resolvePanels(project)).find(hole => hole.label.startsWith('Back'))
      if (!hole) break
      project = closePanelHole(project, ids(project), hole.id).project
    }
    const middle = resolvePanels(project).filter(panel => selected.includes(panel.id)).sort((a, b) => a.position[1] - b.position[1])[1]
    expect(() => movePanels(project, [middle.id], [0, -10, 0])).not.toThrow()
    const next = distributePanels(project, selected)
    expectGaps(next, selected)
  })

  it('distributes the imported everyday shelf with its angled neighboring bay', () => {
    const project = parseProject(importedShelf)
    const selected = project.panels.filter(panel => ['Bottom shelf', 'Middle shelf', 'Top shelf'].includes(panel.name)).map(panel => panel.id)
    const middle = project.panels.find(panel => panel.name === 'Middle shelf')!
    const target = panelDistribution(resolvePanels(project).filter(panel => selected.includes(panel.id)))!.targets[middle.id]
    expect(() => movePanels(project, [middle.id], target.map((value, axis) => value - middle.position[axis]) as Vec3)).not.toThrow()
    const snapshot = structuredClone(project)
    const next = distributePanels(project, selected)
    expectGaps(next, selected)
    for (const panel of project.panels.filter(panel => ['Bottom shelf', 'Top shelf'].includes(panel.name))) {
      const current = next.panels.find(item => item.id === panel.id)!
      expect(new Vector3(...current.position).distanceTo(new Vector3(...panel.position))).toBeLessThan(0.00001)
      expect(current.width).toBeCloseTo(panel.width, 5)
      expect(current.height).toBeCloseTo(panel.height, 5)
    }
    const previous = new Set(validateProject(project).map(issue => issue.id))
    expect(validateProject(next).filter(issue => !previous.has(issue.id))).toEqual([])
    expect(next.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
    expect(roundTripProject(next)).toEqual(next)
    expect(project).toEqual(snapshot)
  })

  it('rejects collisions and incompatible saved rules atomically', () => {
    const project = fixture(), snapshot = structuredClone(project)
    project.constraints = [{ id: 'fixed', enabled: true, kind: 'gap', panelIds: ['p0', 'p1'], axis: 'z', relation: 'exact', value: 76 }]
    expect(() => distributePanels(project, ids(project))).toThrow()
    expect(project.panels).toEqual(snapshot.panels)
    const blocked = fixture()
    blocked.panels.push(createPanel({ id: 'obstacle', width: 500, height: 500, position: [50, 500, 340] }))
    expect(() => distributePanels(blocked, ids(snapshot))).toThrow()
  })
})
