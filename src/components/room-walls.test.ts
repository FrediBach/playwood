import { describe, expect, it } from 'vitest'
import { aroundHole } from './room-wall-geometry'

const area = (rects: { s0: number; s1: number; y0: number; y1: number }[]) => rects.reduce((sum, r) => sum + (r.s1 - r.s0) * (r.y1 - r.y0), 0)

describe('wall surfaces around the window', () => {
  it('leaves a wall without a hole whole', () => {
    expect(aroundHole({ s0: 0, s1: 4, y0: 0, y1: 3 })).toEqual([{ s0: 0, s1: 4, y0: 0, y1: 3 }])
  })

  it('cuts the opening out of the upper wall', () => {
    const parts = aroundHole({ s0: 0, s1: 10, y0: 1, y1: 3 }, { s0: 2, s1: 4.4, y0: 0.35, y1: 2.6 })
    expect(area(parts)).toBeCloseTo(10 * 2 - 2.4 * 1.6)
    for (const part of parts) expect(part.s1 <= 2 || part.s0 >= 4.4 || part.y0 >= 2.6 || part.y1 <= 0.35).toBe(true)
  })

  it('splits a lower wall that reaches into the opening', () => {
    const parts = aroundHole({ s0: 0, s1: 10, y0: 0, y1: 1.1 }, { s0: 2, s1: 4.4, y0: 0.35, y1: 2.6 })
    expect(area(parts)).toBeCloseTo(10 * 1.1 - 2.4 * 0.75)
    expect(parts).toHaveLength(3)
  })
})
