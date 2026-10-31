import type { SnapSettings } from '@/lib/preview-snap'
import { useState, type Dispatch, type SetStateAction } from 'react'
import { Box, Grid2X2, House, Link2, PanelLeftOpen, Plus, RotateCw, Ruler, SlidersHorizontal, Sun } from 'lucide-react'
import Scene, { type SceneProps } from './Scene'
import { ViewportControls } from './ViewportControls'
import { IconButton } from './editor-controls'
import { Tooltip } from './ui/tooltip'
import { Button } from './ui/button'
import type { CameraView, Side } from '@/lib/types'
import { getProjectBounds } from '@/lib/model'

type Setter<T> = Dispatch<SetStateAction<T>>
interface Props extends Omit<SceneProps, 'onSelect' | 'previewPanels' | 'previewConnections'> {
  snapSettings: SnapSettings
  setSnapSettings: Setter<SnapSettings>
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

export function AssemblyWorkspace({snapSettings,setSnapSettings,onPreviewContextMenu,connectorOverrides,selectedConnectorIds,onSelectConnector,panels,connections,selectedIds,choosePanel,onMove,onMoveConnectors,movementEnabled,onDragStart,onDragMove,onDragEnd,dragging,dragSnap,resizeHandles,onResizeStart,onResizeMove,onResizeEnd,resizing,resizeDistance,resizeLimited,previewPanels,previewConnections,view,showGrid,showDimensions,exploded,realisticPreview,fitSignal,frameSignal,zoomSignal,setRealisticPreview,leftOpen,rightOpen,setLeftOpen,setRightOpen,setShowDimensions,setShowGrid,setView,setZoomSignal,setFitSignal,setExploded,onRotate,addPanel,onAutoConnect,autoConnectDisabled,isAttaching,attachmentSide,visibleBounds,hasVisiblePanels,onDrillIn,attachmentHandles,onAttachmentPreview,onAttachmentCommit,attachmentBoundsPanels,suppressedConnectionIds=[],suppressedPanelIds=[],editingAssembly,assemblyHint,attachmentSummary,attachmentWarning}: Props) {
  const [panMode, setPanMode] = useState(false)
  const previewIds = new Set([...suppressedPanelIds, ...previewPanels.map(panel => panel.id)])
  const replacedConnectionIds = new Set([...suppressedConnectionIds,...previewConnections.map(connection=>connection.id)])
  const sceneProps: SceneProps = realisticPreview
    ? { panels, connections, selectedIds, onSelect: choosePanel, view: 'perspective', showGrid: false, showDimensions, exploded: false, realisticPreview, fitSignal, frameSignal, zoomSignal }
    : { panels: panels.filter(panel => !previewIds.has(panel.id)), connections: connections.filter(connection => !replacedConnectionIds.has(connection.id) && !previewIds.has(connection.childId) && !previewIds.has(connection.parentId)), selectedIds, onSelect: choosePanel, onDrillIn, attachmentHandles, onAttachmentPreview, onAttachmentCommit, attachmentBoundsPanels, previewPanels, previewConnections, view, showGrid, showDimensions, exploded, realisticPreview, fitSignal, frameSignal, zoomSignal }
  const movementStatus = resizing ? <><span>{resizeLimited ? 'Resize limit reached' : 'Resizing panels'} · release to apply</span><kbd>Esc</kbd> Cancel</> : resizeHandles?.length ? 'Drag an arrow to pull or push · angles stay fixed' : selectedIds.length > 0 && !editingAssembly && (!assemblyHint || movementEnabled)
    ? movementEnabled
      ? dragging ? <><span>{dragSnap ? 'Snapped · release to attach' : 'Moving selection · release to place'}</span><kbd>Esc</kbd> Cancel</> : undefined
      : isAttaching ? 'Finish attaching to move panels' : exploded ? 'Close exploded view to move panels' : 'Select a panel in the preview to move it'
    : undefined
  const notice = dragging && dragSnap?.warning
    ? <div className="assembly-workspace-hint has-warning" role="status"><strong>{dragSnap.warning}</strong>Release to attach · Esc to cancel</div>
    : !dragging && !realisticPreview && (assemblyHint || attachmentSummary)
      ? <div className={`assembly-workspace-hint ${attachmentWarning ? 'has-warning' : ''}`} role="status">{assemblyHint}{attachmentSummary && <strong>{attachmentSummary}</strong>}</div>
      : undefined
  return <main className="workspace" aria-label="3D assembly workspace">
      <WorkspaceToolbar snapSettings={snapSettings} setSnapSettings={setSnapSettings} onAutoConnect={onAutoConnect} autoConnectDisabled={autoConnectDisabled} panels={panels} realisticPreview={realisticPreview} setRealisticPreview={setRealisticPreview} onRotate={onRotate} leftOpen={leftOpen} setLeftOpen={setLeftOpen} rightOpen={rightOpen} setRightOpen={setRightOpen} showDimensions={showDimensions} setShowDimensions={setShowDimensions} showGrid={showGrid} setShowGrid={setShowGrid}/>
      <div className="scene-container"><Scene {...sceneProps} snapSettings={snapSettings} onPreviewContextMenu={onPreviewContextMenu} connectorOverrides={connectorOverrides} selectedConnectorIds={selectedConnectorIds} onSelectConnector={onSelectConnector} panMode={panMode} onMove={onMove} onMoveConnectors={onMoveConnectors} movementEnabled={movementEnabled} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} dragging={dragging} dragSnap={dragSnap} resizeHandles={resizeHandles} onResizeStart={onResizeStart} onResizeMove={onResizeMove} onResizeEnd={onResizeEnd} resizing={resizing} resizeDistance={resizeDistance} resizeLimited={resizeLimited}/></div>
      {!realisticPreview&&editingAssembly&&<div className="assembly-edit-breadcrumb"><Box size={15}/><strong>Editing {editingAssembly.name}</strong><span>Updates {editingAssembly.instanceCount} {editingAssembly.instanceCount===1?'instance':'instances'}</span><button className={rightOpen?'assembly-desktop-done':undefined} onClick={editingAssembly.onDone}>Done editing</button></div>}
      {!realisticPreview&&isAttaching&&<div className="preview-badge"><span className="pulsing-dot"/>Attachment preview <span>·</span> {attachmentSide} side</div>}
      {!realisticPreview&&!panels.length&&<div className="canvas-empty"><h2>Something good starts here.</h2><p>Bring a panel. Build an idea.</p><Button onClick={addPanel}><Plus size={18}/>Add your first panel</Button></div>}
      <ViewportControls panMode={panMode} onTogglePan={()=>setPanMode(value=>!value)} realisticPreview={realisticPreview} view={view} onViewChange={setView}
        onZoom={direction=>setZoomSignal(value=>({direction,key:value.key+1}))} onFit={()=>setFitSignal(value=>value+1)}
        exploded={exploded} onToggleExploded={()=>setExploded(value=>!value)} status={movementStatus} notice={notice}
        showTransformShortcuts={selectedIds.length>0&&!!movementEnabled&&!editingAssembly&&!dragging&&!resizing}
        roomDetails={realisticPreview&&<div className="room-details" aria-label="Room scale reference">
        <span className="room-eyebrow"><Sun size={14}/>THE DAYLIGHT ROOM</span>
        <h2>{hasVisiblePanels?'Your design, in proportion.':'A room for your next idea.'}</h2>
        {hasVisiblePanels?<p className="room-dimensions">{number(visibleBounds.width)} × {number(visibleBounds.height)} × {number(visibleBounds.depth)} <span>mm · W × H × D</span></p>:<p>Add or show a panel in Studio to see it here.</p>}
        <p className="room-scale-note">Life-size setting · floor lamp 165 cm tall</p>
      </div>}/>
      {!realisticPreview&&<div className="axis-label" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><i/><b/></div>}
    </main>
}


