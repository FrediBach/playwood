import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import importedShelf from './__fixtures__/synth-storage-resize.json'
import { attachPanel, createPanel, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { movePanels, resizePanels } from './structure-edit'
import type { Project } from './types'

const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!
const expectCuts = (before: Project, after: Project, names: string[]) => {
  for (const name of names) {
    const old = named(before, name), next = named(after, name)
    expect(next.width, `${name} width`).toBeCloseTo(old.width, 6)
    expect(next.height, `${name} height`).toBeCloseTo(old.height, 6)
    expect(next.thickness).toBe(old.thickness)
    expect(next.rotation).toEqual(old.rotation)
  }
}
const expectValid = (before: Project, after: Project) => {
  expect(validateProject(after)).toEqual([])
  expect(after.constraints).toEqual(before.constraints)
  expect(after.panels.map(panel => panel.id)).toEqual(before.panels.map(panel => panel.id))
  expect(after.connections.map(connection => connection.id)).toEqual(before.connections.map(connection => connection.id))
  expect(() => parseProject(after)).not.toThrow()
}
const appendages = ['Synth tray 1', 'Synth tray 2', 'Synth tray 3', 'Front stopper 1', 'Front stopper 2', 'Front stopper 3']

// Retain the supplied cuts, including their existing fractional measurements.
// These regressions prevent new drift; they do not infer historical dimensions.
describe('connected edits preserve independent cuts', () => {
  it.each([false, true])('preserves angled trays and stoppers when an upright grows (rotated: %s)', rotated => {
    const loaded = parseProject(importedShelf)
    const before = rotated ? rotateProject(rotateProject({ ...loaded, constraints: [] }, 'y', 27), 'z', 15) : loaded
    const snapshot = JSON.stringify(before)
    const upright = named(before, 'Upright 1.1')
    const after = resizePanels(before, [upright.id], { width: upright.width + 100 })
    expect(named(after, upright.name).width).toBeCloseTo(upright.width + 100)
    expectCuts(before, after, appendages)
    expectValid(before, after)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it.each([false, true])('keeps shallow and deep sections independent when storage grows (rules: %s)', rules => {
    const loaded = parseProject(importedShelf)
    const before = rules ? loaded : { ...loaded, constraints: [] }
    const upright = named(before, 'Storage upright 1.1')
    const after = resizePanels(before, [upright.id], { height: upright.height + 100 })
    for (const panel of before.panels.filter(panel => panel.name.startsWith('Storage '))) {
      expect(named(after, panel.name).height, panel.name).toBeCloseTo(panel.height + 100)
    }
    expectCuts(before, after, before.panels.filter(panel => !panel.name.startsWith('Storage ')).map(panel => panel.name))
    // The shallow continuation keeps its close rear setback; the unused long
    // front extension no longer imposes a second, accidental dimension rule.
    const connection = before.connections.find(connection => connection.parentId === named(before, 'Storage upright 1.2').id
      && connection.childId === named(before, 'Upright 1.1').id)!
    const setback = (project: Project) => {
      const joint = project.connections.find(item => item.id === connection.id)!
      const parent = project.panels.find(panel => panel.id === joint.parentId)!
      const child = project.panels.find(panel => panel.id === joint.childId)!
      return parent.height / 2 - joint.offset - child.height / 2
    }
    expect(setback(after)).toBeCloseTo(setback(before), 6)
    expectValid(before, after)
  })

  it('lets the short side depth grow without recutting storage or angled accessories', () => {
    const before = parseProject(importedShelf), upright = named(before, 'Upright 1.1')
    const after = resizePanels(before, [upright.id], { height: upright.height + 100 })
    expect(named(after, upright.name).height).toBe(400)
    expectCuts(before, after, [...appendages, ...before.panels.filter(panel => panel.name.startsWith('Storage ')).map(panel => panel.name)])
    expectValid(before, after)
  })

  it.each([-10, 10])('moves a shelf by %s mm with its angled tray and stopper intact', distance => {
    const before = parseProject(importedShelf), shelf = named(before, 'Shelf 1.2')
    const after = movePanels(before, [shelf.id], [0, distance, 0])
    expectCuts(before, after, appendages)
    for (const name of ['Shelf 1.2', 'Synth tray 1', 'Front stopper 1']) {
      const delta = new Vector3(...named(after, name).position).sub(new Vector3(...named(before, name).position))
      expect(delta.x).toBeCloseTo(0, 6)
      expect(delta.y).toBeCloseTo(distance, 6)
      expect(delta.z).toBeCloseTo(0, 6)
    }
    expectValid(before, after)
  })

  it.each([false, true])('keeps previously sized parallel stoppers intact through sequential edits (tray locks: %s)', locked => {
    const loaded = parseProject(importedShelf)
    const before: Project = locked ? { ...loaded, constraints: [...loaded.constraints ?? [], ...loaded.panels
      .filter(panel => panel.name.startsWith('Synth tray')).map(panel => ({ id: `tray-height/${panel.id}`, enabled: true,
        kind: 'dimension' as const, panelId: panel.id, dimension: 'height' as const, value: panel.height }))] } : loaded
    const snapshot = JSON.stringify(before)
    const stoppers = before.panels.filter(panel => panel.name.startsWith('Front stopper'))
    const expected = new Map(stoppers.map(panel => [panel.id, panel.height]))
    let current = before
    for (const stopper of stoppers) {
      const next = resizePanels(current, [stopper.id], { height: 50 })
      expected.set(stopper.id, 50)
      for (const panel of next.panels.filter(panel => expected.has(panel.id))) {
        expect(panel.height, panel.name).toBeCloseTo(expected.get(panel.id)!, 6)
        expect(panel.width).toBe(stopper.width)
      }
      expectCuts(current, next, ['Synth tray 1', 'Synth tray 2', 'Synth tray 3'])
      expectValid(before, next)
      current = next
    }
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('honors an authored matching cut even when that cut is oblique to the requested edit', () => {
    const base = createPanel({ name: 'Shelf', width: 600, height: 300, position: [0, 800, 0] })
    const attached = attachPanel({ version: 1, name: 'Intentional matching cuts', panels: [base], connections: [] }, base.id,
      createPanel({ name: 'Angled extension', width: 600, height: 300 }),
      { type: '150', side: 'top', offset: 0, inset: 0, flip: false, color: '#292b27', count: 2 })
    const child = named(attached, 'Angled extension')
    const before: Project = { ...attached, constraints: [{ id: 'match', enabled: true, kind: 'equal-dimension',
      panelIds: [base.id, child.id], dimension: 'height' }] }
    const after = resizePanels(before, [base.id], { height: 350 })
    expect(named(after, child.name).height).toBeCloseTo(350, 6)
    expectValid(before, after)
  })

  it('never releases an authored cut lock to satisfy a rejected resize', () => {
    const loaded = parseProject(importedShelf), tray = named(loaded, 'Synth tray 1')
    const before: Project = { ...loaded, constraints: [...loaded.constraints ?? [], { id: 'locked-tray', enabled: true,
      kind: 'dimension', panelId: tray.id, dimension: 'height', value: tray.height }] }
    const snapshot = JSON.stringify(before)
    expect(() => resizePanels(before, [tray.id], { height: tray.height + 10 })).toThrow(/design rules/)
    expect(JSON.stringify(before)).toBe(snapshot)
    const after = movePanels(before, [named(before, 'Shelf 1.2').id], [0, -10, 0])
    expectCuts(before, after, appendages)
    expectValid(before, after)
  })
})

describe('partial seam cut inference', () => {
  it.each([
    { offset: 139.99, quarterTurn: false, follows: true },
    { offset: 140.01, quarterTurn: false, follows: false },
    { offset: -140.01, quarterTurn: false, follows: false },
    { offset: 139.99, quarterTurn: true, follows: true },
    { offset: 140.01, quarterTurn: true, follows: false },
    { offset: -140.01, quarterTurn: true, follows: false },
  ])('preserves the near end with offset $offset and quarter-turn $quarterTurn', ({ offset, quarterTurn, follows }) => {
    const base = createPanel({ name: 'Deep side', width: 600, height: 600, position: [0, 1000, 0] })
    const attached = attachPanel({ version: 1, name: 'Partial seam', panels: [base], connections: [] }, base.id,
      createPanel({ name: 'Short side', width: quarterTurn ? 400 : 300, height: quarterTurn ? 300 : 400 }),
      { type: '90', side: 'right', offset, inset: 0, flip: false, color: '#292b27', count: 2 })
    const oriented = { ...attached, connections: attached.connections.map(connection => ({ ...connection, quarterTurn })) }
    const before = rotateProject(rotateProject(oriented, 'y', 27), 'z', 15)
    const after = resizePanels(before, [base.id], { height: 700 })
    const child = named(after, 'Short side')
    expect(child[quarterTurn ? 'width' : 'height']).toBeCloseTo(follows ? 500 : 400, 6)
    expect(child[quarterTurn ? 'height' : 'width']).toBeCloseTo(300, 6)
    expect(after.connections[0].offset).toBeCloseTo(offset + (follows ? 0 : Math.sign(offset) * 50), 6)
    expectValid(before, after)
  })
})
