import { AssemblyBatchValues } from '@/components/AssemblyBatchValues'
import { AssemblyEditingInspector,AssemblyPartInspector } from '@/components/AssemblyEditingInspector'
import { AssemblyInspector,CreateAssemblyForm } from '@/components/AssemblyInspector'
import { AttachmentInspector } from '@/components/AttachmentInspector'
import type { AttachmentSideGuideState } from '@/components/AttachmentSideGuide'
import { CloseHoles } from '@/components/CloseHoles'
import { ConnectorInspector } from '@/components/ConnectorInspector'
import { ConstructionObjectInspector } from '@/components/ConstructionObjectInspector'
import { GridPanelSplit } from '@/components/GridPanelSplit'
import { InspectorDisclosure } from '@/components/InspectorPrimitives'
import { InspectorSidebar } from '@/components/InspectorSidebar'
import { MultiPanelInspector } from '@/components/MultiPanelInspector'
import { ParallelPanelSplit } from '@/components/ParallelPanelSplit'
import { SelectionLocation } from '@/components/SelectionLocation'
import { connectorLocation, objectLocation, panelLocation } from '@/lib/selection-location'
import { SinglePanelInspector } from '@/components/SinglePanelInspector'
import { SpaceConstraintInspector } from '@/components/SpaceConstraintInspector'
import { Button } from '@/components/ui/button'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { useProject } from '@/hooks/use-project'
import { AssemblyAttachmentTarget } from '@/lib/assemblies'
import { findClosingPanelHoles } from '@/lib/close-holes'
import { getConnectorPanelFit } from '@/lib/connect-panel'
import { editConnectors } from '@/lib/connector-selection'
import { getPanelGroundExtension } from '@/lib/extend-to-ground'
import { gridPanelCut } from '@/lib/grid-split'
import { orderedConnectors } from '@/lib/list-groups'
import { validateProject } from '@/lib/model'
import { objectConversionReason } from '@/lib/object-conversion'
import { parallelPanelCut } from '@/lib/parallel-panels'
import { updateSelectedConnections } from '@/lib/selection'
import type { AssemblyDefinition,AssemblyInstance,AttachmentOptions,Connection,ConnectorType,Panel,Project,ValidationIssue } from '@/lib/types'
import { Box,Copy,Link2,MousePointer2,Plus,Trash2 } from 'lucide-react'
import { type SetStateAction } from 'react'


interface EditorInspectorProps {
  objectMode: boolean
  objects: ReturnType<typeof useConstructionEditor>
  inspectingConnectors: boolean
  selectedConnectorIds: string[]
  selectionKey: string
  inspectorTab: "panel" | "attach"
  instance: AssemblyInstance|undefined
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  managingProjectConstraints: boolean
  selectedPanels: Panel[]
  selected: Panel|undefined
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  startAttach: () => void
  applyAttachment: () => void
  previewProject: Project|null
  attachmentErrors: ValidationIssue[]
  attachment: AttachmentOptions
  assemblyCount: (definitionId: string) => number
  previewResult: { project: null; error: string }|{ project: Project; error: string }
  constraints: ReturnType<typeof useDesignConstraints>
  setConstraintFooter: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>
  attachmentSummary: string|undefined
  attachmentWarning: string|undefined
  assemblyHint: string|undefined
  closeProjectConstraints: () => void
  projectConstraintsOpen: boolean
  project: Project
  panels: Panel[]
  commit: ReturnType<typeof useProject>['commit']
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  notify: (message: string) => void
  objectControlsDisabled: boolean
  setObjectConversion: React.Dispatch<React.SetStateAction<{ source: Project; ids: string[]; } | null>>
  openConnectorInfill: () => void
  infillReason: string
  fittedConnectorPanel: Panel|undefined
  selectedConnectors: ReturnType<typeof orderedConnectors>
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  updateConnectorType: (type: ConnectorType) => void
  connectorTypeError: { source: Project; selection: string; message: string }|null
  removeSelectedConnectors: () => void
  connectWithPanel: () => void
  modalOpen: boolean
  connectorPanelFit: ReturnType<typeof getConnectorPanelFit>
  selectedIdSet: Set<string>
  trofastInspector: React.JSX.Element | undefined
  buildTools: React.JSX.Element | undefined
  selectedFinishCoverages: number[]
  validTargets: AssemblyAttachmentTarget[]
  duplicateSelected: () => void
  exportAssembly: () => void
  deleteSelected: () => void
  distributeSelection: () => void
  panelEditError: { selection: string; message: string }|null
  openConstraints: (add?: boolean) => void
  constraintsInspector: React.JSX.Element
  issues: ReturnType<typeof validateProject>
  updateMultiplePanels: (patch: Partial<Panel>) => boolean
  selectedIds: string[]
  detachSelection: () => void
  extendToGround: () => void
  groundPanelFit: ReturnType<typeof getPanelGroundExtension>
  connection: Connection|undefined
  updatePanel: (patch: Partial<Panel>) => boolean
  updateConnection: (patch: Partial<AttachmentOptions>) => boolean
  loosePanels: Panel[]
  draft: Panel
  setDraft: React.Dispatch<React.SetStateAction<Panel>>
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
  attachTarget: string
  setAttachTarget: React.Dispatch<React.SetStateAction<string>>
  previewIssues: ValidationIssue[]
  attachmentSideGuide: AttachmentSideGuideState|undefined
  addPanel: () => void
}

