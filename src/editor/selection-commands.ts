import { ResizeReviewRequired, resizePanelsWithReview } from '@/lib/numeric-resize'
import type { Notify } from '@/editor/editor-notifications'
import type { ListGroupingProps } from '@/components/GroupedList'
import type { BoxSelection } from '@/components/PreviewBoxSelection'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { useObjectGesture } from '@/hooks/use-object-gesture'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { useProject } from '@/hooks/use-project'
import { duplicateAssembly,getAssemblyInstance,getAssemblyMovementPanelIds,isPanelConnectedToAssembly,moveAssemblies,removeAssembly } from '@/lib/assemblies'
import { separateOverlappingConnectors } from '@/lib/connector-clearance'
import { editConnectors } from '@/lib/connector-selection'
import { changeConnectorType } from '@/lib/connector-type-edit'
import { copyDesignConstraints,designConstraintPanelIds } from '@/lib/design-constraints'
import { createListGroup,moveListItems,orderedConnectors,renameListGroup,ungroupList } from '@/lib/list-groups'
import { detachPanel,duplicatePanel,removePanel,resolvePanels } from '@/lib/model'
import { mergePanels } from '@/lib/panel-merge'
import { distributePanels } from '@/lib/panel-distribution'
import { splitParallelPanels, type PanelSplitDimension } from '@/lib/parallel-panels'
import { getSharedPanelFields,panelValuesEqual,selectPanelIds,updateSelectedPanels } from '@/lib/selection'
import { MovementReviewRequired,movePanelsWithReview,movePanels,resizePanelDimensions,resizePanels,type MovementReview,type ResizeReview } from '@/lib/structure-edit'
import { assertNoNewTrofastIssues } from '@/lib/trofast'
import type { ConnectorType,ListKind,Panel,Project,Vec3 } from '@/lib/types'
import { type SetStateAction } from 'react'


interface CreatePanelEditCommandsOptions {
  setMovementReview: (review: MovementReview) => void
  setResizeReview: (review: ResizeReview) => void
  selectedPanels: Panel[]
  project: Project
  selectedId: string|null
  assembly: ReturnType<typeof useAssemblyEditor>
  commit: ReturnType<typeof useProject>['commit']
  setPanelEditError: React.Dispatch<React.SetStateAction<{ selection: string; message: string; } | null>>
  selectionKey: string
  notify: Notify
  selectedIds: string[]
}

