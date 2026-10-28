import { describe, expect, it } from 'vitest'
import { createExampleProject, EXAMPLE_LIBRARY } from './example-library'
import { workstationProject } from './platform-examples'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import type { Panel, Project } from './types'

type Bounds = ReturnType<typeof getProjectBounds>

/** Face contact must have positive area; a shared corner cannot support a panel. */
function touches(a: Bounds, b: Bounds): boolean {
  return [0, 1, 2].some(axis => {
    const gap = Math.min(Math.abs(a.max[axis] - b.min[axis]), Math.abs(b.max[axis] - a.min[axis]))
    return gap < 0.000001 && [0, 1, 2].filter(other => other !== axis).every(other =>
      Math.min(a.max[other], b.max[other]) - Math.max(a.min[other], b.min[other]) > 0.000001)
  })
}

function unsupportedAccessories(project: Project): Panel[] {
  const panels = resolvePanels(project)
  const bounds = panels.map(panel => getProjectBounds([panel]))
  const supported = new Set(panels.flatMap((panel, index) => panel.thickness === 18 ? [index] : []))
  for (let changed = true; changed;) {
    changed = false
    panels.forEach((_, index) => {
      if (!supported.has(index) && [...supported].some(other => touches(bounds[index], bounds[other]))) {
        supported.add(index)
        changed = true
      }
    })
  }
  return panels.filter((panel, index) => panel.thickness !== 18 && !supported.has(index))
}

describe('supported accessory inserts', () => {
  const examples = EXAMPLE_LIBRARY.filter(example => example.source)

  it.each(examples)('$name connects every insert to the structural cabinet without intersections', ({ create }) => {
    const project = create()
    expect(unsupportedAccessories(project).map(panel => panel.name)).toEqual([])
    expect(validateProject(project)).toEqual([])
  })

  it('detects an internally connected insert that floats above the cabinet base', () => {
    const project = workstationProject()
    project.panels = project.panels.map(panel => panel.name === 'Left insert divider'
      ? { ...panel, height: 735 } : panel.name.startsWith('Left insert shelf')
        ? { ...panel, height: 355 } : panel)
    expect(unsupportedAccessories(project).map(panel => panel.name)).toContain('Left insert divider')
  })

  it('detects the four short dividers from the reported modular shelf', () => {
    const project = createExampleProject('modular-shelf')
    const dividers = project.panels.filter(panel => panel.name.endsWith(' divider'))
    expect(dividers).toHaveLength(4)
    expect(dividers.every(panel => panel.height === 367)).toBe(true)
    for (const divider of dividers) divider.height = 330
    // Collision checks alone miss these gaps: the old shelf had no overlaps.
    expect(validateProject(project)).toEqual([])
    expect(unsupportedAccessories(project).map(panel => panel.id).sort()).toEqual(dividers.map(panel => panel.id).sort())
  })
})
