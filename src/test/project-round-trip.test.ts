import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject } from '../lib/model'
import { roundTripProject } from './project-round-trip'

describe('project JSON round trip', () => {
  it('uses JSON serialization before validation, rather than cloning the fixture', () => {
    const panel = createPanel({ id: 'panel' })
    const project = { ...createStarterProject('blank'), panels: [panel] }
    // JSON serializes this value as a number; passing the object directly to
    // parseProject (or structuredClone) would fail dimension validation.
    Object.assign(panel, { width: { toJSON: () => 600 } })
    const loaded = roundTripProject(project)
    expect(loaded.panels[0].width).toBe(600)
    expect(typeof panel.width).toBe('object')
    expect(loaded.panels[0]).not.toBe(panel)
  })

  it('validates the reloaded document rather than trusting its type', () => {
    const project = { ...createStarterProject('blank'), panels: [createPanel({ width: -1 })] }
    expect(() => roundTripProject(project)).toThrow(/width/i)
  })
})