export function EditorInspector({
  objectMode, objects, inspectingConnectors, selectedConnectorIds,
  selectionKey, inspectorTab, instance, assembly,
  clipboard, managingProjectConstraints, selectedPanels, selected,
  setRightOpen, setInspectorTab, startAttach, applyAttachment,
  previewProject, attachmentErrors, attachment, assemblyCount,
  previewResult, constraints, setConstraintFooter, attachmentSummary,
  attachmentWarning, assemblyHint, closeProjectConstraints, projectConstraintsOpen,
  project, panels, commit, setFitSignal,
  notify, objectControlsDisabled, setObjectConversion, openConnectorInfill,
  infillReason, fittedConnectorPanel, selectedConnectors, commitWithInsertChecks,
  updateConnectorType, connectorTypeError, removeSelectedConnectors, connectWithPanel,
  modalOpen, connectorPanelFit, selectedIdSet, trofastInspector,
  buildTools, selectedFinishCoverages, validTargets, duplicateSelected,
  exportAssembly, deleteSelected, distributeSelection, panelEditError,
  openConstraints, constraintsInspector, issues, updateMultiplePanels,
  selectedIds, detachSelection, extendToGround, groundPanelFit,
  connection, updatePanel, updateConnection, loosePanels,
  draft, setDraft, setAttachment, attachTarget,
  setAttachTarget, previewIssues, attachmentSideGuide, addPanel
}: EditorInspectorProps)  {
  return <InspectorSidebar
    selectionKey={inspectorSelectionKey({ objectMode, objects, inspectingConnectors, selectedConnectorIds, selectionKey, inspectorTab, instance, assembly, clipboard, managingProjectConstraints })}
    inspectorTab={inspectorTab}
    selectedCount={selectedPanels.length}
    hasSelection={!!selected}
    onCollapse={() => setRightOpen(false)}
    onPanel={() => setInspectorTab('panel')}
    startAttach={startAttach}
    applyAttachment={applyAttachment}
    canAttach={!!previewProject&&!attachmentErrors.length}
    attachmentType={attachment.type}
    contextLabel={inspectorContextLabel(objectMode,managingProjectConstraints,inspectingConnectors,assembly)}
    onDoneEditing={assembly.editingInstance? assembly.done:undefined}
    contextDetail={assembly.editingDefinition? `${assembly.editingDefinition.name} · affects ${assemblyCount(assembly.editingDefinition.id)} linked ${assemblyCount(assembly.editingDefinition.id)===1? 'instance':'instances'}`:undefined}
    attachmentStatus={previewResult.error||attachmentErrors[0]?.message||(previewProject? 'Panel thickness is compatible · Ready to attach':undefined)}
    footer={renderInspectorFooter({ constraints, setConstraintFooter, clipboard, attachmentSummary, assembly, attachmentWarning, assemblyHint, managingProjectConstraints, closeProjectConstraints })}>
    <EditorBuildSpace projectConstraintsOpen={projectConstraintsOpen} clipboard={clipboard} assembly={assembly} inspectorTab={inspectorTab} constraints={constraints} project={project} panels={panels} commit={commit} setFitSignal={setFitSignal} notify={notify}/>
    {!managingProjectConstraints && !assembly.editingInstance && inspectorTab === 'panel' && <SelectionLocation location={objectMode ? objectLocation(objects.objects, objects.selectedIds) : inspectingConnectors ? connectorLocation(project, selectedConnectorIds) : panelLocation(project, selectedIds)}/>}
    {objectMode? <ConstructionObjectInspector editor={objects} disabled={objectControlsDisabled} conversionReason={objectConversionReason(project,objects.selectedIds)} onConvert={() => setObjectConversion({ source: project,ids: [...objects.selectedIds] })} />:inspectingConnectors? <SelectedConnectorInspector
    openConnectorInfill={openConnectorInfill}
    infillReason={infillReason}
    panels={panels}
    fittedConnectorPanel={fittedConnectorPanel}
    selectedConnectors={selectedConnectors}
    commitWithInsertChecks={commitWithInsertChecks}
    selectedConnectorIds={selectedConnectorIds}
    updateConnectorType={updateConnectorType}
    connectorTypeError={connectorTypeError}
    project={project}
    removeSelectedConnectors={removeSelectedConnectors}
    connectWithPanel={connectWithPanel}
    assembly={assembly}
    modalOpen={modalOpen}
    connectorPanelFit={connectorPanelFit}/>:<>
      <SelectionInspector
    clipboard={clipboard}
    assembly={assembly}
    selectedIdSet={selectedIdSet}
    assemblyCount={assemblyCount}
    trofastInspector={trofastInspector}
    instance={instance}
    buildTools={buildTools}
    selectedPanels={selectedPanels}
    selectedFinishCoverages={selectedFinishCoverages}
    project={project}
    assemblyHint={assemblyHint}
    validTargets={validTargets}
    duplicateSelected={duplicateSelected}
    exportAssembly={exportAssembly}
    deleteSelected={deleteSelected}
    selected={selected}
    distributeSelection={distributeSelection}
    panelEditError={panelEditError}
    selectionKey={selectionKey}
    openConstraints={openConstraints}
    constraintsInspector={constraintsInspector}
    issues={issues}
    updateMultiplePanels={updateMultiplePanels}
    commitWithInsertChecks={commitWithInsertChecks}
    selectedIds={selectedIds}
    detachSelection={detachSelection}
    inspectorTab={inspectorTab}
    extendToGround={extendToGround}
    groundPanelFit={groundPanelFit}
    panels={panels}
    connection={connection}
    updatePanel={updatePanel}
    updateConnection={updateConnection}
    loosePanels={loosePanels}
    draft={draft}
    setDraft={setDraft}
    attachment={attachment}
    setAttachment={setAttachment}
    attachTarget={attachTarget}
    setAttachTarget={setAttachTarget}
    previewIssues={previewIssues}
    attachmentSideGuide={attachmentSideGuide}
    managingProjectConstraints={managingProjectConstraints}
    addPanel={addPanel}/>
      {!clipboard.active&&!assembly.editingInstance&&inspectorTab==='panel'&&(assembly.hasMembers||managingProjectConstraints)&&constraintsInspector}
    </>}
  </InspectorSidebar>
}

