import { expect, it } from 'vitest'
import updatedFixture from '../test/fixtures/h-table-fixed-cuts.json'
import fixture from '../test/fixtures/h-table-fixed-gaps.json'
import { getProjectBounds, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { evaluateDesignConstraints } from './design-constraints'
import { movePreviewResize, preparePreviewResize } from './preview-resize'
import { roundTripProject } from '../test/project-round-trip'
import { movePanels } from './structure-edit'

it.each([fixture, updatedFixture].flatMap(file => [0, 90].flatMap(angle => [-100, -10, 10, 100].map(distance => ({ file, angle, distance })))))('keeps H-table supports stationary at rotation $angle with movement $distance', ({ file, angle, distance }) => {
  const before = rotateProject(parseProject(file), 'y', angle)
  const snapshot = JSON.stringify(before)
  const desktop = before.panels.find(panel => panel.name === 'Desktop')!
  const next = movePanels(before, [desktop.id], [0, distance, 0])
  const resolved = resolvePanels(roundTripProject(next))
  expect(resolved.find(panel => panel.id === desktop.id)!.position[1]).toBeCloseTo(desktop.position[1] + distance)
  for (const panel of before.panels.filter(panel => /leg$|spine/i.test(panel.name))) {
    expect(getProjectBounds([resolved.find(after => after.id === panel.id)!]).min[1], panel.name)
      .toBeCloseTo(getProjectBounds([panel]).min[1], 5)
  }
  expect(evaluateDesignConstraints(next.constraints, resolved).every(rule => rule.violation === 0)).toBe(true)
  const issues = new Set(validateProject(before).map(issue => issue.id))
  expect(validateProject(next).filter(issue => !issues.has(issue.id))).toEqual([])
  expect(next.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
  const session = preparePreviewResize(before, { panelId: desktop.id })!
  const handle = session.handles.find(handle => handle.direction[1] * Math.sign(distance) > 0.999)!
  const preview = movePreviewResize(session, handle.id, Math.abs(distance))
  expect(preview.limited).toBe(false)
  expect(resolvePanels(preview.project).map(panel => panel.position[1])).toEqual(resolvePanels(next).map(panel => panel.position[1]))
  expect(JSON.stringify(before)).toBe(snapshot)
})
