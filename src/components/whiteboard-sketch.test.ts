import { describe, expect, it } from 'vitest'
import { createPanel, createStarterProject, resolvePanels } from '@/lib/model'
import { whiteboardSketch } from './whiteboard-sketch'

describe('whiteboard furniture sketch', () => {
  it('fits resolved, rotated furniture inside the board without changing its panels', () => {
    const panels = resolvePanels(createStarterProject('desk'))
    const before = JSON.stringify(panels)
    const drawing = whiteboardSketch(panels)
    expect(drawing.length).toBeGreaterThan(0)
    for (const face of drawing) for (const [x, y] of face.points) {
      expect(x).toBeGreaterThanOrEqual(104.99)
      expect(x).toBeLessThanOrEqual(955.01)
      expect(y).toBeGreaterThanOrEqual(109.99)
      expect(y).toBeLessThanOrEqual(720.01)
    }
    expect(JSON.stringify(panels)).toBe(before)
    expect(whiteboardSketch(panels)).toEqual(drawing)
    expect(whiteboardSketch(panels.map(panel => ({ ...panel, rotation: [0.3, 0.5, 0.2] })))).not.toEqual(drawing)
    expect(whiteboardSketch(panels.map((panel, index) => index ? panel : { ...panel, width: panel.width * 1.5 }))).not.toEqual(drawing)
  })

  it('ignores hidden stock and surface details, and leaves an empty build blank', () => {
    const panel = createPanel({ width: 800, height: 300 })
    const drawing = whiteboardSketch([panel])
    expect(whiteboardSketch([panel, createPanel({ visible: false, position: [9000, 0, 0] })])).toEqual(drawing)
    expect(whiteboardSketch([{ ...panel, pattern: 'pegboard', color: '#ff0000' }])).toEqual(drawing)
    expect(whiteboardSketch([])).toEqual([])
    expect(whiteboardSketch([{ ...panel, visible: false }])).toEqual([])
  })

  it('centres translated furniture and fits very wide or tall constructions', () => {
    for (const [width, height] of [[10000, 50], [50, 10000]]) {
      const panel = createPanel({ width, height })
      const drawing = whiteboardSketch([panel])
      const moved = whiteboardSketch([{ ...panel, position: [10000, 20000, -5000] }])
      drawing.forEach((face, i) => face.points.forEach(([x, y], j) => {
        expect(moved[i].points[j][0]).toBeCloseTo(x)
        expect(moved[i].points[j][1]).toBeCloseTo(y)
      }))
    }
  })
})