interface EditorBuildSpaceProps {
  projectConstraintsOpen: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  inspectorTab: "panel" | "attach"
  constraints: ReturnType<typeof useDesignConstraints>
  project: Project
  panels: Panel[]
  commit: ReturnType<typeof useProject>['commit']
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  notify: (message: string) => void
}

function EditorBuildSpace({ projectConstraintsOpen, clipboard, assembly, inspectorTab, constraints, project, panels, commit, setFitSignal, notify }: EditorBuildSpaceProps)  {
  return projectConstraintsOpen&&!clipboard.active&&!assembly.editingInstance&&inspectorTab==='panel'&&!constraints.editing&&<SpaceConstraintInspector key={JSON.stringify(project.spaceConstraint&&{ ...project.spaceConstraint,enabled: undefined })} value={project.spaceConstraint} panels={panels} onToggle={spaceConstraint => { commit(current => ({ ...current,spaceConstraint })); if(spaceConstraint.enabled) setFitSignal(v => v+1) } } onSave={spaceConstraint => { commit(current => ({ ...current,spaceConstraint })); setFitSignal(v => v+1); notify('Build space saved') } } />
}

interface SelectionInspectorProps {
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  selectedIdSet: Set<string>
  assemblyCount: (definitionId: string) => number
  trofastInspector: React.JSX.Element | undefined
  instance: AssemblyInstance|undefined
  buildTools: React.JSX.Element | undefined
  selectedPanels: Panel[]
  selectedFinishCoverages: number[]
  project: Project
  assemblyHint: string|undefined
  validTargets: AssemblyAttachmentTarget[]
  duplicateSelected: () => void
  exportAssembly: () => void
  deleteSelected: () => void
  selected: Panel|undefined
  distributeSelection: () => void
  panelEditError: { selection: string; message: string }|null
  selectionKey: string
  openConstraints: (add?: boolean) => void
  constraintsInspector: React.JSX.Element
  issues: ReturnType<typeof validateProject>
  updateMultiplePanels: (patch: Partial<Panel>) => boolean
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  selectedIds: string[]
  detachSelection: () => void
  inspectorTab: "panel" | "attach"
  extendToGround: () => void
  groundPanelFit: ReturnType<typeof getPanelGroundExtension>
  panels: Panel[]
  connection: Connection|undefined
  updatePanel: (patch: Partial<Panel>) => boolean
  updateConnection: (patch: Partial<AttachmentOptions>) => boolean
  loosePanels: Panel[]
  draft: Panel
  setDraft: React.Dispatch<React.SetStateAction<Panel>>
  attachment: AttachmentOptions
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
  attachTarget: string
  setAttachTarget: React.Dispatch<React.SetStateAction<string>>
  previewIssues: ValidationIssue[]
  attachmentSideGuide: AttachmentSideGuideState|undefined
  managingProjectConstraints: boolean
  addPanel: () => void
}

