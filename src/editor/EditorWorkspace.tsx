import { AssemblyWorkspace } from '@/components/AssemblyWorkspace'
import type { AttachmentSideGuideState } from '@/components/AttachmentSideGuide'
import type { BoxSelection } from '@/components/PreviewBoxSelection'
import type { ProjectDialog } from '@/components/ProjectDialogs'
import type { AssemblyAttachmentHandle } from '@/components/Scene'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { useObjectGesture } from '@/hooks/use-object-gesture'
import { useObjectPreview } from '@/hooks/use-object-preview'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { AssemblyAttachmentTarget } from '@/lib/assemblies'
import { editConnectors } from '@/lib/connector-selection'
import { getProjectBounds } from '@/lib/model'
import { getNiceValueStep } from '@/lib/nice-values'
import { SnapSettings } from '@/lib/preview-snap'
import type { AttachmentOptions,CameraView,Connection,ConstructionObjects,DesignConstraint,Panel,Project,Vec3 } from '@/lib/types'


interface EditorWorkspaceProps {
  objectMode: boolean
  displayedObjects: ConstructionObjects
  objectPreview: ReturnType<typeof useObjectPreview>
  objects: ReturnType<typeof useConstructionEditor>
  objectInteractionDisabled: boolean
  objectGesture: ReturnType<typeof useObjectGesture>
  boxSelectActive: boolean
  snapSettings: SnapSettings
  chooseObject: (id: string|null,additive?: boolean) => void
  project: Project
  boxSelectAvailable: boolean
  selectionKind: "panels" | "connectors"
  toggleBoxSelect: () => void
  selectBox: (selection: BoxSelection,additive: boolean) => void
  cancelBoxSelect: () => void
  resolveBoxPanelIds: (ids: string[]) => string[]
  resolveBoxConnectorIds: (ids: string[]) => string[]
  resize: ReturnType<typeof usePreviewResize>
  drag: ReturnType<typeof usePreviewDrag>
  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>
  constraints: ReturnType<typeof useDesignConstraints>
  modalOpen: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  inspectorTab: "panel" | "attach"
  realisticPreview: boolean
  selectedConnectorIds: string[]
  chooseConnector: (id: string,additive?: boolean) => void
  selectedIds: string[]
  choosePanel: (id: string|null,additive?: boolean) => void
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; } | null>>
  constraintPreviewProject: Project|undefined
  displayPanels: Panel[]
  openConstraints: (add?: boolean) => void
  pickingConstraint: boolean
  addAutoConnectors: () => void
  panels: Panel[]
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  moveSelection: (delta: Vec3,repeat: boolean) => void
  movementEnabled: boolean
  previewPanels: Panel[]
  previewConnections: Connection[]
  view: CameraView
  showGrid: boolean
  showDimensions: boolean
  exploded: boolean
  fitSignal: number
  frameSignal: number
  zoomSignal: { direction: number; key: number }
  setRealisticPreview: React.Dispatch<React.SetStateAction<boolean>>
  leftOpen: boolean
  rightOpen: boolean
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setShowDimensions: React.Dispatch<React.SetStateAction<boolean>>
  setShowGrid: React.Dispatch<React.SetStateAction<boolean>>
  setView: React.Dispatch<React.SetStateAction<CameraView>>
  setZoomSignal: React.Dispatch<React.SetStateAction<{ direction: number; key: number; }>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  setDialog: React.Dispatch<React.SetStateAction<ProjectDialog>>
  addPanel: () => void
  selected: Panel|undefined
  attachment: AttachmentOptions
  attachmentSideGuide: AttachmentSideGuideState|undefined
  visibleBounds: ReturnType<typeof getProjectBounds>
  hasVisiblePanels: boolean
  inspectingConnectors: boolean
  validTargets: AssemblyAttachmentTarget[]
  assemblyHint: string|undefined
  attachmentSummary: string|undefined
  attachmentWarning: string|undefined
  assemblyCount: (definitionId: string) => number
}

