import { useState, type Dispatch, type SetStateAction } from 'react'
import { Box, ChevronDown, Expand, Grid2X2, Hand, House, Link2, Maximize, Minus, MousePointer2, PanelLeftOpen, Plus, RotateCw, Ruler, SlidersHorizontal, Sun } from 'lucide-react'
import Scene, { type SceneProps } from './Scene'
import { IconButton } from './editor-controls'
import { Tooltip } from './ui/tooltip'
import { Button } from './ui/button'
import type { CameraView, Side } from '@/lib/types'
import { getProjectBounds } from '@/lib/model'

type Setter<T> = Dispatch<SetStateAction<T>>
interface Props extends Omit<SceneProps, 'onSelect' | 'previewPanels' | 'previewConnections'> {
  previewPanels: NonNullable<SceneProps['previewPanels']>
  previewConnections: NonNullable<SceneProps['previewConnections']>
  choosePanel: SceneProps['onSelect']
  realisticPreview: boolean
  setRealisticPreview: Setter<boolean>
  leftOpen: boolean
  rightOpen: boolean
  setLeftOpen: Setter<boolean>
  setRightOpen: Setter<boolean>
  setShowDimensions: Setter<boolean>
  setShowGrid: Setter<boolean>
  setView: Setter<CameraView>
  setZoomSignal: Setter<SceneProps['zoomSignal']>
  setFitSignal: Setter<number>
  setExploded: Setter<boolean>
  onRotate: () => void
  addPanel: () => void
  onAutoConnect: () => void
  autoConnectDisabled: boolean
  isAttaching: boolean
  attachmentSide: Side
  visibleBounds: ReturnType<typeof getProjectBounds>
  hasVisiblePanels: boolean
  suppressedConnectionIds?: string[]
  suppressedPanelIds?: string[]
  editingAssembly?: { name: string; instanceCount: number; onDone: () => void }
  assemblyHint?: string
  attachmentSummary?: string
  attachmentWarning?: boolean
}
const number = (n:number)=>Math.round(n).toLocaleString()

