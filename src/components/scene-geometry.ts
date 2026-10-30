import { panelCornerRadius } from '@/lib/panel-shape'
import * as THREE from 'three'
import type { Panel } from '@/lib/types'

const MM = 0.001

export function makePanelGeometry(panel: Pick<Panel, 'width' | 'height' | 'thickness' | 'pattern' | 'holeSize' | 'holeSpacing' | 'cornerRadius'>) {
  const w = panel.width * MM, h = panel.height * MM, t = panel.thickness * MM
  const shape = new THREE.Shape()
  const r = panelCornerRadius(panel) * MM
  if (r > 0) {
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
        if (r > 0 && dx * dx + dy * dy >= r * r) continue
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
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / Math.max(w, 0.001), uv.getY(i) / Math.max(h, 0.001))
  return geometry
}

