import type { Notify } from '@/editor/editor-notifications'
import type { ProjectDialog } from '@/components/ProjectDialogs'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useProject } from '@/hooks/use-project'
import type { AutoConnectFit } from '@/lib/auto-connect-fit'
import { getAutoConnectFit } from '@/lib/auto-connect-fit'
import { autoConnectNearby } from '@/lib/auto-connect-nearby'
import { closePanelHole,findClosingPanelHoles } from '@/lib/close-holes'
import { getConnectorPanelFit } from '@/lib/connect-panel'
import { getDefaultConnectorColor } from '@/lib/connector-selection'
import { getPanelGroundExtension } from '@/lib/extend-to-ground'
import { orderedConnectors } from '@/lib/list-groups'
import { createPanel } from '@/lib/model'
import { roundPanelDraft } from '@/lib/nice-values'
import type { AssemblyInstance,AttachmentOptions,Connection,ListKind,Panel,Project,Side,ValidationIssue } from '@/lib/types'
import { type SetStateAction } from 'react'


interface CreateConnectionCommandsOptions {
  commit: ReturnType<typeof useProject>['commit']
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  selectedIds: string[]
  setSelectedIds: (next: SetStateAction<string[]>) => void
  notify: Notify
  modalOpen: boolean
  project: Project
  setPendingConnectionFit: React.Dispatch<React.SetStateAction<{ source: Project; fit: AutoConnectFit; } | null>>
  pendingConnectionFit: { source: Project; fit: NonNullable<ReturnType<typeof getAutoConnectFit>> }|null
  groundPanelFit: ReturnType<typeof getPanelGroundExtension>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  connectorPanelFit: ReturnType<typeof getConnectorPanelFit>
  setSelectedId: (id: string|null) => void
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  selectedConnectors: ReturnType<typeof orderedConnectors>
}

export function createConnectionCommands({
  commit, clipboard, assembly, setInspectorTab,
  setExploded, selectedIds, setSelectedIds, notify,
  modalOpen, project, setPendingConnectionFit, pendingConnectionFit,
  groundPanelFit, setFitSignal, connectorPanelFit, setSelectedId,
  setRightOpen, selectedConnectors
}: CreateConnectionCommandsOptions) {
  const finishAutoConnect=(result: ReturnType<typeof autoConnectNearby>,resized=0) => {
    commit(result.project); clipboard.cancel(); assembly.clearPlacement(); setInspectorTab('panel'); setExploded(false)
    if(result.splits&&selectedIds.length>1) setSelectedIds(ids => [...ids,...result.addedPanelIds])
    const placementMessage=[resized? (resized>1? 'Panels resized to fit.':'Panel resized to fit.'):'',result.splits? `${result.splits} panel ${result.splits===1? 'split':'splits'} for T joints; outer dimensions kept.`:'',result.movedPanelIds.length? `${result.movedPanelIds.length} loose ${result.movedPanelIds.length===1? 'panel moved':'panels moved'} to fit.`:''].filter(Boolean).join(' ')||'Panel positions kept.'
    notify(`${result.connectors} connectors ${result.upgrades? 'fitted':'added'} at ${result.joints} ${result.joints===1? 'joint':'joints'}. ${result.upgrades? `${result.upgrades} existing ${result.upgrades===1? 'joint':'joints'} upgraded. `:''}${placementMessage}${result.disassembledNames.length? ` Made independent: ${result.disassembledNames.join(', ')}.`:''} Undo is available.`)
  }
  const addAutoConnectors=() => {
    if(modalOpen||assembly.editingInstance) return
    try {
      const result=autoConnectNearby(project,selectedIds)
      const fitSelection=result.splits&&selectedIds.length>1? [...selectedIds,...result.addedPanelIds]:selectedIds
      const fit=getAutoConnectFit(result.project,fitSelection)
      if(fit) {
        setPendingConnectionFit({
          source: project,fit: {
            ...fit,result: {
              ...fit.result,
              movedPanelIds: result.movedPanelIds,joints: result.joints+fit.result.joints,connectors: result.connectors+fit.result.connectors,
              upgrades: result.upgrades+fit.result.upgrades,splits: result.splits+fit.result.splits,
              addedPanelIds: [...result.addedPanelIds,...fit.result.addedPanelIds],
              disassembledNames: [...new Set([...result.disassembledNames,...fit.result.disassembledNames])],
            }
          }
        })
        return
      }
      if(!result.joints) { notify('No compatible unconnected edges found. Check panel angles, edge alignment, and connector clearance.','error'); return}
      finishAutoConnect(result)
    } catch(error) { notify(error instanceof Error? error.message:'Connectors could not be added.','error')}
  }
  const acceptConnectionFit=() => {
    if(!pendingConnectionFit||pendingConnectionFit.source!==project) return
    finishAutoConnect(pendingConnectionFit.fit.result,pendingConnectionFit.fit.adjustments?.length??1); setPendingConnectionFit(null)
  }
  const extendToGround=() => {
    if(modalOpen||assembly.hasMembers||!groundPanelFit.result) return
    commit(groundPanelFit.result.project); clipboard.cancel(); assembly.clearPlacement(); setInspectorTab('panel'); setExploded(false); setFitSignal(value => value+1)
    notify('Panel extended to ground. Upper edge and existing joints kept in place. Undo is available.')
  }
  const connectWithPanel=() => {
    if(assembly.editingInstance||modalOpen) return
    const result=connectorPanelFit.result
    if(!result) { notify(connectorPanelFit.reason,'error'); return}
    commit(result.project); clipboard.cancel(); assembly.clearPlacement(); setSelectedId(result.panelId); setInspectorTab('panel'); setRightOpen(true); setExploded(false); setFitSignal(v => v+1)
    notify(`Panel fitted to ${selectedConnectors.length} connectors.${result.disassembledNames.length? ` Made independent: ${result.disassembledNames.join(', ')}.`:''} Undo is available.`)
  }
  return { connectWithPanel,extendToGround,addAutoConnectors,acceptConnectionFit }
}

