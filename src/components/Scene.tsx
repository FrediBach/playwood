import { Component, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CameraView, Connection, Panel, Project, Vec3 } from '@/lib/types'
import { ConnectorMeshes } from './ConnectorMeshes'
import { makePanelGeometry } from './scene-geometry'
import { RoomEnvironment } from './RoomEnvironment'
import { getRoomLayout } from './room-layout'
import { getPanelMovementDelta } from '@/lib/panel-movement-direction'
import { PreviewDragMovement, type PreviewDragProps } from './PreviewDragMovement'
import { Plus } from 'lucide-react'
import './assemblies.css'

const MM = 0.001
const ACCENT = '#e75a35'
const EMPTY_PANELS: Panel[] = []
const EMPTY_CONNECTIONS: Connection[] = []
const EMPTY_ATTACHMENT_HANDLES: AssemblyAttachmentHandle[] = []

export interface AssemblyAttachmentHandle {
  id: string
  /** Position in project millimeters. */
  position: Vec3
  label: string
  active?: boolean
  warning?: string
}

export interface SceneProps extends PreviewDragProps {
  panels: Panel[]
  connections: Connection[]
  connectorOverrides?: Project['connectorOverrides']
  selectedConnectorIds?: readonly string[]
  onSelectConnector?: (id: string, additive?: boolean) => void
  selectedIds: readonly string[]
  onSelect: (id: string | null, additive?: boolean) => void
  onMove?: (delta: Vec3, repeat: boolean) => void
  movementEnabled?: boolean
  dragging?: boolean
  dragSnap?: { position: Vec3; label: string; warning?: string } | null
  onDrillIn?: (panelId: string) => void
  attachmentHandles?: AssemblyAttachmentHandle[]
  onAttachmentPreview?: (id: string | null) => void
  onAttachmentCommit?: (id: string) => void
  previewPanels?: Panel[]
  previewConnections?: Connection[]
  /** Attachment candidates included in fitting, without rendering them. */
  attachmentBoundsPanels?: Panel[]
  view: CameraView
  showGrid: boolean
  showDimensions: boolean
  exploded: boolean
  realisticPreview?: boolean
  panMode?: boolean
  fitSignal: number
  frameSignal?: number
  zoomSignal: { direction: number; key: number }
}

function vector(values: Vec3) { return new THREE.Vector3(...values).multiplyScalar(MM) }

function boundsOf(panels: Panel[]) {
  const bounds = new THREE.Box3()
  for (const panel of panels.filter(p => p.visible)) {
    const rotation = new THREE.Euler(...panel.rotation)
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      const point = new THREE.Vector3(x * panel.width / 2, y * panel.height / 2, z * panel.thickness / 2)
        .applyEuler(rotation).add(new THREE.Vector3(...panel.position)).multiplyScalar(MM)
      bounds.expandByPoint(point)
    }
  }
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-0.4, 0, -0.3), new THREE.Vector3(0.4, 0.7, 0.3))
  return bounds
}

function woodTexture(material: Panel['material']) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(canvas.width, canvas.height)
  const strength = material === 'mdf' ? 0.008 : material === 'walnut' ? 0.025 : material === 'oak' ? 0.02 : 0.009
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const bend = Math.sin(y * 0.009) * 3 + Math.sin(y * 0.021 + x * 0.015) * 1.2
      const grain = Math.sin((x + bend) * 0.27) * 0.35 + Math.sin((x + bend) * 0.73) * 0.2 + Math.sin((x + bend) * 1.81) * 0.08
      const fine = Math.sin(x * 128.32 + y * 72.53) * 0.08
      const shade = Math.round(255 * (1 - strength + strength * (grain + fine)))
      const i = (y * canvas.width + x) * 4
      pixels.data[i] = shade; pixels.data[i + 1] = shade; pixels.data[i + 2] = shade; pixels.data[i + 3] = 255
    }
  }
  ctx.putImageData(pixels, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.repeat.set(1.5, 1)
  texture.anisotropy = 8
  return texture
}


