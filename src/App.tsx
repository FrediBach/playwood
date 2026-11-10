import { nextVisibility } from '@/lib/visibility'
import { createPreviewShortcutHandler,flattenPreviewMenuActions } from '@/lib/preview-shortcuts'
import { PanelOverlapDialog } from '@/components/PanelOverlapDialog'
import { EqualPanelSizesDialog } from '@/components/EqualPanelSizesDialog'
import { MovementAlternativesDialog } from '@/components/MovementAlternativesDialog'
import { ResizeAlternativesDialog } from '@/components/ResizeAlternativesDialog'
import { acceptMovementAlternative,acceptResizeAlternative } from '@/lib/structure-edit'
import { PanelPaletteProvider } from '@/components/PanelColorField'
import { PanelConnectionFitDialog } from '@/components/PanelConnectionFitDialog'
import { PreviewContextMenu } from '@/components/PreviewContextMenu'
import { suggestDesignConstraints } from '@/lib/constraint-suggestions'
import { ProjectHeader } from '@/components/ProjectHeader'
import { DirectorySyncDialog } from '@/components/DirectorySyncDialog'
import { ProjectStatus } from '@/components/ProjectStatus'
import { TrofastInspector } from '@/components/TrofastInspector'
import { NiceValuesContext } from '@/components/nice-values-context'
import { buildPreviewMenuActions } from '@/components/preview-menu-actions'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EditorConstraints } from '@/editor/EditorConstraints'
import { EditorConnectorInfill,EditorDialogs,EditorObjectConversion } from '@/editor/EditorDialogs'
import { EditorInspector,SelectionBuildTools } from '@/editor/EditorInspector'
import { EditorSidebar } from '@/editor/EditorSidebar'
import { EditorWorkspace } from '@/editor/EditorWorkspace'
import { createCloseHoleCommand,createConnectionCommands,createPanelInsertionCommands,getAssemblyPlacementFeedback } from '@/editor/attachment-commands'
import { contextMenuTitle } from '@/editor/context-menu-title'
import { createEditorKeyHandler } from '@/editor/editor-keyboard'
import { createProjectFileCommands } from '@/editor/project-file-commands'
import { createBoxSelectionCommands,createConnectorEditCommands,createListGroupingCommands,createObjectSelectionCommands,createPanelEditCommands,createPanelSelectionCommand,createSelectionCommands } from '@/editor/selection-commands'
import { useDisplayedPanels } from '@/editor/use-displayed-panels'
import { useConstraintActions } from '@/editor/use-editor-constraints'
import { canShowBuildTools,panelAttachmentAvailable,selectionMovementAvailable,useObjectInteractions } from '@/editor/use-editor-interactions'
import { useConnectorSelectionDetails,usePanelSelectionDetails } from '@/editor/use-editor-selection'
import { createPaletteActions,useEditorNotifications,useEditorState,useSelectionPruning } from '@/editor/use-editor-state'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useAttachmentPreview } from '@/hooks/use-attachment-preview'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { useConnectStroke } from '@/hooks/use-connect-stroke'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { useProject } from '@/hooks/use-project'
import { useDirectorySync } from '@/hooks/use-directory-sync'
import { useMaterialPrewarm } from '@/hooks/use-material-prewarm'
import { getAssemblyInstance } from '@/lib/assemblies'
import { findClosingPanelHoles } from '@/lib/close-holes'
import { resolvePanels } from '@/lib/model'
import { readSnapSettings } from '@/lib/preview-snap'
import { assertNoNewTrofastIssues } from '@/lib/trofast'
import type { Project } from '@/lib/types'
import { CheckCheck } from 'lucide-react'
import { useCallback,useEffect,useMemo,useState } from 'react'

