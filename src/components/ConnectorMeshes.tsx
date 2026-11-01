import { connectorSlide, getConnectorRail } from '@/lib/connector-movement'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { connectorId, connectorFinish } from '@/lib/connector-selection'
import type { Connection, Panel, Project } from '@/lib/types'
import { getConnectorPlacements } from '@/lib/model'
import { getConnectorGeometry } from './connector-geometry'
import { connectorDisplayColor, getConnectorMaterial } from '@/lib/connector-options'
import { createConnectorMetalResources, getMetalConnectorGeometry, type ConnectorMetalResources } from './connector-metal'

const source = 'resources/connectors-3d/Connettori sharing.obj'

interface SelectionProps {
  selectedConnectorIds?: readonly string[]
  onSelectConnector?: (id: string, additive?: boolean) => void
  connectorOverrides?: Project['connectorOverrides']
}

function ConnectorPiece({ connection, placement, id, ghost, selected, onSelectConnector, metalResources }: {
  connection: Connection; placement: ReturnType<typeof getConnectorPlacements>[number]; id: string; ghost?: boolean; selected: boolean
  metalResources: ConnectorMetalResources | null
} & Pick<SelectionProps, 'onSelectConnector'>) {
  const metal = getConnectorMaterial(connection.type, connection.material) === 'metal'
  const parts = metal ? getMetalConnectorGeometry() : getConnectorGeometry(connection.type)
  const color = connectorDisplayColor(connection)
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color, roughness: metal ? 0.58 : 0.48, metalness: metal ? 0.94 : 0,
    ...(metal && metalResources ? { map: metalResources.map, bumpMap: metalResources.bumpMap,
      roughnessMap: metalResources.roughnessMap, envMap: metalResources.envMap, envMapIntensity: .9, bumpScale: .000065 } : {}),
    emissive: selected ? '#2788ff' : '#000000', emissiveIntensity: selected ? 0.65 : 0,
    transparent: !!ghost, opacity: ghost ? 0.42 : 1, depthWrite: !ghost,
  }), [color, metal, metalResources, ghost, selected])
  useEffect(() => () => material.dispose(), [material])
  return <group name={`Playwood ${connection.type}`} userData={{ connectorType: connection.type, connectorMaterial: metal ? 'metal' : 'plastic', connectorId: ghost ? undefined : id, selected, source }}
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
  const renderer = useThree(state => state.gl)
  const hasMetal = connections.some(connection => Array.from({ length: connection.count }, (_, index) => {
    const finish = connectorFinish(connection, index, connectorOverrides)
    return !finish?.removed && getConnectorMaterial(finish?.type ?? connection.type, finish?.material ?? connection.material) === 'metal'
  }).some(Boolean))
  const [metalResources, setMetalResources] = useState<ConnectorMetalResources | null>(null)
  useLayoutEffect(() => {
    if (!hasMetal) { setMetalResources(null); return }
    // Build GPU resources after commit: Strict Mode may discard render work or
    // replay effects, and a disposed reflection render target cannot be reused.
    const resources = createConnectorMetalResources(renderer)
    setMetalResources(resources)
    return () => resources.dispose()
  }, [hasMetal, renderer])
  const selectedIds = new Set(selectedConnectorIds)
  return <>{connections.filter(connection => connection.count > 0).map(connection => {
    const rail = getConnectorRail(connection, panels, connections)
    if (!rail) return null
    return <group key={connection.id} name={`Connector ${connection.type}`}>
      {rail.placements.map((placement, index) => {
        const id = connectorId(connection.id, index)
        const finish = connectorFinish(connection, index, connectorOverrides)
        const slide = connectorSlide(rail, index, finish?.slide)
        const position = placement.position.map((value, axis) => value + rail.tangent[axis] * slide) as Panel['position']
        return finish?.removed ? null : <ConnectorPiece key={id} id={id} connection={{ ...connection, ...finish }} placement={{ ...placement, position }}
          ghost={ghost} selected={!ghost && selectedIds.has(id)} onSelectConnector={onSelectConnector} metalResources={metalResources}/>
      })}
    </group>
  })}</>
}