interface CreatePanelInsertionCommandsOptions {
  objects: ReturnType<typeof useConstructionEditor>
  setAssemblyTab: React.Dispatch<React.SetStateAction<ListKind | "objects">>
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  setDraft: React.Dispatch<React.SetStateAction<Panel>>
  project: Project
  setDialog: React.Dispatch<React.SetStateAction<ProjectDialog>>
  draft: Panel
  notify: Notify
  inspectingConnectors: boolean
  selectedIds: string[]
  commit: ReturnType<typeof useProject>['commit']
  setSelectedId: (id: string|null) => void
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  selected: Panel|undefined
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
  setAttachTarget: React.Dispatch<React.SetStateAction<string>>
  setAttachmentSideHighlight: React.Dispatch<React.SetStateAction<{ panelId: string; side: Side; } | null>>
  setRealisticPreview: React.Dispatch<React.SetStateAction<boolean>>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  previewProject: Project|null
  attachmentErrors: ValidationIssue[]
  attachTarget: string
  previewPanels: Panel[]
  connection: Connection|undefined
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
}

export function createPanelInsertionCommands({
  objects, setAssemblyTab, clipboard, assembly,
  setDraft, project, setDialog, draft,
  notify, inspectingConnectors, selectedIds, commit,
  setSelectedId, setInspectorTab, setRightOpen, setFitSignal,
  selected, setAttachment, setAttachTarget, setAttachmentSideHighlight,
  setRealisticPreview, setExploded, previewProject, attachmentErrors,
  attachTarget, previewPanels, connection, commitWithInsertChecks
}: CreatePanelInsertionCommandsOptions) {
  const addPanel=() => { objects.cancel(); setAssemblyTab('panels'); clipboard.cancel(); assembly.close(); setDraft(roundPanelDraft(createPanel({ name: `Panel ${project.panels.length+1}`,width: 600,height: 360,thickness: 18,position: [0,500,0] }),project.niceValues)); setDialog('add') }
  const addDraftPanel=() => {
    let panel: Panel
    try { panel=roundPanelDraft({ ...draft,name: draft.name.trim()||'My panel' },project.niceValues)}
    catch(error) { notify(error instanceof Error? error.message:'These panel measurements cannot use the chosen nice-value step.','error'); return}
    setDialog(null)
    if(!inspectingConnectors&&selectedIds.length) { clipboard.insert({ kind: 'panel',panel }); return}
    try { commit(p => ({ ...p,panels: [...p.panels,panel] })) }
    catch(error) {notify(error instanceof Error?error.message:'Could not add panel.','error');return}
    setSelectedId(panel.id); setInspectorTab('panel'); setRightOpen(true)
    setFitSignal(v => v+1); notify('Your panel is ready')
  }
  const startAttach=() => { clipboard.cancel(); if(!selected||assembly.hasMembers) return; setAttachment(current => ({ ...current,color: getDefaultConnectorColor(project) })); setAttachTarget('new'); setAttachmentSideHighlight(null); setRealisticPreview(false); setExploded(false); setDraft(roundPanelDraft(createPanel({ name: `Panel ${project.panels.length+1}`,width: selected?.width??600,height: 360,thickness: selected?.thickness??18,material: selected?.material??'birch',color: selected?.color??'#d9bb87',...(selected.finishCoverage!==undefined? { finishCoverage: selected.finishCoverage }:{}) }),project.niceValues)); setInspectorTab('attach'); setRightOpen(true) }
  const applyAttachment=() => { if(!previewProject||attachmentErrors.length) return; try {commit(previewProject)} catch(error) {notify(error instanceof Error?error.message:'Could not attach panel.','error');return}; setSelectedId(attachTarget==='new'? draft.id:attachTarget); setInspectorTab('panel'); setDraft(createPanel()); notify(`${previewPanels.length===1? 'Panel':`${previewPanels.length} panels`} attached`) }
  const updateConnection=(patch: Partial<AttachmentOptions>) => { if(!connection) return false; const group=connection.id.replace(/:\d+$/,''); return commitWithInsertChecks(p => ({ ...p,connections: p.connections.map(c => c.id.replace(/:\d+$/,'')===group? { ...c,...patch }:c) })) }
  return { startAttach,addPanel,applyAttachment,updateConnection,addDraftPanel }
}

