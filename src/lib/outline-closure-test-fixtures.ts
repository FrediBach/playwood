import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { CONNECTOR_PROFILES } from './connector-profile'
import { createPanel, resolvePanels } from './model'
import type { Connection, ConnectorType, Project, Vec3 } from './types'

/** A five-sided frame with the real 90°, 105°, and 150° connector seats. */
export function pentagonalFrame(): Project {
  const vertices = [[-250, 100], [250, 100], [250 + Math.tan(Math.PI / 12) * 300, 400], [250, 700], [-250, 700]]
    .map(([x, y]) => new Vector3(x, y, 0))
  const corners: ConnectorType[] = ['90', '105', '150', '105', '90']
  const names = ['Bottom', 'Lower slope', 'Upper slope', 'Top', 'Left']
  const panels = vertices.map((vertex, i) => {
    const end = vertices[(i + 1) % vertices.length]
    const direction = end.clone().sub(vertex).normalize()
    const startSeat = CONNECTOR_PROFILES[corners[i]].seat
    const endSeat = CONNECTOR_PROFILES[corners[(i + 1) % corners.length]].seat
    const start = vertex.clone().addScaledVector(direction, startSeat)
    const finish = end.clone().addScaledVector(direction, -endSeat)
    const depth = new Vector3(0, 0, 1)
    const euler = new Euler().setFromRotationMatrix(new Matrix4().makeBasis(direction, depth, direction.clone().cross(depth)))
    return createPanel({ id: `rim-${i}`, name: names[i], width: start.distanceTo(finish), height: 300,
      position: start.add(finish).multiplyScalar(0.5).toArray() as Vec3, rotation: [euler.x, euler.y, euler.z] })
  })
  const connections: Connection[] = []
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  for (let i = 0; i < panels.length; i++) {
    const parent = panels[(i + panels.length - 1) % panels.length], child = panels[i]
    let match: Connection | undefined
    for (const side of ['left', 'right'] as const) for (const flip of [false, true]) {
      const connection: Connection = { id: `rim-joint-${i}:0`, parentId: parent.id, childId: child.id,
        type: corners[i], side, flip, offset: 0, inset: 0, count: 2, color: '#252522', role: 'support' }
      const expected = resolvePanels({ version: 1, name: '', panels: [parent, child], connections: [{ ...connection, role: undefined }] })[1]
      const expectedRotation = new Quaternion().setFromEuler(new Euler(...expected.rotation))
      const actualRotation = new Quaternion().setFromEuler(new Euler(...child.rotation))
      if (new Vector3(...expected.position).distanceTo(new Vector3(...child.position)) < 0.001
        && axes.every(axis => Math.abs(axis.clone().applyQuaternion(expectedRotation).dot(axis.clone().applyQuaternion(actualRotation))) > 0.99999)) match = connection
    }
    if (!match) throw new Error(`Could not fit pentagonal frame corner ${i}.`)
    connections.push(match)
  }
  return { version: 1, name: 'Pentagonal frame', panels, connections }
}
