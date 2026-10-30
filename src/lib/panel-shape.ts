import type { OutlinePoint, Panel } from './types'

/** Clamp at use time so resizing and older project files stay compatible. */
export function panelCornerRadius(panel: Pick<Panel, 'width' | 'height' | 'cornerRadius'>): number {
  return Math.min(Math.max(0, panel.cornerRadius ?? 0), panel.width / 2, panel.height / 2)
}

type OutlinePanel = Pick<Panel, 'width' | 'height' | 'cornerRadius' | 'customOutline'>
const EPSILON = 1e-9
const cross = (a: OutlinePoint, b: OutlinePoint, c: OutlinePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

function onSegment(a: OutlinePoint, b: OutlinePoint, p: OutlinePoint) {
  return Math.abs(cross(a, b, p)) < EPSILON && p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON
    && p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON
}

export function outlineSegmentsIntersect(a: OutlinePoint, b: OutlinePoint, c: OutlinePoint, d: OutlinePoint): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  return ((abC > 0 && abD < 0 || abC < 0 && abD > 0) && (cdA > 0 && cdB < 0 || cdA < 0 && cdB > 0))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)
}

/** Validate persisted data and editor drafts before they reach triangulation. */
export function getOutlineError(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return 'An outline needs at least 3 points.'
  if (value.length > 128) return 'An outline can have up to 128 points.'
  if (!value.every(p => p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) {
    return 'Keep every point inside the panel bounds.'
  }
  const points = value as OutlinePoint[]
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(a.x - points[j].x, a.y - points[j].y) < EPSILON) return 'Points must have different positions.'
      if (j === i + 1 || i === 0 && j === points.length - 1) continue
      if (outlineSegmentsIntersect(a, b, points[j], points[(j + 1) % points.length])) return 'Outline edges cannot cross or overlap.'
    }
    const c = points[(i + 2) % points.length]
    if (Math.abs(cross(a, b, c)) < EPSILON && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) {
      return 'Outline edges cannot cross or overlap.'
    }
  }
  const area = points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length]
    return sum + p.x * next.y - next.x * p.y
  }, 0)
  return Math.abs(area) < EPSILON ? 'The outline needs an enclosed area.' : null
}

export function pointSegmentDistance(point: OutlinePoint, a: OutlinePoint, b: OutlinePoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

export interface OutlineCorner {
  entry: OutlinePoint; exit: OutlinePoint; center: OutlinePoint; radius: number; sweep: 0 | 1;
}

/** Circular fillets in millimetres; shared by the editor preview and 3D mesh. */
export function panelOutlineCorners(panel: OutlinePanel): OutlineCorner[] {
  const normalized = panel.customOutline ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  const points = normalized.map(p => ({ x: p.x * panel.width, y: p.y * panel.height }))
  const radius = panelCornerRadius(panel)
  return points.map((point, i) => {
    const previous = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length]
    const beforeLength = Math.hypot(point.x - previous.x, point.y - previous.y), afterLength = Math.hypot(next.x - point.x, next.y - point.y)
    const sharp = { entry: point, exit: point, center: point, radius: 0, sweep: 0 as const }
    if (!radius || beforeLength < EPSILON || afterLength < EPSILON) return sharp
    const incoming = { x: (point.x - previous.x) / beforeLength, y: (point.y - previous.y) / beforeLength }
    const outgoing = { x: (next.x - point.x) / afterLength, y: (next.y - point.y) / afterLength }
    const turn = Math.atan2(incoming.x * outgoing.y - incoming.y * outgoing.x, incoming.x * outgoing.x + incoming.y * outgoing.y)
    if (Math.abs(turn) < EPSILON || Math.PI - Math.abs(turn) < EPSILON) return sharp
    const tangent = Math.tan(Math.abs(turn) / 2)
    let distance = Math.min(radius * tangent, beforeLength / 2, afterLength / 2)
    if (panel.customOutline) {
      // A fillet stays in a disc around its vertex. Keep those discs clear of
      // nonadjacent edges, so narrow necks and concave notches remain simple.
      for (let j = 0; j < points.length; j++) {
        if (j === i || (j + 1) % points.length === i) continue
        distance = Math.min(distance, pointSegmentDistance(point, points[j], points[(j + 1) % points.length]) * 0.49)
      }
    }
    const actualRadius = distance / tangent, sign = Math.sign(turn)
    const entry = { x: point.x - incoming.x * distance, y: point.y - incoming.y * distance }
    const exit = { x: point.x + outgoing.x * distance, y: point.y + outgoing.y * distance }
    return { entry, exit, radius: actualRadius, sweep: (turn > 0 ? 1 : 0) as 0 | 1,
      center: { x: entry.x - incoming.y * sign * actualRadius, y: entry.y + incoming.x * sign * actualRadius } }
  })
}

export function panelOutlineSvgPath(panel: OutlinePanel): string {
  const corners = panelOutlineCorners(panel)
  if (!corners.length) return ''
  const number = (value: number) => Number(value.toFixed(6))
  const position = (point: OutlinePoint) => `${number(point.x)} ${number(point.y)}`
  return `M ${position(corners[0].entry)} ${corners.map(corner => `L ${position(corner.entry)}${corner.radius > EPSILON
    ? ` A ${number(corner.radius)} ${number(corner.radius)} 0 0 ${corner.sweep} ${position(corner.exit)}` : ''}`).join(' ')} Z`
}
