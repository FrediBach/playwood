import { describe, expect, it } from 'vitest'
import { attachPanel, createPanel, parseProject, validateProject } from './model'
import { getRescaleValues, rescaleProject } from './project-rescale'
import type { Project } from './types'

function insetPairs(): Project {
  let project: Project = { version: 1, name: 'Offset depth pairs', panels: [], connections: [] }
  for (const x of [0, 3000]) {
    const base = createPanel({ name: `Base ${x}`, width: 700, height: 300, position: [x, 1000, 0], rotation: [-Math.PI / 2, 0, 0] })
    project = { ...project, panels: [...project.panels, base] }
    project = attachPanel(project, base.id, createPanel({ name: `Side ${x}`, width: 450, height: 400 }), {
      side: 'left', type: '90', offset: 20, inset: 0, flip: false, color: '#e75a35', count: 2,
    })
  }
  return project
}

function dimensionId(project: Project, value: number) {
  const measurement = getRescaleValues(project).find(item => item.kind === 'dimension' && item.value === value)
  expect(measurement).toBeDefined()
  return measurement!.id
}

describe('rescale structural constraints', () => {
  it('keeps unequal joint depths and existing setbacks while changing repeated measurements', () => {
    const project = insetPairs()
    expect(validateProject(project)).toEqual([])
    const next = rescaleProject(project, { [dimensionId(project, 300)]: 350 })
    for (const panel of next.panels) expect(panel.height).toBeCloseTo(panel.name.startsWith('Base') ? 350 : 450, 6)
    expect(next.connections.map(connection => connection.offset)).toEqual(project.connections.map(connection => connection.offset))
    expect(validateProject(next)).toEqual([])
    expect(parseProject(next)).toEqual(next)
  })

  it('rejects incompatible simultaneous targets without partially editing any component', () => {
    const project = insetPairs(), before = structuredClone(project)
    expect(() => rescaleProject(project, { [dimensionId(project, 300)]: 350, [dimensionId(project, 400)]: 500 }))
      .toThrow(/connected|constraints|cannot/i)
    expect(project).toEqual(before)
    const corrected = rescaleProject(project, { [dimensionId(project, 300)]: 350, [dimensionId(project, 400)]: 450 })
    expect(validateProject(corrected)).toEqual([])
  })

  it('rejects new collisions between otherwise independent parts', () => {
    const project: Project = { version: 1, name: 'Separate panels', connections: [], panels: [
      createPanel({ width: 100, height: 100, position: [0, 100, 0] }),
      createPanel({ width: 100, height: 100, position: [220, 100, 0] }),
    ] }
    const before = structuredClone(project)
    expect(validateProject(project)).toEqual([])
    expect(() => rescaleProject(project, { [dimensionId(project, 100)]: 300 })).toThrow(/overlap/i)
    expect(project).toEqual(before)
  })

  it('treats hidden panels as part of the project and applies replacements to original values only', () => {
    const project: Project = { version: 1, name: 'Original measurements', connections: [], panels: [
      createPanel({ width: 300, height: 300, position: [0, 1000, 0] }),
      createPanel({ width: 400, height: 400, position: [2000, 1000, 0], visible: false }),
    ] }
    const next = rescaleProject(project, { [dimensionId(project, 300)]: 400, [dimensionId(project, 400)]: 500 })
    expect(next.panels.map(panel => [panel.width, panel.height, panel.visible])).toEqual([[400, 400, true], [500, 500, false]])
    expect(parseProject(next)).toEqual(next)
  })
})
