import { describe, expect, it } from 'vitest'
import { attachmentSideAnchors, layoutAttachmentSideLabels, SIDE_LABEL_HEIGHT, SIDE_LABEL_WIDTH } from './attachment-side-guide'
import { createPanel } from './model'
import { SIDES } from './connector-options'

describe('attachment side guidance', () => {
  it('keeps side names attached to the rotated panel, including opposite faces', () => {
    const panel = createPanel({ width: 600, height: 400, thickness: 18, position: [100, 500, -200], rotation: [0, 0, Math.PI] })
    const anchors = attachmentSideAnchors(panel)
    const right = anchors.find(anchor => anchor.side === 'right')!
    expect(right.position[0]).toBeCloseTo(-200)
    expect(right.position[1]).toBeCloseTo(500)
    expect(right.direction[0]).toBeCloseTo(-1)
    expect(anchors.find(anchor => anchor.side === 'front')!.position[2]).toBe(-191)
    expect(anchors.find(anchor => anchor.side === 'back')!.position[2]).toBe(-209)
    expect(anchors.map(anchor => anchor.badge)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it.each([{ width: 800, height: 600 }, { width: 240, height: 320 }])('separates coincident side labels inside a $width × $height viewport', ({ width, height }) => {
    const labels = layoutAttachmentSideLabels(SIDES.map(side => ({ side, x: width / 2, y: height / 2, dx: 0, dy: 0 })), width, height)
    for (const [index, label] of labels.entries()) {
      expect(label.x - SIDE_LABEL_WIDTH / 2).toBeGreaterThanOrEqual(0)
      expect(label.x + SIDE_LABEL_WIDTH / 2).toBeLessThanOrEqual(width)
      expect(label.y - SIDE_LABEL_HEIGHT / 2).toBeGreaterThanOrEqual(0)
      expect(label.y + SIDE_LABEL_HEIGHT / 2).toBeLessThanOrEqual(height)
      for (const other of labels.slice(index + 1)) {
        expect(Math.abs(label.x - other.x) >= SIDE_LABEL_WIDTH || Math.abs(label.y - other.y) >= SIDE_LABEL_HEIGHT).toBe(true)
      }
    }
  })

  it('keeps the projection of rotated left and right edges on their own sides', () => {
    const labels = layoutAttachmentSideLabels([
      { side: 'left', x: 600, y: 300, dx: 1, dy: 0 },
      { side: 'right', x: 200, y: 300, dx: -1, dy: 0 },
      { side: 'front', x: 400, y: 300, dx: 0, dy: 0 },
      { side: 'back', x: 400, y: 300, dx: 0, dy: 0 },
    ], 800, 600)
    expect(labels.find(label => label.side === 'right')!.x).toBeLessThan(labels.find(label => label.side === 'left')!.x)
  })
})
