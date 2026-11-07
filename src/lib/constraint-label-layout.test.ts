import { describe, expect, it } from 'vitest'
import { layoutConstraintLabels, type ConstraintLabelBox } from './constraint-label-layout'

const overlaps = (a: ConstraintLabelBox, b: ConstraintLabelBox) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

describe('constraint label placement', () => {
  it('separates coincident measurements and keeps their labels inside the viewport', () => {
    const labels = Array.from({ length: 10 }, (_, index) => ({ id: String(index), x: 790, y: 590, width: 180, height: 24 }))
    const placed = layoutConstraintLabels(labels, 800, 600)
    for (const [index, box] of placed.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(8)
      expect(box.y).toBeGreaterThanOrEqual(8)
      expect(box.x + box.width).toBeLessThanOrEqual(792)
      expect(box.y + box.height).toBeLessThanOrEqual(592)
      for (const other of placed.slice(index + 1)) expect(overlaps(box, other)).toBe(false)
    }
  })
  it('keeps an isolated label just above its measurement', () => {
    expect(layoutConstraintLabels([{ id: 'cut', x: 200, y: 200, width: 100, height: 24 }], 800, 600)[0]).toMatchObject({ x: 150, y: 166 })
  })
  it('is stable when registration order changes and accounts for detailed multiline labels', () => {
    const labels = [
      { id: 'gap', x: 300, y: 200, width: 180, height: 24 },
      { id: 'cut', x: 300, y: 200, width: 220, height: 50 },
      { id: 'space', x: 300, y: 200, width: 270, height: 60 },
    ]
    const placed = layoutConstraintLabels(labels, 800, 600)
    expect(layoutConstraintLabels([...labels].reverse(), 800, 600)).toEqual(placed)
    for (const [index, box] of placed.entries()) {
      for (const other of placed.slice(index + 1)) expect(overlaps(box, other)).toBe(false)
    }
  })
})