export function AssemblyWorkspace({connectorOverrides,selectedConnectorIds,onSelectConnector,panels,connections,selectedIds,choosePanel,onMove,movementEnabled,onDragStart,onDragMove,onDragEnd,dragging,dragSnap,previewPanels,previewConnections,view,showGrid,showDimensions,exploded,realisticPreview,fitSignal,frameSignal,zoomSignal,setRealisticPreview,leftOpen,rightOpen,setLeftOpen,setRightOpen,setShowDimensions,setShowGrid,setView,setZoomSignal,setFitSignal,setExploded,onRotate,addPanel,onAutoConnect,autoConnectDisabled,isAttaching,attachmentSide,visibleBounds,hasVisiblePanels,onDrillIn,attachmentHandles,onAttachmentPreview,onAttachmentCommit,attachmentBoundsPanels,suppressedConnectionIds=[],suppressedPanelIds=[],editingAssembly,assemblyHint,attachmentSummary,attachmentWarning}: Props) {
  const [panMode, setPanMode] = useState(false)
  const previewIds = new Set([...suppressedPanelIds, ...previewPanels.map(panel => panel.id)])
  const replacedConnectionIds = new Set([...suppressedConnectionIds,...previewConnections.map(connection=>connection.id)])
  const sceneProps: SceneProps = realisticPreview
    ? { panels, connections, selectedIds, onSelect: choosePanel, view: 'perspective', showGrid: false, showDimensions, exploded: false, realisticPreview, fitSignal, frameSignal, zoomSignal }
    : { panels: panels.filter(panel => !previewIds.has(panel.id)), connections: connections.filter(connection => !replacedConnectionIds.has(connection.id) && !previewIds.has(connection.childId) && !previewIds.has(connection.parentId)), selectedIds, onSelect: choosePanel, onDrillIn, attachmentHandles, onAttachmentPreview, onAttachmentCommit, attachmentBoundsPanels, previewPanels, previewConnections, view, showGrid, showDimensions, exploded, realisticPreview, fitSignal, frameSignal, zoomSignal }
  return <main className="workspace" aria-label="3D assembly workspace">
      <WorkspaceToolbar onAutoConnect={onAutoConnect} autoConnectDisabled={autoConnectDisabled} panels={panels} realisticPreview={realisticPreview} setRealisticPreview={setRealisticPreview} onRotate={onRotate} leftOpen={leftOpen} setLeftOpen={setLeftOpen} rightOpen={rightOpen} setRightOpen={setRightOpen} showDimensions={showDimensions} setShowDimensions={setShowDimensions} showGrid={showGrid} setShowGrid={setShowGrid}/>
      <div className="scene-container"><Scene {...sceneProps} connectorOverrides={connectorOverrides} selectedConnectorIds={selectedConnectorIds} onSelectConnector={onSelectConnector} panMode={panMode} onMove={onMove} movementEnabled={movementEnabled} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} dragging={dragging} dragSnap={dragSnap}/></div>
      {!realisticPreview&&editingAssembly&&<div className="assembly-edit-breadcrumb"><Box size={15}/><strong>Editing {editingAssembly.name}</strong><span>Updates {editingAssembly.instanceCount} {editingAssembly.instanceCount===1?'instance':'instances'}</span><button className={rightOpen?'assembly-desktop-done':undefined} onClick={editingAssembly.onDone}>Done editing</button></div>}
      {!dragging&&!realisticPreview&&(assemblyHint||attachmentSummary)&&<div className={`assembly-workspace-hint ${editingAssembly?'has-breadcrumb':''} ${attachmentWarning?'has-warning':''}`} role="status">{assemblyHint}{attachmentSummary&&<strong>{attachmentSummary}</strong>}</div>}
      {dragging&&dragSnap?.warning&&<div className="assembly-workspace-hint has-warning" role="status"><strong>{dragSnap.warning}</strong>Release to attach · Esc to cancel</div>}
      {selectedIds.length>0&&!editingAssembly&&(!assemblyHint||movementEnabled)&&<div className="movement-hint" aria-live="polite">{movementEnabled?(dragging?<><span>{dragSnap?"Snapped · release to attach":"Moving selection · release to place"}</span><kbd>Esc</kbd><span>Cancel</span></>:<><kbd>Ctrl + drag</kbd><span>Move & snap</span><span>·</span><kbd>↑ ↓ ← →</kbd><span>1 cm</span><span>·</span><kbd>Shift</kbd><span>10 cm</span></>):<span>{isAttaching?'Finish attaching to move panels':exploded?'Close exploded view to move panels':'Select a panel in the preview to move it'}</span>}</div>}
      {!realisticPreview&&isAttaching&&<div className="preview-badge"><span className="pulsing-dot"/>Attachment preview <span>·</span> {attachmentSide} side</div>}
      {!realisticPreview&&!panels.length&&<div className="canvas-empty"><h2>Something good starts here.</h2><p>Bring a panel. Build an idea.</p><Button onClick={addPanel}><Plus size={18}/>Add your first panel</Button></div>}
      {realisticPreview&&<div className="room-details" aria-label="Room scale reference">
        <span className="room-eyebrow"><Sun size={14}/>THE DAYLIGHT ROOM</span>
        <h2>{hasVisiblePanels?'Your design, in proportion.':'A room for your next idea.'}</h2>
        {hasVisiblePanels?<p className="room-dimensions">{number(visibleBounds.width)} × {number(visibleBounds.height)} × {number(visibleBounds.depth)} <span>mm · W × H × D</span></p>:<p>Add or show a panel in Studio to see it here.</p>}
        <p className="room-scale-note">Life-size setting · floor lamp 165 cm tall</p>
      </div>}
      <ViewControls panMode={panMode} setPanMode={setPanMode} realisticPreview={realisticPreview} view={view} setView={setView} setZoomSignal={setZoomSignal} setFitSignal={setFitSignal} exploded={exploded} setExploded={setExploded}/>
      {!realisticPreview&&<div className="axis-label" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><i/><b/></div>}
    </main>
}

