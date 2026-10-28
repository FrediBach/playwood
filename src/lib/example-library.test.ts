import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { createExampleProject, EXAMPLE_LIBRARY } from './example-library'
import { getProjectBounds, parseProject, projectToCsv, resolvePanels, validateProject } from './model'

describe('resource example library', () => {
  it('offers each distinct connector build once, alongside the original starters', () => {
    expect(EXAMPLE_LIBRARY).toHaveLength(26)
    expect(new Set(EXAMPLE_LIBRARY.map(example => example.id)).size).toBe(26)
    expect(EXAMPLE_LIBRARY.filter(example => example.source)).toHaveLength(22)
    expect(EXAMPLE_LIBRARY.some(example => /bizu|lean table|nordic|beechwood chair/i.test(example.name))).toBe(false)
    for (const example of EXAMPLE_LIBRARY) if (example.source) {
      expect(existsSync(resolve('resources/library-3d', example.source)), example.source).toBe(true)
    }
  })

  it.each(EXAMPLE_LIBRARY)('$name opens as an independent, exportable editable assembly', example => {
    const project = createExampleProject(example.id)
    expect(project.panels.length).toBeGreaterThan(0)
    expect(project.connections.length).toBeGreaterThan(0)
    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(projectToCsv(project)).toContain('Playwood')
    const panels = resolvePanels(project)
    expect(panels.every(panel => [...panel.position, ...panel.rotation].every(Number.isFinite))).toBe(true)
    const bounds = getProjectBounds(panels)
    expect(Math.min(bounds.width, bounds.height, bounds.depth)).toBeGreaterThan(0)
    expect(validateProject(project).filter(issue => issue.severity === 'error'), example.id).toEqual([])
    expect(validateProject(project).filter(issue => issue.id.startsWith('collision')), example.id).toEqual([])

    const second = createExampleProject(example.id)
    expect(second.panels.some(panel => project.panels.some(first => first.id === panel.id))).toBe(false)
    project.panels[0].name = 'Changed in the editor'
    expect(second.panels[0].name).not.toBe('Changed in the editor')
  })

  it.each([
    ['diamond-shelf', 16, 16, 0, 8],
    ['totem', 18, 16, 8, 6],
    ['corner-booth', 3, 5, 0, 0],
    ['counter-with-doors', 10, 8, 8, 0],
    ['h-table-180', 6, 4, 4, 0],
    ['cube', 4, 8, 0, 0],
    ['promotional-desk', 7, 8, 4, 0],
    ['modular-shelf', 12, 8, 8, 2],
    ['shelf-04', 4, 8, 0, 0],
    ['shelf-08', 7, 8, 4, 0],
    ['high-meeting-table', 7, 8, 4, 0],
    ['h-table-120', 6, 4, 4, 0],
    ['bench', 4, 12, 0, 0],
    ['counter', 13, 8, 12, 0],
    ['reception-counter', 10, 8, 8, 0],
    ['trade-fair-display', 17, 8, 12, 4],
    ['workstation', 7, 16, 0, 0],
    ['plinth-closed-tall', 5, 8, 0, 0],
    ['plinth-closed-medium', 5, 8, 0, 0],
    ['plinth-closed-low', 5, 8, 0, 0],
    ['plinth-open-tall', 4, 8, 0, 0],
    ['plinth-open-wide', 4, 8, 0, 0],
    ['island-display', 9, 24, 0, 0],
  ] as const)('%s preserves its structural panel and connector quantities', (id, panels, corners, tees, crosses) => {
    const project = createExampleProject(id)
    expect(project.panels.filter(panel => panel.thickness === 18)).toHaveLength(panels)
    for (const [type, expected] of [['90', corners], ['t', tees], ['cross', crosses]] as const) {
      expect(project.connections.filter(connection => connection.type === type).reduce((sum, connection) => sum + connection.count, 0), `${id} ${type}`).toBe(expected)
    }
  })

  it.each([['h-table-120', 1200, 600, 282.5], ['h-table-180', 1800, 800, 382.5]] as const)('%s uses its own documented cuts', (id, length, depth, wingWidth) => {
    const project = createExampleProject(id)
    const cuts = project.panels.map(panel => [panel.width, panel.height].sort((a, b) => a - b))
    expect(cuts).toEqual(expect.arrayContaining([[depth, length], [721, length]]))
    expect(cuts.filter(cut => cut[0] === wingWidth && cut[1] === 712.5)).toHaveLength(4)
  })

  it('separates the three closed and two open plinth variants into distinct assemblies', () => {
    const examples = EXAMPLE_LIBRARY.filter(example => example.id.startsWith('plinth-'))
    expect(examples).toHaveLength(5)
    const sizes = examples.map(example => {
      const bounds = getProjectBounds(resolvePanels(example.create()))
      return [bounds.width, bounds.height, bounds.depth].map(Math.round).join('×')
    })
    expect(new Set(sizes).size).toBe(5)
  })

  it('keeps blank projects available and rejects unknown example IDs', () => {
    expect(createExampleProject('blank')).toMatchObject({ panels: [], connections: [] })
    expect(() => createExampleProject('missing')).toThrow('Unknown library example')
  })

  it('opens the photo-inspired diamond shelf already tilted, with white panels and black connectors', () => {
    const project = createExampleProject('diamond-shelf')
    const panels = resolvePanels(project)
    for (const panel of panels) {
      expect([panel.width, panel.height, panel.thickness]).toEqual([350, 350, 18])
      expect(panel.material).toBe('painted')
      expect(panel.color).toBe('#eeede7')
      const normal = new Vector3(0, 0, 1).applyEuler(new Euler(...panel.rotation))
      expect(Math.abs(normal.x)).toBeCloseTo(Math.SQRT1_2, 6)
      expect(Math.abs(normal.y)).toBeCloseTo(Math.SQRT1_2, 6)
      expect(normal.z).toBeCloseTo(0, 6)
    }
    expect(project.connections.every(connection => connection.color === '#292b27')).toBe(true)
    const bounds = getProjectBounds(panels)
    expect(bounds.min[1]).toBeCloseTo(0, 3)
    expect(bounds.width).toBeCloseTo(bounds.height, 3)
    expect(bounds.depth).toBeCloseTo(350, 3)
  })
})
