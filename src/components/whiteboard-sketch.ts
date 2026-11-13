import { CanvasTexture, Euler, SRGBColorSpace, Vector3 } from 'three'
import type { Panel } from '@/lib/types'
import { orderPreviewFaces, type PreviewFace } from '@/lib/preview-face-order'
import { seededRandom } from '@/lib/preview-furnishing-variation'

const WIDTH = 1160, HEIGHT = 860
const PAPER = '#f6f6f2'
const view = new Vector3(1, 0.7, 1.4).normalize()
const right = new Vector3(view.z, 0, -view.x).normalize()
const up = new Vector3().crossVectors(view, right)
type Point = [number, number]
export interface SketchFace { points: Point[]; edges: boolean[] }

/** Resolved millimetre panels become a fitted, simple stock drawing. Hardware,
 * holes, inserts and finishes are deliberately omitted from this quick sketch. */
export function whiteboardSketch(panels: readonly Panel[]): SketchFace[] {
  const faces: PreviewFace[] = []
  for (const panel of panels) {
    if (!panel.visible) continue
    const rotation = new Euler(...panel.rotation)
    const corners = Array.from({ length: 8 }, (_, i) => new Vector3(
      (i & 1 ? 1 : -1) * panel.width / 2,
      (i & 2 ? 1 : -1) * panel.height / 2,
      (i & 4 ? 1 : -1) * panel.thickness / 2,
    ).applyEuler(rotation).add(new Vector3(...panel.position)))
    const sides = [
      { indices: [0, 4, 6, 2], normal: new Vector3(-1, 0, 0) },
      { indices: [1, 3, 7, 5], normal: new Vector3(1, 0, 0) },
      { indices: [0, 1, 5, 4], normal: new Vector3(0, -1, 0) },
      { indices: [2, 6, 7, 3], normal: new Vector3(0, 1, 0) },
      { indices: [0, 2, 3, 1], normal: new Vector3(0, 0, -1) },
      { indices: [4, 5, 7, 6], normal: new Vector3(0, 0, 1) },
    ]
    for (const side of sides) {
      const normal = side.normal.applyEuler(rotation)
      if (normal.dot(view) <= 0.00001) continue
      faces.push({ points: side.indices.map(i => corners[i]), normal, color: PAPER, edges: [true, true, true, true] })
    }
  }
  if (!faces.length) return []
  const projected = orderPreviewFaces(faces, view).map(face => ({
    points: face.points.map(point => [point.dot(right), -point.dot(up)] as Point), edges: face.edges,
  }))
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const face of projected) for (const [x, y] of face.points) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const scale = Math.min(850 / Math.max(1, maxX - minX), 610 / Math.max(1, maxY - minY))
  return projected.map(face => ({ ...face, points: face.points.map(([x, y]) => [
    530 + (x - (minX + maxX) / 2) * scale,
    415 + (y - (minY + maxY) / 2) * scale,
  ]) }))
}

/** A CPU canvas keeps the marker work to one mesh and also embeds in GLB. */
export function whiteboardTexture(panels: readonly Panel[]) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH; canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, WIDTH, HEIGHT)
  const random = seededRandom('whiteboard-marker')
  const jitter = (amount: number) => (random() - 0.5) * amount
  const stroke = (a: Point, b: Point, retrace = false) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    if (length < 1) return
    const wobble = Math.min(12, length * 0.06)
    const offset = retrace ? 3 : 0
    ctx.strokeStyle = retrace ? 'rgba(43, 73, 111, 0.22)' : `rgba(43, 73, 111, ${0.7 + random() * 0.2})`
    ctx.lineWidth = retrace ? 1.8 : 3.2 + random() * 1.2
    ctx.beginPath()
    ctx.moveTo(a[0] + jitter(4) + offset, a[1] + jitter(4) + offset)
    ctx.bezierCurveTo(
      a[0] + dx * 0.32 + jitter(wobble), a[1] + dy * 0.32 + jitter(wobble),
      a[0] + dx * 0.68 + jitter(wobble), a[1] + dy * 0.68 + jitter(wobble),
      b[0] + jitter(5) + offset, b[1] + jitter(5) + offset,
    )
    ctx.stroke()
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  for (const face of whiteboardSketch(panels)) {
    // Opaque faces hide rear lines; BSP split boundaries never get ink.
    ctx.beginPath()
    face.points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.closePath(); ctx.fill()
    face.points.forEach((point, index) => {
      if (!face.edges[index]) return
      const previous = face.points[(index + face.points.length - 1) % face.points.length]
      stroke(previous, point)
      if (random() < 0.3) {
        const start: Point = [previous[0] * 0.7 + point[0] * 0.3, previous[1] * 0.7 + point[1] * 0.3]
        stroke(start, point, true)
      }
    })
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.name = 'Furniture marker sketch'
  return texture
}