function SelectionInspector({
  clipboard, assembly, selectedIdSet, assemblyCount,
  trofastInspector, instance, buildTools, selectedPanels,
  selectedFinishCoverages, project, assemblyHint, validTargets,
  duplicateSelected, exportAssembly, deleteSelected, selected,
  distributeSelection, panelEditError, selectionKey, openConstraints,
  constraintsInspector, issues, updateMultiplePanels, commitWithInsertChecks,
  selectedIds, detachSelection, inspectorTab, extendToGround,
  groundPanelFit, panels, connection, updatePanel,
  updateConnection, loosePanels, draft, setDraft,
  attachment, setAttachment, attachTarget, setAttachTarget,
  previewIssues, attachmentSideGuide, managingProjectConstraints, addPanel
}: SelectionInspectorProps)  {
  if (clipboard.active) return <div className="multi-selection-heading"><h2>Place {clipboard.inserting||'copy'}</h2><p>Hover a + in the workspace to preview. Click to attach, or cancel to return.</p></div>
  if (assembly.editingInstance&&assembly.editingDefinition) return <AssemblyEditingInspector
    panels={assembly.editingDefinition.panels.filter(panel => selectedIdSet.has(assembly.editingInstance!.panelIds[panel.id]))}
    definitionPanels={assembly.editingDefinition.panels} parameters={assembly.editingDefinition.parameters} onParametersChange={assembly.parameters}
    name={assembly.editingDefinition.name} count={assemblyCount(assembly.editingDefinition.id)} onChange={assembly.updateDefinition} accessories={trofastInspector} />
  if (instance&&assembly.definition) return <SelectedAssemblyInspector definition={assembly.definition} buildTools={buildTools} instance={instance} assembly={assembly} assemblyCount={assemblyCount} selectedPanels={selectedPanels} selectedFinishCoverages={selectedFinishCoverages} project={project} assemblyHint={assemblyHint} validTargets={validTargets} duplicateSelected={duplicateSelected} exportAssembly={exportAssembly} clipboard={clipboard} deleteSelected={deleteSelected} />
  if (assembly.memberInstance&&selected&&assembly.definition) return <><AssemblyPartInspector panel={selected} instanceName={assembly.memberInstance.name} definitionName={assembly.definition.name} count={assemblyCount(assembly.definition.id)} onSelectInstance={() => assembly.select(assembly.memberInstance!.id)} onEdit={() => assembly.edit(assembly.memberInstance!.id)} />{buildTools}</>
  if (assembly.hasMembers) return <><div className="selected-heading"><Box size={15} /><span>MULTIPLE OBJECTS</span></div><p className="assembly-help">{selectedPanels.length} panels selected, including linked instances. Select one assembly to edit its design. Arrow keys move connected instances together.</p><AssemblyBatchValues key={selectionKey} project={project} selectedIds={selectedIds} onApply={assembly.applyParameterBatch}/>{buildTools}<div className="panel-actions"><Button variant="outline" onClick={duplicateSelected}><Copy size={15} />Duplicate selection</Button><Button variant="ghost" onClick={deleteSelected}><Trash2 size={15} />Remove</Button></div></>
  return <LoosePanelSelectionInspector
    selectedPanels={selectedPanels}
    distributeSelection={distributeSelection}
    panelEditError={panelEditError}
    selectionKey={selectionKey}
    openConstraints={openConstraints}
    constraintsInspector={constraintsInspector}
    buildTools={buildTools}
    project={project}
    issues={issues}
    updateMultiplePanels={updateMultiplePanels}
    commitWithInsertChecks={commitWithInsertChecks}
    selectedIds={selectedIds}
    duplicateSelected={duplicateSelected}
    deleteSelected={deleteSelected}
    detachSelection={detachSelection}
    selected={selected}
    inspectorTab={inspectorTab}
    trofastInspector={trofastInspector}
    extendToGround={extendToGround}
    groundPanelFit={groundPanelFit}
    panels={panels}
    connection={connection}
    updatePanel={updatePanel}
    updateConnection={updateConnection}
    loosePanels={loosePanels}
    draft={draft}
    setDraft={setDraft}
    attachment={attachment}
    setAttachment={setAttachment}
    attachTarget={attachTarget}
    setAttachTarget={setAttachTarget}
    previewIssues={previewIssues}
    attachmentSideGuide={attachmentSideGuide}
    managingProjectConstraints={managingProjectConstraints}
    addPanel={addPanel} />
}

