import { describe, expect, it } from 'vitest'
import { resolvePanels } from './model'
import { createExampleProject } from './example-library'
import { compartmentRow, furnitureArchetypes } from './fixtures/furniture-archetypes'
import { planPreviewFurnishings, detectPreviewFurnishings, type FurnishingPlacement } from './preview-furnishings'
import { chooseFurnishingRole, nameRoleHint, summarizeFurnishedRoles, type SurfaceFeatures } from './preview-furnishing-roles'

const archetype = (id: string) => furnitureArchetypes().find(item => item.id === id)!
const roleOf = (panels: Parameters<typeof planPreviewFurnishings>[0], panelId: string, options = {}) =>
  planPreviewFurnishings(panels, options).surfaces.find(surface => surface.panelId === panelId)?.role
const kindsOn = (placements: FurnishingPlacement[], panelId: string) => placements.filter(item => item.panelId === panelId).map(item => item.kind)

describe('furnishing purpose recognition', () => {
  it.each(furnitureArchetypes().map(item => [item.id, item] as const))('recognises the %s archetype', (_, item) => {
    const plan = planPreviewFurnishings(item.panels)
    expect(plan.surfaces.find(surface => surface.panelId === item.top)?.role).toBe(item.role)
    expect(plan.placements.some(placement => placement.panelId === item.top)).toBe(true)
  })

  it('does not put a computer or person on a desk-height sideboard without knee space', () => {
    const placements = detectPreviewFurnishings(archetype('sideboard').panels)
    expect(placements.some(item => item.kind === 'computer' || item.kind === 'laptop')).toBe(false)
    expect(placements.some(item => item.kind.startsWith('seated-person'))).toBe(false)
  })

  it('furnishes each role with fitting objects', () => {
    const expectations: Record<string, string[]> = {
      dining: ['place-setting'], coffee: ['tray'], 'side-table': ['table-lamp'], counter: ['cutting-board'],
      'standing-desk': ['laptop'], lowboard: ['tv'], bed: ['bedding'], 'riser-desk': ['laptop', 'seated-person-chair'],
    }
    for (const [id, kinds] of Object.entries(expectations)) {
      const item = archetype(id)
      const found = kindsOn(detectPreviewFurnishings(item.panels), item.top)
      for (const kind of kinds) expect(found, id).toContain(kind)
    }
  })

  it('seats diners on both sides of a dining table without exceeding the people budget', () => {
    const placements = detectPreviewFurnishings(archetype('dining').panels, { density: 'lived-in' })
    const seats = placements.filter(item => item.kind === 'chair' || item.kind === 'seated-person-chair')
    expect(seats.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seats.map(item => Math.sign(item.position[2]))).size).toBe(2)
    expect(placements.filter(item => item.kind.startsWith('seated-person'))).toHaveLength(2)
  })

  it('puts the pillows of a bed at its headboard', () => {
    const bedding = detectPreviewFurnishings(archetype('bed').panels).find(item => item.kind === 'bedding')!
    // Local -X carries the pillows; it must point towards the headboard at world -X.
    expect(Math.cos(bedding.rotation)).toBeCloseTo(1, 6)
    expect(bedding.size![0]).toBeGreaterThan(1.8)
  })

  it('reads coplanar cube tops as one surface but keeps walled compartments separate', () => {
    const cube = archetype('cube-sideboard')
    const plan = planPreviewFurnishings(cube.panels)
    expect(plan.surfaces.find(surface => surface.panelId === 'cube-top-0')?.features.width).toBeGreaterThan(1.1)
    expect(plan.surfaces.some(surface => surface.panelId === 'cube-top-1')).toBe(false)
    const row = planPreviewFurnishings(compartmentRow(4))
    for (let column = 0; column < 4; column++) expect(row.surfaces.some(surface => surface.panelId === `row-shelf-${column}`)).toBe(true)
  })

  it('recognises desks in gallery builds made from separate legs, spines and worktops', () => {
    for (const id of ['h-table-120', 'h-table-180', 'workstation']) {
      const plan = planPreviewFurnishings(resolvePanels(createExampleProject(id)))
      expect(plan.surfaces.some(surface => surface.role === 'desk' && surface.furnished), id).toBe(true)
    }
  })

  it('lets distinctive names settle an ambiguous table, but not an impossible role', () => {
    const table = archetype('dining')
    expect(roleOf(table.panels, table.top)).toBe('dining-table')
    expect(roleOf(table.panels, table.top, { names: { [table.top]: 'Schreibtisch' } })).toBe('desk')
    const named = table.panels.map(panel => panel.id === table.top ? { ...panel, name: 'Desk top' } : panel)
    expect(roleOf(named, table.top)).toBe('desk')
    // No name turns a bench into a bed.
    const bench = archetype('bench')
    expect(roleOf(bench.panels, bench.top, { names: { [bench.top]: 'Daybed' } })).toBe('bench')
  })

  it('applies explicit role choices, including leaving a surface empty', () => {
    const sideboard = archetype('sideboard')
    expect(kindsOn(detectPreviewFurnishings(sideboard.panels, { roles: { [sideboard.top]: 'empty' } }), sideboard.top)).toEqual([])
    const plan = planPreviewFurnishings(sideboard.panels, { roles: { [sideboard.top]: 'display' } })
    expect(plan.surfaces.find(surface => surface.panelId === sideboard.top)).toMatchObject({ role: 'display', source: 'choice' })
    const desk = archetype('desk')
    expect(kindsOn(detectPreviewFurnishings(desk.panels, { roles: { [desk.top]: 'dining-table' } }), desk.top)).toContain('place-setting')
  })

  it('maps names to roles in several languages and ignores generic words', () => {
    expect(nameRoleHint('Desktop')).toBe('desk')
    expect(nameRoleHint('Couchtisch')).toBe('coffee-table')
    expect(nameRoleHint('Nachttisch links')).toBe('side-table')
    expect(nameRoleHint('Stehpult')).toBe('standing-desk')
    expect(nameRoleHint('TV lowboard')).toBe('lowboard')
    expect(nameRoleHint('Top shelf', 'Board', undefined)).toBeUndefined()
  })

  it('stays undecided below the minimum confidence', () => {
    const features: SurfaceFeatures = {
      height: 1.6, width: 1.4, depth: 0.9, headroom: Infinity, workHeadroom: Infinity, legroomFront: false, legroomBack: false,
      enclosedBelow: false, sideWalls: 0, supported: false, benchSeat: false, objectSurfaces: 1, objectHasInserts: false,
    }
    expect(chooseFurnishingRole(features).role).toBeNull()
  })

  it('summarises furnished roles for the status line', () => {
    expect(summarizeFurnishedRoles(['shelf', 'desk', 'shelf', 'lowboard'])).toBe('2 shelves · 1 desk · 1 TV lowboard')
    expect(summarizeFurnishedRoles([])).toBe('')
  })
})
