import { describe, expect, it } from 'vitest'
import hTable from '../test/fixtures/h-table-auto-connect.json'
import { roundTripProject } from '../test/project-round-trip'
import { autoConnect } from './auto-connect'
import { parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { movePanels } from './structure-edit'

describe('moving a shelf between split legs', () => {
  it.each([false, true].flatMap(connected => [-10, 10].flatMap(distance => [false, true].map(rotated => ({ connected, distance, rotated })))))('keeps the frame fixed ($connected, $distance mm, rotated: $rotated)', ({ connected, distance, rotated }) => {
    let project = parseProject(hTable)
    if (connected) for (const side of ['Left', 'Right']) {
      project = autoConnect(project, project.panels.filter(panel => [`${side} front leg`, `${side} rear leg`].includes(panel.name)).map(panel => panel.id)).project
    }
    if (rotated) project = rotateProject(project, 'x', 90)
    const source = structuredClone(project)
    const shelf = project.panels.find(panel => panel.name === 'Center divider')!
    const axis = rotated ? 2 : 1
    const result = movePanels(project, [shelf.id], rotated ? [0, 0, distance] : [0, distance, 0])
    const before = resolvePanels(project)
    for (const panel of resolvePanels(result)) {
      const original = before.find(item => item.id === panel.id)!
      const split = /^(Left|Right) rear leg/.test(panel.name)
      expect(panel.position[axis], panel.name).toBeCloseTo(original.position[axis] + (panel.id === shelf.id ? distance : split ? distance / 2 : 0), 5)
      expect(panel.height, panel.name).toBeCloseTo(original.height + (split ? panel.name.endsWith('(section)') ? -distance : distance : 0), 5)
      expect(panel.width).toBeCloseTo(original.width, 5)
      expect(panel.position[0]).toBeCloseTo(original.position[0], 5)
      expect(panel.position[rotated ? 1 : 2]).toBeCloseTo(original.position[rotated ? 1 : 2], 5)
    }
    const issues = new Set(validateProject(project).map(issue => issue.id))
    expect(validateProject(result).filter(issue => !issues.has(issue.id))).toEqual([])
    expect(roundTripProject(result).connections).toEqual(result.connections)
    expect(project).toEqual(source)
  })
})
