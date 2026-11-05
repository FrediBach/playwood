import { Euler, Matrix4, Vector3 } from 'three'
import { closeWithRectangles } from './rectangular-closures'
import { autoConnect } from './auto-connect'
import { closePanelHole, findPanelHoles } from './close-holes'
import { CONNECTOR_PROFILES } from './connector-profile'
import { getPhysicalConnectors } from './connector-selection'
import { overlappingConnectorIds } from './connector-clearance'
import { createPanel, resolvePanels, validateProject } from './model'
import { OBJECT_PRISM_EDGE_LIMIT, type ObjectPrism } from './object-prism'
import type { Project, Vec3 } from './types'

/** Build one orthogonal prism at its world coordinates. Never return an incomplete shell. */
export function solveObjectPrism(prism: ObjectPrism, thickness: number, rectangularOnly = false): Project {
  if (!Number.isFinite(thickness) || thickness < 16 || thickness > 19) throw new Error('90° connectors require a panel thickness from 16 to 19 mm.')
  const seat = CONNECTOR_PROFILES['90'].seat, u = (prism.axis + 1) % 3, v = (prism.axis + 2) % 3
  const outline = prism.outline
  if (outline.length < 6 || outline.length > OBJECT_PRISM_EDGE_LIMIT || outline.length % 2) throw new Error('Prism profiles support 6–12 boundary edges.')
  const directions = outline.map((p, i) => {
    const next = outline[(i + 1) % outline.length], dx = next[0] - p[0], dy = next[1] - p[1]
    if (((dx === 0) === (dy === 0)) || !Number.isFinite(dx + dy)) throw new Error('The prism boundary must have nonzero orthogonal edges.')
    return [Math.sign(dx), Math.sign(dy)]
  })
  const points = outline.map((p, i) => {
    const previous = directions[(i + directions.length - 1) % directions.length], next = directions[i]
    const coordinates = [0, 0, 0]
    coordinates[u] = p[0] - (previous[1] + next[1]) * thickness / 2
    coordinates[v] = p[1] + (previous[0] + next[0]) * thickness / 2
    coordinates[prism.axis] = (prism.min + prism.max) / 2
    return new Vector3(...coordinates)
  })
  const depth = new Vector3().setComponent(prism.axis, 1), height = prism.max - prism.min - thickness - seat * 2
  const panels = points.map((start, i) => {
    const end = points[(i + 1) % points.length], tangent = end.clone().sub(start), width = tangent.length() - seat * 2
    if (!Number.isFinite(width + height) || width < 40 || width > 4000 || height < 40 || height > 4000 || tangent.getComponent(u) * directions[i][0] + tangent.getComponent(v) * directions[i][1] <= 0) throw new Error('The profile leaves insufficient panel cuts after connector clearances.')
    tangent.normalize()
    const rotation = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(tangent, depth, tangent.clone().cross(depth)))
    return createPanel({ name: `Rim ${i + 1}`, width, height, thickness, position: start.clone().add(end).multiplyScalar(.5).toArray(), rotation: [rotation.x, rotation.y, rotation.z] as Vec3 })
  })
  let project = autoConnect({ version: 1, name: 'Solved orthogonal prism', panels, connections: [] }).project
  const required: [string, string][] = panels.map((panel, i) => [panel.id, panels[(i + 1) % panels.length].id])
  if (rectangularOnly) {
    const holes = findPanelHoles(resolvePanels(project)).filter(hole => hole.panel.customOutline && hole.boundaryIds.length === panels.length)
    if (holes.length !== 2) throw new Error('Cannot identify both closing faces for rectangular panels.')
    let solved: Project | undefined, failure: unknown
    for (const horizontal of [false, true]) {
      try {
        let candidate = project
        for (const hole of holes) candidate = closeWithRectangles(candidate, hole, horizontal)
        solved = candidate; break
      } catch (error) { failure = error }
    }
    if (!solved) throw new Error(`Cannot build rectangular closing faces: ${failure instanceof Error ? failure.message : 'No supported wall attachments.'}`)
    project = solved
  } else {
    for (let face = 0; face < 2; face++) {
      const hole = findPanelHoles(resolvePanels(project))[0]
      if (!hole) throw new Error('Cannot fit both closing faces of this profile.')
      const closed = closePanelHole(project, panels.map(panel => panel.id), hole.id)
      required.push(...panels.map(panel => [panel.id, closed.panelId] as [string, string]))
      project = closed.project
    }
  }
  const hardware = getPhysicalConnectors(project)
  for (const [a, b] of required) if (!hardware.some(({ connection: c }) => c.type === '90' && (c.parentId === a && c.childId === b || c.parentId === b && c.childId === a))) throw new Error('Cannot fit every required profile joint.')
  if (!rectangularOnly && (project.panels.length !== outline.length + 2 || project.connections.length !== outline.length * 3)) throw new Error('The profile shell is incomplete.')
  const issue = validateProject(project)[0]
  if (issue) throw new Error(issue.message)
  if (overlappingConnectorIds(project).size) throw new Error('The profile hardware does not have enough clearance.')
  return project
}