interface LoosePanelSelectionInspectorProps {
  selectedPanels: Panel[]
  distributeSelection: () => void
  panelEditError: { selection: string; message: string }|null
  selectionKey: string
  openConstraints: (add?: boolean) => void
  constraintsInspector: React.JSX.Element
  buildTools: React.JSX.Element | undefined
  project: Project
  issues: ReturnType<typeof validateProject>
  updateMultiplePanels: (patch: Partial<Panel>) => boolean
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  selectedIds: string[]
  duplicateSelected: () => void
  deleteSelected: () => void
  detachSelection: () => void
  selected: Panel|undefined
  inspectorTab: "panel" | "attach"
  trofastInspector: React.JSX.Element | undefined
  extendToGround: () => void
  groundPanelFit: ReturnType<typeof getPanelGroundExtension>
  panels: Panel[]
  connection: Connection|undefined
  updatePanel: (patch: Partial<Panel>) => boolean
  updateConnection: (patch: Partial<AttachmentOptions>) => boolean
  loosePanels: Panel[]
  draft: Panel
  setDraft: React.Dispatch<React.SetStateAction<Panel>>
  attachment: AttachmentOptions
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
  attachTarget: string
  setAttachTarget: React.Dispatch<React.SetStateAction<string>>
  previewIssues: ValidationIssue[]
  attachmentSideGuide: AttachmentSideGuideState|undefined
  managingProjectConstraints: boolean
  addPanel: () => void
}

function LoosePanelSelectionInspector({
  selectedPanels, distributeSelection, panelEditError, selectionKey,
  openConstraints, constraintsInspector, buildTools, project,
  issues, updateMultiplePanels, commitWithInsertChecks, selectedIds,
  duplicateSelected, deleteSelected, detachSelection, selected,
  inspectorTab, trofastInspector, extendToGround, groundPanelFit,
  panels, connection, updatePanel, updateConnection,
  loosePanels, draft, setDraft, attachment,
  setAttachment, attachTarget, setAttachTarget, previewIssues,
  attachmentSideGuide, managingProjectConstraints, addPanel
}: LoosePanelSelectionInspectorProps)  {
  return <>
    {selectedPanels.length>1&&<MultiPanelInspector
    onDistribute={distributeSelection}
    editError={panelEditError?.selection===selectionKey? panelEditError.message:undefined}
    onManageConstraints={() => openConstraints()}
    constraints={constraintsInspector}
    buildTools={buildTools}
    panels={selectedPanels}
    connections={project.connections}
    issues={issues}
    onChange={updateMultiplePanels}
    onConnectionChange={patch => commitWithInsertChecks(p => updateSelectedConnections(p,selectedIds,patch))}
    onDuplicate={duplicateSelected}
    onDelete={deleteSelected}
    onDetach={detachSelection} />}
    {selected&&(inspectorTab==='panel'? <SelectedPanelInspector
    panelEditError={panelEditError}
    selectionKey={selectionKey}
    openConstraints={openConstraints}
    constraintsInspector={constraintsInspector}
    trofastInspector={trofastInspector}
    extendToGround={extendToGround}
    groundPanelFit={groundPanelFit}
    buildTools={buildTools}
    selected={selected}
    project={project}
    panels={panels}
    connection={connection}
    issues={issues}
    updatePanel={updatePanel}
    updateConnection={updateConnection}
    detachSelection={detachSelection}
    duplicateSelected={duplicateSelected}
    deleteSelected={deleteSelected} />:<AttachmentInspector selected={selected} panels={loosePanels} draft={draft} setDraft={setDraft} attachment={attachment} setAttachment={setAttachment} attachTarget={attachTarget} setAttachTarget={setAttachTarget} previewIssues={previewIssues} sideGuide={attachmentSideGuide!} />)}
    {!selectedPanels.length&&!managingProjectConstraints&&<div className="no-selection"><MousePointer2 size={28} /><h2>A little more detail.</h2><p>Select a panel or connector in the workspace<br />to make it your own.</p><Button variant="outline" onClick={addPanel}><Plus size={16} />Add a panel</Button></div>}
  </>
}

interface SelectedPanelInspectorProps {
  panelEditError: { selection: string; message: string }|null
  selectionKey: string
  openConstraints: (add?: boolean) => void
  constraintsInspector: React.JSX.Element
  trofastInspector: React.JSX.Element | undefined
  extendToGround: () => void
  groundPanelFit: ReturnType<typeof getPanelGroundExtension>
  buildTools: React.JSX.Element | undefined
  selected: Panel
  project: Project
  panels: Panel[]
  connection: Connection|undefined
  issues: ReturnType<typeof validateProject>
  updatePanel: (patch: Partial<Panel>) => boolean
  updateConnection: (patch: Partial<AttachmentOptions>) => boolean
  detachSelection: () => void
  duplicateSelected: () => void
  deleteSelected: () => void
}

