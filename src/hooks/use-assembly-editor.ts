import {
  AssemblyAttachmentTarget, acceptAssemblyParameterBatch,
  createAssembly,
  disassembleAssembly,
  disconnectAssembly,
  duplicateAssembly,getAssemblyAttachmentTargets,getAssemblyInstance,
  instantiateAssembly,
  makeAssemblyIndependent,
  removeAssembly,
  renameAssembly,
  resetAssemblyFinish,
  resetAssemblyParameterValues,
  updateAssemblyDefinition,updateAssemblyFinish,
  updateAssemblyParameters,updateAssemblyParameterValues,
} from '@/lib/assemblies'
import type { AssemblyDefinition,AssemblyFinish,AssemblyInstance,AssemblyParameter,Panel,Project } from '@/lib/types'
import { useMemo,useState } from 'react'

interface Options {
  project: Project
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  commit: (project: Project | ((current: Project) => Project)) => void
  notify: (message: string) => void
  prepareSelection: () => void
  fit: () => void
}

/** Keeps instance selection and attachment previews out of the panel editing flow. */
export function useAssemblyEditor({ project, selectedIds, setSelectedIds, commit, notify, prepareSelection, fit }: Options) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [placement, setPlacement] = useState<{ targetId: string; sourceId?: string } | null>(null)
  const [hover, setHover] = useState<{ project: Project; id: string } | null>(null)
  const instances = project.assemblies?.instances ?? []
  const definitions = project.assemblies?.definitions ?? []
  const instanceIds = new Set(instances.map(instance => instance.id))
  if (editingId && !instanceIds.has(editingId)) setEditingId(null)
  if (placement && (!instanceIds.has(placement.targetId) || placement.sourceId && !instanceIds.has(placement.sourceId))) setPlacement(null)
  const editingInstance = instances.find(instance => instance.id === editingId)
  const editingDefinition = definitions.find(definition => definition.id === editingInstance?.definitionId)
  const { selectedInstance,memberInstance,hasMembers,definition }=getAssemblySelection(selectedIds,project,editingInstance,definitions)
  const targetInstanceId = !editingInstance ? selectedInstance?.id : undefined
  const sourceInstanceId = placement && placement.targetId === targetInstanceId ? placement.sourceId : undefined
  const targets = useMemo(() => {
    if (!targetInstanceId) return []
    return getAssemblyAttachmentTargets(project, targetInstanceId, sourceInstanceId)
  }, [project, targetInstanceId, sourceInstanceId])
  const target = hover?.project === project ? targets.find(item => item.id === hover.id) : undefined
  const { sourceIds,existingIds,preview,previewPanels,previewConnections,suppressedConnectionIds,suppressedPanelIds,attachmentBoundsPanels }=useAssemblyPreview(target,project,sourceInstanceId,targets)
  const clearPlacement = () => { setPlacement(null); setHover(null) }
  const close = () => { setEditingId(null); clearPlacement() }
  const select = (id: string, next = project) => {
    const instance = next.assemblies?.instances.find(item => item.id === id)
    if (!instance) return
    close()
    setSelectedIds(Object.values(instance.panelIds))
    prepareSelection()
  }
  const run = (operation: () => Project, message?: string, selectLast = false) => {
    try {
      const next = operation()
      commit(next)
      clearPlacement()
      if (selectLast) {
        const instance = next.assemblies?.instances.at(-1)
        if (instance) select(instance.id, next)
        fit()
      }
      if (message) notify(message)
      return true
    } catch (error) { notify(error instanceof Error ? error.message : 'This assembly could not be changed.'); return false }
  }
  const edit = (id: string) => {
    const instance = instances.find(item => item.id === id)
    if (!instance) return
    setEditingId(id)
    clearPlacement()
    setSelectedIds(Object.values(instance.panelIds))
    prepareSelection()
  }
  const drillIn = (panelId: string) => {
    const instance = getAssemblyInstance(project, panelId)
    if (!instance) return
    if (editingDefinition && instance.definitionId === editingDefinition.id) setEditingId(instance.id)
    else setEditingId(null)
    clearPlacement()
    setSelectedIds([panelId])
    prepareSelection()
  }
  const updateDefinition = (patch: Partial<Panel>) => {
    if (!editingInstance) return false
    const selected = new Set(selectedIds)
    const partIds = Object.entries(editingInstance.panelIds).filter(([, id]) => selected.has(id)).map(([id]) => id)
    return run(() => updateAssemblyDefinition(project, editingInstance.id, patch, partIds))
  }
  const attach = createAttachmentCommand(targets,notify,sourceInstanceId,instances,commit,select,close,setSelectedIds,sourceIds,existingIds,prepareSelection,fit)
  return {
    instances, definitions, selectedInstance, memberInstance, hasMembers, definition,
    editingInstance, editingDefinition, targets, target, preview, previewPanels, previewConnections, suppressedConnectionIds, suppressedPanelIds, attachmentBoundsPanels,
    placementActive: !!placement && placement.targetId === targetInstanceId,
    select, edit, drillIn, updateDefinition, close, clearPlacement,
    done: () => { if (editingInstance) select(editingInstance.id); else close() },
    create: (name: string, parameters: AssemblyParameter[] = []) => run(() => createAssembly(project, selectedIds, name, parameters), 'Reusable assembly created. Use a + to attach a linked copy.', true),
    parameters: (parameters: AssemblyParameter[]) => editingInstance ? run(() => updateAssemblyParameters(project, editingInstance.id, parameters), 'Editable values saved for this assembly.') : false,
    parameter: (id: string, parameterId: string, value: number) => run(() => updateAssemblyParameterValues(project, id, { [parameterId]: value })),
    applyParameterBatch: (source: Project, candidate: Project) => {
      try {
        commit(current => acceptAssemblyParameterBatch(current, source, candidate))
        clearPlacement()
        notify('Coordinated assembly values applied.')
        return true
      } catch (error) { notify(error instanceof Error ? error.message : 'These values could not be applied.'); return false }
    },
    resetParameters: (id: string) => run(() => resetAssemblyParameterValues(project, id)),
    insert: (id: string) => run(() => instantiateAssembly(project, id), 'Linked instance added.', true),
    duplicate: (id: string) => run(() => duplicateAssembly(project, id), 'Linked instance duplicated.', true),
    remove: (id: string) => run(() => removeAssembly(project, id), 'Instance removed. Neighboring connectors restored.'),
    disconnect: (id: string) => { if (run(() => disconnectAssembly(project, id), 'Instance disconnected and moved clear of its neighbors. Corner connectors restored.')) fit() },
    independent: (id: string) => run(() => makeAssemblyIndependent(project, id), 'Instance now has its own assembly design. Physical connections kept.'),
    disassemble: (id: string) => {
      const instance = instances.find(item => item.id === id)
      if (!instance) return
      if (run(() => disassembleAssembly(project, id), 'Assembly disassembled. Its panels are editable separately. Undo to restore the instance.')) {
        close()
        setSelectedIds(Object.values(instance.panelIds))
        prepareSelection()
      }
    },
    rename: (id: string, name: string) => run(() => renameAssembly(project, id, name)),
    finish: (id: string, finish: AssemblyFinish) => run(() => updateAssemblyFinish(project, id, finish)),
    resetFinish: (id: string, key?: keyof AssemblyFinish) => run(() => resetAssemblyFinish(project, id, key)),
    startAttach: (sourceId?: string) => {
      if (!selectedInstance) return
      setPlacement({ targetId: selectedInstance.id, sourceId }); setHover(null); prepareSelection(); fit()
    },
    hover: (id: string | null) => setHover(id ? { project, id } : null),
    attach,
    sidebarAssemblies: instances.map(instance => ({ id: instance.id, name: instance.name, definitionName: definitions.find(item => item.id === instance.definitionId)?.name ?? 'Assembly', panelIds: Object.values(instance.panelIds) })),
    libraryAssemblies: definitions.map(item => ({ id: item.id, name: item.name, panelCount: item.panels.length, instanceCount: instances.filter(instance => instance.definitionId === item.id).length })),
  }
}

