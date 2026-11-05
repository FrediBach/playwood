import { useEffect, useEffectEvent, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import { DoubleSide } from 'three'
import { constructionBounds, constructionLeaves, type ObjectSurface } from '@/lib/object-geometry'
import { getPanelMovementDelta } from '@/lib/panel-movement-direction'
import type { ConstructionObjects, Vec3 } from '@/lib/types'
import { PreviewDragMovement } from './PreviewDragMovement'
import { PreviewResizeHandles } from './PreviewResizeHandles'
import type { useObjectGesture } from '@/hooks/use-object-gesture'

export interface ConstructionLayerProps {
  objects: ConstructionObjects;
  surfaces?: ObjectSurface[];
  selectedIds: readonly string[];
  active: boolean;
  movementEnabled: boolean;
  step: number;
  gesture?: ReturnType<typeof useObjectGesture>;
  boxSelecting?: boolean;
  onSelect: (id: string | null, additive?: boolean) => void;
  onMove: (delta: Vec3, repeat: boolean) => void;
}
const noRaycast = () => undefined

export function ConstructionObjectLayer(props: ConstructionLayerProps) {
  const { objects, surfaces, selectedIds, active, onSelect, gesture, boxSelecting } = props
  const selected = new Set(selectedIds)
  const boxes = active ? constructionLeaves(objects, selectedIds) : []
  return <group name="Construction objects">
    <ObjectKeyboardMovement {...props} movementEnabled={props.movementEnabled && !gesture?.active && !boxSelecting}/>
    {gesture && <>
      <PreviewDragMovement targetKey="objectId" selectedIds={[...selectedIds, ...boxes.map(box => box.id)]} movementEnabled={active && props.movementEnabled && !gesture.resizing && !boxSelecting}
        onSelect={onSelect} onDragStart={()=>gesture.start()} onDragMove={delta=>gesture.update(delta)} onDragEnd={gesture.end}/>
      <PreviewResizeHandles handles={gesture.handles} enabled={active && props.movementEnabled && (!gesture.active || gesture.resizing) && !boxSelecting}
        distance={gesture.distance} limited={gesture.limited} keyboardStep={props.step}
        onResizeStart={id=>gesture.start(id)} onResizeMove={gesture.update} onResizeEnd={gesture.end}/>
    </>}
    {surfaces?.filter(surface => surface.positions.length).map(surface => <mesh key={surface.id} name={`Object ${surface.id}`} userData={active ? { objectId: surface.id } : undefined} raycast={active ? undefined : noRaycast}
      onClick={active ? event => { event.stopPropagation(); onSelect(surface.id, event.shiftKey || event.metaKey || event.ctrlKey) } : undefined}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[surface.positions, 3]}/></bufferGeometry>
      <meshBasicMaterial color={selected.has(surface.id) && active ? '#187cd2' : '#3b91db'} transparent opacity={active ? 0.27 : 0.12} depthWrite={false} side={DoubleSide}/>
    </mesh>)}
    {boxes.map(box => <mesh key={box.id} name={`Object outline ${box.id}`} userData={{objectId:box.id}} position={box.position.map(value => value / 1000) as Vec3} rotation={box.rotation}>
      <boxGeometry args={[box.width / 1000, box.height / 1000, box.depth / 1000]}/>
      <meshBasicMaterial visible={false}/><Edges color="#1769aa" raycast={noRaycast} depthTest={false}/>
    </mesh>)}
  </group>
}

function ObjectKeyboardMovement({ objects, selectedIds, active, movementEnabled, onMove, step }: ConstructionLayerProps) {
  const { camera, gl, size } = useThree(), gesture = useRef('')
  const move = useEffectEvent((event: KeyboardEvent) => {
    if (!active || !movementEnabled || !selectedIds.length || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const bounds = constructionBounds(objects, selectedIds)
    if (!bounds) return
    camera.updateWorldMatrix(true, false)
    const delta = getPanelMovementDelta({ camera, key: event.key, shiftKey: event.shiftKey, rotation: [0, 0, 0],
      position: bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) as Vec3, viewport: size })
    if (!delta) return
    event.preventDefault(); event.stopPropagation()
    const key = `${event.key}:${event.shiftKey}:${selectedIds.join('/')}`
    onMove(delta.map(value => value * step / 10) as Vec3, event.repeat && gesture.current === key)
    gesture.current = key
  })
  useEffect(() => {
    const canvas = gl.domElement, reset = () => { gesture.current = '' }
    canvas.addEventListener('keydown', move)
    canvas.addEventListener('keyup', reset); canvas.addEventListener('blur', reset)
    return () => { canvas.removeEventListener('keydown', move); canvas.removeEventListener('keyup', reset); canvas.removeEventListener('blur', reset) }
  }, [gl])
  return null
}
