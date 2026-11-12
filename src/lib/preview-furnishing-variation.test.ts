import { describe, expect, it } from 'vitest'
import { createPanel } from './model'
import { compartmentRow, furnitureArchetypes } from './fixtures/furniture-archetypes'
import { detectPreviewFurnishings, planPreviewFurnishings } from './preview-furnishings'
import { hashFraction, hashText, pickContent, shelfMix, variationHash } from './preview-furnishing-variation'
import type { Panel } from './types'

/** A tall bookcase, five compartments wide and five high, with stable IDs. */
function bookcase(prefix = 'case') {
  const width = 380, depth = 420, height = 300, pitch = width + 35
  const panels: Panel[] = []
  for (let row = 0; row <= 5; row++) for (let column = 0; column < 5; column++) panels.push(createPanel({
    id: `${prefix}-shelf-${column}-${row}`, name: 'Board', width, height: depth, position: [(column - 2) * pitch, 9 + row * (height + 35), 0], rotation: [-Math.PI / 2, 0, 0],
  }))
  for (let row = 0; row < 5; row++) for (let column = 0; column <= 5; column++) panels.push(createPanel({
    id: `${prefix}-upright-${column}-${row}`, name: 'Board', width: depth, height, position: [(column - 2.5) * pitch, 9 + (row + 0.5) * (height + 35), 0], rotation: [0, Math.PI / 2, 0],
  }))
  return panels
}

const signature = (panels: Panel[], options = {}) => detectPreviewFurnishings(panels, options).map(item => `${item.id}:${item.bookSeed ?? ''}`).join('|')

describe('furnishing variations', () => {
  it('keeps seed 0 identical to the default and reshuffles reproducibly for other seeds', () => {
    const panels = bookcase()
    expect(signature(panels, { seed: 0 })).toBe(signature(panels))
    const shuffled = [1, 2, 3].map(seed => signature(panels, { seed }))
    expect(new Set([signature(panels), ...shuffled]).size).toBe(4)
    expect(signature(panels, { seed: 2 })).toBe(shuffled[1])
    expect(signature([...panels].reverse(), { seed: 2 })).toBe(shuffled[1])
  })

  it('matches the original content buckets for the default mix', () => {
    const mix = shelfMix('living', 'balanced')
    for (let index = 0; index < 400; index++) {
      const hash = hashText(`bucket-${index}`)
      const bucket = hash % 10
      expect(pickContent(mix, hashFraction(hash))).toBe(bucket < 2 ? 'empty' : bucket < 5 ? 'decor' : 'books')
    }
    expect(variationHash('panel', 0)).toBe(hashText('panel'))
    expect(variationHash('panel', 7)).not.toBe(hashText('panel'))
  })

  it('fills more compartments as density rises', () => {
    const panels = bookcase()
    const count = (density: 'minimal' | 'balanced' | 'lived-in') => [0, 1, 2, 3].reduce((sum, seed) =>
      sum + new Set(detectPreviewFurnishings(panels, { density, seed }).map(item => item.panelId)).size, 0)
    expect(count('minimal')).toBeLessThan(count('balanced'))
    expect(count('balanced')).toBeLessThan(count('lived-in'))
  })

  it('adds desk accessories when lived-in and varies the desk layout with a shuffle', () => {
    const desk = furnitureArchetypes().find(item => item.id === 'desk')!.panels
    expect(detectPreviewFurnishings(desk, { density: 'lived-in' }).map(item => item.kind)).toEqual(expect.arrayContaining(['mug', 'notebook', 'computer']))
    const layouts = new Set(Array.from({ length: 12 }, (_, seed) => detectPreviewFurnishings(desk, { seed })
      .map(item => `${item.kind}:${item.position[0].toFixed(2)}`).join(',')))
    expect(layouts.size).toBeGreaterThan(1)
  })

  it('uses themed contents for kids and kitchen shelving', () => {
    const panels = bookcase()
    const kinds = (theme: 'kids' | 'kitchen') => new Set([0, 1, 2].flatMap(seed => detectPreviewFurnishings(panels, { theme, seed }).map(item => item.kind)))
    expect([...kinds('kids')]).toEqual(expect.arrayContaining(['basket']))
    expect([...kinds('kitchen')]).toEqual(expect.arrayContaining(['jars']))
  })

  it('sizes baskets to their compartment', () => {
    for (let seed = 0; seed < 8; seed++) for (const basket of detectPreviewFurnishings(bookcase(), { theme: 'kids', seed }).filter(item => item.kind === 'basket')) {
      expect(basket.size![0]).toBeLessThanOrEqual(0.36)
      expect(basket.size![1]).toBeLessThanOrEqual(0.26)
    }
  })

  it('avoids repeating the same decoration in neighbouring compartments', () => {
    let repeats = 0, pairs = 0
    for (let seed = 0; seed < 12; seed++) {
      const placements = detectPreviewFurnishings(compartmentRow(6), { seed })
      const decor = (column: number) => {
        const kinds = placements.filter(item => item.panelId === `row-shelf-${column}`).map(item => item.kind)
        return kinds.length === 1 && (kinds[0] === 'vase' || kinds[0] === 'plant') ? 'decor' : kinds.length ? 'other' : 'empty'
      }
      for (let column = 1; column < 6; column++) {
        pairs++
        const a = decor(column - 1), b = decor(column)
        if (a === b && a !== 'other') repeats++
      }
    }
    // Without planning, about a fifth of neighbouring pairs repeat decor or a gap.
    expect(repeats / pairs).toBeLessThan(0.12)
  })

  it('continues long book shelves with a second group', () => {
    const wide = (id: string) => [
      createPanel({ id, name: 'Board', width: 1200, height: 380, position: [0, 9, 0], rotation: [-Math.PI / 2, 0, 0] }),
      createPanel({ id: `${id}:roof`, name: 'Board', width: 1200, height: 380, position: [0, 369, 0], rotation: [-Math.PI / 2, 0, 0] }),
      ...[-1, 1].map(sign => createPanel({ id: `${id}:wall:${sign}`, name: 'Board', width: 380, height: 342, position: [sign * 609, 189, 0], rotation: [0, Math.PI / 2, 0] })),
    ]
    let continued = 0
    for (let index = 0; index < 30; index++) {
      const id = `long-${index}`
      const kinds = detectPreviewFurnishings(wide(id)).filter(item => item.panelId === id).map(item => item.kind)
      if (kinds[0] === 'books' && kinds.length > 1) continued++
    }
    expect(continued).toBeGreaterThan(3)
  })

  it('reports a stable role summary independent of seed', () => {
    const panels = bookcase()
    const roles = (seed: number) => planPreviewFurnishings(panels, { seed }).surfaces.map(item => `${item.panelId}:${item.role}`).join(',')
    expect(roles(5)).toBe(roles(0))
  })
})