function createAttachmentCommand(targets: AssemblyAttachmentTarget[],notify: (message: string) => void,sourceInstanceId: string|undefined,instances: AssemblyInstance[],commit: (project: Project | ((current: Project) => Project)) => void,select: (id: string,next?: Project) => void,close: () => void,setSelectedIds: (ids: string[]) => void,sourceIds: Set<string>,existingIds: Set<string>,prepareSelection: () => void,fit: () => void) {
  return (id: string) => {
    const candidate=targets.find(item => item.id===id)
    if(!candidate?.project) { if(candidate?.error) notify(candidate.error); return}
    const next=candidate.project
    const placed=sourceInstanceId? next.assemblies?.instances.find(instance => instance.id===sourceInstanceId)
      :next.assemblies?.instances.find(instance => !instances.some(previous => previous.id===instance.id))
    commit(next)
    if(placed) select(placed.id,next)
    else {
      close()
      setSelectedIds(candidate.panelIds??next.panels.filter(panel => sourceIds.has(panel.id)||!existingIds.has(panel.id)).map(panel => panel.id))
      prepareSelection()
    }
    fit()
    notify(candidate.warning? `Attached. ${candidate.warning.replace(/^Requires disassembly:/,'Disassembled:')} Undo is available.`:'Instance attached. Shared connectors fitted automatically.')
  }
}

