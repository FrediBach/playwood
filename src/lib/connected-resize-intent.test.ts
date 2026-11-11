import { expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { hTableProject } from './example-geometry'
import { islandProject } from './platform-examples'
import { resolvePanels, rotateProject, validateProject } from './model'
import { movePreviewResize, preparePreviewResize, reviewPreviewResize } from './preview-resize'

const cases = [
  { name: 'H-table height', create: () => hTableProject('H-table', 1800), panel: 'Left front leg', dimension: 'height' as const, changed: ['Central spine', 'Left rear leg', 'Right front leg', 'Right rear leg'] },
  { name: 'H-table depth', create: () => hTableProject('H-table', 1800), panel: 'Desktop', dimension: 'width' as const, changed: [] },
  { name: 'Island depth', create: islandProject, panel: 'Island base', dimension: 'height' as const, changed: ['Island middle platform'] },
  { name: 'Island width', create: islandProject, panel: 'Island base', dimension: 'width' as const, changed: ['Island middle platform', 'Island upper shelf'] },
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
  for (const name of changed) {
    const old = before.find(item => item.name === name)!, next = after.find(item => item.name === name)!
    expect(Math.max(Math.abs(next.width - old.width), Math.abs(next.height - old.height)), name).toBeGreaterThan(1)
  }
  if (name === 'Desktop' && dimension === 'width') for (const side of ['Left', 'Right']) {
    const pair = (panels: typeof before) => panels.filter(p => [`${side} front leg`, `${side} rear leg`].includes(p.name)).reduce((sum, p) => sum + p.width, 0)
    expect(pair(after) - pair(before), `${side} split-leg span`).toBeCloseTo(distance, 4)
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