function SelectedPanelInspector({
  panelEditError, selectionKey, openConstraints, constraintsInspector,
  trofastInspector, extendToGround, groundPanelFit, buildTools,
  selected, project, panels, connection,
  issues, updatePanel, updateConnection, detachSelection,
  duplicateSelected, deleteSelected
}: SelectedPanelInspectorProps)  {
  return <SinglePanelInspector
    editError={panelEditError?.selection===selectionKey? panelEditError.message:undefined}
    onManageConstraints={() => openConstraints()}
    constraints={constraintsInspector}
    accessories={trofastInspector}
    onExtendToGround={extendToGround}
    groundFitReason={groundPanelFit.reason}
    buildTools={buildTools}
    selected={selected}
    connected={project.connections.some(c => c.parentId===selected.id||c.childId===selected.id)}
    panels={panels}
    connection={connection}
    supportConnected={project.connections.some(c => c.role==='support'&&(c.parentId===selected.id||c.childId===selected.id))}
    issues={issues}
    updatePanel={updatePanel}
    updateConnection={updateConnection}
    onDetach={detachSelection}
    duplicateSelected={duplicateSelected}
    deleteSelected={deleteSelected} />
}

interface SelectedConnectorInspectorProps {
  openConnectorInfill: () => void
  infillReason: string
  panels: Panel[]
  fittedConnectorPanel: Panel|undefined
  selectedConnectors: ReturnType<typeof orderedConnectors>
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  selectedConnectorIds: string[]
  updateConnectorType: (type: ConnectorType) => void
  connectorTypeError: { source: Project; selection: string; message: string }|null
  project: Project
  removeSelectedConnectors: () => void
  connectWithPanel: () => void
  assembly: ReturnType<typeof useAssemblyEditor>
  modalOpen: boolean
  connectorPanelFit: ReturnType<typeof getConnectorPanelFit>
}

function SelectedConnectorInspector({
  openConnectorInfill, infillReason, panels, fittedConnectorPanel,
  selectedConnectors, commitWithInsertChecks, selectedConnectorIds, updateConnectorType,
  connectorTypeError, project, removeSelectedConnectors, connectWithPanel,
  assembly, modalOpen, connectorPanelFit
}: SelectedConnectorInspectorProps)  {
  return <ConnectorInspector
    onAddBetween={openConnectorInfill}
    infillReason={infillReason}
    panels={panels}
    fitSummary={fittedConnectorPanel? `${Math.round(fittedConnectorPanel.width)} × ${Math.round(fittedConnectorPanel.height)} × ${fittedConnectorPanel.thickness} mm`:undefined}
    connectors={selectedConnectors}
    onChange={patch => commitWithInsertChecks(current => editConnectors(current,selectedConnectorIds,patch))}
    onTypeChange={updateConnectorType}
    typeError={connectorTypeError?.source===project&&connectorTypeError.selection===selectedConnectorIds.join('/')? connectorTypeError.message:undefined}
    onRemove={removeSelectedConnectors}
    onConnectPanel={connectWithPanel}
    panelFitReason={assembly.editingInstance? 'Finish editing the assembly before connecting a panel.':modalOpen? 'Close the dialog before connecting a panel.':connectorPanelFit.reason} />
}

interface SelectedAssemblyInspectorProps {
  definition: AssemblyDefinition
  buildTools: React.JSX.Element | undefined
  instance: AssemblyInstance
  assembly: ReturnType<typeof useAssemblyEditor>
  assemblyCount: (definitionId: string) => number
  selectedPanels: Panel[]
  selectedFinishCoverages: number[]
  project: Project
  assemblyHint: string|undefined
  validTargets: AssemblyAttachmentTarget[]
  duplicateSelected: () => void
  exportAssembly: () => void
  clipboard: ReturnType<typeof useCopyPaste>
  deleteSelected: () => void
}

