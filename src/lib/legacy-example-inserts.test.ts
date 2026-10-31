import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/legacy-example-inserts.json'
import { EXAMPLE_LIBRARY, createExampleProject } from './example-library'
import { LEGACY_INSERT_SHAPES } from './legacy-example-inserts-data'
import { repairLegacyExampleInserts } from './legacy-example-inserts'
import { createPanel, parseProject, resolvePanels, validateProject } from './model'
import type { Panel, Project } from './types'

const legacy = (id: keyof typeof fixtures) => parseProject(structuredClone(fixtures[id]))
const shape = (panel: Panel) => [panel.width, panel.height, panel.thickness, ...panel.position, ...panel.rotation].map(value => Math.round(value * 1e6) / 1e6).join('|')
const shapes = (project: Project) => resolvePanels(project).map(shape).sort()

describe('saved library insert repairs', () => {
  it.each(Object.keys(fixtures) as (keyof typeof fixtures)[])('repairs the frozen %s project without altering its saved original', id => {
    const project = legacy(id)
    const original = structuredClone(project)
    const repaired = repairLegacyExampleInserts(project)
    expect(repaired).not.toBe(project)
    expect(project).toEqual(original)
    expect(shapes(repaired)).toEqual(shapes(createExampleProject(id)))
    expect(repaired.connections).toBe(project.connections)
    expect(parseProject(JSON.parse(JSON.stringify(repaired)))).toEqual(repaired)
    expect(validateProject(repaired)).toEqual([])
    expect(repairLegacyExampleInserts(repaired)).toBe(repaired)
  })

  it.each(Object.keys(LEGACY_INSERT_SHAPES))('recognizes the original thin panels of %s', id => {
    const template = createExampleProject(id)
    const original: Project = { ...template, panels: [
      ...resolvePanels(template).filter(panel => panel.thickness === 18),
      ...LEGACY_INSERT_SHAPES[id].map(spec => createPanel(spec)),
    ] }
    const repaired = repairLegacyExampleInserts(original)
    expect(repaired).not.toBe(original)
    expect(shapes(repaired)).toEqual(shapes(template))
  })

  it('preserves IDs, user names, panel order, finishes, patterns, visibility and connector colors', () => {
    const project = legacy('modular-shelf')
    project.name = 'My custom shelf'
    project.panels.reverse()
    project.panels.forEach((panel, index) => {
      panel.name = `My panel ${index}`
      panel.color = '#123456'
      panel.material = 'walnut'
      panel.finishCoverage = 0.3
      panel.pattern = 'pegboard'
      panel.visible = index % 2 === 0
      panel.holeSize = 8
      panel.holeSpacing = 40
    })
    project.connections.forEach(connection => { connection.color = '#abcdef' })
    const repaired = repairLegacyExampleInserts(project)
    expect(repaired.name).toBe('My custom shelf')
    expect(repaired.panels.map(panel => panel.id)).toEqual(project.panels.map(panel => panel.id))
    for (const panel of repaired.panels) {
      const before = project.panels.find(candidate => candidate.id === panel.id)!
      for (const key of ['name', 'color', 'material', 'finishCoverage', 'pattern', 'visible', 'holeSize', 'holeSpacing'] as const) expect(panel[key]).toBe(before[key])
    }
    expect(repaired.connections).toBe(project.connections)
    expect(shapes(repaired)).toEqual(shapes(createExampleProject('modular-shelf')))
  })

  it('adds the high table’s supporting insert sides with the saved insert finish', () => {
    const project = legacy('high-meeting-table')
    const shelf = project.panels.find(panel => panel.thickness !== 18)!
    shelf.color = '#123456'
    shelf.material = 'walnut'
    shelf.finishCoverage = 0.7
    const repaired = repairLegacyExampleInserts(project)
    expect(repaired.panels).toHaveLength(project.panels.length + 2)
    expect(repaired.panels.find(panel => panel.id === shelf.id)?.width).toBe(355)
    expect(repaired.panels.slice(-2).map(panel => [panel.material, panel.color])).toEqual([['walnut', '#123456'], ['walnut', '#123456']])
    expect(repaired.panels.slice(-2).map(panel => panel.finishCoverage)).toEqual([0.7, 0.7])
    expect(parseProject(JSON.parse(JSON.stringify(repaired)))).toEqual(repaired)
  })

  it.each(['structural size', 'insert size', 'position', 'rotation', 'missing panel', 'extra panel', 'connection'])("leaves custom %s changes alone", change => {
    const project = legacy('modular-shelf')
    const insert = project.panels.find(panel => panel.thickness !== 18)!
    if (change === 'structural size') project.panels[0].width += 20
    if (change === 'insert size') insert.height += 1
    if (change === 'position') insert.position[0] += 1
    if (change === 'rotation') insert.rotation[1] += 0.01
    if (change === 'missing panel') project.panels.pop()
    if (change === 'extra panel') project.panels.push(createPanel())
    if (change === 'connection') project.connections[0].count += 1
    expect(repairLegacyExampleInserts(project)).toBe(project)
  })

  it('does not change current examples or unrelated projects', () => {
    for (const example of EXAMPLE_LIBRARY) {
      const project = example.create()
      expect(repairLegacyExampleInserts(project), example.id).toBe(project)
    }
    const blank = createExampleProject('blank')
    expect(repairLegacyExampleInserts(blank)).toBe(blank)
  })
})
