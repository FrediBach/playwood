import { Box3, Euler, Matrix4, Vector3 } from 'three'
import type { Vec3 } from './types'
import { seededRandom } from './preview-furnishing-variation'

export type PreviewBookArrangement = 'upright' | 'leaning' | 'stacked'
export type PreviewBookSupport = 'left' | 'right'
export type PreviewBookDesign = 'band' | 'arch' | 'grid' | 'minimal' | 'split'

/** Local X is the book's thickness, Y its height, and +Z its outward spine. */
export interface PreviewBook {
  position: Vec3
  rotation: Vec3
  thickness: number
  height: number
  depth: number
  color: string
  coverColor: string
  accentColor: string
  design: PreviewBookDesign
  stripeCount: number
}

/** Fixed envelopes shared with the placement detector, in metres (W × H × D). */
export const PREVIEW_BOOK_BOUNDS: Vec3 = [0.25, 0.28, 0.23]
export const PREVIEW_BOOK_STACK_BOUNDS: Vec3 = [0.25, 0.13, 0.23]

const palette = [
  ['#6e7b62', '#d7d9bf', '#e8dec5'],
  ['#b37054', '#e7bea0', '#f0dec3'],
  ['#4c6373', '#b7c4c5', '#dedecb'],
  ['#bfab83', '#e6dbc1', '#716d54'],
  ['#6f5052', '#d1a495', '#ead5b8'],
  ['#d4c9b0', '#829080', '#646e60'],
  ['#474e48', '#9caa8b', '#e4dcc5'],
  ['#ac8b48', '#e8d9ae', '#515f55'],
  ['#738d87', '#c4d1b8', '#ebdfbf'],
  ['#777287', '#c6bacc', '#e7dac3'],
  ['#c1bfb0', '#657c81', '#f0e7cd'],
  ['#93654e', '#d4b68b', '#ead9b9'],
] as const
const designs: PreviewBookDesign[] = ['band', 'arch', 'grid', 'minimal', 'split']

/** Seeded variation keeps a shelf stable through selection, camera moves and edits. */
export function createPreviewBooks(seed: string, arrangement?: PreviewBookArrangement, supportSide: PreviewBookSupport = 'right'): PreviewBook[] {
  const random = seededRandom(seed)
  const style = arrangement ?? (['upright', 'leaning', 'stacked'] as const)[Math.floor(random() * 3)]
  const stacked = style === 'stacked'
  const count = stacked ? 2 + Math.floor(random() * 3) : 2 + Math.floor(random() * 6)
  let previousColor = -1
  const books: PreviewBook[] = Array.from({ length: count }, () => {
    let colorIndex = Math.floor(random() * palette.length)
    if (colorIndex === previousColor) colorIndex = (colorIndex + 1) % palette.length
    previousColor = colorIndex
    const [color, coverColor, accentColor] = palette[colorIndex]
    return {
      position: [0, 0, 0], rotation: [0, 0, 0],
      thickness: (stacked ? 0.016 : 0.015) + random() * (stacked ? 0.014 : 0.021),
      height: (stacked ? 0.19 : 0.18) + random() * (stacked ? 0.035 : 0.085),
      depth: (stacked ? 0.16 : 0.163) + random() * (stacked ? 0.025 : 0.043),
      color, coverColor, accentColor,
      design: designs[Math.floor(random() * designs.length)],
      stripeCount: 1 + Math.floor(random() * 3),
    }
  })

  if (stacked) {
    // Rotate the broad front cover upward; the spines continue facing the opening.
    // The very small offsets resemble a hand-placed pile without precarious overhangs.
    let base = 0
    for (const book of books) {
      book.position = [(random() - 0.5) * 0.008, base + book.thickness / 2, (random() - 0.5) * 0.008]
      book.rotation = [0, (random() - 0.5) * 0.12, Math.PI / 2]
      base += book.thickness
    }
    return books
  }

  if (style === 'leaning') {
    const first = books[0], neighbor = books[1]
    first.rotation[2] = -(0.08 + random() * 0.08)
    // The leaning book meets a taller neighbour near its top, instead of floating.
    first.height = Math.min(first.height, neighbor.height - 0.012)
  }
  const gap = 0.001
  const lean = Math.abs(books[0].rotation[2])
  const leanWidth = books[0].height * Math.sin(lean)
  const thicknessWidth = books.reduce((sum, book) => sum + book.thickness * Math.cos(book.rotation[2]), 0)
  const scale = Math.min(1, (0.238 - leanWidth - (count - 1) * gap) / thicknessWidth)
  books.forEach(book => { book.thickness *= scale })
  const widths = books.map(book => book.thickness * Math.cos(book.rotation[2]) + book.height * Math.abs(Math.sin(book.rotation[2])))
  let left = -(widths.reduce((sum, width) => sum + width, 0) + (count - 1) * gap) / 2
  books.forEach((book, i) => {
    const angle = Math.abs(book.rotation[2])
    book.position = [left + widths[i] / 2, (book.height * Math.cos(angle) + book.thickness * Math.sin(angle)) / 2, 0.105 - book.depth / 2]
    left += widths[i] + gap
  })
  if (supportSide === 'left') books.forEach(book => {
    // Mirror the pose, keeping cover artwork and spine normals unmirrored.
    // The upright end meets the sidewall; the free end leans back into the row.
    book.position[0] *= -1
    if (book.rotation[2] !== 0) book.rotation[2] *= -1
  })
  return books
}

/** Exact row extents let the detector anchor its upright end against a sidewall. */
export function getPreviewBookBounds(books: PreviewBook[]): { min: Vec3; max: Vec3 } {
  if (!books.length) return { min: [0, 0, 0], max: [0, 0, 0] }
  const bounds = new Box3()
  for (const book of books) {
    const transform = new Matrix4().makeRotationFromEuler(new Euler(...book.rotation))
    transform.setPosition(...book.position)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      bounds.expandByPoint(new Vector3(x * book.thickness / 2, y * book.height / 2, z * book.depth / 2).applyMatrix4(transform))
    }
  }
  return { min: bounds.min.toArray() as Vec3, max: bounds.max.toArray() as Vec3 }
}
