import { useEffect, useEffectEvent, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { TriangleAlert } from 'lucide-react'
import { OBJECT_CONNECTOR_MIN_SPAN } from '@/lib/object-clearance'
import { Edges, Html } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three'
import type { ConversionRegion } from '@/lib/object-conversion-diagnostics'
import type { ObjectPreviewSurface } from '@/lib/object-preview'
import type { ObjectBounds } from '@/lib/object-geometry'
import { constructionBounds, constructionLeaves } from '@/lib/object-geometry'
import { getPanelMovementDelta } from '@/lib/panel-movement-direction'
import type { ConstructionObjects, Vec3 } from '@/lib/types'
import { PreviewDragMovement } from './PreviewDragMovement'
import { PreviewResizeHandles } from './PreviewResizeHandles'
import type { useObjectGesture } from '@/hooks/use-object-gesture'

export interface ConstructionLayerProps {
  objects: ConstructionObjects;
  highlightedRegions?: ConversionRegion[];
  previewBounds?: ObjectBounds;
  surfaces?: ObjectPreviewSurface[];
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
    {surfaces?.filter(surface => surface.positions.length).map(surface => <ObjectSurfaceMesh key={surface.id} surface={surface}
      selected={selected.has(surface.id) && active} active={active} onSelect={onSelect}/>)}
    {active && surfaces?.filter(surface => surface.warningPositions?.length).map(surface => <ObjectClearanceWarning key={`warning-${surface.id}`}
      positions={surface.warningPositions!} name={objects.nodes.find(node => node.id === surface.id)?.name ?? 'Object'}/>)}
    {props.highlightedRegions?.map(region => <mesh key={region.id} name={`Affected source region ${region.name}`} raycast={noRaycast}
      position={region.bounds.min.map((value, axis) => (value + region.bounds.max[axis]) / 2000) as Vec3}>
      <boxGeometry args={region.bounds.max.map((value, axis) => Math.max(1, value - region.bounds.min[axis]) / 1000) as Vec3}/>
      <meshBasicMaterial color="#dc392e" transparent opacity={0.08} depthWrite={false}/>
      <Edges color="#dc392e" depthTest={false} raycast={noRaycast}/>
    </mesh>)}
    {boxes.map(box => <mesh key={box.id} name={`Object outline ${box.id}`} userData={{objectId:box.id}} position={box.position.map(value => value / 1000) as Vec3} rotation={box.rotation}>
      <boxGeometry args={[box.width / 1000, box.height / 1000, box.depth / 1000]}/>
      <meshBasicMaterial visible={false}/><Edges color="#d52cb8" transparent opacity={0.65} depthWrite={false} raycast={noRaycast} depthTest={false}/>
    </mesh>)}
  </group>
}

function ObjectClearanceWarning({ positions, name }: { positions: Float32Array; name: string }) {
  const geometry = useMemo(() => new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3)), [positions])
  useEffect(() => () => geometry.dispose(), [geometry])
  const anchor = [0, 1, 2].map(axis => (positions[axis] + positions[axis + 3] + positions[axis + 6]) / 3) as Vec3
  const message = `${name}: narrow geometry may not fit connectors. Highlighted sections are under ${OBJECT_CONNECTOR_MIN_SPAN} mm, allowing for 16 mm stock, connector seats and a 40 mm panel cut. Widen these sections and use Convert to panels to check the full hardware fit.`
  return <group>
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={5}>
      <meshBasicMaterial color="#ef9b18" transparent opacity={0.55} depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}/>
      <Edges color="#a95800" depthTest={false} raycast={noRaycast}/>
    </mesh>
    <Html position={anchor} center zIndexRange={[20, 0]}>
      <span className="object-clearance-warning" tabIndex={0} role="img" aria-label={message}>
        <TriangleAlert size={20} aria-hidden="true"/>
        <span className="object-clearance-tooltip">{message}</span>
      </span>
    </Html>
  </group>
}

function ObjectSurfaceMesh({ surface, selected, active, onSelect }: {
  surface: ObjectPreviewSurface; selected: boolean; active: boolean; onSelect: ConstructionLayerProps['onSelect'];
}) {
  const geometry = useMemo(() => new BufferGeometry().setAttribute('position', new BufferAttribute(surface.positions, 3)), [surface.positions])
  useEffect(() => () => geometry.dispose(), [geometry])
  // R3F skips undefined props, so explicitly restore raycasting after passive mode.
  return <mesh geometry={geometry} name={`Object ${surface.id}`} userData={active ? { objectId: surface.id } : {}} raycast={active ? Mesh.prototype.raycast : noRaycast}
    onClick={active ? event => { event.stopPropagation(); onSelect(surface.id, event.shiftKey || event.metaKey || event.ctrlKey) } : undefined}>
    <meshBasicMaterial color={selected ? '#d52cb8' : '#3b91db'} transparent opacity={active ? 0.27 : 0.12} depthWrite={false} side={DoubleSide}/>
    <Edges geometry={geometry} color={selected ? '#d52cb8' : '#1769aa'} transparent opacity={active ? 0.65 : 0.35} depthWrite={false} depthTest={false} raycast={noRaycast}/>
  </mesh>
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
