import { Euler, Vector3 } from 'three'
import { SIDES } from './connector-options'
import type { Panel, Side, Vec3 } from './types'

export interface AttachmentSideAnchor {
  side: Side
  label: string
  badge: string
  /** Local and world positions in millimeters. */
  localPosition: Vec3
  position: Vec3
  direction: Vec3
}

/** Names belong to the panel, so rotating the view never changes their meaning. */
export function attachmentSideAnchors(panel: Panel): AttachmentSideAnchor[] {
  const rotation = new Euler(...panel.rotation)
  const directions: Record<Side, Vec3> = {
    left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1],
  }
  return SIDES.map((side, index) => {
    const axis = directions[side]
    const localPosition = [axis[0] * panel.width / 2, axis[1] * panel.height / 2, axis[2] * panel.thickness / 2] as Vec3
    return { side, label: side[0].toUpperCase() + side.slice(1), badge: String.fromCharCode(65 + index), localPosition,
      position: new Vector3(...localPosition).applyEuler(rotation).add(new Vector3(...panel.position)).toArray() as Vec3,
      direction: new Vector3(...axis).applyEuler(rotation).toArray() as Vec3 }
  })
}

export interface SideLabelPoint { side: Side; x: number; y: number; dx: number; dy: number }
export const SIDE_LABEL_WIDTH = 104
export const SIDE_LABEL_HEIGHT = 34
const GAP = 8

/** Keep all six choices reachable even when opposite faces project to one point. */
export function layoutAttachmentSideLabels(points: SideLabelPoint[], width: number, height: number) {
  const placed: { side: Side; x: number; y: number }[] = []
  const halfWidth = SIDE_LABEL_WIDTH / 2, halfHeight = SIDE_LABEL_HEIGHT / 2
  const clamp = (value: number, extent: number, half: number) => Math.max(half + GAP, Math.min(extent - half - GAP, value))
  for (const point of points) {
    let dx = point.dx, dy = point.dy
    const length = Math.hypot(dx, dy)
    if (length > 0.01) { dx /= length; dy /= length }
    else { dx = 0; dy = point.side === 'back' || point.side === 'bottom' ? 1 : -1 }
    const desired = { x: point.x + dx * (halfWidth + 26), y: point.y + dy * (halfHeight + 26) }
    const candidates = [desired]
    for (let ring = 1; ring <= 6; ring++) {
      for (const [x, y] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        candidates.push({ x: desired.x + x * ring * (SIDE_LABEL_WIDTH + GAP), y: desired.y + y * ring * (SIDE_LABEL_HEIGHT + GAP) })
      }
    }
    const bounded = candidates.map(candidate => ({ x: clamp(candidate.x, width, halfWidth), y: clamp(candidate.y, height, halfHeight) }))
      .sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y))
    const position = bounded.find(candidate => placed.every(other => Math.abs(candidate.x - other.x) >= SIDE_LABEL_WIDTH + GAP
      || Math.abs(candidate.y - other.y) >= SIDE_LABEL_HEIGHT + GAP)) ?? bounded[0]
    placed.push({ side: point.side, ...position })
  }
  return placed
}