function ViewControls({panMode,setPanMode,realisticPreview,view,setView,setZoomSignal,setFitSignal,exploded,setExploded}: Pick<Props, 'realisticPreview' | 'view' | 'setView' | 'setZoomSignal' | 'setFitSignal' | 'exploded' | 'setExploded'> & { panMode: boolean; setPanMode: Setter<boolean> }) {
  return <div className="canvas-bottom">
        <div className="canvas-instructions"><MousePointer2 size={14}/><span>{panMode || (!realisticPreview && view !== 'perspective') ? 'Drag to pan' : 'Drag to orbit'}<span className="instruction-dot">·</span>Scroll to zoom<span className="instruction-dot">·</span>Right-drag to pan{!realisticPreview&&<><span className="instruction-dot">·</span>Shift-click to multi-select</>}</span></div>
        <div className="view-controls">
          {realisticPreview?<span className="room-view-label"><House size={15}/>Room view</span>:<div className="view-select"><Box size={16}/><select aria-label="Camera view" value={view} onChange={e=>setView(e.target.value as CameraView)}><option value="perspective">Perspective</option><option value="front">Front</option><option value="top">Top</option><option value="right">Right</option></select><ChevronDown size={13}/></div>}
          <IconButton label="Pan view" aria-pressed={panMode} className={panMode?'is-active':''} onClick={()=>setPanMode(v=>!v)}><Hand size={17}/></IconButton>
          <span className="control-divider"/><IconButton label="Zoom out" onClick={()=>setZoomSignal(v=>({direction:-1,key:v.key+1}))}><Minus size={17}/></IconButton><IconButton label="Zoom in" onClick={()=>setZoomSignal(v=>({direction:1,key:v.key+1}))}><Plus size={17}/></IconButton><span className="control-divider"/>
          <IconButton label={realisticPreview?'Reset room view (F)':'Fit assembly (F)'} onClick={()=>setFitSignal(v=>v+1)}><Maximize size={17}/></IconButton>
          {!realisticPreview&&<IconButton label="Exploded view" aria-pressed={exploded} className={exploded?'is-active':''} onClick={()=>setExploded(v=>!v)}><Expand size={17}/></IconButton>}
        </div>
      </div>
}

function WorkspaceToolbar({onAutoConnect,autoConnectDisabled,panels,realisticPreview,setRealisticPreview,onRotate,leftOpen,setLeftOpen,rightOpen,setRightOpen,showDimensions,setShowDimensions,showGrid,setShowGrid}: Pick<Props, 'onAutoConnect' | 'autoConnectDisabled' | 'panels' | 'realisticPreview' | 'setRealisticPreview' | 'onRotate' | 'leftOpen' | 'setLeftOpen' | 'rightOpen' | 'setRightOpen' | 'showDimensions' | 'setShowDimensions' | 'showGrid' | 'setShowGrid'>) {
  return <div className="workspace-top">
        <div className="preview-mode-switch" role="group" aria-label="Preview mode">
          <button aria-pressed={!realisticPreview} onClick={()=>setRealisticPreview(false)}><Box size={15}/>Studio</button>
          <button aria-pressed={realisticPreview} onClick={()=>setRealisticPreview(true)}><House size={15}/>Realistic preview</button>
        </div>
        <div className="workspace-options">
          <IconButton label="Auto-add connectors" disabled={autoConnectDisabled} onClick={onAutoConnect}><Link2 size={18}/></IconButton>
          <IconButton label="Rotate creation" disabled={!panels.length} onClick={onRotate}><RotateCw size={18}/></IconButton>
          {!realisticPreview&&!leftOpen&&<IconButton label="Open panel list" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={18}/></IconButton>}
          <Tooltip label="Show dimensions"><button className={`canvas-toggle ${showDimensions?'active':''}`} aria-label="Show dimensions" aria-pressed={showDimensions} onClick={()=>setShowDimensions(v=>!v)}><Ruler size={18}/></button></Tooltip>
          {!realisticPreview&&<Tooltip label="Show grid"><button className={`canvas-toggle ${showGrid?'active':''}`} aria-label="Show grid" aria-pressed={showGrid} onClick={()=>setShowGrid(v=>!v)}><Grid2X2 size={17}/></button></Tooltip>}
          {!realisticPreview&&!rightOpen&&<IconButton label="Open inspector" onClick={()=>setRightOpen(true)}><SlidersHorizontal size={18}/></IconButton>}
        </div>
      </div>
}
