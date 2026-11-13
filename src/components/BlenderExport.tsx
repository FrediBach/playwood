import { Canvas, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Box, Download, House } from 'lucide-react'
import { Box3, Vector3 } from 'three'
import { resolvePanels } from '@/lib/model'
import { furnishingNameHints, planPreviewFurnishings, type FurnishingOptions } from '@/lib/preview-furnishings'
import { roomStyleFor } from '@/lib/room-floor-style'
import { furnishingOptions, usePreviewFurnishing } from '@/hooks/use-preview-furnishing'
import type { Project } from '@/lib/types'
import { ConnectorMeshes } from './ConnectorMeshes'
import { PanelMesh } from './Scene'
import { boundsOf } from './scene-bounds'
import { RoomEnvironment } from './RoomEnvironment'
import { PreviewFurnishings } from './PreviewFurnishings'
import { DreameDockModel, DreameVacuumModel } from './RobotVacuumModel'
import { createVacuumPlan } from './robot-vacuum-navigation'
import { exportSceneGlb } from '@/lib/scene-export'

/** Furnishing options are captured at start so the export matches the viewport's arrangement. */
interface Job { project: Project; room: boolean; furnished: boolean; furnishing: FurnishingOptions; autoFurnish: boolean }

export function BlenderExport({ project }: { project: Project }) {
  const [job, setJob] = useState<Job | null>(null)
  const [furnished, setFurnished] = useState(false)
  const [status, setStatus] = useState('')
  const furnishing = usePreviewFurnishing()
  function start(room: boolean) {
    setStatus('Preparing GLB…')
    setJob({ project, room, furnished, furnishing: furnishingOptions(furnishing, furnishingNameHints(project)), autoFurnish: furnishing.enabled })
  }
  return <section aria-label="Blender export">
    <h3>Export to Blender</h3>
    <p className="dialog-note">Download a GLB, then in Blender choose File → Import → glTF 2.0. Save as .blend from Blender. Exports visible panels, installed hardware and inserts at actual scale.</p>
    <div className="export-options">
      <button disabled={!!job} onClick={() => start(false)}><span className="export-icon"><Box size={23}/></span><span><strong>Construction · GLB</strong><small>Furniture only, with materials and textures</small></span><Download size={19}/></button>
      <button disabled={!!job} onClick={() => start(true)}><span className="export-icon"><House size={23}/></span><span><strong>Realistic scene · GLB</strong><small>Construction, room, decor, camera and supported lights</small></span><Download size={19}/></button>
    </div>
    <label><input type="checkbox" checked={furnished} disabled={!!job} onChange={event => setFurnished(event.target.checked)} /> Include auto furnishings in realistic scene</label>
    <p className="dialog-note">Furnishings and the room's floor, walls, curtains and art follow the density, style, shuffle and surface choices from Realistic preview.</p>
    <p className="dialog-note">Uses the assembled construction and a fitted camera. Shader effects, bump detail, ambient and area lighting may look different in Blender. The robot vacuum is exported docked, without animation.</p>
    {status && <p role="status">{status}</p>}
    {job && <div aria-hidden="true" style={{ position: 'fixed', left: -10000, width: 64, height: 64, pointerEvents: 'none' }}>
      <ExportBoundary onError={() => { setJob(null); setStatus('Export failed. Check that WebGL is available and try again.') }}>
      <Canvas frameloop="demand" camera={{ position: [2, 1.5, 2.5], near: 0.01, far: 200 }}>
        <ExportContent job={job} onDone={(error?: string) => { setJob(null); setStatus(error ?? 'GLB downloaded. Import it into Blender using glTF 2.0.') }} />
      </Canvas>
      </ExportBoundary>
    </div>}
  </section>
}

function ExportContent({ job, onDone }: { job: Job; onDone: (error?: string) => void }) {
  const panels = useMemo(() => resolvePanels(job.project), [job.project])
  // The plan also gives the room style, which matches the preview's floor and rug.
  const plan = useMemo(() => job.room && (job.furnished || job.autoFurnish) ? planPreviewFurnishings(panels, job.furnishing) : null, [job, panels])
  const furnishings = useMemo(() => job.furnished ? plan?.placements ?? [] : [], [job.furnished, plan])
  const roomStyle = useMemo(() => roomStyleFor({ enabled: job.autoFurnish, seed: job.furnishing.seed ?? 0, density: job.furnishing.density }, plan?.theme), [job, plan])
  const bounds = useMemo(() => boundsOf(panels), [panels])
  const vacuum = useMemo(() => job.room ? createVacuumPlan(bounds, panels, furnishings, roomStyle) : null, [job.room, bounds, panels, furnishings, roomStyle])
  return <>
    <group name="Construction">
      {panels.filter(panel => panel.visible).map(panel => <PanelMesh key={panel.id} panel={panel} selected={false} interactive={false} onSelect={() => {}} />)}
      <ConnectorMeshes panels={panels} connections={job.project.connections} connectorOverrides={job.project.connectorOverrides} />
    </group>
    {job.room && <RoomEnvironment panels={panels} bounds={bounds} style={roomStyle} furnishings={furnishings} />}
    {job.room && <PreviewFurnishings placements={furnishings} />}
    {vacuum && <group name="Robot vacuum"><group position={[vacuum.dock.x, vacuum.floorY, vacuum.dock.z]}><DreameDockModel /></group><group position={[vacuum.start.x, vacuum.floorY, vacuum.start.z]}><DreameVacuumModel /></group></group>}
    <SerializeScene job={job} bounds={bounds} onDone={onDone} />
  </>
}

function SerializeScene({ job, bounds, onDone }: { job: Job; bounds: Box3; onDone: (error?: string) => void }) {
  const { scene, camera } = useThree()
  useEffect(() => {
    let cancelled = false
    // Allow child layout effects (including metal materials) to commit first.
    const timer = window.setTimeout(() => {
      const center = bounds.getCenter(new Vector3())
      const distance = Math.max(1, bounds.getSize(new Vector3()).length() * 1.7)
      camera.position.copy(center).add(new Vector3(1, .7, 1).normalize().multiplyScalar(distance))
      camera.lookAt(center)
      camera.name = 'Playwood camera'
      scene.add(camera)
      const name = job.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'playwood-project'
      void exportSceneGlb(scene).then(data => {
        if (cancelled) return
        const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${name}-${job.room ? 'scene' : 'construction'}.glb`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        onDone()
      }).catch(error => { if (!cancelled) onDone(`Export failed: ${error instanceof Error ? error.message : 'Please try again.'}`) })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [scene, camera, job, bounds, onDone])
  return null
}

class ExportBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError() }
  render() { return this.state.failed ? null : this.props.children }
}
