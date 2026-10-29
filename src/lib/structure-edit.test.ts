import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import { attachPanel, createPanel, createStarterProject, getProjectBounds, parseProject, resolvePanels, rotateProject, validateProject } from './model'
import { gridProject } from './example-geometry'
import { workstationProject } from './platform-examples'
import { EXAMPLE_LIBRARY } from './example-library'
import { movePanels, resizePanels } from './structure-edit'
import type { AttachmentOptions, Panel, Project, Vec3 } from './types'

const named = (project: Project, name: string) => resolvePanels(project).find(panel => panel.name === name)!
const near = (actual: number[], expected: number[], precision = 5) => actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], precision))
const options: AttachmentOptions = { type: '90', side: 'right', offset: 0, inset: 0, flip: false, color: '#e75a35', count: 2 }
const expectValid = (project: Project) => { expect(validateProject(project)).toEqual([]); expect(() => parseProject(project)).not.toThrow() }

describe('connected panel movement', () => {
  it('raises an interior shelf exactly and compensates the spans above and below', () => {
    const before = createStarterProject()
    const middle = named(before, 'Middle shelf')
    const next = movePanels(before, [middle.id], [0, 10, 0])
    near(named(next, 'Middle shelf').position, middle.position.map((value, axis) => value + (axis === 1 ? 10 : 0)))
    for (const name of ['Bottom shelf', 'Top shelf']) near(named(next, name).position, named(before, name).position)
    for (const name of ['Left side', 'Right side']) expect(named(next, name).width).toBeCloseTo(named(before, name).width + 10, 5)
    for (const name of ['Left upper side', 'Right upper side']) expect(named(next, name).width).toBeCloseTo(named(before, name).width - 10, 5)
    expectValid(next)
    near(named(before, 'Middle shelf').position, middle.position)
  })

  it('raises the top shelf while keeping the bottom and middle shelves stationary', () => {
    const before = createStarterProject()
    const top = named(before, 'Top shelf')
    const next = movePanels(before, [top.id], [0, 100, 0])
    near(named(next, 'Top shelf').position, top.position.map((value, axis) => value + (axis === 1 ? 100 : 0)))
    for (const name of ['Bottom shelf', 'Middle shelf']) near(named(next, name).position, named(before, name).position)
    expectValid(next)
  })

  it('moves a side outward, widens every shelf, and keeps the opposite side stationary', () => {
    const before = createStarterProject()
    const right = named(before, 'Right side')
    const next = movePanels(before, [right.id], [10, 0, 0])
    near(named(next, 'Right side').position, right.position.map((value, axis) => value + (axis === 0 ? 10 : 0)))
    near(named(next, 'Left side').position, named(before, 'Left side').position)
    for (const name of ['Bottom shelf', 'Middle shelf', 'Top shelf']) expect(named(next, name).width).toBeCloseTo(1110, 5)
    expectValid(next)
  })

  it('translates an entire selected assembly exactly once without changing its cuts', () => {
    const before = createStarterProject()
    before.panels[2].visible = false
    const next = movePanels(before, before.panels.map(panel => panel.id), [10, 100, -10])
    resolvePanels(next).forEach((panel, index) => {
      const original = resolvePanels(before)[index]
      near(panel.position, original.position.map((value, axis) => value + [10, 100, -10][axis]))
      expect(panel.width).toBe(original.width)
      expect(panel.height).toBe(original.height)
    })
    expect(next.connections).toEqual(before.connections)
    expectValid(next)
  })

  it('preserves independent assemblies and moves a free panel without resizing', () => {
    const before = createStarterProject()
    const loose = createPanel({ position: [3000, 1000, 0] })
    before.panels.push(loose)
    const next = movePanels(before, [loose.id], [0, 0, -100])
    expect(named(next, loose.name).position).toEqual([3000, 1000, -100])
    expect(next.panels.filter(panel => panel.id !== loose.id)).toEqual(resolvePanels(before).filter(panel => panel.id !== loose.id))
  })

  it('handles a rotated assembly in its own axes', () => {
    const before = rotateProject(rotateProject(createStarterProject(), 'z', 45), 'y', 27)
    const middle = named(before, 'Middle shelf')
    const axis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion().setFromEuler(new Euler(...middle.rotation)))
    if (axis.y < 0) axis.negate()
    const delta = axis.multiplyScalar(10).toArray() as Vec3
    const next = movePanels(before, [middle.id], delta)
    near(named(next, 'Middle shelf').position, middle.position.map((value, index) => value + delta[index]))
    for (const name of ['Bottom shelf', 'Top shelf']) near(named(next, name).position, named(before, name).position)
    expectValid(next)
  })

  it('preserves all T/cross supports in a grid with multiple driving roots', () => {
    const before = gridProject('Grid', [350, 450], [300, 400])
    const selected = named(before, 'Shelf 1.2')
    const next = movePanels(before, [selected.id], [0, 10, 0])
    near(named(next, selected.name).position, selected.position.map((value, axis) => value + (axis === 1 ? 10 : 0)))
    expectValid(next)
  })

  it('rejects a step beyond physical size limits atomically', () => {
    const before = createStarterProject()
    const snapshot = JSON.stringify(before)
    expect(() => movePanels(before, [named(before, 'Middle shelf').id], [0, 1000, 0])).toThrow(/limits/)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('keeps a supported insert touching the cabinet as its opening changes', () => {
    const before = workstationProject()
    const next = movePanels(before, [named(before, 'Worktop').id], [0, 100, 0])
    for (const side of ['Left', 'Right']) {
      const divider = named(next, `${side} insert divider`)
      const base = named(next, `${side} pedestal base`)
      const bounds = getProjectBounds([divider]), floor = getProjectBounds([base]), top = getProjectBounds([named(next, 'Worktop')])
      expect(bounds.min[1]).toBeCloseTo(floor.max[1], 5)
      expect(bounds.max[1]).toBeCloseTo(top.min[1], 5)
    }
    expectValid(next)
  })
})

describe('connected panel resizing', () => {
  it('propagates shelf width through support joints with the edited panel centered', () => {
    const before = createStarterProject()
    const selected = named(before, 'Middle shelf')
    const next = resizePanels(before, [selected.id], { width: 1200, height: undefined })
    for (const name of ['Bottom shelf', 'Middle shelf', 'Top shelf']) expect(named(next, name).width).toBeCloseTo(1200, 5)
    near(named(next, selected.name).position, selected.position)
    expectValid(next)
  })

  it('propagates depth changes along flush connected edges', () => {
    const before = createStarterProject()
    const next = resizePanels(before, [named(before, 'Middle shelf').id], { height: 420 })
    for (const panel of next.panels) expect(panel.height).toBeCloseTo(420, 5)
    expectValid(next)
  })

  it.each(['105', '150'] as const)('keeps the rigid %s° connector seat and angle intact', type => {
    const base = createPanel({ width: 600, height: 360, position: [0, 400, 0] })
    const before = attachPanel({ version: 1, name: 'Angled panels', panels: [base], connections: [] }, base.id, createPanel({ name: 'Angled child' }), { ...options, type })
    const selected = named(before, 'Angled child')
    const next = resizePanels(before, [selected.id], { width: 750, height: 420 })
    near(named(next, selected.name).position, selected.position)
    near(named(next, selected.name).rotation, selected.rotation)
    expect(named(next, base.name).height).toBeCloseTo(420, 5)
    expectValid(next)
  })

  it('resizes an entire grid without breaking shared hardware', () => {
    const before = gridProject('Grid', [350, 450], [300, 400])
    const next = resizePanels(before, [named(before, 'Shelf 1.2').id], { width: 425 })
    expect(named(next, 'Shelf 1.2').width).toBe(425)
    expectValid(next)
  })

  it('handles a near-limit grid without a dense matrix solve', () => {
    const before = gridProject('Large grid', Array(8).fill(350), Array(10).fill(300))
    const selected = named(before, 'Shelf 4.5')
    const next = movePanels(before, [selected.id], [0, 10, 0])
    expect(next.panels).toHaveLength(178)
    near(named(next, selected.name).position, selected.position.map((value, axis) => value + (axis === 1 ? 10 : 0)))
    expectValid(next)
  })

  it.each(EXAMPLE_LIBRARY)('keeps the $name example connected when its first panel grows', example => {
    const before = example.create()
    const selected = before.panels[0]
    const next = resizePanels(before, [selected.id], { width: selected.width + 10, height: selected.height + 10 })
    expectValid(next)
  })

  it('keeps unattached insert shelves fitted when a workstation grows in depth', () => {
    const before = workstationProject()
    const next = resizePanels(before, [named(before, 'Worktop').id], { height: 835 })
    for (const side of ['Left', 'Right']) {
      const divider = named(next, `${side} insert divider`)
      for (const suffix of ['1', '2']) {
        const shelf = named(next, `${side} insert shelf ${suffix}`)
        expect(shelf.height).toBeCloseTo(named(before, shelf.name).height + 50, 5)
        expect(shelf.width).toBeCloseTo(divider.width, 5)
      }
    }
    expectValid(next)
  })

  it('rejects invalid input and leaves no-op changes alone', () => {
    const before = createStarterProject()
    const id = before.panels[0].id
    expect(() => resizePanels(before, [id], { width: 39 })).toThrow(/limits/)
    expect(() => movePanels(before, [id], [Infinity, 0, 0])).toThrow(/finite/)
    expect(resizePanels(before, [id], { width: before.panels[0].width })).toBe(before)
    expect(movePanels(before, [id], [0, 0, 0])).toBe(before)
    expect(movePanels(before, ['missing'], [10, 0, 0])).toBe(before)
  })
})
