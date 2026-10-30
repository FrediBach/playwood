import { connectorSlide, getConnectorRail } from '@/lib/connector-movement'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { connectorId, connectorFinish } from '@/lib/connector-selection'
import type { Connection, Panel, Project } from '@/lib/types'
import { getConnectorPlacements } from '@/lib/model'
import { getConnectorGeometry } from './connector-geometry'

const source = 'resources/connectors-3d/Connettori sharing.obj'

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
  return <group name={`Playwood ${connection.type}`} userData={{ connectorType: connection.type, connectorId: ghost ? undefined : id, selected, source }}
    position={[placement.position[0] * 0.001, placement.position[1] * 0.001, placement.position[2] * 0.001]} rotation={placement.rotation}
    onClick={ghost || !onSelectConnector ? undefined : event => { event.stopPropagation(); onSelectConnector(id, event.shiftKey || event.metaKey || event.ctrlKey) }}
    onDoubleClick={ghost ? undefined : event => event.stopPropagation()}>
    {parts.map(part => <mesh key={part.name} name={part.name} geometry={part.geometry} material={material}
      castShadow={!ghost} receiveShadow={!ghost} dispose={null} />)}
  </group>
}

export function ConnectorMeshes({ panels, connections, ghost, selectedConnectorIds = [], onSelectConnector, connectorOverrides }: {
  panels: Panel[]; connections: Connection[]; ghost?: boolean
} & SelectionProps) {
  return <>{connections.filter(connection => connection.count > 0).map(connection => {
    const rail = getConnectorRail(connection, panels, connections)
    if (!rail) return null
    return <group key={connection.id} name={`Connector ${connection.type}`}>
      {rail.placements.map((placement, index) => {
        const id = connectorId(connection.id, index)
        const finish = connectorFinish(connection, index, connectorOverrides)
        const slide = connectorSlide(rail, index, finish?.slide)
        const position = new THREE.Vector3(...placement.position).addScaledVector(new THREE.Vector3(...rail.tangent), slide).toArray() as Panel['position']
        return finish?.removed ? null : <ConnectorPiece key={id} id={id} connection={{ ...connection, ...finish }} placement={{ ...placement, position }}
          ghost={ghost} selected={!ghost && selectedConnectorIds.includes(id)} onSelectConnector={onSelectConnector}/>
      })}
    </group>
  })}</>
}
