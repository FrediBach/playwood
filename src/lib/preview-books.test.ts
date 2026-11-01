import { describe, expect, it } from 'vitest'
import { Box3, Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import {
  createPreviewBooks, getPreviewBookBounds, PREVIEW_BOOK_BOUNDS, PREVIEW_BOOK_STACK_BOUNDS,
  type PreviewBook, type PreviewBookArrangement,
} from './preview-books'

const arrangements: PreviewBookArrangement[] = ['upright', 'leaning', 'stacked']
const supportedArrangements = arrangements.flatMap(arrangement => (['left', 'right'] as const).map(supportSide => ({ arrangement, supportSide })))
const seeds = Array.from({ length: 64 }, (_, index) => `shelf-${index}:books:left`)

function bookBounds(book: PreviewBook) {
  const rotation = new Quaternion().setFromEuler(new Euler(...book.rotation))
  const bounds = new Box3()
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    bounds.expandByPoint(new Vector3(x * book.thickness / 2, y * book.height / 2, z * book.depth / 2)
      .applyQuaternion(rotation).add(new Vector3(...book.position)))
  }
  return bounds
}

function bookBox(book: PreviewBook) {
  // Shared cover surfaces may touch. Shrink by 10 μm to test volume overlap.
  const halfSize = new Vector3(book.thickness, book.height, book.depth).multiplyScalar(0.5).addScalar(-0.00001)
  const rotation = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...book.rotation)))
  return new OBB(new Vector3(...book.position), halfSize, rotation)
}