function useAssemblyPreview(target: AssemblyAttachmentTarget|undefined,project: Project,sourceInstanceId: string|undefined,targets: AssemblyAttachmentTarget[]) {
  const preview=target?.project
  const existingIds=useMemo(() => new Set(project.panels.map(panel => panel.id)),[project.panels])
  const sourceIds=useMemo(() => new Set(Object.values(project.assemblies?.instances.find(instance => instance.id===sourceInstanceId)?.panelIds??{})),[project.assemblies,sourceInstanceId])
  // Rebuilding rotated instances introduces harmless float noise. Only the
  // placed instance is a ghost; neighbors keep their solid, unchanged panels.
  const previewPanels=preview?.panels.filter(panel => !existingIds.has(panel.id)||sourceIds.has(panel.id))??[]
  const attachmentBoundsPanels=useMemo(() => targets.flatMap(item => item.project?.panels.filter(panel => !existingIds.has(panel.id)||sourceIds.has(panel.id))??[]),[targets,existingIds,sourceIds])
  const previewIds=new Set(previewPanels.map(panel => panel.id))
  const connectionsById=useMemo(() => new Map(project.connections.map(connection => [connection.id,connection])),[project.connections])
  const previewConnectionIds=new Set(preview?.connections.map(connection => connection.id))
  const previewPanelIds=new Set(preview?.panels.map(panel => panel.id))
  const previewConnections=preview?.connections.filter(connection => {
    const old=connectionsById.get(connection.id)
    return !old||JSON.stringify(old)!==JSON.stringify(connection)||previewIds.has(connection.parentId)||previewIds.has(connection.childId)
  })??[]
  const suppressedConnectionIds=preview? project.connections.filter(connection => !previewConnectionIds.has(connection.id)).map(connection => connection.id):[]
  const suppressedPanelIds=preview? project.panels.filter(panel => !previewPanelIds.has(panel.id)).map(panel => panel.id):[]
  return { sourceIds,existingIds,preview,previewPanels,previewConnections,suppressedConnectionIds,suppressedPanelIds,attachmentBoundsPanels }
}

function getAssemblySelection(selectedIds: string[],project: Project,editingInstance: AssemblyInstance|undefined,definitions: AssemblyDefinition[]) {
  const owners=selectedIds.map(id => getAssemblyInstance(project,id))
  const memberInstance=owners[0]&&owners.every(owner => owner?.id===owners[0]?.id)? owners[0]:undefined
  const selectedInstance=!editingInstance&&memberInstance&&Object.values(memberInstance.panelIds).length===selectedIds.length? memberInstance:undefined
  const definition=definitions.find(item => item.id===(selectedInstance??memberInstance)?.definitionId)
  const hasMembers=owners.some(Boolean)
  return { selectedInstance,memberInstance,hasMembers,definition }
}