export function EditorWorkspace({
  objectMode, displayedObjects, objectPreview, objects,
  objectInteractionDisabled, objectGesture, boxSelectActive, snapSettings,
  chooseObject, project, boxSelectAvailable, selectionKind,
  toggleBoxSelect, selectBox, cancelBoxSelect, resolveBoxPanelIds,
  resolveBoxConnectorIds, resize, drag, setSnapSettings,
  constraints, modalOpen, clipboard, assembly,
  inspectorTab, realisticPreview, selectedConnectorIds, chooseConnector,
  selectedIds, choosePanel, setContextMenu, constraintPreviewProject,
  displayPanels, openConstraints, pickingConstraint, addAutoConnectors,
  panels, commitWithInsertChecks, moveSelection, movementEnabled,
  previewPanels, previewConnections, view, showGrid,
  showDimensions, exploded, fitSignal, frameSignal,
  zoomSignal, setRealisticPreview, leftOpen, rightOpen,
  setLeftOpen, setRightOpen, setShowDimensions, setShowGrid,
  setView, setZoomSignal, setFitSignal, setExploded,
  setDialog, addPanel, selected, attachment,
  attachmentSideGuide, visibleBounds, hasVisiblePanels, inspectingConnectors,
  validTargets, assemblyHint, attachmentSummary, attachmentWarning,
  assemblyCount
}: EditorWorkspaceProps)  {
  const workspaceParts = getWorkspaceParts({ resize, drag, constraintPreviewProject, clipboard, assembly, project, displayPanels, previewPanels, previewConnections })
  const workspaceInteraction = getWorkspaceInteractionProps({ displayedObjects, objectPreview, objects, objectMode, objectInteractionDisabled, objectGesture, boxSelectActive, snapSettings, chooseObject, realisticPreview, choosePanel, constraints, modalOpen, assembly, panels, inspectorTab, attachmentSideGuide, assemblyCount })
  return <AssemblyWorkspace
    {...workspaceInteraction}
    {...workspaceParts}
    objectSelection={objectMode}
    objectPreviewStatus={objectPreviewStatus(objectGesture,objectPreview,objects,objectMode)}
    spaceConstraint={project.spaceConstraint}
    niceValueStep={getNiceValueStep(project.niceValues)}
    boxSelectActive={boxSelectActive&&boxSelectAvailable}
    boxSelectDisabled={!boxSelectAvailable}
    selectionKind={selectionKind}
    onToggleBoxSelect={toggleBoxSelect}
    onBoxSelect={selectBox}
    onBoxSelectCancel={cancelBoxSelect}
    resolveBoxPanelIds={resolveBoxPanelIds}
    resolveBoxConnectorIds={resolveBoxConnectorIds}
    snapProbe={resize.snapProbe}
    snapDirection={drag.snapDirection}
    snapSettings={snapSettings}
    setSnapSettings={setSnapSettings}
    onPreviewContextMenu={workspaceContextMenu({ objectMode, constraints, modalOpen, drag, resize, clipboard, assembly, inspectorTab, realisticPreview, selectedConnectorIds, chooseConnector, selectedIds, choosePanel, setContextMenu }) }
    selectedConnectorIds={selectedConnectorIds}
    onSelectConnector={chooseConnector}
    selectedIds={selectedIds}
    hasFloorConstraint={project.constraints?.some(rule => rule.enabled&&rule.kind==='floor')}
    designConstraint={constraints.activeRule}
    constraintPanelIds={constraints.highlightedPanelIds}
    onConstraints={() => openConstraints()}
    constraintEditing={constraints.editing}
    constraintPicking={pickingConstraint}
    onDragStart={drag.start}
    onDragMove={drag.move}
    onDragEnd={drag.end}
    dragging={drag.active}
    dragSnap={drag.snap}
    resizeHandles={resize.handles}
    onResizeStart={resize.start}
    onResizeMove={resize.move}
    onResizeEnd={resize.end}
    resizing={resize.active}
    resizeDistance={resize.distance}
    resizeLimited={resize.limited}
    repeatPreview={resize.repeatPreview}
    onAutoConnect={addAutoConnectors}
    onMoveConnectors={(slides,repeat) => commitWithInsertChecks(current => {
      let next=current
      for(const [id,slide] of Object.entries(slides)) next=editConnectors(next,[id],{ slide })
      return next
    },{ group: 'connector-move',repeat })}
    onMove={moveSelection}
    movementEnabled={movementEnabled}
    view={view}
    showGrid={showGrid}
    showDimensions={showDimensions}
    exploded={exploded}
    realisticPreview={realisticPreview}
    fitSignal={fitSignal}
    frameSignal={frameSignal}
    zoomSignal={zoomSignal}
    setRealisticPreview={next => { objects.cancel(); setRealisticPreview(next) } }
    leftOpen={leftOpen}
    rightOpen={rightOpen}
    setLeftOpen={setLeftOpen}
    setRightOpen={setRightOpen}
    setShowDimensions={setShowDimensions}
    setShowGrid={setShowGrid}
    setView={setView}
    setZoomSignal={setZoomSignal}
    setFitSignal={setFitSignal}
    setExploded={setExploded}
    onMoveCreation={() => setDialog('move')}
    onRescale={() => setDialog('rescale')}
    onRotate={() => setDialog('rotate')}
    addPanel={addPanel}
    isAttaching={inspectorTab==='attach'&&!!selected}
    attachmentSide={attachment.side}
    visibleBounds={visibleBounds}
    hasVisiblePanels={hasVisiblePanels}
    attachmentHandles={workspaceAttachmentHandles({ constraints, modalOpen, inspectingConnectors, clipboard, validTargets, assembly })}
    onAttachmentPreview={clipboard.active? clipboard.hover:assembly.hover}
    onAttachmentCommit={clipboard.active? clipboard.attach:assembly.attach}
    suppressedConnectionIds={clipboard.active? clipboard.suppressedConnectionIds:assembly.suppressedConnectionIds}
    suppressedPanelIds={clipboard.active? clipboard.suppressedPanelIds:assembly.suppressedPanelIds}
    attachmentBoundsPanels={clipboard.active? clipboard.boundsPanels:assembly.attachmentBoundsPanels}
    onDrillIn={constraints.editing? undefined:assembly.drillIn}
    assemblyHint={assemblyHint}
    attachmentSummary={attachmentSummary}
    attachmentWarning={!!attachmentWarning} />
}

