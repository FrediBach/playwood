import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Connection, Panel } from '@/lib/types'
import { getConnectorPlacements } from '@/lib/model'
import { getConnectorGeometry } from './connector-geometry'

const source = 'resources/connectors-3d/Connettori sharing.obj'
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')

function ConnectorJoint({ connection, parent, child, ghost }: {
  connection: Connection; parent: Panel; child: Panel; ghost?: boolean
}) {
  const parts = getConnectorGeometry(connection.type)
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: connection.color,
    roughness: 0.48,
    metalness: 0,
    transparent: !!ghost,
    opacity: ghost ? 0.42 : 1,
    depthWrite: !ghost,
  }), [connection.color, ghost])
  useEffect(() => () => material.dispose(), [material])
  const placements = getConnectorPlacements(connection, parent, child)

  return <group name={`Connector ${connection.type}`}>
    {placements.map((placement, index) => <group key={index}
      name={`Playwood ${connection.type}`} userData={{ connectorType: connection.type, source }}
      position={[placement.position[0] * 0.001, placement.position[1] * 0.001, placement.position[2] * 0.001]} rotation={placement.rotation}>
      {parts.map(part => <mesh key={part.name} name={part.name} geometry={part.geometry} material={material}
        castShadow={!ghost} receiveShadow={!ghost} dispose={null} />)}
    </group>)}
  </group>
}

export function ConnectorMeshes({ panels, connections, ghost }: {
  panels: Panel[]; connections: Connection[]; ghost?: boolean
}) {
  const byId = new Map(panels.map(panel => [panel.id, panel]))
  return <>{connections.filter(connection => connection.count > 0).map(connection => {
    const parent = byId.get(connection.parentId)
    const child = byId.get(connection.childId)
    const branches = connections.filter(branch => jointId(branch) === jointId(connection))
    // T and cross hardware is a single assembly shared by all its branches.
    if (!parent?.visible || !child?.visible || branches.some(branch => !byId.get(branch.childId)?.visible)) return null
    const horizontalSeam = connection.side !== 'left' && connection.side !== 'right'
    const seamLength = (panel: Panel) => horizontalSeam ? panel.width : panel.height
    const shortestBranch = branches.reduce((shortest, branch) => {
      const panel = byId.get(branch.childId)!
      return seamLength(panel) < seamLength(shortest) ? panel : shortest
    }, child)
    return <ConnectorJoint key={connection.id} connection={connection} parent={parent} child={shortestBranch} ghost={ghost} />
  })}</>
}