function PanelMesh({ panel, selected, ghost, interactive = true, onSelect, onDrillIn }: {
  panel: Panel; selected: boolean; ghost?: boolean; interactive?: boolean; onSelect: SceneProps['onSelect']; onDrillIn?: SceneProps['onDrillIn']
}) {
  const { width, height, thickness, pattern, holeSize, holeSpacing } = panel
  const geometry = useMemo(() => makePanelGeometry({ width, height, thickness, pattern, holeSize, holeSpacing }), [width, height, thickness, pattern, holeSize, holeSpacing])
  const texture = useMemo(() => panel.material !== 'painted' ? woodTexture(panel.material) : null, [panel.material])
  const face = useMemo(() => new THREE.MeshStandardMaterial({
    color: ghost ? ACCENT : panel.color, map: ghost ? null : texture,
    roughness: 0.76, metalness: 0, transparent: ghost, opacity: ghost ? 0.38 : 1,
    depthWrite: !ghost,
  }), [panel.color, texture, ghost])
  const edge = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ color: ghost ? ACCENT : panel.color, roughness: 0.9, transparent: ghost, opacity: ghost ? 0.32 : 1, depthWrite: !ghost })
    if (panel.material === 'birch' && !ghost) {
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float plywoodZ;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nplywoodZ = position.z;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float plywoodZ;')
          .replace('#include <color_fragment>', '#include <color_fragment>\nfloat ply = smoothstep(0.37, 0.43, fract(plywoodZ * 700.0));\ndiffuseColor.rgb *= mix(0.75, 1.02, ply);')
      }
      material.customProgramCacheKey = () => 'playwood-plywood-edges'
    }
    return material
  }, [panel.color, panel.material, ghost])
  const outline = useMemo(() => {
    const box = new THREE.BoxGeometry(panel.width * MM + 0.001, panel.height * MM + 0.001, panel.thickness * MM + 0.001)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    return edges
  }, [panel.width, panel.height, panel.thickness])
  useEffect(() => () => { geometry.dispose() }, [geometry])
  useEffect(() => () => { texture?.dispose() }, [texture])
  useEffect(() => () => { face.dispose(); edge.dispose() }, [face, edge])
  useEffect(() => () => { outline.dispose() }, [outline])
  useEffect(() => () => { document.body.style.cursor = '' }, [])
  const position = panel.position.map(value => value * MM) as Vec3
  return <group position={position} rotation={panel.rotation}>
    <mesh name={panel.name} userData={ghost || !interactive ? undefined : { panelId: panel.id }} geometry={geometry} material={[face, edge]} castShadow={!ghost} receiveShadow={!ghost}
      onClick={ghost || !interactive ? undefined : (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey) }}
      onDoubleClick={ghost || !interactive || !onDrillIn ? undefined : (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onDrillIn(panel.id) }}
      onPointerOver={ghost || !interactive ? undefined : event => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={ghost || !interactive ? undefined : () => { document.body.style.cursor = 'auto' }}>
    </mesh>
    {(selected || ghost) && <lineSegments geometry={outline} raycast={() => null}>
      <lineBasicMaterial color={ACCENT} transparent opacity={ghost ? 0.7 : 0.95} depthTest={false} />
    </lineSegments>}
  </group>
}

