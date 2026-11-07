import { expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import fixture from '../test/fixtures/h-table-end-shelves.json'
import { roundTripProject } from '../test/project-round-trip'
import { parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { movePreviewResize, preparePreviewResize } from './preview-resize'

it.each([0, 27])('keeps the end shelf panels aligned when the leg resize arrow moves (rotation %s°)', angle => {
  const project = rotateProject(parseProject(fixture), 'y', angle)
  const snapshot = JSON.stringify(project)
  const original = resolvePanels(project)
  const leg = original.find(panel => panel.name === 'Left rear leg')!
  const axis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromEuler(new Euler(...leg.rotation)))
  const session = preparePreviewResize(project, { panelId: leg.id })!
  const handle = session.handles.find(handle => handle.id === 'panel-normal-positive')!
  expect(handle.blocked).toBeUndefined()
  for (const distance of [-100, 100]) {
    const result = movePreviewResize(session, handle.id, distance)
    expect(result.limited).toBe(false)
    const after = resolvePanels(roundTripProject(result.project))
    const endIds = ['3314a44e-e58c-41c0-a12e-35eccccd4343', '787dcb6a-b977-4fc2-aef8-d2c222190353', 'd0d342c7-e04c-437c-a259-fd14fb4ec35b']
    for (const id of endIds) {
      const before = original.find(panel => panel.id === id)!
      const panel = after.find(panel => panel.id === id)!
      expect(panel.height).toBeCloseTo(before.height + distance, 4)
      expect(panel.width).toBeCloseTo(before.width, 4)
      const expected = new Vector3(...before.position).addScaledVector(axis, distance / 2)
      expect(new Vector3(...panel.position).distanceTo(expected)).toBeLessThan(0.001)
    }
    for (const before of original.filter(panel => panel.name === 'Shelf 1.2' || panel.name.startsWith('Right'))) {
      const panel = after.find(panel => panel.id === before.id)!
      expect(panel.width).toBeCloseTo(before.width, 4)
      expect(panel.height).toBeCloseTo(before.height, 4)
      expect(new Vector3(...panel.position).distanceTo(new Vector3(...before.position))).toBeLessThan(0.001)
    }
    const previousIssues = new Set(validateProject(project).map(issue => issue.id))
    expect(validateProject(result.project).filter(issue => !previousIssues.has(issue.id))).toEqual([])
    expect(result.project.connections.map(connection => connection.id)).toEqual(project.connections.map(connection => connection.id))
  }
  expect(JSON.stringify(project)).toBe(snapshot)
})
