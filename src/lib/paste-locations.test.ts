import { describe, expect, it } from 'vitest'
import { copySelection, getPasteTargets } from './clipboard'
import { gridProject } from './example-geometry'
import { groupPasteLocations } from './paste-locations'

describe('paste destination grouping', () => {
  it('collapses copied anchors and bend directions into at most four edges and one surface', () => {
    const project = gridProject('Stack', [350], [300, 300], { depth: 250 })
    const selected = project.panels.filter(panel => ['Shelf 1.2', 'Shelf 1.3', 'Upright 1.2', 'Upright 2.2'].includes(panel.name))
    const roof = project.panels.find(panel => panel.name === 'Shelf 1.3')!
    const targets = getPasteTargets(project, [roof.id], copySelection(project, selected.map(panel => panel.id))).filter(target => target.project)
    const locations = groupPasteLocations(targets)
    expect(locations.length).toBeLessThanOrEqual(5)
    expect(locations.length).toBeLessThan(targets.length)
    expect(locations.flatMap(location => location.targets)).toHaveLength(targets.length)
    const shared = locations.find(location => location.label.includes('shared surface'))!
    expect(shared.position).toEqual(roof.position)
    expect(shared.segment).toHaveLength(5)
    for (const edge of locations.filter(location => location.label.includes('edge'))) {
      expect(edge.segment).toHaveLength(2)
      expect(edge.targets.every(target => target.location?.id === edge.id)).toBe(true)
    }
  })
})
