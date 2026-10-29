import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { connectorId, connectorFinish } from '@/lib/connector-selection'
import type { Connection, Panel, Project } from '@/lib/types'
import { getConnectorPlacements } from '@/lib/model'
import { getConnectorGeometry } from './connector-geometry'

const source = 'resources/connectors-3d/Connettori sharing.obj'
const jointId = (connection: Connection) => connection.id.replace(/:\d+$/, '')

interface SelectionProps {
  selectedConnectorIds?: readonly string[]
  onSelectConnector?: (id: string, additive?: boolean) => void
  connectorOverrides?: Project['connectorOverrides']
}

function ConnectorPiece({ connection, placement, id, ghost, selected, onSelectConnector }: {
  connection: Connection; placement: ReturnType<typeof getConnectorPlacements>[number]; id: string; ghost?: boolean; selected: boolean
} & Pick<SelectionProps, 'onSelectConnector'>) {
  const parts = getConnectorGeometry(connection.type)
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: connection.color, roughness: 0.48, metalness: 0,
    emissive: selected ? '#2788ff' : '#000000', emissiveIntensity: selected ? 0.65 : 0,
    transparent: !!ghost, opacity: ghost ? 0.42 : 1, depthWrite: !ghost,
  }), [connection.color, ghost, selected])
  useEffect(() => () => material.dispose(), [material])
  return <group name={`Playwood ${connection.type}`} userData={{ connectorType: connection.type, connectorId: id, selected, source }}
    position={[placement.position[0] * 0.001, placement.position[1] * 0.001, placement.position[2] * 0.001]} rotation={placement.rotation}
    onClick={ghost || !onSelectConnector ? undefined : event => { event.stopPropagation(); onSelectConnector(id, event.shiftKey || event.metaKey || event.ctrlKey) }}
    onDoubleClick={ghost ? undefined : event => event.stopPropagation()}>
    {parts.map(part => <mesh key={part.name} name={part.name} geometry={part.geometry} material={material}
      castShadow={!ghost} receiveShadow={!ghost} dispose={null} />)}
  </group>
}

function ConnectorJoint({ connection, parent, child, ghost, selectedConnectorIds = [], onSelectConnector, connectorOverrides }: {
  connection: Connection; parent: Panel; child: Panel; ghost?: boolean
} & SelectionProps) {
  return <group name={`Connector ${connection.type}`}>
    {getConnectorPlacements(connection, parent, child).map((placement, index) => {
      const id = connectorId(connection.id, index)
      const finish = connectorFinish(connection, index, connectorOverrides)
      return finish?.removed ? null : <ConnectorPiece key={id} id={id} connection={{ ...connection, ...finish }} placement={placement}
        ghost={ghost} selected={!ghost && selectedConnectorIds.includes(id)} onSelectConnector={onSelectConnector}/>
    })}
  </group>
}

export function ConnectorMeshes({ panels, connections, ghost, ...selection }: {
  panels: Panel[]; connections: Connection[]; ghost?: boolean
} & SelectionProps) {
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
    return <ConnectorJoint key={connection.id} connection={connection} parent={parent} child={shortestBranch} ghost={ghost} {...selection} />
  })}</>
}
