import { Euler, Matrix4, Quaternion, Vector3, Vector4, type Camera } from 'three'
import type { Vec3 } from './types'

export interface PanelMovementDirectionOptions {
  camera: Camera
  key: string
  shiftKey?: boolean
  /** Resolved panel center, in project millimeters. */
  position: Vec3
  /** Resolved panel rotation. Its local axes are used unless axes are supplied. */
  rotation?: Vec3
  /** Optional world-space structural directions; their length is ignored. */
  axes?: readonly Vec3[]
  viewport: { width: number; height: number }
}

interface ProjectedAxis {
  direction: Vector3
  x: number
  y: number
  length: number
}

/**
 * Snap an arrow to a visible structural axis using the current camera, including
 * orbit, roll, and perspective at the panel's location. The result is in mm.
 * Horizontal and vertical arrows use different axes where both are available.
 */
export function getPanelMovementDelta({ camera, key, shiftKey = false, position, rotation = [0, 0, 0], axes,
  viewport }: PanelMovementDirectionOptions): Vec3 | null {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight'
  if (!horizontal && key !== 'ArrowUp' && key !== 'ArrowDown') return null
  if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)
    || ![...position, ...rotation].every(Number.isFinite)) return null

  const orientation = new Quaternion().setFromEuler(new Euler(...rotation))
  const directions = axes
    ? axes.map(axis => new Vector3(...axis))
    : [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map(axis => axis.applyQuaternion(orientation))
  // Read the current world matrix without changing the camera or its cached inverse.
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorld.clone().invert())
  const center = new Vector4(position[0] * 0.001, position[1] * 0.001, position[2] * 0.001, 1).applyMatrix4(projection)
  if (!Number.isFinite(center.w) || center.w <= 1e-9) return null

  const projected: ProjectedAxis[] = []
  for (const direction of directions) {
    if (!direction.toArray().every(Number.isFinite) || direction.lengthSq() < 1e-12) continue
    direction.normalize()
    if (projected.some(axis => Math.abs(axis.direction.dot(direction)) > 1 - 1e-9)) continue
    const delta = new Vector4(direction.x, direction.y, direction.z, 0).applyMatrix4(projection)
    // Differentiate perspective division at the center. Using the same derivative
    // for either sign makes opposite keys exact inverses, even off-center.
    const x = (delta.x * center.w - center.x * delta.w) / (center.w * center.w) * viewport.width / 2
    const y = (delta.y * center.w - center.y * delta.w) / (center.w * center.w) * viewport.height / 2
    const length = Math.hypot(x, y)
    if (Number.isFinite(length) && length > 1e-9) projected.push({ direction, x, y, length })
  }
  const maxLength = Math.max(0, ...projected.map(axis => axis.length))
  // A nearly end-on axis should not beat a clearly visible axis merely because
  // its tiny projection happens to point exactly along the requested arrow.
  const visible = projected.filter(axis => axis.length >= maxLength * 0.05)
  const eligible = (axis: ProjectedAxis, isHorizontal: boolean) => {
    const primary = Math.abs(isHorizontal ? axis.x : axis.y)
    const secondary = Math.abs(isHorizontal ? axis.y : axis.x)
    return primary > maxLength * 0.05 && primary >= secondary - maxLength * 1e-9
  }
  const candidates = (isHorizontal: boolean) => {
    const closest = visible.filter(axis => eligible(axis, isHorizontal))
    // Off-center perspective can tilt both diagonal axes just past 45 degrees.
    // Keep the requested direction available without accepting a nearly
    // perpendicular axis (for example, moving right along a vertical-only rail).
    return closest.length ? closest : visible.filter(axis =>
      Math.abs(isHorizontal ? axis.x : axis.y) >= axis.length * 0.5)
  }
  const horizontalCandidates = candidates(true)
  const verticalCandidates = candidates(false)
  const score = (axis: ProjectedAxis, isHorizontal: boolean) => (isHorizontal ? axis.x ** 2 : axis.y ** 2) / axis.length
  let horizontalAxis: ProjectedAxis | undefined
  let verticalAxis: ProjectedAxis | undefined
  let bestPair = -Infinity
  for (const h of horizontalCandidates) {
    for (const v of verticalCandidates) {
      if (h === v) continue
      const value = score(h, true) + score(v, false)
      if (value > bestPair + maxLength * 1e-9) {
        bestPair = value
        horizontalAxis = h
        verticalAxis = v
      }
    }
  }
  let chosen = horizontal ? horizontalAxis : verticalAxis
  if (!chosen) {
    let best = -Infinity
    for (const axis of horizontal ? horizontalCandidates : verticalCandidates) {
      const value = score(axis, horizontal)
      if (value > best + maxLength * 1e-9) { best = value; chosen = axis }
    }
  }
  if (!chosen) return null
  const sign = (key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 1) * Math.sign(horizontal ? chosen.x : chosen.y)
  return chosen.direction.multiplyScalar(sign * (shiftKey ? 100 : 10)).toArray().map(value => Math.abs(value) < 1e-10 ? 0 : value) as Vec3
}
