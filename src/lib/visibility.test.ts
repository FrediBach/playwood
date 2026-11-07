import { describe, expect, it } from 'vitest'
import { createPanel, parseProject } from './model'
import { createAssembly, materializeAssemblies } from './assemblies'
import { gridProject } from './example-geometry'
import { roundTripProject } from '../test/project-round-trip'
import { nextVisibility } from './visibility'

describe('three-state visibility', () => {
  it('cycles without making wireframes pickable and preserves saved states', () => {
    let panel = createPanel()
    for (const state of [{ visible: false, wireframe: true }, { visible: false, wireframe: false }, { visible: true, wireframe: false }]) {
      panel = { ...panel, ...nextVisibility(panel) }
      const saved = roundTripProject({ version: 1, name: 'Visibility', panels: [panel], connections: [] })
      expect(saved.panels[0]).toMatchObject(state)
    }
    expect(parseProject({ version: 1, name: 'Legacy', panels: [createPanel({ visible: false })], connections: [] }).panels[0].wireframe).toBeUndefined()
    expect(() => parseProject({ version: 1, name: 'Invalid', panels: [{ ...panel, wireframe: 'yes' }], connections: [] })).toThrow(/wireframe/)
  })

  it('retains individual assembly panel visibility across reload and rebuild', () => {
    const base = gridProject('Box', [350], [350], { depth: 350 })
    const project = createAssembly(base, base.panels.map(panel => panel.id), 'Box')
    project.panels[0] = { ...project.panels[0], ...nextVisibility(project.panels[0]) }
    const saved = roundTripProject(project)
    expect(materializeAssemblies(saved).panels.find(panel => panel.id === project.panels[0].id)).toMatchObject({ visible: false, wireframe: true })
  })
})
