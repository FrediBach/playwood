import { expect, it } from 'vitest'
import { createStarterProject, getProjectBounds, resolvePanels, rotateProject, validateProject } from './model'
import { evaluateDesignConstraints } from './design-constraints'
import { movePanels } from './structure-edit'
import type { Project, Vec3 } from './types'

const orientations = [
  { rotation: 'y', angle: 0, axis: 'y', delta: [0, 1, 0] },
  { rotation: 'z', angle: 90, axis: 'x', delta: [-1, 0, 0] },
  { rotation: 'x', angle: 90, axis: 'z', delta: [0, 0, 1] },
] as const
const cases = orientations.flatMap(orientation => ['Top shelf', 'Bottom shelf'].flatMap(peer => [-50, 50].map(distance => ({ ...orientation, peer, distance }))))

it.each(cases)('preserves the free boundary along $axis with a fixed gap to $peer and movement $distance', ({ rotation, angle, axis, delta, peer, distance }) => {
  const source = rotateProject(createStarterProject(), rotation, angle)
  const panels = resolvePanels(source)
  const selected = panels.find(panel => panel.name === 'Middle shelf')!
  const linked = panels.find(panel => panel.name === peer)!
  const stationary = panels.find(panel => panel.name === (peer === 'Top shelf' ? 'Bottom shelf' : 'Top shelf'))!
  const dimension = ['x', 'y', 'z'].indexOf(axis)
  const ordered = [selected, linked].sort((a, b) => a.position[dimension] - b.position[dimension])
  const before: Project = { ...source, constraints: [{ id: 'opening', enabled: true, kind: 'gap', axis,
    panelIds: [ordered[0].id, ordered[1].id], relation: 'exact',
    value: getProjectBounds([ordered[1]]).min[dimension] - getProjectBounds([ordered[0]]).max[dimension] }] }
  const snapshot = JSON.stringify(before)
  const movement = delta.map(value => value * distance) as Vec3
  const next = movePanels(before, [selected.id], movement)
  const after = resolvePanels(next)
  for (const original of [selected, linked, stationary]) {
    const panel = after.find(panel => panel.id === original.id)!
    panel.position.forEach((value, index) => expect(value).toBeCloseTo(original.position[index] + (original === stationary ? 0 : movement[index]), 5))
    expect(panel.width).toBeCloseTo(original.width, 5)
    expect(panel.height).toBeCloseTo(original.height, 5)
  }
  expect(evaluateDesignConstraints(next.constraints, after).every(rule => rule.violation === 0)).toBe(true)
  expect(validateProject(next)).toEqual([])
  const reversed = resolvePanels(movePanels(next, [selected.id], movement.map(value => -value) as Vec3))
  panels.forEach(original => {
    const panel = reversed.find(panel => panel.id === original.id)!
    panel.position.forEach((value, index) => expect(value).toBeCloseTo(original.position[index], 5))
    expect(panel.width).toBeCloseTo(original.width, 5)
    expect(panel.height).toBeCloseTo(original.height, 5)
  })
  expect(JSON.stringify(before)).toBe(snapshot)
})

it.each([false, true])('keeps authored cuts hard when boundary anchoring is impossible (fixed base: %s)', fixedBase => {
  const source = createStarterProject()
  const panels = resolvePanels(source)
  const selected = panels.find(panel => panel.name === 'Middle shelf')!
  const bottom = panels.find(panel => panel.name === 'Bottom shelf')!
  const before: Project = { ...source, constraints: panels.flatMap(panel => (['width', 'height'] as const).map(dimension => ({
    id: `${panel.id}/${dimension}`, enabled: true, kind: 'dimension' as const, panelId: panel.id, dimension,
    relation: 'exact' as const, value: panel[dimension],
  }))) }
  if (fixedBase) before.constraints!.push({ id: 'base', enabled: true, kind: 'floor', panelId: bottom.id, reference: 'center', value: bottom.position[1] })
  const snapshot = JSON.stringify(before)
  if (fixedBase) expect(() => movePanels(before, [selected.id], [0, -50, 0])).toThrow(/design rules/)
  else {
    const next = movePanels(before, [selected.id], [0, -50, 0])
    for (const panel of resolvePanels(next)) {
      const original = panels.find(candidate => candidate.id === panel.id)!
      expect(panel.width).toBeCloseTo(original.width, 5)
      expect(panel.height).toBeCloseTo(original.height, 5)
      expect(panel.position[1]).toBeCloseTo(original.position[1] - 50, 5)
    }
    expect(validateProject(next)).toEqual([])
  }
  expect(JSON.stringify(before)).toBe(snapshot)
})