interface WorkspaceContextMenuOptions {
  objectMode: boolean
  constraints: ReturnType<typeof useDesignConstraints>
  modalOpen: boolean
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  inspectorTab: string
  realisticPreview: boolean
  selectedConnectorIds: string[]
  chooseConnector: (id: string,additive?: boolean) => void
  selectedIds: string[]
  choosePanel: (id: string|null,additive?: boolean) => void
  setContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; } | null>>
}

function workspaceContextMenu({
  objectMode, constraints, modalOpen, drag,
  resize, clipboard, assembly, inspectorTab,
  realisticPreview, selectedConnectorIds, chooseConnector, selectedIds,
  choosePanel, setContextMenu
}: WorkspaceContextMenuOptions): ((target: { panelId?: string; connectorId?: string },x: number,y: number) => void)|undefined {
  return objectMode||constraints.editing||modalOpen||drag.active||resize.active||clipboard.active||assembly.placementActive||inspectorTab==='attach'? undefined:(target,x,y) => {
    if(target.connectorId&&!realisticPreview) { if(!selectedConnectorIds.includes(target.connectorId)) chooseConnector(target.connectorId)}
    else if(target.panelId!==undefined) { if(!target.panelId||!selectedIds.includes(target.panelId)) choosePanel(target.panelId||null)}
    setContextMenu({ x,y })
  }
}

interface WorkspaceAttachmentHandlesOptions {
  constraints: ReturnType<typeof useDesignConstraints>
  modalOpen: boolean
  inspectingConnectors: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  validTargets: AssemblyAttachmentTarget[]
  assembly: ReturnType<typeof useAssemblyEditor>
}

function workspaceAttachmentHandles({ constraints, modalOpen, inspectingConnectors, clipboard, validTargets, assembly }: WorkspaceAttachmentHandlesOptions): AssemblyAttachmentHandle[]|undefined {
  return !constraints.editing&&!modalOpen&&!inspectingConnectors? (clipboard.active? clipboard.targets:validTargets).map(target => ({ id: target.id,label: `${clipboard.active? (clipboard.inserting? `Attach ${clipboard.inserting} at`:'Paste at'):'Attach'} ${target.label}${target.warning? ` · ${target.warning}`:''}`,position: target.position,warning: target.warning,active: (clipboard.active? clipboard.hovered:assembly.target)?.id===target.id })):[]
}

function objectPreviewStatus(objectGesture: ReturnType<typeof useObjectGesture>,objectPreview: ReturnType<typeof useObjectPreview>,objects: ReturnType<typeof useConstructionEditor>,objectMode: boolean): string|undefined {
  return objectGesture.active? `Object ${objectGesture.resizing? 'resize':'move'}${objectGesture.limited? ' · limit reached':''} · release to apply · Esc to cancel`:objectPreview.error??(objectPreview.pending? 'Updating object preview…':objects.editing? 'Object preview · Apply to keep changes · Esc to cancel':objectMode&&objectPreview.surfaces?.some(surface => !surface.volume)? 'A selected operation may produce an empty shape. Edit its operands in the Objects list.':undefined)
}