function WorkspaceToolbar({snapSettings,setSnapSettings,onAutoConnect,autoConnectDisabled,panels,realisticPreview,setRealisticPreview,onRotate,leftOpen,setLeftOpen,rightOpen,setRightOpen,showDimensions,setShowDimensions,showGrid,setShowGrid}: Pick<Props, 'snapSettings' | 'setSnapSettings' | 'onAutoConnect' | 'autoConnectDisabled' | 'panels' | 'realisticPreview' | 'setRealisticPreview' | 'onRotate' | 'leftOpen' | 'setLeftOpen' | 'rightOpen' | 'setRightOpen' | 'showDimensions' | 'setShowDimensions' | 'showGrid' | 'setShowGrid'>) {
  return <div className="workspace-top">
        <div className="preview-mode-switch" role="group" aria-label="Preview mode">
          <button aria-pressed={!realisticPreview} onClick={()=>setRealisticPreview(false)}><Box size={15}/>Studio</button>
          <button aria-pressed={realisticPreview} onClick={()=>setRealisticPreview(true)}><House size={15}/>Realistic preview</button>
        </div>
        <div className="workspace-options">
          <details className="snap-controls" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false}}} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false}}>
            <summary aria-label="Snapping settings">Snap · {snapSettings.grid || snapSettings.geometry ? 'On' : 'Off'}</summary>
            <div className="snap-panel">
              <strong>Snapping</strong>
              <label><input type="checkbox" checked={snapSettings.grid} onChange={e=>setSnapSettings(v=>({...v,grid:e.target.checked}))}/>Global grid <kbd>G</kbd></label>
              <label>Spacing (mm)<input aria-label="Grid spacing (mm)" type="number" min="1" max="1000" value={snapSettings.spacing} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=1&&n<=1000)setSnapSettings(v=>({...v,spacing:n}))}}/></label>
              <label><input type="checkbox" checked={snapSettings.geometry} onChange={e=>setSnapSettings(v=>({...v,geometry:e.target.checked}))}/>Align to geometry <kbd>S</kbd></label>
              <label>Snap tolerance (mm)<input aria-label="Snap tolerance (mm)" type="number" min="1" max="100" value={snapSettings.tolerance} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=1&&n<=100)setSnapSettings(v=>({...v,tolerance:n}))}}/></label>
              <p>World-axis grid from the origin. Align panel boundaries, or connector centers when moving connectors. Both modes can be combined. Arrows move one grid spacing (Shift: ×10). Show grid displays guides. Joint limits take priority.</p>
            </div>
          </details>
          <IconButton label="Auto-add connectors" disabled={autoConnectDisabled} onClick={onAutoConnect}><Link2 size={18}/></IconButton>
          <IconButton label="Rotate creation" disabled={!panels.length} onClick={onRotate}><RotateCw size={18}/></IconButton>
          {!realisticPreview&&!leftOpen&&<IconButton label="Open panel list" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={18}/></IconButton>}
          <Tooltip label="Show dimensions"><button className={`canvas-toggle ${showDimensions?'active':''}`} aria-label="Show dimensions" aria-pressed={showDimensions} onClick={()=>setShowDimensions(v=>!v)}><Ruler size={18}/></button></Tooltip>
          {!realisticPreview&&<Tooltip label="Show grid"><button className={`canvas-toggle ${showGrid?'active':''}`} aria-label="Show grid" aria-pressed={showGrid} onClick={()=>setShowGrid(v=>!v)}><Grid2X2 size={17}/></button></Tooltip>}
          {!realisticPreview&&!rightOpen&&<IconButton label="Open inspector" onClick={()=>setRightOpen(true)}><SlidersHorizontal size={18}/></IconButton>}
        </div>
      </div>
}
