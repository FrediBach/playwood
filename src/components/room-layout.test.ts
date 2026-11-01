import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { getRoomLayout } from './room-layout'

const layoutFor = (height: number, width = 2) => getRoomLayout(
  new Box3(new Vector3(-width / 2, 0, -0.2), new Vector3(width / 2, height, 0.2)),
)

describe('room artwork placement', () => {
  it('keeps the frame above furniture while both margins fit', () => {
    const layout = layoutFor(1.69)
    expect(layout.artX).toBe(-0.05)
    expect(layout.artY - 1.05 / 2 - 1.69).toBeCloseTo(0.2)
    expect(layout.height - layout.artY - 1.05 / 2).toBeGreaterThan(0.2)
  })

  it.each([1.71, 2, 4])('moves the complete frame above the lounge seat for %s m furniture', height => {
    const layout = layoutFor(height, 5)
    expect(layout.artX).toBe(layout.chairX)
    expect(layout.artY).toBe(1.85)
    expect(layout.height - layout.artY - 1.05 / 2).toBeGreaterThan(0.2)
    expect(layout.artX - 0.85 / 2 - 5 / 2).toBeGreaterThan(0.2)
  })

  it('keeps the usual hanging height for low furniture', () => {
    expect(layoutFor(0.7).artY).toBe(1.85)
    expect(layoutFor(0.7).artX).toBe(-0.05)
  })
})