function Measure({ from, to, label }: { from: Vec3; to: Vec3; label: string }) {
  const middle: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]
  return <group>
    <Line points={[from, to]} color="#8e9189" lineWidth={0.8} />
    {[from, to].map((point, i) => <mesh key={i} position={point}><sphereGeometry args={[0.0025, 8, 8]} /><meshBasicMaterial color="#8e9189" /></mesh>)}
    <Html position={middle} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <span style={{ display: 'block', whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 4, fontSize: 13, lineHeight: '18px', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em', color: '#62665d', background: 'rgba(238,237,232,0.94)' }}>{label}</span>
    </Html>
  </group>
}

function Dimensions({ bounds }: { bounds: THREE.Box3 }) {
  const { min, max } = bounds
  const y = min.y - 0.006, z = max.z + 0.13, x = max.x + 0.14
  return <group>
    <Measure from={[min.x, y, z]} to={[max.x, y, z]} label={`${Math.round((max.x - min.x) / MM)} mm`} />
    <Measure from={[x, min.y, max.z]} to={[x, max.y, max.z]} label={`${Math.round((max.y - min.y) / MM)} mm`} />
    <Measure from={[min.x - 0.11, y, min.z]} to={[min.x - 0.11, y, max.z]} label={`${Math.round((max.z - min.z) / MM)} mm`} />
  </group>
}

function CameraController({ bounds, view, fitSignal, frameSignal, zoomSignal, realisticPreview, panMode }: Pick<SceneProps, 'view' | 'fitSignal' | 'frameSignal' | 'zoomSignal' | 'realisticPreview' | 'panMode'> & { bounds: THREE.Box3 }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const [roomMaxDistance, setRoomMaxDistance] = useState(100)
  const { camera, size, invalidate } = useThree()
  const boundsRef = useRef(bounds)
  const lastZoomKey = useRef(0)
  const lastFrameSignal = useRef(frameSignal)
  const lastFitSignal = useRef(fitSignal)
  useLayoutEffect(() => { boundsRef.current = bounds }, [bounds])
  useEffect(() => {
    // Clear pending inertia before fitting, so the view stays centered after a pan.
    if (controls.current) {
      controls.current.enableDamping = false
      controls.current.update()
      controls.current.enableDamping = true
    }
    const preserveDirection = frameSignal !== undefined && frameSignal !== lastFrameSignal.current && fitSignal === lastFitSignal.current && !!controls.current
    lastFrameSignal.current = frameSignal
    lastFitSignal.current = fitSignal
    const previousDirection = preserveDirection ? camera.position.clone().sub(controls.current!.target).normalize() : undefined
    const cameraBounds = boundsRef.current.clone().expandByScalar(0.08)
    if (realisticPreview) {
      const room = getRoomLayout(boundsRef.current)
      // Include life-size reference objects without scaling the design to the room.
      cameraBounds.expandByPoint(new THREE.Vector3(boundsRef.current.min.x - 0.75, room.floorY, room.backZ + 0.2))
      cameraBounds.expandByPoint(new THREE.Vector3(room.chairX + 0.55, Math.max(room.floorY + 1.9, boundsRef.current.max.y + 0.25), room.chairZ + 0.5))
    }
    const center = cameraBounds.getCenter(new THREE.Vector3())
    const direction = previousDirection ?? (realisticPreview ? new THREE.Vector3(0.33, size.width < size.height ? 0.1 : 0.22, 1).normalize() : view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'top' ? new THREE.Vector3(0, 1, 0.0001) : view === 'right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1.35, 0.9, 1.6).normalize())
    const extent = cameraBounds.getSize(new THREE.Vector3()).length()
    camera.position.copy(center).addScaledVector(direction, Math.max(3, extent * 2.5))
    camera.up.set(0, 1, 0)
    camera.lookAt(center)
    camera.updateMatrixWorld()
    const inverse = camera.matrixWorldInverse
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const x of [cameraBounds.min.x, cameraBounds.max.x]) for (const y of [cameraBounds.min.y, cameraBounds.max.y]) for (const z of [cameraBounds.min.z, cameraBounds.max.z]) {
      const corner = new THREE.Vector3(x, y, z).applyMatrix4(inverse)
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x)
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y)
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      let distance = 0.1
      for (const x of [cameraBounds.min.x, cameraBounds.max.x]) for (const y of [cameraBounds.min.y, cameraBounds.max.y]) for (const z of [cameraBounds.min.z, cameraBounds.max.z]) {
        const offset = new THREE.Vector3(x, y, z).sub(center)
        const towardsCamera = offset.dot(direction)
        distance = Math.max(distance,
          Math.abs(offset.dot(right)) / (tan * (size.width / Math.max(size.height, 1)) * 0.74) + towardsCamera,
          Math.abs(offset.dot(up)) / (tan * 0.74) + towardsCamera)
      }
      camera.position.copy(center).addScaledVector(direction, distance)
      camera.zoom = 1
      if (realisticPreview) {
        const maxDistance = Math.max(6, distance * 1.3)
        setRoomMaxDistance(maxDistance)
        if (controls.current) controls.current.maxDistance = maxDistance
      }
    } else {
      camera.zoom = Math.min(size.width / Math.max(maxX - minX, 0.1), size.height / Math.max(maxY - minY, 0.1)) * 0.74
    }
    camera.updateProjectionMatrix()
    controls.current?.target.copy(center)
    controls.current?.update()
    invalidate()
  }, [camera, view, fitSignal, frameSignal, size.width, size.height, invalidate, realisticPreview])
  useEffect(() => {
    if (!zoomSignal.key || zoomSignal.key === lastZoomKey.current) return
    lastZoomKey.current = zoomSignal.key
    if (camera instanceof THREE.PerspectiveCamera && controls.current) {
      const offset = camera.position.clone().sub(controls.current.target)
      const distance = THREE.MathUtils.clamp(offset.length() * (zoomSignal.direction > 0 ? 1 / 1.18 : 1.18), realisticPreview ? 0.6 : 0.08, realisticPreview ? roomMaxDistance : 100)
      camera.position.copy(controls.current.target).add(offset.setLength(distance))
      controls.current.update()
    } else {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (zoomSignal.direction > 0 ? 1.18 : 1 / 1.18), 25, 4000)
    }
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, zoomSignal.key, zoomSignal.direction, invalidate, realisticPreview, roomMaxDistance])
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minZoom={25} maxZoom={4000}
    minDistance={realisticPreview ? 0.6 : 0.08} maxDistance={realisticPreview ? roomMaxDistance : 100} minPolarAngle={realisticPreview ? 0.25 : 0} maxPolarAngle={Math.PI * (realisticPreview ? 0.49 : 0.94)}
    minAzimuthAngle={realisticPreview ? 0 : -Infinity} maxAzimuthAngle={realisticPreview ? Math.PI / 3 : Infinity} enableRotate={view === 'perspective'} enablePan screenSpacePanning
    mouseButtons={{ LEFT: panMode || view !== 'perspective' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    touches={{ ONE: panMode || view !== 'perspective' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
}

/** Read the live camera on every keypress, including during orbit damping. */
function PanelKeyboardMovement({panels, selectedIds, onMove, movementEnabled}: SceneProps) {
  const {camera, gl, size} = useThree()
  const gesture = useRef('')
  const move = useEffectEvent((event: KeyboardEvent) => {
    if (!movementEnabled || !onMove || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const wanted = new Set(selectedIds)
    const selected = panels.filter(panel => panel.visible && wanted.has(panel.id))
    if (!selected.length) return
    const position = selected.reduce((center, panel) => center.map((value, axis) => value + panel.position[axis] / selected.length) as Vec3, [0, 0, 0] as Vec3)
    camera.updateWorldMatrix(true, false)
    const delta = getPanelMovementDelta({camera, key:event.key, shiftKey:event.shiftKey, position, rotation:selected[0].rotation, viewport:size})
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const key = `${event.key}:${event.shiftKey}:${selected.map(panel=>panel.id).join(',')}`
    onMove(delta, event.repeat && gesture.current === key)
    gesture.current = key
  })
  useEffect(() => {
    const canvas = gl.domElement
    canvas.tabIndex = 0
    canvas.setAttribute('aria-label', '3D preview canvas')
    canvas.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight X Y Z')
    const reset = () => { gesture.current = '' }
    const focus = () => canvas.focus({preventScroll:true})
    canvas.addEventListener('pointerdown', focus)
    canvas.addEventListener('keydown', move)
    canvas.addEventListener('blur', reset)
    window.addEventListener('keyup', reset)
    window.addEventListener('blur', reset)
    return () => {
      canvas.removeEventListener('pointerdown', focus)
      canvas.removeEventListener('keydown', move)
      canvas.removeEventListener('blur', reset)
      window.removeEventListener('keyup', reset)
      window.removeEventListener('blur', reset)
    }
  }, [gl])
  return null
}

type AttachmentElements = RefObject<Map<string, HTMLDivElement>>

/** The buttons belong to the app's DOM root; only their screen positions follow the 3D camera. */
function AttachmentHandlePositions({ handles, elements }: { handles: AssemblyAttachmentHandle[]; elements: AttachmentElements }) {
  const { camera, size, invalidate } = useThree()
  const projected = useMemo(() => new THREE.Vector3(), [])
  useLayoutEffect(() => { invalidate() }, [handles, camera, size, invalidate])
  useFrame(() => {
    camera.updateMatrixWorld()
    const placed: { x: number; y: number }[] = []
    for (const handle of handles) {
      const element = elements.current.get(handle.id)
      if (!element) continue
      projected.set(...handle.position).multiplyScalar(MM).project(camera)
      const x = (projected.x + 1) * size.width / 2
      const y = (1 - projected.y) * size.height / 2
      const visible = projected.z >= -1 && projected.z <= 1 && x >= 0 && x <= size.width && y >= 0 && y <= size.height
      element.style.visibility = visible ? 'visible' : 'hidden'
      let screenX = x, screenY = y
      if (visible) {
        // Opposite faces can project onto the same spot. Keep both choices
        // reachable, including the extra space used by the hover outline.
        const fits = (cx: number, cy: number) => placed.every(other => Math.hypot(cx - other.x, cy - other.y) >= 38)
        if (!fits(x, y)) {
          search: for (let ring = 1; ring <= handles.length; ring++) {
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
              const cx = x + dx * ring * 38, cy = y + dy * ring * 38
              if (cx >= 19 && cx <= size.width - 19 && cy >= 19 && cy <= size.height - 19 && fits(cx, cy)) {
                screenX = cx; screenY = cy; break search
              }
            }
          }
        }
        placed.push({ x: screenX, y: screenY })
      }
      element.style.transform = `translate3d(${screenX}px,${screenY}px,0) translate(-50%,-50%)`
    }
  })
  return null
}

function World(props: SceneProps & { attachmentElements: AttachmentElements }) {
  const { panels, connections, selectedIds, onSelect, previewPanels = EMPTY_PANELS, previewConnections = EMPTY_CONNECTIONS, attachmentBoundsPanels = EMPTY_PANELS, showGrid, showDimensions, exploded, realisticPreview } = props
  const displayPanels = useMemo(() => {
    if (!exploded) return panels
    const center = boundsOf(panels).getCenter(new THREE.Vector3())
    return panels.map(panel => ({ ...panel, position: vector(panel.position).sub(center).multiplyScalar(1.45).add(center).multiplyScalar(1 / MM).toArray() as Vec3 }))
  }, [panels, exploded])
  const bounds = useMemo(() => boundsOf(displayPanels), [displayPanels])
  const cameraBounds = useMemo(() => boundsOf([...displayPanels, ...previewPanels, ...attachmentBoundsPanels]), [displayPanels, previewPanels, attachmentBoundsPanels])
  const center = useMemo(() => bounds.getCenter(new THREE.Vector3()), [bounds])
  const shownPanels = displayPanels.filter(panel => panel.visible)
  const floorY = bounds.min.y - 0.012
  const extent = useMemo(() => Math.max(3, bounds.getSize(new THREE.Vector3()).length() * 2.5), [bounds])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  return <>
    <PanelKeyboardMovement {...props} movementEnabled={props.movementEnabled && !props.dragging}/>
    <PreviewDragMovement {...props}/>
    {props.view === 'perspective'
      ? <PerspectiveCamera key={realisticPreview ? 'room' : 'studio'} makeDefault fov={realisticPreview ? 45 : 35} near={0.01} far={200} position={[2, 1.5, 2.5]} />
      : <OrthographicCamera makeDefault near={0.01} far={200} position={[2, 1.5, 2.5]} zoom={450} />}
    <color attach="background" args={[realisticPreview ? '#e9e7df' : '#eeede8']} />
    {realisticPreview ? <RoomEnvironment bounds={bounds} /> : <>
    <ambientLight intensity={0.9} />
    <hemisphereLight args={['#ffffff', '#b6b0a0', 1.0]} />
    <directionalLight position={[2.5, 5, 3.5]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.001}
      shadow-normalBias={0.006} shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-camera-far={20} />
    <directionalLight position={[-3, 2, -3]} intensity={0.5} />
    <mesh position={[center.x, floorY - 0.002, center.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
      <planeGeometry args={[200, 200]} /><shadowMaterial color="#706b60" transparent opacity={0.2} />
    </mesh>
    {showGrid && <Grid position={[0, floorY, 0]} args={[extent, extent]} cellSize={0.1} sectionSize={0.5} cellThickness={0.5} sectionThickness={0.7}
      cellColor="#cccfc5" sectionColor="#b9bdb2" fadeDistance={extent * 0.65} fadeStrength={2} fadeFrom={0} infiniteGrid />}
    </>}
    {shownPanels.map(panel => <PanelMesh key={panel.id} panel={panel} selected={selectedIdSet.has(panel.id)} onSelect={onSelect} onDrillIn={props.onDrillIn} />)}
    {!exploded && <ConnectorMeshes panels={panels} connections={connections} connectorOverrides={props.connectorOverrides} selectedConnectorIds={props.selectedConnectorIds} onSelectConnector={realisticPreview ? undefined : props.onSelectConnector} />}
    {previewPanels.filter(panel => panel.visible).map(panel => <PanelMesh key={`preview-${panel.id}`} panel={panel} selected={false} ghost onSelect={onSelect} />)}
    {previewConnections.length > 0 && <ConnectorMeshes panels={[...panels, ...previewPanels]} connections={previewConnections} connectorOverrides={props.connectorOverrides} ghost />}
    {showDimensions && shownPanels.length > 0 && !exploded && <Dimensions bounds={bounds} />}
    {props.dragSnap && <Html position={vector(props.dragSnap.position)} center style={{ pointerEvents: 'none' }}><span className={`preview-drag-snap${props.dragSnap.warning ? ' has-warning' : ''}`}>Snapped · {props.dragSnap.label}{props.dragSnap.warning && <strong>{props.dragSnap.warning}</strong>}</span></Html>}
    <AttachmentHandlePositions handles={props.attachmentHandles ?? EMPTY_ATTACHMENT_HANDLES} elements={props.attachmentElements}/>
    <CameraController panMode={props.panMode} bounds={cameraBounds} view={props.view} fitSignal={props.fitSignal} frameSignal={props.frameSignal} zoomSignal={props.zoomSignal} realisticPreview={realisticPreview} />
  </>
}

class ViewportBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    if (this.state.error) return <div role="alert" style={{ padding: 32, maxWidth: 420, margin: 'auto', lineHeight: 1.6 }}><strong>The 3D view could not start.</strong><p>Your design is still available in the panels list. Enable browser hardware acceleration, then reload to use the 3D workspace.</p></div>
    return this.props.children
  }
}

export default function Scene(props: SceneProps) {
  const attachmentElements = useRef(new Map<string, HTMLDivElement>())
  const [controlHeld, setControlHeld] = useState(false)
  const clearAttachmentPreview = useEffectEvent(() => props.onAttachmentPreview?.(null))
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Control') { setControlHeld(true); clearAttachmentPreview() }
    }
    const up = (event: KeyboardEvent) => { if (event.key === 'Control') setControlHeld(false) }
    const blur = () => setControlHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const attachmentHandles = !controlHeld && !props.exploded && !props.realisticPreview && !props.dragging ? props.attachmentHandles ?? EMPTY_ATTACHMENT_HANDLES : EMPTY_ATTACHMENT_HANDLES
  return <ViewportBoundary>
    <div className="scene-surface">
    <Canvas aria-label={props.realisticPreview ? 'Realistic furniture preview in a modern home, at actual scale. Drag to orbit, right-drag or enable Pan view to pan, and scroll to zoom. Control-drag a selected panel or assembly to move and snap it.' : 'Interactive 3D furniture design. Drag to orbit, right-drag or enable Pan view to pan, scroll to zoom, click a panel to select it. Control-drag the selection to move and snap it. Shift-click, Command-click, or Control-click to select multiple panels.'} shadows frameloop="demand" dpr={[1, 2]} camera={{ position: [2, 1.5, 2.5], fov: 35, near: 0.01, far: 200 }}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      style={{ width: '100%', height: '100%', touchAction: 'none', cursor: props.panMode ? 'grab' : undefined }}
      onPointerMissed={event => { if (event.type === 'click') props.onSelect(null, event.shiftKey || event.metaKey || event.ctrlKey) }}
      fallback={<div style={{ padding: 32 }}>Your browser needs WebGL to display this 3D workspace.</div>}>
      <World {...props} attachmentHandles={attachmentHandles} attachmentElements={attachmentElements}/>
    </Canvas>
    <div className="assembly-attachment-layer">{attachmentHandles.map(handle=><div key={handle.id} className="assembly-attachment-anchor" ref={element=>{if(element)attachmentElements.current.set(handle.id,element);else attachmentElements.current.delete(handle.id)}}>
      <button className={`assembly-attach-handle ${handle.active ? 'is-active' : ''} ${handle.warning ? 'has-warning' : ''}`} aria-label={handle.label} title={handle.label} data-attachment-id={handle.id}
        onPointerDown={event => event.stopPropagation()}
        onPointerEnter={() => props.onAttachmentPreview?.(handle.id)}
        onPointerLeave={event => { if (document.activeElement !== event.currentTarget) props.onAttachmentPreview?.(null) }}
        onFocus={() => props.onAttachmentPreview?.(handle.id)} onBlur={() => props.onAttachmentPreview?.(null)}
        onKeyDown={event => { if (event.key !== 'Escape' && !event.ctrlKey && !event.metaKey) event.stopPropagation() }}
        onClick={event => { event.stopPropagation(); props.onAttachmentCommit?.(handle.id) }}><Plus size={17}/></button>
    </div>)}</div>
    </div>
  </ViewportBoundary>
}