describe('varied preview books', () => {
  it('keeps each seeded arrangement stable across rerenders and unrelated generations', () => {
    for (const arrangement of [...arrangements, undefined]) {
      const before = createPreviewBooks('same-shelf:books:left', arrangement)
      createPreviewBooks('another-shelf:books:right', 'stacked')
      expect(createPreviewBooks('same-shelf:books:left', arrangement)).toEqual(before)
    }
  })

  it('varies counts, thicknesses, heights, colours and cover designs across shelves', () => {
    const groups = seeds.map(seed => createPreviewBooks(seed, 'upright'))
    const books = groups.flat()
    expect(new Set(groups.map(group => group.length)).size).toBeGreaterThanOrEqual(4)
    expect(new Set(books.map(book => book.thickness)).size).toBeGreaterThan(15)
    expect(new Set(books.map(book => book.height)).size).toBeGreaterThan(15)
    expect(new Set(books.map(book => book.color)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(books.map(book => book.design)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(seeds.map(seed => createPreviewBooks(seed, 'stacked').length)).size).toBeGreaterThanOrEqual(2)
  })

  it('varies the default shelf arrangement while keeping the chosen pose stable', () => {
    const poses = seeds.map(seed => {
      const books = createPreviewBooks(seed)
      const roll = books[0].rotation[2]
      return Math.abs(roll) > 1 ? 'stacked' : Math.abs(roll) > 0.03 ? 'leaning' : 'upright'
    })
    expect(new Set(poses)).toEqual(new Set(arrangements))
  })

  it.each(supportedArrangements)('keeps $arrangement groups with $supportSide support grounded, nonintersecting and inside their clearance envelope', ({ arrangement, supportSide }) => {
    const envelope = arrangement === 'stacked' ? PREVIEW_BOOK_STACK_BOUNDS : PREVIEW_BOOK_BOUNDS
    for (const seed of seeds) {
      const books = createPreviewBooks(seed, arrangement, supportSide)
      expect(books.length).toBeGreaterThanOrEqual(2)
      expect(books.length).toBeLessThanOrEqual(arrangement === 'stacked' ? 4 : 7)
      const bounds = books.map(bookBounds)
      expect(Math.min(...bounds.map(box => box.min.y))).toBeCloseTo(0, 9)
      for (const [index, book] of books.entries()) {
        expect([...book.position, ...book.rotation, book.thickness, book.height, book.depth].every(Number.isFinite)).toBe(true)
        expect(book.thickness).toBeGreaterThan(0)
        expect(book.height).toBeGreaterThan(0)
        expect(book.depth).toBeGreaterThan(0)
        expect(bounds[index].min.x).toBeGreaterThanOrEqual(-envelope[0] / 2 - 1e-9)
        expect(bounds[index].max.x).toBeLessThanOrEqual(envelope[0] / 2 + 1e-9)
        expect(bounds[index].min.z).toBeGreaterThanOrEqual(-envelope[2] / 2 - 1e-9)
        expect(bounds[index].max.z).toBeLessThanOrEqual(envelope[2] / 2 + 1e-9)
        expect(bounds[index].min.y).toBeGreaterThanOrEqual(-1e-9)
        expect(bounds[index].max.y).toBeLessThanOrEqual(envelope[1] + 1e-9)
        if (arrangement !== 'stacked') expect(bounds[index].min.y).toBeCloseTo(0, 9)
        for (let other = index + 1; other < books.length; other++) {
          expect(bookBox(book).intersectsOBB(bookBox(books[other]), 1e-10), `${seed}: books ${index} and ${other} overlap`).toBe(false)
        }
      }
    }
  })

  it.each(['left', 'right'] as const)('rests the free end inward against its neighbour with the %s end upright at the wall', supportSide => {
    for (const seed of seeds) {
      const books = createPreviewBooks(seed, 'leaning', supportSide)
      const index = books.findIndex(book => Math.abs(book.rotation[2]) > 0.03)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(books.length - 1)
      const leaning = bookBounds(books[index]), neighbour = bookBounds(books[index + 1])
      expect(books[index].rotation[2] * (supportSide === 'left' ? -1 : 1)).toBeLessThan(0)
      expect(books[index + 1].rotation[2]).toBeCloseTo(0, 9)
      const gap = supportSide === 'left' ? leaning.min.x - neighbour.max.x : neighbour.min.x - leaning.max.x
      expect(gap).toBeGreaterThanOrEqual(-1e-9)
      expect(gap).toBeLessThanOrEqual(0.003)
      expect(neighbour.max.y).toBeGreaterThanOrEqual(leaning.max.y - 1e-9)
      const supported = books.at(-1)!, supportedBounds = bookBounds(supported), groupBounds = getPreviewBookBounds(books)
      expect(supported.rotation[2]).toBe(0)
      expect(supportSide === 'left' ? supportedBounds.min.x : supportedBounds.max.x)
        .toBeCloseTo(supportSide === 'left' ? groupBounds.min[0] : groupBounds.max[0], 9)
      for (const book of books) {
        const spine = new Vector3(0, 0, 1).applyEuler(new Euler(...book.rotation))
        expect(spine.toArray()).toEqual([0, 0, 1])
      }
    }
  })

  it('mirrors only standing poses for left support while keeping the same books and default right support', () => {
    for (const arrangement of arrangements) for (const seed of seeds) {
      const right = createPreviewBooks(seed, arrangement, 'right'), left = createPreviewBooks(seed, arrangement, 'left')
      expect(createPreviewBooks(seed, arrangement)).toEqual(right)
      expect(createPreviewBooks(seed, arrangement, 'left')).toEqual(left)
      if (arrangement === 'stacked') expect(left).toEqual(right)
      else for (let index = 0; index < right.length; index++) {
        const a = right[index], b = left[index]
        expect({ ...b, position: a.position, rotation: a.rotation }).toEqual(a)
        expect(b.position).toEqual([-a.position[0], a.position[1], a.position[2]])
        expect(b.rotation[2]).toBeCloseTo(-a.rotation[2], 9)
        expect(b.rotation.slice(0, 2)).toEqual(a.rotation.slice(0, 2))
      }
    }
  })

  it('reports exact transformed cuboid bounds for anchoring and clearance checks', () => {
    expect(getPreviewBookBounds([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0] })
    for (const { arrangement, supportSide } of supportedArrangements) for (const seed of seeds) {
      const books = createPreviewBooks(seed, arrangement, supportSide)
      const expected = books.map(bookBounds).reduce((group, bounds) => group.union(bounds), new Box3())
      const actual = getPreviewBookBounds(books)
      for (let axis = 0; axis < 3; axis++) {
        expect(actual.min[axis]).toBeCloseTo(expected.min.getComponent(axis), 10)
        expect(actual.max[axis]).toBeCloseTo(expected.max.getComponent(axis), 10)
      }
    }
  })

  it('lays stacks cover-up with spines towards the opening and each layer resting on the previous book', () => {
    for (const seed of seeds) {
      const books = createPreviewBooks(seed, 'stacked')
      const bounds = books.map(bookBounds).sort((a, b) => a.min.y - b.min.y)
      for (const book of books) {
        const rotation = new Quaternion().setFromEuler(new Euler(...book.rotation))
        const coverNormal = new Vector3(1, 0, 0).applyQuaternion(rotation)
        const spineNormal = new Vector3(0, 0, 1).applyQuaternion(rotation)
        expect(coverNormal.y).toBeCloseTo(1, 9)
        expect(spineNormal.z).toBeGreaterThanOrEqual(Math.cos(0.06) - 1e-9)
        expect(Math.abs(spineNormal.y)).toBeLessThan(1e-9)
      }
      for (let index = 1; index < bounds.length; index++) {
        expect(bounds[index].min.y).toBeCloseTo(bounds[index - 1].max.y, 9)
      }
    }
  })
})
