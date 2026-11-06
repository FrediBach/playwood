import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { orderPreviewFaces, type PreviewFace } from './preview-face-order'

const face = (color: string, points: number[][]): PreviewFace => {
  const vertices = points.map(point => new Vector3(...point))
  return { color, points: vertices, edges: points.map(() => true), normal: vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize() }
}
const visibleColor = (faces: PreviewFace[], x: number, y: number) => {
  let color = ''
  for (const polygon of faces) {
    const signs = polygon.points.map((a, index) => {
      const b = polygon.points[(index + 1) % polygon.points.length]
      return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    })
    if (signs.every(value => value >= 0) || signs.every(value => value <= 0)) color = polygon.color
  }
  return color
}

describe('preview face depth ordering', () => {
  it('correctly occludes both halves of crossing faces, regardless of input order', () => {
    const level = face('level', [[-2,-2,0], [2,-2,0], [2,2,0], [-2,2,0]])
    const sloped = face('sloped', [[-2,-2,-2], [2,-2,2], [2,2,2], [-2,2,-2]])
    for (const faces of [[level, sloped], [sloped, level]]) {
      const sorted = orderPreviewFaces(faces, new Vector3(0, 0, 1))
      expect(visibleColor(sorted, -1, .5)).toBe('level')
      expect(visibleColor(sorted, 1, .5)).toBe('sloped')
      expect(sorted.some(polygon => polygon.edges.includes(false))).toBe(true)
      // A generated edge must lie on the intersection, not an outside boundary.
      for (const polygon of sorted) polygon.edges.forEach((edge, index) => {
        if (edge) return
        expect(polygon.points[index].x).toBeCloseTo(0)
        expect(polygon.points[(index + polygon.points.length - 1) % polygon.points.length].x).toBeCloseTo(0)
      })
      const reversed = orderPreviewFaces(faces, new Vector3(0, 0, -1))
      expect(visibleColor(reversed, -1, .5)).toBe('sloped')
      expect(visibleColor(reversed, 1, .5)).toBe('level')
    }
  })
  it('keeps coplanar faces finite and leaves the source geometry intact', () => {
    const a = face('a', [[0,0,0], [2,0,0], [2,2,0], [0,2,0]])
    const b = face('b', [[1,0,0], [3,0,0], [3,2,0], [1,2,0]])
    const before = JSON.stringify([a, b])
    expect(orderPreviewFaces([a, b], new Vector3(0,0,1))).toHaveLength(2)
    expect(JSON.stringify([a, b])).toBe(before)
  })
})
