import type { ThreeEvent } from '@react-three/fiber'
import type { Panel } from '@/lib/types'
import { getTrofastColor, getTrofastItem } from '@/lib/trofast-catalog'
import { getTrofastGeometry } from './trofast-geometry'

interface TrofastMeshesProps {
  panel: Panel
  ghost?: boolean
  interactive?: boolean
  onSelect: (id: string, additive?: boolean) => void
  onDrillIn?: (id: string) => void
}

/** Local to the parent panel. Shared CAD-like geometry lives for the application;
 * declarative per-instance materials are owned and disposed by React Three Fiber.
 */
export function TrofastMeshes({ panel, ghost, interactive = true, onSelect, onDrillIn }: TrofastMeshesProps) {
  const selectable = !ghost && interactive
  return <>{panel.trofastInserts?.map(insert => {
    const item = getTrofastItem(insert.itemId), color = getTrofastColor(insert.colorId)
    if (!item || !color) return null
    const parts = getTrofastGeometry(item)
    return <group key={insert.id} position={[(insert.x - panel.width / 2) / 1000, (panel.height / 2 - insert.y) / 1000, insert.face * panel.thickness / 2000]}
      rotation={[insert.face === -1 ? Math.PI : 0, 0, insert.quarterTurn ? Math.PI / 2 : 0]}>
      {parts.map(part => <mesh key={part.role} name={`TROFAST ${item.name} · ${color.name}`}
        userData={selectable ? { panelId: panel.id, trofastInsertId: insert.id } : undefined}
        castShadow={!ghost} receiveShadow={!ghost}
        onClick={selectable ? (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey) } : undefined}
        onDoubleClick={selectable && onDrillIn ? (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onDrillIn(panel.id) } : undefined}
        onPointerOver={selectable ? event => { event.stopPropagation(); document.body.style.cursor = 'pointer' } : undefined}
        onPointerOut={selectable ? () => { document.body.style.cursor = 'auto' } : undefined}>
        <primitive object={part.geometry} attach="geometry" />
        <meshPhysicalMaterial color={ghost ? '#e75a35' : color.hex}
          roughness={item.kind === 'mesh' ? 0.52 : part.role === 'rim' ? 0.28 : 0.36}
          metalness={item.kind === 'mesh' ? 0.18 : 0}
          clearcoat={item.kind === 'mesh' ? 0.06 : 0.14} clearcoatRoughness={0.4}
          transparent={!!ghost} opacity={ghost ? 0.35 : 1} depthWrite={!ghost} />
      </mesh>)}
    </group>
  })}</>
}
