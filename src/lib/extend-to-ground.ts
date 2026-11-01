import { Euler, Quaternion, Vector3 } from 'three'
import { getProjectBounds, resolvePanels, validateProject } from './model'
import { resizePanelEdge } from './structure-edit'
import type { Project } from './types'

const TOLERANCE = 1e-5

export interface GroundExtension {
  project: Project
  panelId: string
  dimension: 'width' | 'height'
  from: number
  to: number
  distance: number
  groundY: number
}

/** Grow only the downward edge to the physical floor, keeping other panels and
 * hardware fixed. The studio's adaptive shadow/grid offset is not a cut size.
 */
export function extendPanelToGround(project: Project, panelId: string, groundY = 0): GroundExtension {
  if (!Number.isFinite(groundY)) throw new Error('Ground level must be a finite height.')
  const panel = resolvePanels(project).find(panel => panel.id === panelId)
  if (!panel || !panel.visible) throw new Error('Select a visible panel to extend to the ground.')
  if (panel.customOutline) throw new Error('Extend to ground is available for rectangular panels. Edit this panel’s outline instead.')
  const rotation = new Quaternion().setFromEuler(new Euler(...panel.rotation))
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0)].map(axis => axis.applyQuaternion(rotation))
  const index = axes.findIndex(axis => Math.abs(axis.y) > 1 - 1e-7)
  if (index < 0) throw new Error('Extend to ground needs a panel with a vertical width or height edge.')
  const dimension = index === 0 ? 'width' : 'height'
  const side = axes[index].y > 0 ? -1 : 1
  const bottom = getProjectBounds([panel]).min[1]
  const distance = (bottom - groundY) / Math.abs(axes[index].y)
  if (distance <= TOLERANCE) throw new Error(bottom < groundY - TOLERANCE
    ? 'This panel already extends below ground level.' : 'This panel already reaches the ground.')
  if (panel[dimension] + distance > 4000) throw new Error('Reaching the ground would exceed the maximum panel size of 4,000 mm.')
  const next = resizePanelEdge(project, panelId, dimension, side, distance, true)
  const previousCollisions = new Set(validateProject(project).filter(issue => issue.id.startsWith('collision-')).map(issue => issue.id))
  const collision = validateProject(next).find(issue => issue.id.startsWith('collision-') && issue.panelIds.includes(panelId) && !previousCollisions.has(issue.id))
  if (collision) throw new Error(`Cannot extend to ground: ${collision.message}`)
  const fitted = resolvePanels(next).find(panel => panel.id === panelId)!
  if (Math.abs(getProjectBounds([fitted]).min[1] - groundY) > TOLERANCE) throw new Error('This panel cannot reach the ground while keeping its existing joints in place.')
  return { project: next, panelId, dimension, from: panel[dimension], to: fitted[dimension], distance, groundY }
}

export function getPanelGroundExtension(project: Project, panelId: string, groundY = 0): { result?: GroundExtension; reason: string } {
  try { return { result: extendPanelToGround(project, panelId, groundY), reason: '' } }
  catch (error) { return { reason: error instanceof Error ? error.message : 'This panel cannot be extended to the ground.' } }
}
