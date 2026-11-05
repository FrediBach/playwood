import { autoConnect } from './auto-connect'
import { overlappingConnectorIds } from './connector-clearance'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getPhysicalConnectors } from './connector-selection'
import { createPanel, getProjectBounds, resolvePanels, validateProject } from './model'
import type { Panel, Project, Vec3 } from './types'

export interface CuboidSolverInput {
  /** Finished panel envelope in millimeters, centered on X/Z and resting on the floor. */
  width: number;
  height: number;
  depth: number;
  thickness: number;
}

/** Geometry proof for the object solver. Produces an independent candidate, never a partial build. */
export function solveCuboid(input: CuboidSolverInput): Project {
  const { width, height, depth, thickness } = input
  if (!Number.isFinite(thickness) || thickness < 16 || thickness > 19) {
    throw new Error('90° connectors require a panel thickness from 16 to 19 mm.')
  }
  // Each cut ends one seat before the perpendicular panel centerline at both ends.
  const allowance = thickness + 2 * CONNECTOR_PROFILES['90'].seat
  const cuts = [width, height, depth].map(length => length - allowance)
  if (cuts.some(length => !Number.isFinite(length) || length < 40 || length > 4000)) {
    throw new Error('Outside dimensions must leave panel cuts between 40 and 4000 mm after connector clearances.')
  }
  const [w, h, d] = cuts
  const panel = (name: string, width: number, height: number, position: Vec3, rotation: Vec3): Panel =>
    createPanel({ name, width, height, thickness, position, rotation })
  const panels = [
    panel('Left', d, h, [-(width - thickness) / 2, height / 2, 0], [0, Math.PI / 2, 0]),
    panel('Right', d, h, [(width - thickness) / 2, height / 2, 0], [0, Math.PI / 2, 0]),
    panel('Bottom', w, d, [0, thickness / 2, 0], [Math.PI / 2, 0, 0]),
    panel('Top', w, d, [0, height - thickness / 2, 0], [Math.PI / 2, 0, 0]),
    panel('Back', w, h, [0, height / 2, -(depth - thickness) / 2], [0, 0, 0]),
    panel('Front', w, h, [0, height / 2, (depth - thickness) / 2], [0, 0, 0]),
  ]
  const candidate = autoConnect({ version: 1, name: 'Solved cuboid', panels, connections: [] }).project
  const hardware = getPhysicalConnectors(candidate)
  // Opposite faces are consecutive pairs. Every other pair requires its own fitted joint.
  for (let a = 0; a < panels.length; a++) for (let b = a + 1; b < panels.length; b++) {
    if (Math.floor(a / 2) === Math.floor(b / 2)) continue
    if (!hardware.some(piece => {
      const joint = piece.connection
      return joint.type === '90' && (
        joint.parentId === panels[a].id && joint.childId === panels[b].id
        || joint.parentId === panels[b].id && joint.childId === panels[a].id)
    })) throw new Error(`Cannot fit the required joint between ${panels[a].name} and ${panels[b].name}.`)
  }
  const issue = validateProject(candidate)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(candidate).size) throw new Error('The cuboid hardware does not have enough clearance.')
  const bounds = getProjectBounds(resolvePanels(candidate))
  if (candidate.panels.length !== 6 || [bounds.width - width, bounds.height - height, bounds.depth - depth, bounds.min[1]].some(error => Math.abs(error) > 1e-5)) {
    throw new Error('The solved construction does not preserve the requested outside dimensions.')
  }
  return candidate
}
