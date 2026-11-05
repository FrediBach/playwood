import { expect, it } from 'vitest'
import { findObjectSolids } from './object-solids'

it('uses exact connectivity and preserves a tiny gap', () => {
  const planes = [[0, 100, 100.000001, 200], [0, 100], [0, 100]]
  const occupied = new Uint8Array([1, 0, 1])
  const solids = findObjectSolids(planes, occupied)
  expect(solids.map(s => s.bounds)).toEqual([
    { min: [0, 0, 0], max: [100, 100, 100] },
    { min: [100.000001, 0, 0], max: [200, 100, 100] },
  ])
  expect(solids.every(s => s.cuboid)).toBe(true)
  expect([...occupied]).toEqual([1, 0, 1])
})
it('keeps a cavity in one component and does not mistake its envelope for a cuboid', () => {
  const occupied = new Uint8Array(27).fill(1); occupied[13] = 0
  const solids = findObjectSolids([[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]], occupied)
  expect(solids).toHaveLength(1)
  expect(solids[0].cuboid).toBe(false)
  expect(solids[0].prism).toBeUndefined()
})
it('bounds the number of pieces before fitting hardware', () => {
  expect(() => findObjectSolids([Array.from({ length: 68 }, (_, i) => i), [0, 1], [0, 1]], Uint8Array.from({ length: 67 }, (_, i) => Number(i % 2 === 0)))).toThrow(/200-panel/)
})
