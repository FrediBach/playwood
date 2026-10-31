import { outlineSegmentsIntersect, panelCornerRadius, panelOutlineCorners, pointSegmentDistance } from '@/lib/panel-shape'
import * as THREE from 'three'
import type { OutlinePoint, Panel } from '@/lib/types'

const MM = 0.001

function insideContour(point: OutlinePoint, contour: OutlinePoint[]) {
  let inside = false
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const a = contour[i], b = contour[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A circle or vertical capsule must clear every edge, including concave notches. */
function openingInsideContour(x: number, y: number, radius: number, straight: number, contour: OutlinePoint[]) {
  const top = { x, y: y + straight }, bottom = { x, y: y - straight }
  if (!insideContour(top, contour) || !insideContour(bottom, contour)) return false
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length]
    if (Math.max(a.x, b.x) < x - radius || Math.min(a.x, b.x) > x + radius
      || Math.max(a.y, b.y) < bottom.y - radius || Math.min(a.y, b.y) > top.y + radius) continue
    if (outlineSegmentsIntersect(top, bottom, a, b) || Math.min(pointSegmentDistance(top, a, b), pointSegmentDistance(bottom, a, b),
      pointSegmentDistance(a, top, bottom), pointSegmentDistance(b, top, bottom)) <= radius + 1e-9) return false
  }
  return true
}

export function makePanelGeometry(panel: Pick<Panel, 'width' | 'height' | 'thickness' | 'pattern' | 'holeSize' | 'holeSpacing' | 'cornerRadius' | 'customOutline'>) {
  const w = panel.width * MM, h = panel.height * MM, t = panel.thickness * MM
  const shape = new THREE.Shape()
  const r = panelCornerRadius(panel) * MM
  if (panel.customOutline) {
    const corners = panelOutlineCorners(panel)
    shape.moveTo(corners[0].entry.x * MM - w / 2, h / 2 - corners[0].entry.y * MM)
    for (const corner of corners) {
      shape.lineTo(corner.entry.x * MM - w / 2, h / 2 - corner.entry.y * MM)
      if (corner.radius > 0) {
        shape.absarc(corner.center.x * MM - w / 2, h / 2 - corner.center.y * MM, corner.radius * MM,
          Math.atan2(corner.center.y - corner.entry.y, corner.entry.x - corner.center.x),
          Math.atan2(corner.center.y - corner.exit.y, corner.exit.x - corner.center.x), corner.sweep === 1)
      }
    }
  } else if (r > 0) {
    shape.moveTo(-w / 2 + r, -h / 2)
    shape.lineTo(w / 2 - r, -h / 2)
    shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(w / 2, h / 2 - r)
    shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2, false)
    shape.lineTo(-w / 2 + r, h / 2)
    shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(-w / 2, -h / 2 + r)
    shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5, false)
  } else {
    shape.moveTo(-w / 2, -h / 2); shape.lineTo(w / 2, -h / 2)
    shape.lineTo(w / 2, h / 2); shape.lineTo(-w / 2, h / 2)
  }
  shape.closePath()
  // Match ExtrudeGeometry's tessellation, so openings stay inside the rendered face.
  const contour = panel.customOutline ? shape.getPoints(8) : null
  if (panel.pattern !== 'solid') {
    const radius = Math.max(1, panel.holeSize) * MM / 2
    const spacing = Math.max(panel.holeSpacing, panel.holeSize + 5, 15) * MM
    const slotLength = Math.min(spacing * 0.72, radius * 7)
    const marginX = Math.max(spacing * 0.65, radius * 2)
    const marginY = panel.pattern === 'slots' ? Math.max(spacing * 0.65, slotLength / 2 + radius) : marginX
    const cols = Math.max(0, Math.floor((w - marginX * 2) / spacing) + 1)
    const rows = Math.max(0, Math.floor((h - marginY * 2) / spacing) + 1)
    // Keep a large perforated panel interactive without changing its pitch.
    if (cols * rows <= 5000) {
      for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) {
        const x = (col - (cols - 1) / 2) * spacing, y = (row - (rows - 1) / 2) * spacing
        // Keep the complete opening (including slot ends) inside the rounded outline.
        const extentY = panel.pattern === 'slots' ? Math.max(radius, slotLength / 2) : radius
        const dx = Math.max(0, Math.abs(x) + radius - (w / 2 - r))
        const dy = Math.max(0, Math.abs(y) + extentY - (h / 2 - r))
        if (contour ? !openingInsideContour(x, y, radius, panel.pattern === 'slots' ? Math.max(0, slotLength / 2 - radius) : 0, contour)
          : r > 0 && dx * dx + dy * dy >= r * r) continue
        const hole = new THREE.Path()
        if (panel.pattern === 'pegboard') {
          hole.absarc(x, y, radius, 0, Math.PI * 2, true)
        } else {
          const straight = Math.max(0, slotLength / 2 - radius)
          hole.moveTo(x - radius, y + straight)
          hole.absarc(x, y + straight, radius, Math.PI, 0, true)
          hole.lineTo(x + radius, y - straight)
          hole.absarc(x, y - straight, radius, 0, -Math.PI, true)
          hole.closePath()
        }
        shape.holes.push(hole)
      }
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1, curveSegments: 8 })
  geometry.translate(0, 0, -t / 2)
  // ExtrudeGeometry's face UVs use local metres. Keep that physical scale so
  // repeating grain stays the same size when a board is resized or reshaped.
  return geometry
}