export function createPanelEditCommands({ selectedPanels, project, selectedId, assembly, commit, setPanelEditError, selectionKey, notify, selectedIds, setResizeReview, setMovementReview }: CreatePanelEditCommandsOptions) {
  const checkLoosePanelPatch=(patch: Partial<Panel>) => {
    if(selectedPanels.some(panel => isPanelConnectedToAssembly(project,panel.id)&&(['position','rotation','thickness'] as const).some(key => patch[key]!==undefined&&!panelValuesEqual(panel[key],patch[key])))) {
      throw new Error('These panels still connect to an assembly. Detach the panels before changing their placement or thickness.')
    }
  }
  const updatePanel=(patch: Partial<Panel>) => {
    if(!selectedId) return false
    if(assembly.hasMembers) return assembly.editingInstance? assembly.updateDefinition(patch):false
    try {
      checkLoosePanelPatch(patch)
      const { width,height,thickness,position,...rest }=patch
      commit(current => {
        if(Object.keys(patch).every(key=>key==='width'||key==='height')) return resizePanelsWithReview(current,[selectedId],{ width,height })
        if(patch.position&&Object.keys(patch).length===1) {
          const before=resolvePanels(current).find(panel=>panel.id===selectedId)!
          return assertNoNewTrofastIssues(current,movePanelsWithReview(current,[selectedId],patch.position.map((value,axis)=>value-before.position[axis]) as Vec3))
        }
        if(patch.trofastInserts!==undefined&&current!==project) throw new Error('The project changed. Review the TROFAST placement before saving it.')
        const constrained=current.constraints?.some(rule => rule.enabled)
        const fields=!constrained&&thickness!==undefined? { ...rest,thickness }:rest
        let base={ ...current,panels: current.panels.map(panel => panel.id===selectedId? { ...panel,...fields }:panel) }
        if(position) { const before=resolvePanels(base).find(panel => panel.id===selectedId)!; base=constrained? movePanels(base,[selectedId],position.map((value,axis) => value-before.position[axis]) as Vec3):{ ...base,panels: base.panels.map(panel => panel.id===selectedId? { ...panel,position }:panel) }}
        if(constrained&&thickness!==undefined) return assertNoNewTrofastIssues(current,resizePanelDimensions(base,{ [selectedId]: { width,height,thickness } }))
        return assertNoNewTrofastIssues(current,width!==undefined||height!==undefined? resizePanels(base,[selectedId],{ width,height }):base)
      })
      setPanelEditError(null)
      return true
    } catch(error) { if(error instanceof ResizeReviewRequired) { setPanelEditError(null); setResizeReview(error.review); return false } if(error instanceof MovementReviewRequired) { setMovementReview(error.review); return false } const message=error instanceof Error? error.message:'This panel size cannot keep the joints aligned.'; setPanelEditError({ selection: selectionKey,message }); notify(message,'error'); return false}
  }
  const updateMultiplePanels=(patch: Partial<Panel>) => {
    if(assembly.hasMembers) return assembly.editingInstance? assembly.updateDefinition(patch):false
    try {
      checkLoosePanelPatch(patch)
      const { width,height,thickness,position,...rest }=patch
      const shared=getSharedPanelFields(selectedPanels)
      const dimensions={ width: shared.has('width')? width:undefined,height: shared.has('height')? height:undefined }
      commit(current => {
        if(Object.keys(patch).every(key=>key==='width'||key==='height')) return resizePanelsWithReview(current,selectedIds,dimensions)
        const constrained=current.constraints?.some(rule => rule.enabled)
        let base=updateSelectedPanels(current,selectedIds,!constrained&&thickness!==undefined? { ...rest,thickness }:rest)
        if(position) { const before=resolvePanels(base).find(panel => panel.id===selectedIds[0])!; base=constrained? movePanels(base,selectedIds,position.map((value,axis) => value-before.position[axis]) as Vec3):updateSelectedPanels(base,selectedIds,{ position })}
        if(constrained&&thickness!==undefined) return assertNoNewTrofastIssues(current,resizePanelDimensions(base,Object.fromEntries(selectedIds.map(id => [id,{ ...dimensions,thickness }]))))
        return assertNoNewTrofastIssues(current,dimensions.width!==undefined||dimensions.height!==undefined? resizePanels(base,selectedIds,dimensions):base)
      })
      setPanelEditError(null)
      return true
    } catch(error) { if(error instanceof ResizeReviewRequired) { setPanelEditError(null); setResizeReview(error.review); return false } const message=error instanceof Error? error.message:'These panel sizes cannot keep the joints aligned.'; setPanelEditError({ selection: selectionKey,message }); notify(message,'error'); return false}
  }
  return { updatePanel,updateMultiplePanels }
}

interface CreateSelectionCommandsOptions {
  setMovementReview: (review: MovementReview) => void
  assembly: ReturnType<typeof useAssemblyEditor>
  commit: ReturnType<typeof useProject>['commit']
  selectedIds: string[]
  notify: Notify
  project: Project
  setSelectedIds: (next: SetStateAction<string[]>) => void
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  inspectingConnectors: boolean
  removeSelectedConnectors: () => void
  selectedIdSet: Set<string>
  setFrameSignal: React.Dispatch<React.SetStateAction<number>>
}