interface CreateCloseHoleCommandOptions {
  holes: ReturnType<typeof findClosingPanelHoles>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setToolRequest: React.Dispatch<React.SetStateAction<{ tool: "grid" | "parallel" | "assembly" | "holes"; selection: string; token: number; holeId?: string | undefined; } | undefined>>
  selectionKey: string
  project: Project
  selectedIds: string[]
  commit: ReturnType<typeof useProject>['commit']
  setSelectedIds: (next: SetStateAction<string[]>) => void
  notify: Notify
}

export function createCloseHoleCommand({ holes, setInspectorTab, setRightOpen, setToolRequest, selectionKey, project, selectedIds, commit, setSelectedIds, notify }: CreateCloseHoleCommandOptions) {
  return (id: string,reviewed=false) => {
    if(!reviewed&&holes.find(hole => hole.id===id)?.alignment) { setInspectorTab('panel'); setRightOpen(true); setToolRequest({ tool: 'holes',selection: selectionKey,token: Date.now(),holeId: id }); return}
    try {
      const result=closePanelHole(project,selectedIds,id)
      const closedInstance=result.instanceId? result.project.assemblies?.instances.find(item => item.id===result.instanceId):undefined
      if(result.instanceId&&!closedInstance) throw new Error('The closed opening has no assembly instance.')
      commit(result.project)
      if(closedInstance) setSelectedIds(Object.values(closedInstance.panelIds))
      else setSelectedIds([...selectedIds,result.panelId])
      notify(`${result.label} hole closed. Undo to restore the opening.`)
    } catch(error) { notify(error instanceof Error? error.message:'Could not close this opening.','error')}
  }
}

interface GetAssemblyPlacementFeedbackOptions {
  assembly: ReturnType<typeof useAssemblyEditor>
  clipboard: ReturnType<typeof useCopyPaste>
  instance: AssemblyInstance|undefined
  inspectingConnectors: boolean
  exploded: boolean
  realisticPreview: boolean
}

export function getAssemblyPlacementFeedback({ assembly, clipboard, instance, inspectingConnectors, exploded, realisticPreview }: GetAssemblyPlacementFeedbackOptions) {
  const validTargets=assembly.targets.filter(target => target.project)
  const assemblyHint=clipboard.active? 'Choose a location, then an arrangement · Esc to cancel.':instance&&!inspectingConnectors&&!exploded&&!realisticPreview
    ? validTargets.length? 'Hover a + to preview. Click to attach.':assembly.targets.find(target => target.error)?.error??'This assembly has no compatible corner attachments. Duplicate it to place another instance.'
    :undefined
  const attachmentWarning=clipboard.active? clipboard.hovered?.warning:assembly.target?.warning
  const attachmentSummary=attachmentWarning??(clipboard.active? clipboard.hovered?.error:assembly.target?.error??(assembly.preview? 'Corner connectors replaced with shared cross connectors.':undefined))
  return { validTargets,assemblyHint,attachmentSummary,attachmentWarning }
}