function SelectedAssemblyInspector({
  definition, buildTools, instance, assembly,
  assemblyCount, selectedPanels, selectedFinishCoverages, project,
  assemblyHint, validTargets, duplicateSelected, exportAssembly,
  clipboard, deleteSelected
}: SelectedAssemblyInspectorProps)  {
  return <AssemblyInspector
    buildTools={buildTools}
    key={instance.id}
    name={instance.name}
    definitionName={definition.name}
    parameters={definition.parameters}
    parameterValues={instance.parameterValues}
    onParameterChange={(id,value) => assembly.parameter(instance.id,id,value)}
    onResetParameters={() => assembly.resetParameters(instance.id)}
    instanceCount={assemblyCount(instance.definitionId)}
    panelCount={Object.keys(instance.panelIds).length}
    color={instance.finish?.color??selectedPanels[0]?.color??'#d9bb87'}
    hasColorOverride={!!instance.finish?.color}
    finishCoverage={selectedFinishCoverages[0]??0}
    finishCoverageMixed={selectedFinishCoverages.some(value => value!==selectedFinishCoverages[0])}
    finishCoverageDisabled={selectedPanels.every(p => p.material==='painted')}
    hasFinishCoverageOverride={instance.finish?.finishCoverage!==undefined}
    onFinishCoverageChange={finishCoverage => assembly.finish(instance.id,{ finishCoverage })}
    onResetFinishCoverage={() => assembly.resetFinish(instance.id,'finishCoverage')}
    connected={project.assemblies?.links.some(link => link.a.instanceId===instance.id||link.b.instanceId===instance.id)}
    attachmentTargets={assembly.instances.filter(item => item.id!==instance.id&&!project.assemblies?.links.some(link => link.a.instanceId===item.id||link.b.instanceId===item.id)).map(item => ({ id: item.id,name: item.name }))}
    attachmentActive={assembly.placementActive}
    attachmentMessage={assemblyHint}
    onCancelAttach={assembly.clearPlacement}
    canAttachCopy={validTargets.length>0}
    onRename={name => assembly.rename(instance.id,name)}
    onColorChange={color => assembly.finish(instance.id,{ color })}
    onResetColor={() => assembly.resetFinish(instance.id,'color')}
    onDuplicate={duplicateSelected}
    onExport={exportAssembly}
    onAttachCopy={() => { clipboard.cancel(); assembly.startAttach() } }
    onAttachExisting={id => { clipboard.cancel(); assembly.startAttach(id) } }
    onEdit={() => assembly.edit(instance.id)}
    onDisconnect={() => assembly.disconnect(instance.id)}
    onMakeIndependent={() => assembly.independent(instance.id)}
    onDisassemble={() => assembly.disassemble(instance.id)}
    onDelete={deleteSelected} />
}

function inspectorContextLabel(objectMode: boolean,managingProjectConstraints: boolean,inspectingConnectors: boolean,assembly: ReturnType<typeof useAssemblyEditor>): string|undefined {
  return objectMode? 'Objects':managingProjectConstraints? 'All constraints':inspectingConnectors? 'Connectors':assembly.editingInstance? 'Shared assembly':assembly.hasMembers? 'Assembly':undefined
}

interface InspectorSelectionKeyOptions {
  objectMode: boolean
  objects: ReturnType<typeof useConstructionEditor>
  inspectingConnectors: boolean
  selectedConnectorIds: string[]
  selectionKey: string
  inspectorTab: string
  instance: AssemblyInstance|undefined
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  managingProjectConstraints: boolean
}

function inspectorSelectionKey({ objectMode, objects, inspectingConnectors, selectedConnectorIds, selectionKey, inspectorTab, instance, assembly, clipboard, managingProjectConstraints }: InspectorSelectionKeyOptions): string {
  return `${objectMode? objects.selectedIds.join('/'):inspectingConnectors? selectedConnectorIds.join('/'):selectionKey}:${inspectorTab}:${instance?.id??assembly.memberInstance?.id??''}:${assembly.editingInstance?.id??''}:${assembly.placementActive}:${clipboard.active}:${managingProjectConstraints}`
}

interface RenderInspectorFooterOptions {
  constraints: ReturnType<typeof useDesignConstraints>
  setConstraintFooter: React.Dispatch<React.SetStateAction<HTMLDivElement | null>>
  clipboard: ReturnType<typeof useCopyPaste>
  attachmentSummary: string|undefined
  assembly: ReturnType<typeof useAssemblyEditor>
  attachmentWarning: string|undefined
  assemblyHint: string|undefined
  managingProjectConstraints: boolean
  closeProjectConstraints: () => void
}

function renderInspectorFooter({ constraints, setConstraintFooter, clipboard, attachmentSummary, assembly, attachmentWarning, assemblyHint, managingProjectConstraints, closeProjectConstraints }: RenderInspectorFooterOptions)  {
  return constraints.editing? <div ref={setConstraintFooter} />:clipboard.active? <><p className="inspector-task-status" role="status">{attachmentSummary||'Choose a + in the workspace to attach.'}</p><Button variant="outline" className="full-button" onClick={clipboard.cancel}>Cancel placement</Button></>:assembly.placementActive? <><p className={`inspector-task-status ${attachmentWarning? 'is-blocked':''}`} role="status">{attachmentSummary||assemblyHint}</p><Button variant="outline" className="full-button" onClick={assembly.clearPlacement}>Cancel attachment</Button></>:managingProjectConstraints? <Button variant="outline" className="full-button" aria-label="Done managing constraints" onClick={closeProjectConstraints}>Done</Button>:undefined
}

interface SelectionBuildToolsProps {
  selectedIds: string[]
  assembly: ReturnType<typeof useAssemblyEditor>
  gridCut: ReturnType<typeof gridPanelCut>
  toolRequest: { tool: "grid"|"parallel"|"assembly"|"holes"; selection: string; token: number; holeId?: string }|undefined
  project: Project
  commit: ReturnType<typeof useProject>['commit']
  setSelectedIds: (next: SetStateAction<string[]>) => void
  notify: (message: string) => void
  selectedPanels: Panel[]
  splitCounts: number[]
  checkingSplits: boolean
  splitSelection: (count?: number) => void
  mergeSelection: () => void
  instance: AssemblyInstance|undefined
  holes: ReturnType<typeof findClosingPanelHoles>
  closeHole: (id: string,reviewed?: boolean) => void
  addAutoConnectors: () => void
  panels: Panel[]
  modalOpen: boolean
}