export function createSelectionCommands({ assembly, commit, selectedIds, notify, project, setSelectedIds, setInspectorTab, inspectingConnectors, removeSelectedConnectors, selectedIdSet, setFrameSignal, setMovementReview }: CreateSelectionCommandsOptions) {
  const moveSelection=(delta: Vec3,repeat: boolean) => {
    try {
      if(assembly.editingInstance) return
      commit(current => {
        const instanceIds=[...new Set(selectedIds.map(id => getAssemblyInstance(current,id)?.id).filter((id): id is string => !!id))]
        const carriedIds=new Set(getAssemblyMovementPanelIds(current,instanceIds))
        const looseIds=selectedIds.filter(id => !getAssemblyInstance(current,id)&&!carriedIds.has(id))
        const next=instanceIds.length? moveAssemblies(current,instanceIds,delta):current
        return looseIds.length? (instanceIds.length?movePanels(next,looseIds,delta):movePanelsWithReview(next,looseIds,delta)):next
      },{ group: 'panel-move',repeat })
    } catch(error) { if(error instanceof MovementReviewRequired) { setMovementReview(error.review); return } notify(error instanceof Error? error.message:'This move cannot keep the joints aligned.','error')}
  }
  const distributeSelection=() => {
    try { commit(current => distributePanels(current,selectedIds))}
    catch(error) { notify(error instanceof Error? error.message:'These panels cannot be distributed while keeping their joints aligned.','error')}
  }
  const mergeSelection=() => {
    if(assembly.hasMembers||assembly.editingInstance||inspectingConnectors) return
    try { commit(current => mergePanels(current,selectedIds)); setSelectedIds([selectedIds[0]]); notify('Panels merged. Undo is available.','success') }
    catch(error) { notify(error instanceof Error? error.message:'These panels cannot be merged.','error') }
  }
  const splitSelection=(count=1, dimension?: PanelSplitDimension) => {
    try {
      const result=splitParallelPanels(project,selectedIds,count,dimension)
      commit(result.project); setSelectedIds(result.panelIds)
      notify(`Panels split into ${count+1} equal sections each with ${count} ${count===1? 'divider':'dividers'} and ${result.connectors} new connectors. Undo is available.`)
    } catch(error) { notify(error instanceof Error? error.message:'These panels could not be split.','error')}
  }
  const detachSelection=() => {
    try { commit(current => selectedIds.reduce((next,id) => detachPanel(next,id),current)); setInspectorTab('panel'); notify('Panels detached. Their positions are unchanged.')}
    catch(error) { notify(error instanceof Error? error.message:'These panels could not be detached.','error')}
  }
  const deleteSelected=() => {
    if(inspectingConnectors) { removeSelectedConnectors(); return}
    if(assembly.editingInstance||assembly.memberInstance&&!assembly.selectedInstance) { notify('Select the whole instance to remove it.','error'); return}
    if(!selectedIds.length) return
    const removedRules=project.constraints?.filter(rule => designConstraintPanelIds(rule).some(id => selectedIdSet.has(id))).length??0
    try {
      commit(current => {
        const instanceIds=[...new Set(selectedIds.map(id => getAssemblyInstance(current,id)?.id).filter((id): id is string => !!id))]
        const looseIds=selectedIds.filter(id => !getAssemblyInstance(current,id))
        const next=instanceIds.reduce((p,id) => removeAssembly(p,id),current)
        return looseIds.reduce((p,id) => removePanel(p,id),next)
      }); assembly.clearPlacement(); notify(`Selection removed.${removedRules? ` Removed ${removedRules} dependent ${removedRules===1? 'constraint':'constraints'}.`:''} Undo to bring it back.`)
    } catch(error) { notify(error instanceof Error? error.message:'This selection could not be removed.','error')}
  }
  const duplicateSelected=() => {
    if(inspectingConnectors) return
    if(assembly.editingInstance||assembly.memberInstance&&!assembly.selectedInstance) { notify('Select the whole instance to duplicate it.','error'); return}
    if(!selectedIds.length) return
    try {
      let next=project; const copies: string[]=[]; const copied=new Set<string>(); const copiedPanels=new Map<string,string>()
      for(const id of selectedIds) {
        const instance=getAssemblyInstance(project,id)
        if(instance) { if(copied.has(instance.id)) continue; copied.add(instance.id); next=duplicateAssembly(next,instance.id); const newInstance=next.assemblies!.instances.at(-1)!; copies.push(...Object.values(newInstance.panelIds)); for(const [local,original] of Object.entries(instance.panelIds)) copiedPanels.set(original,newInstance.panelIds[local])}
        else { const duplicate=duplicatePanel(next,id); if(duplicate!==next) { const newId=duplicate.panels.at(-1)!.id; copies.push(newId); copiedPanels.set(id,newId)}  next=duplicate}
      }
      const assemblyPanelIds=project.assemblies?.instances.map(instance => new Set(Object.values(instance.panelIds)))
      const pairRules=project.constraints?.filter(rule => 'panelIds' in rule&&!assemblyPanelIds?.some(ids => rule.panelIds.every(id => ids.has(id))))
      const copiedRules=copyDesignConstraints(pairRules,copiedPanels)
      if(copiedRules.length) next={ ...next,constraints: [...next.constraints??[],...copiedRules] }
      const omittedRules=project.constraints?.filter(rule => designConstraintPanelIds(rule).some(id => copiedPanels.has(id))&&(rule.kind==='floor'||rule.kind==='position'||designConstraintPanelIds(rule).some(id => !copiedPanels.has(id)))).length??0
      commit(next); assembly.close(); setSelectedIds(copies); if(copied.size) setFrameSignal(v => v+1); notify(`${copied.size? 'Linked instances duplicated':'Panels duplicated'}${omittedRules? `. ${omittedRules} absolute-position or external ${omittedRules===1? 'constraint stays':'constraints stay'} with the originals.`:''}`)
    } catch(error) { notify(error instanceof Error? error.message:'This selection could not be duplicated.','error')}
  }
  return { duplicateSelected,deleteSelected,detachSelection,mergeSelection,splitSelection,distributeSelection,moveSelection }
}

