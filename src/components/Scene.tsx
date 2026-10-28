import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { CameraView, Connection, Panel, Vec3 } from '@/lib/types'
import { getConnectionAnchors } from '@/lib/model'
import { makePanelGeometry } from './scene-geometry'

const MM = 0.001
const ACCENT = '#e75a35'

export interface SceneProps {
  panels: Panel[]
  connections: Connection[]
  selectedIds: readonly string[]
  onSelect: (id: string | null, additive?: boolean) => void
  previewPanels?: Panel[]
  previewConnections?: Connection[]
  view: CameraView
  showGrid: boolean
  showDimensions: boolean
  exploded: boolean
  fitSignal: number
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


function PanelMesh({ panel, selected, ghost, onSelect, displacement }: {
  panel: Panel; selected: boolean; ghost?: boolean; onSelect: SceneProps['onSelect']; displacement: THREE.Vector3
}) {
  const geometry = useMemo(() => makePanelGeometry(panel), [panel.width, panel.height, panel.thickness, panel.pattern, panel.holeSize, panel.holeSpacing])
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
  const position = vector(panel.position).add(displacement)
  return <group position={position} rotation={panel.rotation}>
    <mesh name={panel.name} geometry={geometry} material={[face, edge]} castShadow={!ghost} receiveShadow={!ghost}
      onClick={ghost ? undefined : (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey) }}
      onPointerOver={ghost ? undefined : event => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
      onPointerOut={ghost ? undefined : () => { document.body.style.cursor = 'auto' }}>
    </mesh>
    {(selected || ghost) && <lineSegments geometry={outline} raycast={() => null}>
      <lineBasicMaterial color={ACCENT} transparent opacity={ghost ? 0.7 : 0.95} depthTest={false} />
    </lineSegments>}
  </group>
}

// Schematic clamp geometry follows the official 40 mm depth and 35 mm arms.
// It deliberately does not imply a production-ready manufacturer CAD model.
function ClampJaw({ panel, anchor, seam, color, ghost }: { panel: Panel; anchor: THREE.Vector3; seam: THREE.Vector3; color: string; ghost?: boolean }) {
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...panel.rotation))
  const inward = vector(panel.position).sub(anchor).addScaledVector(seam, -vector(panel.position).sub(anchor).dot(seam))
  inward.addScaledVector(normal, -inward.dot(normal))
  if (inward.lengthSq() < 0.000001) inward.crossVectors(seam, normal)
  inward.normalize()
  const tangent = new THREE.Vector3().crossVectors(normal, inward).normalize()
  const matrix = new THREE.Matrix4().makeBasis(inward, tangent, normal)
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix)
  const gap = panel.thickness * MM
  return <group position={anchor} quaternion={quaternion}>
    {[-1, 1].map(sign => <mesh key={sign} position={[0.0115, 0, sign * (gap / 2 + 0.0025)]} castShadow={!ghost} receiveShadow>
      <boxGeometry args={[0.035, 0.04, 0.005]} />
      <meshStandardMaterial color={color} roughness={0.52} transparent={ghost} opacity={ghost ? 0.42 : 1} />
    </mesh>)}
    <mesh position={[-0.006, 0, 0]} castShadow={!ghost}>
      <boxGeometry args={[0.006, 0.04, gap + 0.01]} />
      <meshStandardMaterial color={color} roughness={0.52} transparent={ghost} opacity={ghost ? 0.42 : 1} />
    </mesh>
    {!ghost && <mesh position={[0.013, 0, gap / 2 + 0.0053]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.0035, 0.0035, 0.0012, 6]} />
      <meshStandardMaterial color="#554f49" roughness={0.4} metalness={0.5} />
    </mesh>}
  </group>
}

