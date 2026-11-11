import { expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { hTableProject } from './example-geometry'
import { islandProject } from './platform-examples'
import { resolvePanels, rotateProject, validateProject } from './model'
import { movePanels, resizePanelEdge } from './structure-edit'
import { roundTripProject } from '../test/project-round-trip'
import { movePreviewResize, preparePreviewResize, reviewPreviewResize } from './preview-resize'

const cases = [
  { name: 'H-table height', create: () => hTableProject('H-table', 1800), panel: 'Left front leg', dimension: 'height' as const, changed: ['Central spine', 'Left rear leg', 'Right front leg', 'Right rear leg'] },
  { name: 'H-table depth', create: () => hTableProject('H-table', 1800), panel: 'Desktop', dimension: 'width' as const, changed: [] },
  { name: 'Island depth', create: islandProject, panel: 'Island base', dimension: 'height' as const, changed: ['Island middle platform'] },
  { name: 'Island width', create: islandProject, panel: 'Island base', dimension: 'width' as const, changed: ['Island middle platform', 'Island upper shelf'] },
  { name: 'Island middle depth', create: islandProject, panel: 'Island middle platform', dimension: 'height' as const, changed: ['Island base'] },
]
it.each(cases.flatMap(scenario => [0, 27].flatMap(angle => [-1, 1].flatMap(side => [-80, 100].map(distance => ({ ...scenario, angle, side: side as -1 | 1, distance }))))))('$name propagates a $distance mm edge drag (rotation $angle, side $side)', ({ create, panel: name, dimension, changed, angle, side, distance }) => {
  const source = rotateProject(create(), 'y', angle), snapshot = JSON.stringify(source)
  const before = resolvePanels(source), panel = before.find(item => item.name === name)!
  const handle = `panel-${dimension}-${side === 1 ? 'positive' : 'negative'}`
  const session = preparePreviewResize(source, { panelId: panel.id })!
  const result = movePreviewResize(session, handle, distance)
  expect(result.limited, result.reason).toBe(false)
  const after = resolvePanels(result.project), selected = after.find(item => item.id === panel.id)!
  expect(selected[dimension]).toBeCloseTo(panel[dimension] + distance, 4)
  const axis = new Vector3(dimension === 'width' ? 1 : 0, dimension === 'height' ? 1 : 0, 0).applyEuler(new Euler(...panel.rotation))
  const anchor = (p: typeof panel) => new Vector3(...p.position).addScaledVector(axis, -side * p[dimension] / 2)
  expect(anchor(selected).distanceTo(anchor(panel))).toBeLessThan(1e-4)
  if (name.startsWith('Island')) {
    const upper = after.find(p => p.name === 'Island upper shelf')!
    expect(new Vector3(...upper.position).sub(new Vector3(...selected.position)).dot(axis)).toBeCloseTo(0, 4)
    expect(upper.height).toBeCloseTo(350, 4)
  }
  for (const name of changed) {
    const old = before.find(item => item.name === name)!, next = after.find(item => item.name === name)!
    expect(Math.max(Math.abs(next.width - old.width), Math.abs(next.height - old.height)), name).toBeGreaterThan(1)
  }
  if (name === 'Desktop' && dimension === 'width') for (const side of ['Left', 'Right']) {
    const pair = (panels: typeof before) => panels.filter(p => [`${side} front leg`, `${side} rear leg`].includes(p.name)).reduce((sum, p) => sum + p.width, 0)
    expect(pair(after) - pair(before), `${side} split-leg span`).toBeCloseTo(distance, 4)
    for (const end of ['front', 'rear']) {
      const old = before.find(p => p.name === `${side} ${end} leg`)!
      expect(after.find(p => p.id === old.id)!.width - old.width).toBeCloseTo(distance / 2, 4)
    }
    const spine = after.find(p => p.name === 'Central spine')!
    expect(new Vector3(...spine.position).sub(new Vector3(...selected.position)).dot(axis)).toBeCloseTo(0, 4)
  }
  expect(() => reviewPreviewResize(session, handle, result.distance)).not.toThrow()
  expect(movePreviewResize(session, handle, 0).project).toBe(source)
  const previousIssues = new Set(validateProject(source).map(issue => issue.id))
  expect(validateProject(result.project).filter(issue => !previousIssues.has(issue.id))).toEqual([])
  expect(JSON.stringify(source)).toBe(snapshot)
})
it.each(cases.filter(item => ['H-table depth', 'Island depth'].includes(item.name)))('$name keeps other cuts fixed only with Shift-resize', ({ create, panel: name, dimension }) => {
  const source = create(), panel = source.panels.find(item => item.name === name)!
  const result = movePreviewResize(preparePreviewResize(source, { panelId: panel.id })!, `panel-${dimension}-positive`, 100, true)
  expect(result.limited, result.reason).toBe(false)
  for (const old of resolvePanels(source).filter(item => item.id !== panel.id)) {
    const next = resolvePanels(result.project).find(item => item.id === old.id)!
    expect(next.width).toBeCloseTo(old.width, 4)
    expect(next.height).toBeCloseTo(old.height, 4)
    next.position.forEach((value, axis) => expect(value).toBeCloseTo(old.position[axis], 4))
  }
})

it('keeps a centered split through successive resizes and reload', () => {
  let project = hTableProject('Centered split', 1200)
  const top = project.panels.find(p => p.name === 'Desktop')!
  for (const side of [-1, 1, -1] as const) {
    project = roundTripProject(resizePanelEdge(project, top.id, 'width', side, 60))
    const panels = resolvePanels(project)
    for (const end of ['Left', 'Right']) {
      expect(panels.find(p => p.name === `${end} front leg`)!.width)
        .toBeCloseTo(panels.find(p => p.name === `${end} rear leg`)!.width, 4)
    }
  }
  expect(project.constraints ?? []).toEqual([])
})

it('allows moving the divider off center and does not recenter it on a later resize', () => {
  const source = hTableProject('Off-center split', 1800)
  const spine = resolvePanels(source).find(p => p.name === 'Central spine')!
  const shifted = movePanels(source, [spine.id], [0, 0, 60])
  const panels = resolvePanels(shifted)
  expect(panels.find(p => p.id === spine.id)!.position[2] - spine.position[2]).toBeCloseTo(60, 4)
  const top = panels.find(p => p.name === 'Desktop')!
  const next = resolvePanels(resizePanelEdge(roundTripProject(shifted), top.id, 'width', 1, 80))
  for (const end of ['Left', 'Right']) {
    expect(Math.abs(next.find(p => p.name === `${end} front leg`)!.width
      - next.find(p => p.name === `${end} rear leg`)!.width)).toBeGreaterThan(1)
  }
})

it('lets a saved spine position override automatic centering', () => {
  const source = hTableProject('Authored position', 1800)
  const spine = resolvePanels(source).find(p => p.name === 'Central spine')!
  source.constraints = [{ id: 'fixed-spine', enabled: true, kind: 'position', panelId: spine.id,
    axis: 'z', reference: 'center', value: spine.position[2] }]
  const top = source.panels.find(p => p.name === 'Desktop')!
  const next = resolvePanels(resizePanelEdge(source, top.id, 'width', 1, 100))
  expect(next.find(p => p.id === spine.id)!.position[2]).toBeCloseTo(spine.position[2], 4)
  expect(next.find(p => p.id === top.id)!.width).toBeCloseTo(top.width + 100, 4)
})

it('allows directly resizing a split half to break symmetry', () => {
  const source = hTableProject('Direct half edit', 1800)
  const leg = source.panels.find(p => p.name === 'Left front leg')!
  const result = resizePanelEdge(source, leg.id, 'width', -1, 60)
  const panels = resolvePanels(result)
  expect(panels.find(p => p.id === leg.id)!.width).toBeCloseTo(leg.width + 60, 4)
  expect(Math.abs(panels.find(p => p.id === leg.id)!.width
    - panels.find(p => p.name === 'Left rear leg')!.width)).toBeGreaterThan(1)
})

it('retains island centering through successive depth edits and reload', () => {
  let project = islandProject()
  const base = project.panels.find(p => p.name === 'Island base')!
  for (const side of [-1, 1, -1] as const) {
    project = roundTripProject(resizePanelEdge(project, base.id, 'height', side, 80))
    const panels = resolvePanels(project)
    expect(panels.find(p => p.name === 'Island upper shelf')!.position[2])
      .toBeCloseTo(panels.find(p => p.id === base.id)!.position[2], 4)
    expect(panels.find(p => p.name === 'Island upper shelf')!.height).toBeCloseTo(350, 4)
  }
  expect(project.constraints ?? []).toEqual([])
})

it('allows moving the island upper tier off center before resizing', () => {
  const source = islandProject()
  const tier = source.panels.filter(p => p.name.includes('upper'))
  const moved = roundTripProject(movePanels(source, tier.map(p => p.id), [0, 0, 60]))
  const upper = resolvePanels(moved).find(p => p.name === 'Island upper shelf')!
  expect(upper.position[2]).toBeCloseTo(60, 4)
  const base = moved.panels.find(p => p.name === 'Island base')!
  const panels = resolvePanels(resizePanelEdge(moved, base.id, 'height', 1, 80))
  expect(Math.abs(panels.find(p => p.id === upper.id)!.position[2]
    - panels.find(p => p.id === base.id)!.position[2])).toBeGreaterThan(1)
})

it('lets a saved upper shelf position override inferred seam centering', () => {
  const source = islandProject()
  const upper = resolvePanels(source).find(p => p.name === 'Island upper shelf')!
  source.constraints = [{ id: 'fixed-upper', enabled: true, kind: 'position', panelId: upper.id,
    axis: 'z', reference: 'center', value: upper.position[2] }]
  const base = source.panels.find(p => p.name === 'Island base')!
  const panels = resolvePanels(resizePanelEdge(source, base.id, 'height', 1, 100))
  expect(panels.find(p => p.id === upper.id)!.position[2]).toBeCloseTo(upper.position[2], 4)
  expect(panels.find(p => p.id === base.id)!.height).toBeCloseTo(base.height + 100, 4)
})