interface CreateConnectorEditCommandsOptions {
  modalOpen: boolean
  assembly: ReturnType<typeof useAssemblyEditor>
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
  selectedConnectorIds: string[]
  notify: Notify
  commit: ReturnType<typeof useProject>['commit']
  setSelectedConnectorIds: React.Dispatch<React.SetStateAction<string[]>>
  setConnectorTypeError: React.Dispatch<React.SetStateAction<{ source: Project; selection: string; message: string; } | null>>
  project: Project
  constraints: ReturnType<typeof useDesignConstraints>
  objectMode: boolean
  objects: ReturnType<typeof useConstructionEditor>
  setAssemblyTab: React.Dispatch<React.SetStateAction<ListKind | "objects">>
  clipboard: ReturnType<typeof useCopyPaste>
  setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function createConnectorEditCommands({
  modalOpen, assembly, commitWithInsertChecks, selectedConnectorIds,
  notify, commit, setSelectedConnectorIds, setConnectorTypeError,
  project, constraints, objectMode, objects,
  setAssemblyTab, clipboard, setPanelSelection, setInspectorTab,
  setRightOpen, setLeftOpen
}: CreateConnectorEditCommandsOptions) {
  const separateSelectedConnectors=() => {
    if(modalOpen||assembly.editingInstance) return
    let changed=false
    if(commitWithInsertChecks(current => {
      const next=separateOverlappingConnectors(current,selectedConnectorIds)
      changed=next!==current
      return next
    })) notify(changed? 'Selected overlapping connectors separated. Undo is available.':'No selected connectors overlap.')
  }
  const removeSelectedConnectors=() => {
    commit(current => editConnectors(current,selectedConnectorIds,{ removed: true }))
    setSelectedConnectorIds([]); notify('Connectors removed. Undo to bring them back.')
  }
  const updateConnectorType=(type: ConnectorType) => {
    try {
      commit(current => changeConnectorType(current,selectedConnectorIds,type))
      setConnectorTypeError(null)
    } catch(error) {
      const message=error instanceof Error? error.message:'This connector angle cannot keep the joints aligned.'
      setConnectorTypeError({ source: project,selection: selectedConnectorIds.join('/'),message }); notify(message,'error')
    }
  }
  const selectConnectors=(next: SetStateAction<string[]>,revealInspector=true,additive=false) => {
    if(constraints.editing) return
    if(objectMode) { objects.cancel(); setAssemblyTab('connectors')}
    clipboard.cancel(); assembly.close(); if(!additive) setPanelSelection([])
    setSelectedConnectorIds(next)
    setInspectorTab('panel'); setRightOpen(true)
    if(revealInspector&&window.innerWidth<=900) setLeftOpen(false)
  }
  const chooseConnector=(id: string,additive=false) => selectConnectors(ids => selectPanelIds(ids,id,additive),true,additive)
  return { removeSelectedConnectors,selectConnectors,separateSelectedConnectors,chooseConnector,updateConnectorType }
}

interface CreatePanelSelectionCommandOptions {
  objectMode: boolean
  objects: ReturnType<typeof useConstructionEditor>
  setAssemblyTab: React.Dispatch<React.SetStateAction<ListKind | "objects">>
  constraintPicker: React.RefObject<((id: string) => boolean) | null>
  setPickingConstraint: React.Dispatch<React.SetStateAction<boolean>>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  constraints: ReturnType<typeof useDesignConstraints>
  selectedConnectors: ReturnType<typeof orderedConnectors>
  setSelectedConnectorIds: React.Dispatch<React.SetStateAction<string[]>>
  setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedIds: (next: SetStateAction<string[]>) => void
  clipboard: ReturnType<typeof useCopyPaste>
  project: Project
  assembly: ReturnType<typeof useAssemblyEditor>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
}

export function createPanelSelectionCommand({
  objectMode, objects, setAssemblyTab, constraintPicker,
  setPickingConstraint, setRightOpen, constraints, selectedConnectors,
  setSelectedConnectorIds, setPanelSelection, setSelectedIds, clipboard,
  project, assembly, setInspectorTab
}: CreatePanelSelectionCommandOptions) {
  return (id: string|null,additive=false) => {
    if(objectMode) { objects.cancel(); setAssemblyTab('panels')}
    if(constraintPicker.current) { if(id&&constraintPicker.current(id)) { constraintPicker.current=null; setPickingConstraint(false); setRightOpen(true)}  return}
    if(constraints.editing) return
    if(!id&&additive&&selectedConnectors.length) return
    if(!additive) setSelectedConnectorIds([])
    const updateSelection=additive? setPanelSelection:setSelectedIds
    clipboard.cancel()
    const owner=id? getAssemblyInstance(project,id):undefined
    if(assembly.editingInstance) {
      if(owner?.id===assembly.editingInstance.id) { updateSelection(ids => selectPanelIds(ids,id,additive)); return}
      if(owner?.definitionId===assembly.editingDefinition?.id&&id) { assembly.drillIn(id); return}
      if(!id) return
      assembly.close()
    }
    if(owner) {
      if(additive) {
        const members=Object.values(owner.panelIds),memberIds=new Set(members)
        assembly.clearPlacement()
        updateSelection(ids => {
          const selected=new Set(ids)
          return members.every(member => selected.has(member))? ids.filter(member => !memberIds.has(member)):[...new Set([...ids,...members])]
        })
        setInspectorTab('panel'); setRightOpen(true)
      }
      else assembly.select(owner.id)
      return
    }
    assembly.clearPlacement(); updateSelection(ids => selectPanelIds(ids,id,additive)); if(additive||!id) setInspectorTab('panel'); if(id) setRightOpen(true)
  }
}

interface CreateBoxSelectionCommandsOptions {
  inspectingConnectors: boolean
  panels: Panel[]
  assembly: ReturnType<typeof useAssemblyEditor>
  project: Project
  physicalConnectors: ReturnType<typeof orderedConnectors>
  setBoxSelectActive: React.Dispatch<React.SetStateAction<boolean>>
  objectMode: boolean
  objects: ReturnType<typeof useConstructionEditor>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedConnectorIds: React.Dispatch<React.SetStateAction<string[]>>
}

export function createBoxSelectionCommands({ inspectingConnectors, panels, assembly, project, physicalConnectors, setBoxSelectActive, objectMode, objects, setRightOpen, setInspectorTab, setPanelSelection, setSelectedConnectorIds }: CreateBoxSelectionCommandsOptions) {
  const resolveBoxPanelIds=(ids: string[]) => {
    if(assembly.editingInstance) { const allowed=new Set(Object.values(assembly.editingInstance.panelIds)); return ids.filter(id => allowed.has(id))}
    return [...new Set(ids.flatMap(id => { const owner=getAssemblyInstance(project,id); return owner? Object.values(owner.panelIds):[id] }))]
  }
  const resolveBoxConnectorIds=(ids: string[]) => {
    if(!assembly.editingInstance) return ids
    const members=new Set(Object.values(assembly.editingInstance.panelIds))
    const allowed=new Set(physicalConnectors.filter(({ connection }) => members.has(connection.parentId)&&members.has(connection.childId)).map(connector => connector.id))
    return ids.filter(id => allowed.has(id))
  }
  const selectBox=(selection: BoxSelection,additive: boolean) => {
    setBoxSelectActive(false)
    if(objectMode) { objects.selectMany(selection.objectIds??[],additive); setRightOpen(true); return}
    assembly.clearPlacement(); setInspectorTab('panel')
    setPanelSelection(current => additive? [...new Set([...current,...selection.panelIds])]:selection.panelIds)
    setSelectedConnectorIds(current => additive? [...new Set([...current,...selection.connectorIds])]:selection.connectorIds)
    if(selection.panelIds.length||selection.connectorIds.length) setRightOpen(true)
  }
  const selectAll=(includeConnectors=false)=>{
    if(includeConnectors&&inspectingConnectors){setSelectedConnectorIds(resolveBoxConnectorIds(physicalConnectors.filter(c=>[c.connection.parentId,c.connection.childId].every(id=>panels.some(p=>p.id===id&&p.visible))).map(c=>c.id)));return}
    const ids=assembly.editingInstance?Object.values(assembly.editingInstance.panelIds):project.panels.map(p=>p.id)
    setPanelSelection(ids);assembly.clearPlacement();setInspectorTab('panel');setRightOpen(true)
  }
  return { resolveBoxConnectorIds,selectBox,resolveBoxPanelIds,selectAll }
}

interface CreateListGroupingCommandsOptions {
  project: Project
  selectConnectors: (next: SetStateAction<string[]>,revealInspector?: boolean,additive?: boolean) => void
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  commit: ReturnType<typeof useProject>['commit']
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function createListGroupingCommands({ project, selectConnectors, clipboard, assembly, setPanelSelection, setInspectorTab, setRightOpen, commit, setLeftOpen }: CreateListGroupingCommandsOptions) {
  const listGrouping=(kind: ListKind): ListGroupingProps => ({
    groups: (project.listGroups??[]).filter(group => group.kind===kind),
    onSelectGroup: (ids,selected) => {
      const members=new Set(ids)
      const update=(current: string[]) => selected? [...new Set([...current,...ids])]:current.filter(id => !members.has(id))
      if(kind==='connectors') selectConnectors(update,false,true)
      else {
        clipboard.cancel(); assembly.close(); setPanelSelection(update)
        setInspectorTab('panel'); setRightOpen(true)
      }
    },
    onCreateGroup: (id,ids) => commit(p => createListGroup(p,kind,ids,id)),
    onRenameGroup: (id,name) => commit(p => renameListGroup(p,id,name)),
    onUngroup: id => commit(p => ungroupList(p,id)),
    onMove: (ids,groupId,beforeId) => commit(p => moveListItems(p,kind,ids,groupId,beforeId)),
  })
  const groupSelected=(kind: ListKind,ids: string[]) => {
    commit(p => createListGroup(p,kind,ids,crypto.randomUUID()))
    setLeftOpen(true)
  }
  return { groupSelected,listGrouping }
}

interface CreateObjectSelectionCommandsOptions {
  objectControlsDisabled: boolean
  objects: ReturnType<typeof useConstructionEditor>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  objectGesture: ReturnType<typeof useObjectGesture>
  modalOpen: boolean
  clipboard: ReturnType<typeof useCopyPaste>
  assembly: ReturnType<typeof useAssemblyEditor>
  constraints: ReturnType<typeof useDesignConstraints>
  setProjectConstraintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setPickingConstraint: React.Dispatch<React.SetStateAction<boolean>>
  constraintPicker: React.RefObject<((id: string) => boolean) | null>
  setSelectedIds: (next: SetStateAction<string[]>) => void
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  setAssemblyTab: React.Dispatch<React.SetStateAction<ListKind | "objects">>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  closeContextMenu: () => void
  selectedPanels: Panel[]
  selectedConnectors: ReturnType<typeof orderedConnectors>
}

export function createObjectSelectionCommands({
  objectControlsDisabled, objects, setRightOpen, setLeftOpen,
  drag, resize, objectGesture, modalOpen,
  clipboard, assembly, constraints, setProjectConstraintsOpen,
  setPickingConstraint, constraintPicker, setSelectedIds, setExploded,
  setAssemblyTab, setInspectorTab, closeContextMenu, selectedPanels,
  selectedConnectors
}: CreateObjectSelectionCommandsOptions) {
  const chooseObject=(id: string|null,additive=false) => {
    if(objectControlsDisabled) return
    objects.select(id,additive); setRightOpen(true)
    if(id&&window.innerWidth<=900) setLeftOpen(false)
  }
  const changeAssemblyTab=(tab: ListKind|'objects') => {
    if(drag.active||resize.active||objectGesture.active||modalOpen) return
    objects.cancel()
    if(tab==='objects') {
      clipboard.cancel(); assembly.close(); constraints.cancel(); setProjectConstraintsOpen(false); setPickingConstraint(false); constraintPicker.current=null
      setSelectedIds([]); setRightOpen(true); setExploded(false)
    }

    setAssemblyTab(tab); setInspectorTab('panel'); assembly.clearPlacement(); closeContextMenu()
    if(selectedPanels.length||selectedConnectors.length) setRightOpen(true)
  }
  return { chooseObject,changeAssemblyTab }
}