export function SelectionBuildTools({
  selectedIds, assembly, gridCut, toolRequest,
  project, commit, setSelectedIds, notify,
  selectedPanels, splitCounts, checkingSplits, splitSelection, mergeSelection,
  instance, holes, closeHole,
  addAutoConnectors, panels, modalOpen
}: SelectionBuildToolsProps)  {
  const request = toolRequest?.selection === selectedIds.join('/') ? toolRequest : undefined
  const openRequest = (tool: NonNullable<typeof toolRequest>['tool']) => request?.tool === tool ? request.token : 0
  return <section className="inspector-section inspector-build-tools" aria-label="Build tools" key={`tools:${selectedIds.join('/')}`}>
    <div className="section-title"><h2>Build tools</h2><Plus size={16} /></div>
    {selectedIds.length===2&&<InspectorDisclosure title="Merge panels" summary="Fill the gap with one continuous panel" lazy><p className="field-note">Merge two aligned solid rectangles with matching thickness and finish. Outside edges and existing hardware stay fixed.</p><Button variant="outline" size="sm" disabled={modalOpen||assembly.hasMembers} onClick={mergeSelection}>Merge panels</Button></InspectorDisclosure>}
    {!assembly.hasMembers&&gridCut&&<InspectorDisclosure openRequest={openRequest('grid')} focusTarget="#grid-split-X" title="Divide into a grid" summary="Rows & columns" lazy><GridPanelSplit project={project} ids={selectedIds} frame={gridCut} onSplit={(result,x,y) => { commit(result.project); setSelectedIds(result.panelIds); notify(`Created a ${x+1} × ${y+1} grid with ${result.connectors} new connectors. Undo is available.`) } } /></InspectorDisclosure>}
    {!assembly.hasMembers&&parallelPanelCut(selectedPanels)&&<InspectorDisclosure openRequest={openRequest('parallel')} focusTarget="select" title="Divide evenly" summary="Add equally spaced dividers" lazy><ParallelPanelSplit counts={splitCounts} checking={checkingSplits} onSplit={splitSelection} /></InspectorDisclosure>}
    {(instance||!assembly.hasMembers)&&holes.length>0&&<HoleBuildTool openRequest={openRequest} holes={holes} toolRequest={toolRequest} instance={instance} closeHole={closeHole}/>}
    <InspectorDisclosure title="Auto-add connectors" summary="Connect matching or nearly fitting edges" lazy><p className="field-note">{selectedPanels.length>1? 'Connect matching edges between selected panels.':'Connect this panel to matching nearby edges.'} If a small size change is needed, review it before applying. Interior T joints split continuous panels, keeping their outer dimensions. Undo restores the original panels.</p><Button variant="outline" size="sm" onClick={addAutoConnectors} disabled={panels.length<2||modalOpen}><Link2 size={15} />Auto-add connectors</Button></InspectorDisclosure>
    {!assembly.hasMembers&&selectedPanels.length>1&&<InspectorDisclosure openRequest={openRequest('assembly')} focusTarget="input" title="Create assembly" summary="Reuse these panels as linked copies" lazy><CreateAssemblyForm panelCount={selectedPanels.length} panels={selectedPanels} onCreate={assembly.create} /></InspectorDisclosure>}
  </section>
}

interface HoleBuildToolProps {
  openRequest: (tool: NonNullable<{ tool: "grid"|"parallel"|"assembly"|"holes"; selection: string; token: number; holeId?: string }|undefined>["tool"]) => number
  holes: ReturnType<typeof findClosingPanelHoles>
  toolRequest: { tool: "grid"|"parallel"|"assembly"|"holes"; selection: string; token: number; holeId?: string }|undefined
  instance: AssemblyInstance|undefined
  closeHole: (id: string,reviewed?: boolean) => void
}

function HoleBuildTool({ openRequest, holes, toolRequest, instance, closeHole }: HoleBuildToolProps)  {
  return <InspectorDisclosure openRequest={openRequest('holes')} focusTarget="select" title="Close holes" summary={`${holes.length} ${holes.length===1? 'opening':'openings'} available`} lazy><CloseHoles key={toolRequest?.tool==='holes'? toolRequest.token:'holes'} initialHoleId={toolRequest?.tool==='holes'? toolRequest.holeId:undefined} holes={holes} assembly={!!instance} onClose={id => closeHole(id,true)} /></InspectorDisclosure>
}
