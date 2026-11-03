import { describe, expect, it } from 'vitest'
import { createPanel, parseProject } from './model'
import { assertDesignConstraintEdit } from './design-constraint-edits'
import { spaceClearances } from './space-constraint'
import { movePanels, resizePanels } from './structure-edit'
import type { Project } from './types'

const project = (): Project => ({ version: 1, name: 'Space', connections: [], panels: [createPanel({ id: 'p', width: 400, height: 400, position: [0, 200, 0] })], spaceConstraint: { enabled: true, width: 600, height: 600, depth: 600, centerX: 0, centerZ: 0 } })
describe('build space', () => {
  it('round trips and preserves legacy projects without a space', () => {
    const p = project()
    expect(parseProject(JSON.parse(JSON.stringify(p))).spaceConstraint).toEqual(p.spaceConstraint)
    delete p.spaceConstraint
    expect(parseProject(p).spaceConstraint).toBeUndefined()
    for (const width of [0, -1, Infinity, '600']) expect(() => parseProject({ ...p, spaceConstraint: { ...project().spaceConstraint, width } })).toThrow(/build space/)
  })
  it('blocks movement beyond a boundary but allows touching and disabling', () => {
    const p = project()
    expect(movePanels(p, ['p'], [100, 0, 0]).panels[0].position[0]).toBe(100)
    expect(() => movePanels(p, ['p'], [101, 0, 0])).toThrow(/space/)
    expect(resizePanels(p, ['p'], { width: 600 }).panels[0].width).toBe(600)
    expect(() => resizePanels(p, ['p'], { width: 601 })).toThrow(/space/)
    expect(() => assertDesignConstraintEdit(p, { ...p, spaceConstraint: { ...p.spaceConstraint!, width: 300 } })).toThrow(/space/)
    expect(assertDesignConstraintEdit(p, { ...p, spaceConstraint: { ...p.spaceConstraint!, enabled: false } }).spaceConstraint?.enabled).toBe(false)
  })
  it('uses rotated hidden stock and permits imported violations to improve only', () => {
    const p = project()
    p.panels[0] = { ...p.panels[0], visible: false, rotation: [0, 0, Math.PI / 4] }
    expect(spaceClearances(p.spaceConstraint!, p.panels)[0].clearance).toBeLessThan(-80)
    const moved = (y: number): Project => ({ ...p, panels: [{ ...p.panels[0], position: [0, y, 0] }] })
    expect(() => assertDesignConstraintEdit(p, moved(220))).not.toThrow()
    expect(() => assertDesignConstraintEdit(p, moved(180))).toThrow(/space/)
  })
  it('preserves the space when commands reconstruct a project', () => {
    const p = project(), candidate = { ...p }
    delete candidate.spaceConstraint
    expect(assertDesignConstraintEdit(p, candidate).spaceConstraint).toEqual(p.spaceConstraint)
  })
})