interface GetWorkspacePartsOptions {
  resize: ReturnType<typeof usePreviewResize>
  drag: ReturnType<typeof usePreviewDrag>
  constraintPreviewProject: Project|undefined
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  project: Project
  displayPanels: Panel[]
  previewPanels: Panel[]
  previewConnections: Connection[]
}

function getWorkspaceParts({ resize, drag, constraintPreviewProject, clipboard, assembly, project, displayPanels, previewPanels, previewConnections }: GetWorkspacePartsOptions) {
  return {
    connectorOverrides: (resize.project??drag.project??constraintPreviewProject??clipboard.preview??assembly.preview??project).connectorOverrides,
    panels: resize.panels??drag.panels??displayPanels,
    connections: (resize.project??drag.project??constraintPreviewProject??project).connections,
    previewPanels: clipboard.active? clipboard.previewPanels:assembly.preview? assembly.previewPanels:previewPanels,
    previewConnections: clipboard.active? clipboard.previewConnections:assembly.preview? assembly.previewConnections:previewConnections
  }
}

interface GetWorkspaceInteractionPropsOptions {
  displayedObjects: ConstructionObjects
  objectPreview: ReturnType<typeof useObjectPreview>
  objects: ReturnType<typeof useConstructionEditor>
  objectMode: boolean
  objectInteractionDisabled: boolean
  objectGesture: ReturnType<typeof useObjectGesture>
  boxSelectActive: boolean
  snapSettings: SnapSettings
  chooseObject: (id: string|null,additive?: boolean) => void
  realisticPreview: boolean
  choosePanel: (id: string|null,additive?: boolean) => void
  constraints: { editing: boolean; openRequest: number; manageRequest: number; cancelRequest: number; onEditingChange: (value: boolean) => void; onPreview: (rule: DesignConstraint | null, anchorPanelId?: string | undefined) => void; onApply: (rule: DesignConstraint, anchorPanelId?: string | undefined) => boolean; previewProject: Project | undefined; previewError: string | undefined; previewSummary: string | undefined; activeRule: DesignConstraint | null; highlightedPanelIds: string[]; onHighlight: React.Dispatch<React.SetStateAction<DesignConstraint | null>>; open: () => void; manage: () => void; cancel: () => void; onRemove: (id: string) => void; onToggle: (id: string, enabled: boolean) => void; }
  modalOpen: boolean
  assembly: ReturnType<typeof useAssemblyEditor>
  panels: Panel[]
  inspectorTab: string
  attachmentSideGuide: AttachmentSideGuideState|undefined
  assemblyCount: (definitionId: string) => number
}

function getWorkspaceInteractionProps({
  displayedObjects, objectPreview, objects, objectMode,
  objectInteractionDisabled, objectGesture, boxSelectActive, snapSettings,
  chooseObject, realisticPreview, choosePanel, constraints,
  modalOpen, assembly, panels, inspectorTab,
  attachmentSideGuide, assemblyCount
}: GetWorkspaceInteractionPropsOptions) {
  return {
    constructionLayer: { objects: displayedObjects,surfaces: objectPreview.surfaces,selectedIds: objects.selectedIds,active: objectMode&&!objectInteractionDisabled,movementEnabled: objectMode&&!objectInteractionDisabled&&!objects.editing,gesture: objectGesture,boxSelecting: boxSelectActive,step: snapSettings.grid? snapSettings.spacing:10,onSelect: chooseObject,onMove: objects.move },
    choosePanel: objectMode&&!realisticPreview? (id: string | null,additive?: boolean) => { if(!id) objects.select(null,additive) } :choosePanel,
    autoConnectDisabled: constraints.editing||modalOpen||!!assembly.editingInstance||panels.length<2,
    attachmentSideGuide: inspectorTab==='attach'&&!modalOpen? attachmentSideGuide:undefined,
    editingAssembly: assembly.editingDefinition? { name: assembly.editingDefinition.name,instanceCount: assemblyCount(assembly.editingDefinition.id),onDone: assembly.done }:undefined
  }
}