function ConnectorMeshes({ panels, connections, ghost }: { panels: Panel[]; connections: Connection[]; ghost?: boolean }) {
  return <>{connections.map(connection => {
    const parent = panels.find(panel => panel.id === connection.parentId)
    const child = panels.find(panel => panel.id === connection.childId)
    if (!parent?.visible || !child?.visible) return null
    const jointId = connection.id.replace(/:\d+$/, '')
    const primary = connections.find(c => c.id.replace(/:\d+$/, '') === jointId && c.count > 0)
    const anchors = getConnectionAnchors(connection.count ? connection : { ...connection, count: primary?.count ?? 0 }, parent, child)
    const axis = connection.side === 'left' || connection.side === 'right' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    axis.applyEuler(new THREE.Euler(...parent.rotation))
    return <group key={connection.id} name={`Connector ${connection.type}`}>
      {anchors.map((point, index) => <group key={index}>
        {connection.count > 0 && <ClampJaw panel={parent} anchor={vector(point)} seam={axis} color={connection.color} ghost={ghost} />}
        <ClampJaw panel={child} anchor={vector(point)} seam={axis} color={connection.color} ghost={ghost} />
      </group>)}
    </group>
  })}</>
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

function CameraController({ bounds, view, fitSignal, zoomSignal }: Pick<SceneProps, 'view' | 'fitSignal' | 'zoomSignal'> & { bounds: THREE.Box3 }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, size, invalidate } = useThree()
  const boundsRef = useRef(bounds)
  const lastZoomKey = useRef(0)
  boundsRef.current = bounds
  useEffect(() => {
    const cameraBounds = boundsRef.current.clone().expandByScalar(0.08)
    const center = cameraBounds.getCenter(new THREE.Vector3())
    const direction = view === 'front' ? new THREE.Vector3(0, 0, 1) : view === 'top' ? new THREE.Vector3(0, 1, 0.0001) : view === 'right' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(1.35, 0.9, 1.6).normalize()
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
    } else {
      camera.zoom = Math.min(size.width / Math.max(maxX - minX, 0.1), size.height / Math.max(maxY - minY, 0.1)) * 0.74
    }
    camera.updateProjectionMatrix()
    controls.current?.target.copy(center)
    controls.current?.update()
    invalidate()
  }, [camera, view, fitSignal, size.width, size.height, invalidate])
  useEffect(() => {
    if (!zoomSignal.key || zoomSignal.key === lastZoomKey.current) return
    lastZoomKey.current = zoomSignal.key
    if (camera instanceof THREE.PerspectiveCamera && controls.current) {
      const offset = camera.position.clone().sub(controls.current.target)
      const distance = THREE.MathUtils.clamp(offset.length() * (zoomSignal.direction > 0 ? 1 / 1.18 : 1.18), 0.08, 100)
      camera.position.copy(controls.current.target).add(offset.setLength(distance))
      controls.current.update()
    } else {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * (zoomSignal.direction > 0 ? 1.18 : 1 / 1.18), 25, 4000)
    }
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, zoomSignal.key, zoomSignal.direction, invalidate])
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minZoom={25} maxZoom={4000}
    minDistance={0.08} maxDistance={100} maxPolarAngle={Math.PI * 0.94} enableRotate={view === 'perspective'} screenSpacePanning />
}

function World(props: SceneProps) {
  const { panels, connections, selectedIds, onSelect, previewPanels = [], previewConnections = [], showGrid, showDimensions, exploded } = props
  const displayPanels = useMemo(() => {
    if (!exploded) return panels
    const center = boundsOf(panels).getCenter(new THREE.Vector3())
    return panels.map(panel => ({ ...panel, position: vector(panel.position).sub(center).multiplyScalar(1.45).add(center).multiplyScalar(1 / MM).toArray() as Vec3 }))
  }, [panels, exploded])
  const bounds = useMemo(() => boundsOf(displayPanels), [displayPanels])
  const cameraBounds = useMemo(() => boundsOf([...displayPanels, ...previewPanels]), [displayPanels, previewPanels])
  const center = bounds.getCenter(new THREE.Vector3())
  const shownPanels = displayPanels.filter(panel => panel.visible)
  const floorY = bounds.min.y - 0.012
  const extent = Math.max(3, bounds.getSize(new THREE.Vector3()).length() * 2.5)
  return <>
    {props.view === 'perspective'
      ? <PerspectiveCamera makeDefault fov={35} near={0.01} far={200} position={[2, 1.5, 2.5]} />
      : <OrthographicCamera makeDefault near={0.01} far={200} position={[2, 1.5, 2.5]} zoom={450} />}
    <color attach="background" args={['#eeede8']} />
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
    {shownPanels.map(panel => <PanelMesh key={panel.id} panel={panel} selected={selectedIds.includes(panel.id)} onSelect={onSelect} displacement={new THREE.Vector3()} />)}
    {!exploded && <ConnectorMeshes panels={panels} connections={connections} />}
    {previewPanels.filter(panel => panel.visible).map(panel => <PanelMesh key={`preview-${panel.id}`} panel={panel} selected={false} ghost onSelect={onSelect} displacement={new THREE.Vector3()} />)}
    {previewConnections.length > 0 && <ConnectorMeshes panels={[...panels, ...previewPanels]} connections={previewConnections} ghost />}
    {showDimensions && panels.length > 0 && !exploded && <Dimensions bounds={bounds} />}
    <CameraController bounds={cameraBounds} view={props.view} fitSignal={props.fitSignal} zoomSignal={props.zoomSignal} />
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
  return <ViewportBoundary>
    <Canvas aria-label="Interactive 3D furniture design. Drag to orbit, scroll to zoom, click a panel to select it. Shift-click, Command-click, or Control-click to select multiple panels." shadows frameloop="demand" dpr={[1, 2]} camera={{ position: [2, 1.5, 2.5], fov: 35, near: 0.01, far: 200 }}
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
      onPointerMissed={event => { if (event.type === 'click') props.onSelect(null, event.shiftKey || event.metaKey || event.ctrlKey) }}
      fallback={<div style={{ padding: 32 }}>Your browser needs WebGL to display this 3D workspace.</div>}>
      <World {...props} />
    </Canvas>
  </ViewportBoundary>
}