export default function App() {
  useMaterialPrewarm()
  const {project,documentId,getSnapshot,commit,undo,redo,canUndo,canRedo,saveStatus,repairNotice}=useProject()
  const {
  overlapRepair, setOverlapRepair, equalSizes, setEqualSizes, assemblyTab, setAssemblyTab, selectedConnectorIds, setSelectedConnectorIds,
  connectorTypeError, setConnectorTypeError, selectedIds, setPanelSelection,
  setSelectedIds, setSelectedId, contextMenu, setContextMenu,
  constraintFooter, setConstraintFooter, projectConstraintsOpen, setProjectConstraintsOpen,
  constraintPicker, pickingConstraint, setPickingConstraint, panelEditError,
  setPanelEditError, closeContextMenu, toolRequest, setToolRequest,
  inspectorTab, setInspectorTab, trofastPreview, previewTrofast,
  dialog, setDialog, pendingConnectionFit, setPendingConnectionFit, resizeReview, setResizeReview, movementReview, setMovementReview,
  connectorInfill, setConnectorInfill, objectConversion, setObjectConversion,
  modalOpen, pendingTemplate, setPendingTemplate, draft,
  setDraft, attachTarget, setAttachTarget, attachment,
  setAttachment, attachmentSideHighlight, setAttachmentSideHighlight, view,
  setView, boxSelectActive, setBoxSelectActive, realisticPreview,
  setRealisticPreview, showGrid, setShowGrid, showDimensions,
  setShowDimensions, exploded, setExploded, fitSignal,
  setFitSignal, zoomSignal, setZoomSignal, frameSignal,
  setFrameSignal, leftOpen, setLeftOpen, rightOpen,
  setRightOpen, toast, setToast, importError,
  setImportError, importRef, assemblyImportRef, assemblyImportError,
  setAssemblyImportError
} = useEditorState(project)
    const panels=useMemo(()=>resolvePanels(project),[project])
  const selectionKey=selectedIds.join('/')
  useEffect(()=>setToolRequest(undefined),[selectionKey,setToolRequest])
  useEffect(()=>{if(selectionKey||selectedConnectorIds.length)setProjectConstraintsOpen(false)},[selectionKey,selectedConnectorIds,setProjectConstraintsOpen])
  const {
  selectedIdSet, selectedPanels, splitCounts, checkingSplits,
  gridCut, selectedFinishCoverages, selected, selectedId,
  groundPanelFit, attachmentSideGuide, connection, bounds,
  visibleBounds, hasVisiblePanels, issues
} = usePanelSelectionDetails({ selectedIds, panels, project, attachment, attachmentSideHighlight, setAttachmentSideHighlight, setAttachment })
    const {
  inspectingConnectors, physicalConnectors, connectorPanelFit, selectedConnectors,
  infillReason, openConnectorInfill, connectorCount, connectorSummary,
  selectionKind, managingProjectConstraints
}=useConnectorSelectionDetails({ project, selectedConnectorIds, selectedPanels, assemblyTab, projectConstraintsOpen, setConnectorInfill })
  const notify=useCallback((message:string)=>setToast(message),[setToast])
  const [snapSettings,setSnapSettings]=useState(readSnapSettings)
  const [connectMode,setConnectMode]=useState(false)
  const cancelConnect=useCallback(()=>setConnectMode(false),[])
  const objectMode=assemblyTab==='objects'
  const objects=useConstructionEditor({project,commit,notify,snapSettings})
  const constraints=useDesignConstraints({project,commit,notify})
  const closeProjectConstraints=()=>{
    setProjectConstraintsOpen(false);constraints.cancel()
    window.setTimeout(()=>document.querySelector<HTMLButtonElement>('button[aria-label="All constraints"]')?.focus(),0)
  }
  const commitWithInsertChecks=(change:(current:Project)=>Project,options?:{group:string;repeat:boolean})=>{
    try { commit(current=>assertNoNewTrofastIssues(current,change(current)),options);return true }
    catch(error){notify(error instanceof Error?error.message:'This edit needs more clearance for the TROFAST inserts.');return false}
  }
  useEffect(()=>{try{localStorage.setItem('playwood-snap',JSON.stringify(snapSettings))}catch{/* Storage may be unavailable. */}},[snapSettings])
  const drag=usePreviewDrag({project,selectedIds:inspectingConnectors?[]:selectedIds,commit,notify,snapSettings,select:setSelectedIds})
  const assembly=useAssemblyEditor({project,selectedIds,setSelectedIds,commit,notify,
    prepareSelection:()=>{setInspectorTab('panel');setRightOpen(true);setExploded(false);if(window.innerWidth<=900)setLeftOpen(false)},fit:()=>setFrameSignal(v=>v+1)})
  // Connector edits affect instance hardware, so leave shared-source editing without changing selection.
  useEffect(()=>{if(inspectingConnectors&&assembly.editingInstance)assembly.close()})
  const clipboard=useCopyPaste({project,selectedIds,selectedConnectorIds,commit,notify,
    prepare:()=>{assembly.clearPlacement();setInspectorTab('panel');setExploded(false);setRealisticPreview(false);setFrameSignal(v=>v+1)},
    select:ids=>{assembly.close();setSelectedIds(ids);setInspectorTab('panel');setRightOpen(true);setFrameSignal(v=>v+1)}})
  const assemblyCount=(definitionId:string)=>assembly.instances.filter(instance=>instance.definitionId===definitionId).length
  useEditorNotifications(repairNotice,notify,toast,setToast)
  useSelectionPruning(setPanelSelection,project,setSelectedConnectorIds,physicalConnectors)
  const { removeSelectedConnectors,selectConnectors,separateSelectedConnectors,chooseConnector,updateConnectorType }=createConnectorEditCommands({ modalOpen, assembly, commitWithInsertChecks, selectedConnectorIds, notify, commit, setSelectedConnectorIds, setConnectorTypeError, project, constraints, objectMode, objects, setAssemblyTab, clipboard, setPanelSelection, setInspectorTab, setRightOpen, setLeftOpen })
  const { updatePanel,updateMultiplePanels }=createPanelEditCommands({ selectedPanels, project, selectedId, assembly, commit, setPanelEditError, selectionKey, notify, selectedIds, setResizeReview, setMovementReview })
  const { duplicateSelected,deleteSelected,detachSelection,mergeSelection,splitSelection,distributeSelection,moveSelection }=createSelectionCommands({ assembly, commit, selectedIds, notify, project, setSelectedIds, setInspectorTab, inspectingConnectors, removeSelectedConnectors, selectedIdSet, setFrameSignal, setMovementReview })
  const { connectWithPanel,extendToGround,addAutoConnectors,acceptConnectionFit }=createConnectionCommands({ commit, clipboard, assembly, setInspectorTab, setExploded, selectedIds, setSelectedIds, notify, modalOpen, project, setPendingConnectionFit, pendingConnectionFit, groundPanelFit, setFitSignal, connectorPanelFit, setSelectedId, setRightOpen, selectedConnectors })
  const movementEnabled=!connectMode&&selectionMovementAvailable({ objectMode, constraints, clipboard, modalOpen, assembly, inspectingConnectors, realisticPreview, exploded, inspectorTab })
  const resize=usePreviewResize({project,selectedIds:inspectingConnectors?[]:selectedIds,selectedConnectorIds:inspectingConnectors?selectedConnectorIds:[],snapSettings,enabled:movementEnabled&&!drag.active&&!contextMenu,commit,notify,select:setSelectedId})
  const { boxSelectAvailable,objectInteractionDisabled,objectGesture,displayedObjects,objectPreview }=useObjectInteractions({ modalOpen, drag, resize, constraints, assembly, clipboard, realisticPreview, exploded, project, objects, objectMode, boxSelectActive, snapSettings, commit, notify, inspectorTab, hasVisiblePanels })
  const connectAvailable=!objectMode&&!modalOpen&&!constraints.editing&&!drag.active&&!resize.active&&!clipboard.active&&!assembly.editingInstance&&!assembly.placementActive&&!realisticPreview&&!exploded&&inspectorTab!=='attach'&&panels.filter(panel=>panel.visible).length>1
  const connect=useConnectStroke({project,enabled:connectMode&&connectAvailable,commit,notify,cancel:cancelConnect})
  useEffect(()=>{if(!connectAvailable)setConnectMode(false)},[connectAvailable])
  const toggleConnect=()=>{
    if(!connectAvailable)return
    closeContextMenu();setBoxSelectActive(false);setConnectMode(value=>!value)
    if(window.innerWidth<=900){setLeftOpen(false);setRightOpen(false)}
    window.setTimeout(()=>document.querySelector<HTMLCanvasElement>('canvas')?.focus(),0)
  }
  const cancelBoxSelect=useCallback(()=>setBoxSelectActive(false),[setBoxSelectActive])
  useEffect(()=>{setBoxSelectActive(false)},[project,view,realisticPreview,exploded,boxSelectAvailable,setBoxSelectActive])
  const toggleBoxSelect=()=>{
    if(!boxSelectAvailable)return
    closeContextMenu();cancelConnect();assembly.clearPlacement();setBoxSelectActive(active=>!active)
  }
  const { resolveBoxConnectorIds,selectBox,resolveBoxPanelIds,selectAll }=createBoxSelectionCommands({ inspectingConnectors, panels, assembly, project, physicalConnectors, setBoxSelectActive, objectMode, objects, setRightOpen, setInspectorTab, setPanelSelection, setSelectedConnectorIds })
  const objectControlsDisabled=objectInteractionDisabled||objectGesture.active
  const { chooseObject,changeAssemblyTab }=createObjectSelectionCommands({ objectControlsDisabled, objects, setRightOpen, setLeftOpen, drag, resize, objectGesture, modalOpen, clipboard, assembly, constraints, setProjectConstraintsOpen, setPickingConstraint, constraintPicker, setSelectedIds, setExploded, setAssemblyTab, setInspectorTab, closeContextMenu, selectedPanels, selectedConnectors })
  const canAttachPanel=!connectMode&&panelAttachmentAvailable({ selectedPanels, inspectingConnectors, assembly, clipboard, constraints, modalOpen, drag, resize, boxSelectActive, inspectorTab })
  const [previewShortcutHandler]=useState(createPreviewShortcutHandler)
  useEffect(()=>{
    const onKey=createEditorKeyHandler({ connectMode, cancelConnect, previewShortcut: e => previewShortcutHandler(e,flattenPreviewMenuActions(menuActions),closeContextMenu), previewShortcutsEnabled: !objectMode&&!modalOpen&&!constraints.editing&&!drag.active&&!resize.active&&!clipboard.active&&!assembly.target&&!assembly.placementActive&&!boxSelectActive&&inspectorTab!=='attach', modalOpen, constraints, pickingConstraint, constraintPicker, setPickingConstraint, setRightOpen, projectConstraintsOpen, closeProjectConstraints, objectMode, realisticPreview, redo, undo, objects, objectControlsDisabled, toggleBoxSelect, boxSelectActive, setSnapSettings, setFitSignal, boxSelectAvailable, canAttachPanel, startAttach, clipboard, inspectingConnectors, movementEnabled, drag, resize, assembly, selectedPanels, commit, selectedIds, notify, setRealisticPreview, selectAll, duplicateSelected, deleteSelected, setInspectorTab, setSelectedId })
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  })
  const {previewResult,previewProject,previewPanels,previewConnections,previewIssues,attachmentErrors}=useAttachmentPreview({project,selected,panels,draft,attachment,inspectorTab,attachTarget})
  const choosePanel=createPanelSelectionCommand({ objectMode, objects, setAssemblyTab, constraintPicker, setPickingConstraint, setRightOpen, constraints, selectedConnectors, setSelectedConnectorIds, setPanelSelection, setSelectedIds, clipboard, project, assembly, setInspectorTab })
  const { startAttach,addPanel,applyAttachment,updateConnection,addDraftPanel }=createPanelInsertionCommands({ objects, setAssemblyTab, clipboard, assembly, setDraft, project, setDialog, draft, notify, inspectingConnectors, selectedIds, commit, setSelectedId, setInspectorTab, setRightOpen, setFitSignal, selected, setAttachment, setAttachTarget, setAttachmentSideHighlight, setRealisticPreview, setExploded, previewProject, attachmentErrors, attachTarget, previewPanels, connection, commitWithInsertChecks })
  const { loadTemplate,insertModule,insertModuleDefinition,insertSavedAssembly,exportAssembly,startNewProject,closeProjectDialog,applyTemplate,exportName,exportProject,importProject,openProject,importAssembly }=createProjectFileCommands({ inspectingConnectors, selectedIds, clipboard, project, commit, assembly, setSelectedIds, setInspectorTab, setRightOpen, setExploded, setRealisticPreview, setFitSignal, notify, setAssemblyImportError, setPendingTemplate, dialog, setDialog, setProjectConstraintsOpen, constraints, pendingTemplate, closeContextMenu, setView, setAttachTarget, setAttachment, setImportError })
  const directorySync=useDirectorySync({project,documentId,getSnapshot,replaceProject:openProject,insertAssembly:definition=>{insertModuleDefinition(definition);setDialog(null)},notify})
  const instance=assembly.selectedInstance
  const holes=useMemo(()=>findClosingPanelHoles(project,selectedIds),[project,selectedIds])
  const closeHole=createCloseHoleCommand({ holes, setInspectorTab, setRightOpen, setToolRequest, selectionKey, project, selectedIds, commit, setSelectedIds, notify })
  const { validTargets,assemblyHint,attachmentSummary,attachmentWarning }=getAssemblyPlacementFeedback({ assembly, clipboard, instance, inspectingConnectors, exploded, realisticPreview })
  const loosePanels=panels.filter(panel=>!getAssemblyInstance(project,panel.id))

  const { groupSelected,listGrouping }=createListGroupingCommands({ project, selectConnectors, clipboard, assembly, setPanelSelection, setInspectorTab, setRightOpen, commit, setLeftOpen })

  const { canMenuAutoConnect,openConstraints }=useConstraintActions({ contextMenu, inspectingConnectors, assembly, project, selectedIds, objects, setAssemblyTab, notify, clipboard, closeContextMenu, selectedConnectorIds, setSelectedConnectorIds, setProjectConstraintsOpen, setInspectorTab, setRightOpen, setRealisticPreview, setExploded, setLeftOpen, constraints })
  const constraintSuggestions=useMemo(()=>contextMenu&&!inspectingConnectors&&!assembly.editingInstance?suggestDesignConstraints(project,selectedIds):[],[contextMenu,inspectingConnectors,assembly.editingInstance,project,selectedIds])
  const menuActions = buildPreviewMenuActions({
    constraintSuggestions, constraintsEditing: constraints.editing,
    project, panels, selectedPanels, selectedIds, selectedConnectorIds, selectedIdSet,
    inspectingConnectors, modalOpen, assembly, splitCounts, checkingSplits, canDivideGrid: !!gridCut, holes,
    canMenuAutoConnect, hasVisiblePanels, canAddConnectorsBetween: !infillReason, canConnectWithPanel: !!connectorPanelFit.result,
    canAttachPanel, canExtendToGround: !!groundPanelFit.result, canAttachCopy: validTargets.length > 0,
    actions: {
      cyclePanelVisibility: ()=>commit(current=>({...current,panels:current.panels.map(panel=>selectedIdSet.has(panel.id)?{...panel,...nextVisibility(panel)}:panel)})),
      lockPanelSizes: ()=>constraints.lockSizes(selectedIds),
      applyConstraintSuggestion: constraints.applySuggestion,
      equalizeSizes: ()=>setEqualSizes({source:project,ids:[...selectedIds]}),
      separateSelectedConnectors, addConnectorsBetween: openConnectorInfill, connectWithPanel, groupSelected, removeSelectedConnectors, openConstraints, startAttach,
      extendToGround, detachSelection, mergeSelection, splitSelection, distributeSelection, closeHole, duplicateSelected, deleteSelected,
      addPanel, addAutoConnectors, selectAll, copy: clipboard.copy,
      inspectConnectors: ()=>setRightOpen(true),
      inspectPanels: ()=>{setInspectorTab('panel');setRightOpen(true)},
      attachCopy: ()=>{clipboard.cancel();assembly.startAttach()},
      fitView: ()=>setFitSignal(v=>v+1),
      openTool: tool=>{setInspectorTab('panel');setRightOpen(true);setToolRequest({tool,selection:selectionKey,token:Date.now()})},
    },
  })

  const buildToolsProps: React.ComponentProps<typeof SelectionBuildTools> = { assembly, selectedPanels, selectedIds, gridCut, toolRequest, project, commit, setSelectedIds, notify, splitCounts, checkingSplits, splitSelection, mergeSelection, instance, holes, closeHole, addAutoConnectors, panels, modalOpen }
  const buildTools = renderBuildTools(buildToolsProps, clipboard, inspectorTab)
  const fittedConnectorPanel=connectorPanelFit.result?.project.panels.find(panel=>panel.id===connectorPanelFit.result?.panelId)
  const trofastInspector=selected?<TrofastInspector key={`${selected.id}:${JSON.stringify(selected.trofastInserts)}`} project={project} panel={selected} onApply={inserts=>updatePanel({trofastInserts:inserts})} onPreview={previewTrofast}/>:undefined
  const { constraintPreviewProject,displayPanels }=useDisplayedPanels({ trofastPreview, project, selectedId, inspectorTab, modalOpen, clipboard, assembly, exploded, constraints, setFrameSignal, panels })
  const editorConstraintsProps: React.ComponentProps<typeof EditorConstraints> = {
    panels, project, selectedIds, constraints, constraintPicker, setPickingConstraint, constraintFooter, setRightOpen,
    setSelectedIds, setFrameSignal
  }
  const constraintsInspector=<EditorConstraints {...editorConstraintsProps}/>

  const paletteActions = createPaletteActions(commit,project,setDraft)
  const editorSidebarProps: React.ComponentProps<typeof EditorSidebar> = {
    syncedProjects: directorySync.connected && directorySync.directoryName ? {
      directoryName: directorySync.directoryName, projects: directorySync.projects, readPreview: directorySync.readPreview,
      disabled: directorySync.busy || directorySync.loading || !!directorySync.pendingOpen,
      onOpen: name => { setDialog('sync'); void directorySync.openProject(name) },
    } : undefined,
    objects, objectControlsDisabled, chooseObject, setRightOpen, setFrameSignal, setLeftOpen, commit, notify, assemblyTab,
    onRepairPanel: panelId => setOverlapRepair({source:project,panelId}),
    changeAssemblyTab, listGrouping, panels, selectedIds, issues, choosePanel, selectedPanels, connectorCount,
    connectorSummary, assembly, setPanelSelection, selectAll, physicalConnectors, selectedConnectorIds, selectConnectors,
    setDialog, addPanel, loadTemplate, insertModule, instance, clipboard, insertSavedAssembly, setAssemblyImportError,
    assemblyImportRef, assemblyImportError
  }
  const editorWorkspaceProps: React.ComponentProps<typeof EditorWorkspace> = {
    connect, connectAvailable, toggleConnect,
    objectMode, displayedObjects, objectPreview, objects, objectInteractionDisabled, objectGesture, boxSelectActive,
    snapSettings, chooseObject, project, boxSelectAvailable, selectionKind, toggleBoxSelect, selectBox, cancelBoxSelect,
    resolveBoxPanelIds, resolveBoxConnectorIds, resize, drag, setSnapSettings, constraints, modalOpen, clipboard,
    assembly, inspectorTab, realisticPreview, selectedConnectorIds, chooseConnector, selectedIds, choosePanel,
    setContextMenu, constraintPreviewProject, displayPanels, openConstraints, pickingConstraint, addAutoConnectors,
    constraintsOverviewOpen: projectConstraintsOpen && rightOpen,
    panels, commitWithInsertChecks, moveSelection, movementEnabled, previewPanels, previewConnections, view, showGrid,
    showDimensions, exploded, fitSignal, frameSignal, zoomSignal, setRealisticPreview, leftOpen, rightOpen, setLeftOpen,
    setRightOpen, setShowDimensions, setShowGrid, setView, setZoomSignal, setFitSignal, setExploded, setDialog, addPanel,
    selected, attachment, attachmentSideGuide, visibleBounds, hasVisiblePanels, inspectingConnectors, validTargets,
    assemblyHint, attachmentSummary, attachmentWarning, assemblyCount
  }
  const editorInspectorProps: React.ComponentProps<typeof EditorInspector> = {
    objectMode, objects, inspectingConnectors, selectedConnectorIds, selectionKey, inspectorTab, instance, assembly,
    clipboard, managingProjectConstraints, selectedPanels, selected, setRightOpen, setInspectorTab, startAttach,
    applyAttachment, previewProject, attachmentErrors, attachment, assemblyCount, previewResult, constraints,
    setConstraintFooter, attachmentSummary, attachmentWarning, assemblyHint, closeProjectConstraints,
    projectConstraintsOpen, project, panels, commit, setFitSignal, notify, objectControlsDisabled, setObjectConversion,
    openConnectorInfill, infillReason, fittedConnectorPanel, selectedConnectors, commitWithInsertChecks,
    updateConnectorType, connectorTypeError, removeSelectedConnectors, connectWithPanel, modalOpen, connectorPanelFit,
    selectedIdSet, trofastInspector, buildTools, selectedFinishCoverages, validTargets, duplicateSelected, exportAssembly,
    deleteSelected, distributeSelection, panelEditError, openConstraints, constraintsInspector, issues,
    updateMultiplePanels, selectedIds, detachSelection, extendToGround, groundPanelFit, connection, updatePanel,
    updateConnection, loosePanels, draft, setDraft, setAttachment, attachTarget, setAttachTarget, previewIssues,
    attachmentSideGuide, addPanel
  }
  const editorDialogsProps: React.ComponentProps<typeof EditorDialogs> = {
    startNewProject, dialog, closeProjectDialog, draft, setDraft, loadTemplate, pendingTemplate, applyTemplate,
    exportName, notify, exportProject, project, importRef, importError, panels, connectorCount, issues, commit, assembly,
    setInspectorTab, setExploded, setDialog, setFitSignal, inspectingConnectors, selectedIds, addDraftPanel
  }
  return <NiceValuesContext value={project.niceValues}><PanelPaletteProvider {...paletteActions} project={project}><TooltipProvider delayDuration={350}><div className={`app-shell ${leftOpen?'':'left-closed'} ${rightOpen?'':'right-closed'} ${realisticPreview?'room-preview':''}`}>
    {objectConversion&&<EditorObjectConversion objectConversion={objectConversion} project={project} setObjectConversion={setObjectConversion} commit={commit} objects={objects} setSelectedIds={setSelectedIds} setInspectorTab={setInspectorTab} setRightOpen={setRightOpen} setFitSignal={setFitSignal} notify={notify}/>}
    <ProjectHeader projectName={project.name} saveStatus={directorySync.headerStatus??saveStatus} canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo}
      syncFolderName={directorySync.directoryName} syncConnected={directorySync.connected} syncNeedsAttention={!!directorySync.error}
      onNew={()=>setDialog('new')} onSync={()=>{closeContextMenu();setDialog('sync')}} onRename={name=>commit(p=>({...p,name}))} onHelp={()=>setDialog('help')} onTemplates={()=>setDialog('templates')} onImport={()=>{closeContextMenu();setImportError('');importRef.current?.click()}} onExport={()=>setDialog('export')} onBuy={()=>setDialog('buy')}/>

    <EditorSidebar {...editorSidebarProps}/>

    {connectorInfill&&<EditorConnectorInfill project={project} connectorInfill={connectorInfill} setConnectorInfill={setConnectorInfill} notify={notify} commitWithInsertChecks={commitWithInsertChecks}/>}
    {contextMenu&&<PreviewContextMenu {...contextMenu} title={contextMenuTitle(inspectingConnectors,selectedConnectors,instance,selectedPanels)} actions={menuActions} onClose={closeContextMenu}/>}
    <EditorWorkspace {...editorWorkspaceProps}/>

    <EditorInspector {...editorInspectorProps}/>

    <ProjectStatus panelCount={project.panels.length} connectorCount={connectorCount} issueCount={issues.length} bounds={bounds} onParts={()=>setDialog('parts')} onHelp={()=>setDialog('help')}/>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}</div>}

    {overlapRepair&&overlapRepair.source===project&&<PanelOverlapDialog {...overlapRepair} onCancel={()=>setOverlapRepair(null)} onApply={candidate=>{
      try { commit(current=>{if(current!==overlapRepair.source)throw new Error('The project changed. Reopen the overlap repair.');return candidate});setOverlapRepair(null);notify('Panel overlaps repaired. Undo is available.') }
      catch(error) { notify(error instanceof Error?error.message:'Could not repair panel overlaps.') }
    }}/>}
    {equalSizes&&equalSizes.source===project&&<EqualPanelSizesDialog {...equalSizes} onCancel={()=>setEqualSizes(null)} onApply={candidate=>{
      try { commit(current=>{if(current!==equalSizes.source)throw new Error('The project changed. Reopen Make sizes equal.');return candidate});setEqualSizes(null);notify('Panel sizes updated. Undo is available.') }
      catch(error) { notify(error instanceof Error?error.message:'These sizes could not be applied.') }
    }}/> }
    {movementReview&&movementReview.source===project&&<MovementAlternativesDialog review={movementReview} onCancel={()=>setMovementReview(null)} onConfirm={index=>{
      try { commit(current=>acceptMovementAlternative(current,movementReview,index)); setMovementReview(null); setPanelEditError(null); notify('Movement applied. Undo is available.') }
      catch(error) { setMovementReview(null); notify(error instanceof Error?error.message:'This move could not be applied.') }
    }}/>}
    {resizeReview&&resizeReview.source===project&&<ResizeAlternativesDialog review={resizeReview} onCancel={()=>setResizeReview(null)} onConfirm={index=>{
      try { commit(current=>acceptResizeAlternative(current,resizeReview,index)); setResizeReview(null); setPanelEditError(null); notify('Resize applied. Undo is available.') }
      catch(error) { setResizeReview(null); notify(error instanceof Error?error.message:'This resize could not be applied.') }
    }}/>}
    <PanelConnectionFitDialog adjustments={pendingConnectionFit?.fit.adjustments} adjustment={pendingConnectionFit?.fit.adjustment} operations={pendingConnectionFit?.fit.result} onConfirm={acceptConnectionFit} onCancel={()=>setPendingConnectionFit(null)}/>
    <EditorDialogs {...editorDialogsProps} dialog={dialog==='sync'?null:dialog}/>
    <DirectorySyncDialog {...directorySync} open={dialog==='sync'} onClose={()=>{directorySync.cancelOpen();setDialog(null)}}
      assemblyOptions={assembly.instances.map(item=>({id:item.id,name:item.name}))}
      onChoose={()=>void directorySync.choose()} onResync={()=>void directorySync.resync()} onForget={()=>void directorySync.forget()}
      onSave={()=>void directorySync.save()} onDuplicate={()=>void directorySync.duplicate()} onAutosave={directorySync.setAutosave}
      onOpenProject={name=>void directorySync.openProject(name)} onDuplicateProject={name=>void directorySync.duplicate(name)}
      onConfirmOpen={save=>void directorySync.confirmOpen(save)} onCancelOpen={directorySync.cancelOpen}
      onInsertAssembly={name=>void directorySync.insertAssembly(name)} onExportAssembly={id=>void directorySync.exportAssembly(id)}
      onImportAssembly={file=>void directorySync.importAssembly(file)}/>
    <input ref={importRef} type="file" accept=".json,.playwood.json" className="visually-hidden" aria-label="Import project file" onChange={e=>{const file=e.target.files?.[0];if(file)void importProject(file);e.target.value=''}}/>
    <input ref={assemblyImportRef} type="file" accept=".json,.playwood-assembly.json" className="visually-hidden" aria-label="Import assembly file" onChange={e=>{const file=e.target.files?.[0];if(file)void importAssembly(file);e.target.value=''}}/>
  </div></TooltipProvider></PanelPaletteProvider></NiceValuesContext>
}

// An absent slot must stay undefined so inspectors can choose their default content.
function renderBuildTools(props: React.ComponentProps<typeof SelectionBuildTools>, clipboard: ReturnType<typeof useCopyPaste>, inspectorTab: 'panel' | 'attach') {
  return canShowBuildTools({ ...props, clipboard, inspectorTab }) ? <SelectionBuildTools {...props}/> : undefined
}
