import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { OBB } from 'three/examples/jsm/math/OBB.js'
import { CONNECTOR_LOCAL_BOUNDS } from './connector-bounds'
import { connectorSlide, getConnectorRail } from './connector-movement'
import { getPhysicalConnectors } from './connector-selection'
import { resolvePanels } from './model'
import type { Project } from './types'

/** Check installed CAD envelopes independently of the placement solver.
 * Hidden panels still carry hardware, and removed pieces carry none. */
export function installedHardware(project: Project) {
  const panels = resolvePanels(project).map(panel => ({ ...panel, visible: true }))
  return getPhysicalConnectors(project).map(piece => {
    const rail = getConnectorRail(piece.connection, panels, project.connections)!
    const placement = rail.placements[piece.index]
    const origin = new Vector3(...placement.position).addScaledVector(new Vector3(...rail.tangent),
      connectorSlide(rail, piece.index, project.connectorOverrides?.[piece.id]?.slide))
    const orientation = new Quaternion().setFromEuler(new Euler(...placement.rotation))
    const boxes = CONNECTOR_LOCAL_BOUNDS[piece.type].map(part => {
      const min = new Vector3(...part.min), max = new Vector3(...part.max)
      return new OBB(min.clone().add(max).multiplyScalar(.5).applyQuaternion(orientation).add(origin),
        max.sub(min).multiplyScalar(.5).subScalar(.05), new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(orientation)))
    })
    return { id: piece.id, type: piece.type, origin, orientation, boxes }
  })
}

export function overlappingHardware(project: Project) {
  const pieces = installedHardware(project)
  return pieces.flatMap((a, index) => pieces.slice(index + 1)
    .filter(b => a.boxes.some(first => b.boxes.some(second => first.intersectsOBB(second, 1e-8))))
    .map(b => [a.id, b.id]))
}
