import { useRoomPreparation } from '@/hooks/use-room-preparation'
import { getProjectBounds } from '@/lib/model'
import { roomStyleFor } from '@/lib/room-floor-style'
import { planPreviewFurnishings,type FurnishingPlacement,type FurnishingPlan } from '@/lib/preview-furnishings'
import { summarizeFurnishedRoles } from '@/lib/preview-furnishing-roles'
import { FURNISHING_DENSITIES,FURNISHING_THEMES,type FurnishingDensity,type FurnishingTheme } from '@/lib/preview-furnishing-variation'
import { furnishingOptions,resetPreviewFurnishing,shufflePreviewFurnishing,updatePreviewFurnishing,usePreviewFurnishing,type PreviewFurnishingSettings } from '@/hooks/use-preview-furnishing'
import { RepeatPreview } from '@/lib/preview-resize'
import type { SnapSettings } from '@/lib/preview-snap'
import type { CameraView,Connection,Panel,Side,Vec3 } from '@/lib/types'
import { ArrowDownToLine,Box,ChevronDown,Grid2X2,House,Move,PanelLeftOpen,Plus,RotateCcw,RotateCw,Ruler,Scaling,Shuffle,SlidersHorizontal,Sun,Moon,Cloud } from 'lucide-react'
import { LIGHT_MOOD_LABELS, roomLighting } from '@/lib/room-lighting'
import type { RoomStyleInput } from '@/lib/room-floor-style'
import { useMemo,useState,type Dispatch,type SetStateAction } from 'react'
import { AttachmentSideGuideState } from './AttachmentSideGuide'
import { ConstructionLayerProps } from './ConstructionObjectLayer'
import { PreviewResizeHandle } from './PreviewResizeHandles'
import Scene,{ AssemblyAttachmentHandle,type SceneProps } from './Scene'
import { ViewportControls } from './ViewportControls'
import { IconButton } from './editor-controls'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'

