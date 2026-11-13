import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { Vector3, type Box3 } from 'three'
import { isGeometryGuideActive, type SnapSettings } from '@/lib/preview-snap'
import type { Panel, Vec3 } from '@/lib/types'
import { GroundGrid } from './GroundGrid'
import { RoomEnvironment } from './RoomEnvironment'
import type { RoomStyleInput } from '@/lib/room-floor-style'
import type { FurnishingPlacement } from '@/lib/preview-furnishings'

const MM = 0.001
interface Props {
  panels: readonly Panel[]
  bounds: Box3
  floorY: number
  showGrid: boolean
  exploded: boolean
  realisticPreview?: boolean
  roomStyle?: RoomStyleInput
  /** Wall art keeps clear of furnishings standing on the creation. */
  furnishings?: readonly FurnishingPlacement[]
  snapSettings?: SnapSettings
  guides: { targets: Vec3[]; sources: Vec3[]; direction: Vec3 }
}

export function SceneEnvironment({panels, bounds, floorY, showGrid, exploded, realisticPreview, roomStyle, furnishings, snapSettings, guides}: Props) {
  const center = useMemo(() => bounds.getCenter(new Vector3()), [bounds])
  const extent = useMemo(() => Math.max(3, bounds.getSize(new Vector3()).length() * 2.5), [bounds])
  return <>
    <color attach="background" args={[realisticPreview ? '#e9e7df' : '#eeede8']} />
    {realisticPreview ? <RoomEnvironment panels={panels} bounds={bounds} style={roomStyle} furnishings={furnishings} /> : <>
    <ambientLight intensity={0.9} />
    <hemisphereLight args={['#ffffff', '#b6b0a0', 1.0]} />
    <directionalLight position={[2.5, 5, 3.5]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.001}
      shadow-normalBias={0.006} shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-camera-far={20} />
    <directionalLight position={[-3, 2, -3]} intensity={0.5} />
    <mesh position={[center.x, floorY - 0.002, center.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
      <planeGeometry args={[200, 200]} /><shadowMaterial color="#706b60" transparent opacity={0.2} />
    </mesh>
    {showGrid && snapSettings?.geometry && !exploded && guides.targets.flatMap((point, index) => [0, 1, 2].map(axis => {
      const start = point.map(value => value * MM) as Vec3, end = [...start] as Vec3
      start[axis] -= extent / 2; end[axis] += extent / 2
      const active = isGeometryGuideActive(point, axis, guides.sources, guides.direction)
      return <Line key={`${index}-${axis}`} name="geometry-snap-guide" userData={{ snapActive: active }} points={[start, end]}
        color={active ? '#345b5c' : '#719899'} transparent opacity={active ? 0.9 : 0.25} lineWidth={active ? 1.6 : 1}
        dashed dashSize={0.025} gapSize={0.025} />
    }))}
    {showGrid && <GroundGrid floorY={floorY} extent={extent} cellSize={snapSettings?.grid ? snapSettings.spacing * MM : 0.1} />}
    </>}
  </>
}
