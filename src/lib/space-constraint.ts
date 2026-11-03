import { getDesignConstraintBounds } from './design-constraints'
import type { Panel, SpaceConstraint, Vec3 } from './types'

export function spaceBounds(space: SpaceConstraint): { min: Vec3; max: Vec3 } {
  return { min: [space.centerX - space.width / 2, 0, space.centerZ - space.depth / 2],
    max: [space.centerX + space.width / 2, space.height, space.centerZ + space.depth / 2] }
}

/** Conservative rectangular stock bounds, including hidden and rotated panels. */
export function spaceClearances(space: SpaceConstraint, panels: readonly Panel[]) {
  const bounds = spaceBounds(space)
  return panels.map(panel => {
    const stock = getDesignConstraintBounds(panel)
    const clearances = bounds.min.flatMap((min, axis) => [stock.min[axis] - min, bounds.max[axis] - stock.max[axis]])
    return { panel, clearances, clearance: Math.min(...clearances) }
  })
}

export function parseSpaceConstraint(value: unknown): SpaceConstraint {
  if (!value || typeof value !== 'object') throw new Error('Invalid build space.')
  const raw = value as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') throw new Error('Invalid build space enabled flag.')
  const number = (key: string, min: number, max: number) => {
    const n = raw[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid build space ${key}.`)
    return n
  }
  return { enabled: raw.enabled, width: number('width', 1, 100000), height: number('height', 1, 100000), depth: number('depth', 1, 100000), centerX: number('centerX', -100000, 100000), centerZ: number('centerZ', -100000, 100000) }
}