type Setter<T> = Dispatch<SetStateAction<T>>
interface Props extends Omit<SceneProps, 'onSelect' | 'previewPanels' | 'previewConnections'> {
  rescaleSliders?: React.ReactNode
  /** Assembly and group names per panel, used as purpose hints by Auto furnish. */
  furnishingNames?: Record<string, string>
  attachmentChooser?: React.ReactNode
  objectPreviewStatus?: string
  boxSelectDisabled?: boolean
  onToggleBoxSelect?: () => void
  connectDisabled?: boolean
  onToggleConnect?: () => void
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
  onMoveCreation: () => void
  onRotate: () => void
  onRescale: () => void
  onConstraints: () => void
  constraintCount?: number
  constraintsOverviewOpen?: boolean
  constraintEditing?: boolean
  constraintPicking?: boolean
  addPanel: () => void
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

export function AssemblyWorkspace({
  connect, connectDisabled, onToggleConnect,
  objectSelection, constructionLayer, objectPreviewStatus, spaceConstraint,
  boxSelectActive, boxSelectDisabled, selectionKind, onToggleBoxSelect,
  onBoxSelect, onBoxSelectCancel, resolveBoxPanelIds, resolveBoxConnectorIds,
  snapProbe, snapDirection, snapSettings, niceValueStep,
  setSnapSettings, onPreviewContextMenu, connectorOverrides, selectedConnectorIds,
  onSelectConnector, panels, connections, selectedIds,
  choosePanel, onMove, onMoveConnectors, movementEnabled,
  onDragStart, onDragMove, onDragEnd, dragging,
  dragSnap, resizeHandles, onResizeStart, onResizeMove,
  onResizeEnd, resizing, resizeDistance, resizeLimited,
  repeatPreview, hasFloorConstraint, designConstraint, constraintPanelIds, overviewConstraints, constraintCount, constraintsOverviewOpen,
  onConstraints, constraintEditing, constraintPicking, previewPanels,
  previewConnections, view, showGrid, showDimensions,
  exploded, realisticPreview, fitSignal, frameSignal,
  zoomSignal, setRealisticPreview, leftOpen, rightOpen,
  setLeftOpen, setRightOpen, setShowDimensions, setShowGrid,
  setView, setZoomSignal, setFitSignal, setExploded,
  onMoveCreation, onRotate, onRescale, addPanel, rescaleSliders,
  isAttaching, attachmentSide,
  attachmentSideGuide, visibleBounds, hasVisiblePanels, onDrillIn,
  attachmentHandles, onAttachmentPreview, onAttachmentCommit, attachmentBoundsPanels,
  suppressedConnectionIds=[], suppressedPanelIds=[], editingAssembly, assemblyHint,
  attachmentSummary, attachmentWarning, attachmentChooser, furnishingNames
}: Props) {
  const [panMode, setPanMode] = useState(false)
  const preparation = useRoomPreparation(realisticPreview)
  const furnishing = usePreviewFurnishing()
  // Keep detection and all additional meshes out of the default preview path.
  const furnishingPlan = useMemo(() => preparation.renderRoom && furnishing.enabled ? planPreviewFurnishings(panels, furnishingOptions(furnishing, furnishingNames)) : null,
    [panels, preparation.renderRoom, furnishing, furnishingNames])
  const furnishings = furnishingPlan?.placements ?? NO_FURNISHINGS
  const roomStyle = useMemo(() => roomStyleFor(furnishing, furnishingPlan?.theme), [furnishing, furnishingPlan?.theme])
  const panelSelectionActive = (selectionKind ?? (selectedConnectorIds?.length ? 'connectors' : 'panels')) === 'panels'
  const sceneProps: SceneProps=workspaceSceneProps(suppressedPanelIds,previewPanels,suppressedConnectionIds,previewConnections,realisticPreview,panels,connections,selectedIds,choosePanel,showDimensions,furnishings,fitSignal,frameSignal,zoomSignal,onDrillIn,attachmentSideGuide,attachmentHandles,onAttachmentPreview,onAttachmentCommit,attachmentBoundsPanels,view,showGrid,exploded)
  const movementStatus = getMovementStatus(constraintPicking,constraintEditing,boxSelectActive,objectSelection,resizing,repeatPreview,resizeLimited,resizeHandles,panelSelectionActive,selectedIds,editingAssembly,assemblyHint,movementEnabled,dragging,dragSnap,isAttaching,exploded)
  const notice = getWorkspaceNotice(boxSelectActive,dragging,dragSnap,realisticPreview,assemblyHint,attachmentSummary,attachmentWarning)
  return <main className="workspace" aria-label="3D assembly workspace">
      <WorkspaceToolbar
    rescaleSliders={rescaleSliders}
    niceValueStep={niceValueStep}
    constraintCount={constraintCount}
    constraintsOverviewOpen={constraintsOverviewOpen}
    onConstraints={onConstraints}
    constraintEditing={constraintEditing}
    snapSettings={snapSettings}
    setSnapSettings={setSnapSettings}
    panels={panels}
    realisticPreview={realisticPreview}
    setRealisticPreview={setRealisticPreview}
    onMoveCreation={onMoveCreation}
    onRotate={onRotate}
    onRescale={onRescale}
    leftOpen={leftOpen}
    setLeftOpen={setLeftOpen}
    rightOpen={rightOpen}
    setRightOpen={setRightOpen}
    showDimensions={showDimensions}
    setShowDimensions={setShowDimensions}
    showGrid={showGrid}
    setShowGrid={setShowGrid}/>
      <div className="scene-container"><Scene
    {...sceneProps}
    realisticPreview={preparation.renderRoom}
    preparingRealisticPreview={preparation.preparing}
    onRoomRendered={preparation.onRendered}
    roomStyle={roomStyle}
    connect={connect}
    objectSelection={objectSelection}
    constructionLayer={realisticPreview||exploded?undefined:constructionLayer}
    spaceConstraint={spaceConstraint}
    hasFloorConstraint={hasFloorConstraint}
    designConstraint={designConstraint}
    overviewConstraints={overviewConstraints}
    constraintPanelIds={constraintPanelIds}
    boxSelectActive={boxSelectActive}
    selectionKind={selectionKind}
    onBoxSelect={onBoxSelect}
    onBoxSelectCancel={onBoxSelectCancel}
    resolveBoxPanelIds={resolveBoxPanelIds}
    resolveBoxConnectorIds={resolveBoxConnectorIds}
    snapProbe={snapProbe}
    snapDirection={snapDirection}
    snapSettings={snapSettings}
    niceValueStep={niceValueStep}
    onPreviewContextMenu={onPreviewContextMenu}
    connectorOverrides={connectorOverrides}
    selectedConnectorIds={selectedConnectorIds}
    onSelectConnector={onSelectConnector}
    panMode={panMode}
    onMove={onMove}
    onMoveConnectors={onMoveConnectors}
    movementEnabled={movementEnabled}
    onDragStart={onDragStart}
    onDragMove={onDragMove}
    onDragEnd={onDragEnd}
    dragging={dragging}
    dragSnap={dragSnap}
    resizeHandles={resizeHandles}
    onResizeStart={onResizeStart}
    onResizeMove={onResizeMove}
    onResizeEnd={onResizeEnd}
    resizing={resizing}
    resizeDistance={resizeDistance}
    resizeLimited={resizeLimited}
    repeatPreview={repeatPreview}/></div>
      <AssemblyEditingBreadcrumb realisticPreview={realisticPreview} editingAssembly={editingAssembly} rightOpen={rightOpen}/>
      {!realisticPreview&&isAttaching&&<div className="preview-badge"><span className="pulsing-dot"/>Attachment preview <span>·</span> {attachmentSide} side</div>}
      <WorkspaceEmptyState realisticPreview={realisticPreview} panels={panels} constructionLayer={constructionLayer} addPanel={addPanel}/>
      {!realisticPreview && objectPreviewStatus && <div className="object-preview-status" role="status">{objectPreviewStatus}</div>}
      <ViewportControls
    connectActive={connect?.gesture.active}
    connectDisabled={connectDisabled}
    onConnect={onToggleConnect}
    boxSelectActive={boxSelectActive}
    boxSelectDisabled={boxSelectDisabled}
    onBoxSelect={onToggleBoxSelect}
    panMode={panMode}
    onTogglePan={()=>setPanMode(value=>!value)}
    realisticPreview={realisticPreview}
    view={view}
    onViewChange={setView}
    onZoom={direction=>setZoomSignal(value=>({direction,key:value.key+1}))}
    onFit={()=>setFitSignal(value=>value+1)}
    exploded={exploded}
    onToggleExploded={()=>setExploded(value=>!value)}
    status={connect?.gesture.active ? connect.panelIds.length ? undefined : <><span>Connect · drag between panels or click twice</span><kbd>Esc</kbd> Exit</> : movementStatus}
    notice={connect?.gesture.active ? undefined : notice}
    showTransformShortcuts={showTransformShortcuts(boxSelectActive,panelSelectionActive,selectedIds,movementEnabled,editingAssembly,dragging,resizing)}
    roomDetails={preparation.ready&&<RoomDetails hasVisiblePanels={hasVisiblePanels} visibleBounds={visibleBounds} furnishing={furnishing} plan={furnishingPlan} roomStyle={roomStyle}/>}/>
      {!realisticPreview&&<div className="axis-label" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><i/><b/></div>}
      {attachmentChooser}
    </main>
}


function showTransformShortcuts(boxSelectActive: boolean|undefined,panelSelectionActive: boolean,selectedIds: readonly string[],movementEnabled: boolean|undefined,editingAssembly: { name: string; instanceCount: number; onDone: () => void }|undefined,dragging: boolean|undefined,resizing: boolean|undefined): boolean|undefined {
  return !boxSelectActive&&panelSelectionActive&&selectedIds.length>0&&!!movementEnabled&&!editingAssembly&&!dragging&&!resizing
}

function WorkspaceEmptyState({ realisticPreview, panels, constructionLayer, addPanel }: { realisticPreview: boolean; panels: Panel[]; constructionLayer: ConstructionLayerProps|undefined; addPanel: () => void })  {
  return !realisticPreview&&!panels.length&&!constructionLayer?.objects.roots.length&&<div className="canvas-empty"><h2>Something good starts here.</h2><p>Bring a panel. Build an idea.</p><Button onClick={addPanel}><Plus size={18} />Add your first panel</Button></div>
}

function workspaceSceneProps(suppressedPanelIds: string[],previewPanels: Panel[],suppressedConnectionIds: string[],previewConnections: Connection[],realisticPreview: boolean,panels: Panel[],connections: Connection[],selectedIds: readonly string[],choosePanel: (id: string|null,additive?: boolean) => void,showDimensions: boolean,furnishings: FurnishingPlacement[],fitSignal: number,frameSignal: number|undefined,zoomSignal: { direction: number; key: number },onDrillIn: ((panelId: string) => void)|undefined,attachmentSideGuide: AttachmentSideGuideState|undefined,attachmentHandles: AssemblyAttachmentHandle[]|undefined,onAttachmentPreview: ((id: string|null) => void)|undefined,onAttachmentCommit: ((id: string) => void)|undefined,attachmentBoundsPanels: Panel[]|undefined,view: CameraView,showGrid: boolean,exploded: boolean) {
  const previewIds=new Set([...suppressedPanelIds,...previewPanels.map(panel => panel.id)])
  const replacedConnectionIds=new Set([...suppressedConnectionIds,...previewConnections.map(connection => connection.id)])
  const sceneProps: SceneProps=realisticPreview
    ? { panels,connections,selectedIds,onSelect: choosePanel,view: 'perspective',showGrid: false,showDimensions,exploded: false,realisticPreview,furnishings,fitSignal,frameSignal,zoomSignal }
    :{ panels: panels.filter(panel => !previewIds.has(panel.id)),connections: connections.filter(connection => !replacedConnectionIds.has(connection.id)&&!previewIds.has(connection.childId)&&!previewIds.has(connection.parentId)),selectedIds,onSelect: choosePanel,onDrillIn,attachmentSideGuide,attachmentHandles,onAttachmentPreview,onAttachmentCommit,attachmentBoundsPanels,previewPanels,previewConnections,view,showGrid,showDimensions,exploded,realisticPreview,fitSignal,frameSignal,zoomSignal }
  return sceneProps
}

function AssemblyEditingBreadcrumb({ realisticPreview, editingAssembly, rightOpen }: { realisticPreview: boolean; editingAssembly: { name: string; instanceCount: number; onDone: () => void }|undefined; rightOpen: boolean })  {
  return !realisticPreview&&editingAssembly&&<div className="assembly-edit-breadcrumb"><Box size={15} /><strong>Editing {editingAssembly.name}</strong><span>Updates {editingAssembly.instanceCount} {editingAssembly.instanceCount===1? 'instance':'instances'}</span>{!rightOpen&&<button onClick={editingAssembly.onDone}>Done editing</button>}</div>
}

function getWorkspaceNotice(boxSelectActive: boolean|undefined,dragging: boolean|undefined,dragSnap: { position: Vec3; label: string; warning?: string }|null|undefined,realisticPreview: boolean,assemblyHint: string|undefined,attachmentSummary: string|undefined,attachmentWarning: boolean|undefined) {
  return boxSelectActive? undefined:dragging&&dragSnap?.warning
    ? <div className="assembly-workspace-hint has-warning" role="status"><strong>{dragSnap.warning}</strong>Release to attach · Esc to cancel</div>
    :!dragging&&!realisticPreview&&(assemblyHint||attachmentSummary)
      ? <div className={`assembly-workspace-hint ${attachmentWarning? 'has-warning':''}`} role="status">{assemblyHint}{attachmentSummary&&<strong>{attachmentSummary}</strong>}</div>
      :undefined
}

const NO_FURNISHINGS: FurnishingPlacement[] = []

function RoomDetails({ hasVisiblePanels, visibleBounds, furnishing, plan, roomStyle }: { hasVisiblePanels: boolean; visibleBounds: { width: number; height: number; depth: number; min: Vec3; max: Vec3 }; furnishing: PreviewFurnishingSettings; plan: FurnishingPlan|null; roomStyle: RoomStyleInput })  {
  const mood = useMemo(() => roomLighting(roomStyle).mood, [roomStyle])
  const MoodIcon = mood === 'evening' ? Moon : mood === 'overcast' ? Cloud : Sun
  const customised = furnishing.seed !== 0 || furnishing.density !== 'balanced' || furnishing.theme !== 'auto'
  return <div className="room-details" aria-label="Room scale reference">
    <span className="room-eyebrow" data-room-light={mood}><MoodIcon size={14} />{LIGHT_MOOD_LABELS[mood].toUpperCase()}</span>
    {hasVisiblePanels
      ? <p className="room-dimensions">{number(visibleBounds.width)} × {number(visibleBounds.height)} × {number(visibleBounds.depth)} <span>mm · W × H × D</span></p>
      : <><h2>A room for your next idea.</h2><p>Add or show a panel in Studio to see it here.</p></>}
    <p className="room-scale-note">Life-size · banana 22 cm · floor lamp 165 cm tall</p>
    <div className="room-furnishing-control">
      <div className="room-furnishing-header">
        <label className="room-furnishing-switch"><input type="checkbox" checked={furnishing.enabled} onChange={event => updatePreviewFurnishing({ enabled: event.target.checked })} aria-label="Auto furnish" aria-describedby="room-furnishing-note" />Auto furnish</label>
        <span id="room-furnishing-note" className="visually-hidden">Preview only. Adds books, decor, table settings and people chosen by what each surface is for; never saved or exported as parts. May slow large previews.</span>
        {furnishing.enabled&&<div className="room-furnishing-actions">
          {customised&&<IconButton label="Reset" tooltipLabel="Reset arrangement" className="room-furnishing-icon" onClick={resetPreviewFurnishing}><RotateCcw size={14}/></IconButton>}
          <IconButton label="Shuffle" tooltipLabel="Shuffle arrangement" className="room-furnishing-icon" onClick={shufflePreviewFurnishing}><Shuffle size={14}/></IconButton>
        </div>}
      </div>
      {furnishing.enabled&&<FurnishingOptionsControls furnishing={furnishing} plan={plan}/>}
    </div>
  </div>
}

function FurnishingOptionsControls({ furnishing, plan }: { furnishing: PreviewFurnishingSettings; plan: FurnishingPlan|null }) {
  const chosen = plan?.surfaces.filter(surface => surface.source === 'choice').length ?? 0
  const furnished = plan?.surfaces.flatMap(surface => surface.furnished && surface.role ? [surface.role] : []) ?? []
  return <>
    <div className="room-furnishing-options">
      <div className="room-furnishing-density" role="radiogroup" aria-label="Furnishing density">
        {FURNISHING_DENSITIES.map(option => <button key={option.id} type="button" role="radio" aria-checked={furnishing.density===option.id}
          onClick={() => updatePreviewFurnishing({ density: option.id as FurnishingDensity })}>{option.label}</button>)}
      </div>
      <span className="room-furnishing-theme">
        <select value={furnishing.theme} onChange={event => updatePreviewFurnishing({ theme: event.target.value as FurnishingTheme })} aria-label="Furnishing style">
          {FURNISHING_THEMES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <ChevronDown size={13} aria-hidden="true"/>
      </span>
    </div>
    <p className="room-furnishing-status" role="status">{furnished.length? summarizeFurnishedRoles(furnished):'No furnishings placed.'}{chosen? ` · ${chosen} set by you`:''}</p>
  </>
}

function getMovementStatus(constraintPicking: boolean|undefined,constraintEditing: boolean|undefined,boxSelectActive: boolean|undefined,objectSelection: boolean|undefined,resizing: boolean|undefined,repeatPreview: RepeatPreview|undefined,resizeLimited: boolean|undefined,resizeHandles: PreviewResizeHandle[]|undefined,panelSelectionActive: boolean,selectedIds: readonly string[],editingAssembly: { name: string; instanceCount: number; onDone: () => void }|undefined,assemblyHint: string|undefined,movementEnabled: boolean|undefined,dragging: boolean|undefined,dragSnap: { position: Vec3; label: string; warning?: string }|null|undefined,isAttaching: boolean,exploded: boolean) {
  return constraintPicking? <><span>Choose a panel for the constraint</span><kbd>Esc</kbd> Cancel picking</>:constraintEditing? <><span>Constraint preview · Apply to keep changes</span><kbd>Esc</kbd> Cancel</>:boxSelectActive? <><span>Box select {objectSelection? 'objects':'parts'} · drag to enclose</span><kbd>Shift</kbd> Add <kbd>Esc</kbd> Cancel</>:resizing? <><span>{repeatPreview? `Repeat · ${repeatPreview.count} ${repeatPreview.count===1? 'bay':'bays'}${resizeLimited? ' · limit':''}`:resizeLimited? 'Resize limit reached':'Resizing panels'} · release to apply</span><kbd>Esc</kbd> Cancel</>:resizeHandles?.length? resizeHandles.some(handle => handle.panelHandle)? 'Drag arrow to resize · Shift: one panel · Ctrl: repeat bay':resizeHandles.some(handle => handle.affectedPanelIds)? 'Drag arrow to stretch connecting panels · selection stays rigid':'Drag an arrow to pull or push · angles stay fixed':panelSelectionActive&&selectedIds.length>0&&!editingAssembly&&(!assemblyHint||movementEnabled)
    ? movementEnabled
      ? dragging? <><span>{dragSnap? 'Snapped · release to attach':'Moving selection · release to place'}</span><kbd>Esc</kbd> Cancel</>:undefined
      :isAttaching? 'Choose a labeled side in the preview or inspector':exploded? 'Close exploded view to move panels':'Select a panel in the preview to move it'
    :undefined
}

function WorkspaceToolbar({
  onConstraints, constraintEditing, constraintCount, constraintsOverviewOpen, niceValueStep, snapSettings, setSnapSettings,
  panels, realisticPreview, rescaleSliders,
  setRealisticPreview, onMoveCreation, onRotate, onRescale,
  leftOpen, setLeftOpen, rightOpen, setRightOpen,
  showDimensions, setShowDimensions, showGrid, setShowGrid
}: Pick<Props, 'rescaleSliders' | 'niceValueStep' | 'constraintCount' | 'constraintsOverviewOpen' | 'onConstraints' | 'constraintEditing' | 'snapSettings' | 'setSnapSettings' | 'panels' | 'realisticPreview' | 'setRealisticPreview' | 'onMoveCreation' | 'onRotate' | 'onRescale' | 'leftOpen' | 'setLeftOpen' | 'rightOpen' | 'setRightOpen' | 'showDimensions' | 'setShowDimensions' | 'showGrid' | 'setShowGrid'>) {
  return <div className="workspace-top">
        <div className="preview-controls"><div className="preview-mode-switch" role="group" aria-label="Preview mode">
          <button aria-pressed={!realisticPreview} onClick={()=>setRealisticPreview(false)}><Box size={15}/>Studio</button>
          <button aria-pressed={realisticPreview} onClick={()=>setRealisticPreview(true)}><House size={15}/>Realistic preview</button>
        </div>
        {rescaleSliders}</div>
        <div className="workspace-options">
          <details className="snap-controls" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false}}} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false}}>
            <summary aria-label="Snapping settings">Snap · {snapSettings.grid || snapSettings.geometry ? 'On' : 'Off'}</summary>
            <div className="snap-panel">
              <strong>Snapping</strong>
              <label><input type="checkbox" checked={snapSettings.grid} onChange={e=>setSnapSettings(v=>({...v,grid:e.target.checked}))}/>Global grid <kbd>G</kbd></label>
              <label>Spacing (mm)<input aria-label="Grid spacing (mm)" type="number" min="1" max="1000" value={snapSettings.spacing} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=1&&n<=1000)setSnapSettings(v=>({...v,spacing:n}))}}/></label>
              <label><input type="checkbox" checked={snapSettings.geometry} onChange={e=>setSnapSettings(v=>({...v,geometry:e.target.checked}))}/>Align to geometry <kbd>S</kbd></label>
              <label>Snap tolerance (mm)<input aria-label="Snap tolerance (mm)" type="number" min="1" max="100" value={snapSettings.tolerance} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=1&&n<=100)setSnapSettings(v=>({...v,tolerance:n}))}}/></label>
              <p>World-axis grid from the origin. Align panel boundaries, or connector centers when moving connectors. Object edits align source-box and panel boundaries. Both modes can be combined. In Studio, arrows move one grid spacing (Shift: ×10). Show grid displays panel guides. Joint limits take priority for furniture edits.</p>
            </div>
          </details>
          <IconButton label="All constraints" className="constraints-toolbar-button" aria-pressed={!!constraintsOverviewOpen} aria-description={`${constraintCount ?? 0} saved constraints, including paused rules and enabled build space`} disabled={constraintEditing} onClick={onConstraints}><SlidersHorizontal size={18}/>{!!constraintCount && <span className="constraints-toolbar-badge" aria-hidden="true">{constraintCount}</span>}</IconButton>
          <IconButton label="Move creation" disabled={constraintEditing||!panels.length} onClick={onMoveCreation}><Move size={18}/></IconButton>
          <IconButton label="Rescale creation" tooltipLabel={niceValueStep ? `Rescale creation · Only nice values enabled · ${niceValueStep} mm step` : 'Rescale creation'} className="constraints-toolbar-button" aria-description={niceValueStep ? `Only nice values enabled · ${niceValueStep} mm step` : 'Only nice values disabled'} disabled={constraintEditing||!panels.length} onClick={onRescale}><Scaling size={18}/>{!!niceValueStep && <span className="constraints-toolbar-badge" aria-hidden="true">{niceValueStep}</span>}</IconButton>
          <IconButton label="Rotate creation" disabled={constraintEditing||!panels.length} onClick={onRotate}><RotateCw size={18}/></IconButton>
          {!realisticPreview&&!leftOpen&&<IconButton label="Open panel list" tooltipSide="bottom" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={18}/></IconButton>}
          <Tooltip label="Show dimensions"><button className={`canvas-toggle ${showDimensions?'active':''}`} aria-label="Show dimensions" aria-pressed={showDimensions} onClick={()=>setShowDimensions(v=>!v)}><Ruler size={18}/></button></Tooltip>
          {!realisticPreview&&<Tooltip label="Show grid"><button className={`canvas-toggle ${showGrid?'active':''}`} aria-label="Show grid" aria-pressed={showGrid} onClick={()=>setShowGrid(v=>!v)}><Grid2X2 size={17}/></button></Tooltip>}
          {!realisticPreview&&!rightOpen&&<IconButton label="Open inspector" tooltipSide="bottom" onClick={()=>setRightOpen(true)}><SlidersHorizontal size={18}/></IconButton>}
          <IconButton className="ground-limit-toggle" label="Keep above ground" tooltipLabel={snapSettings.keepAboveGround !== false ? 'Keep above ground: ON · stop dragging and resize arrows at the floor' : 'Keep above ground: OFF · allow dragging and resize arrows below the floor'} aria-pressed={snapSettings.keepAboveGround !== false} onClick={()=>setSnapSettings(value=>({...value,keepAboveGround:value.keepAboveGround === false}))}><ArrowDownToLine size={18}/></IconButton>
        </div>
      </div>
}
