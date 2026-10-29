import { useEffect, useMemo, useState } from 'react'
import {
  createAssembly, duplicateAssembly, getAssemblyAttachmentTargets, getAssemblyInstance,
  instantiateAssembly, removeAssembly, disconnectAssembly, makeAssemblyIndependent,
  updateAssemblyDefinition, updateAssemblyFinish, resetAssemblyFinish, renameAssembly,
} from '@/lib/assemblies'
import type { Panel, Project } from '@/lib/types'

interface Options {
  project: Project
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  commit: (project: Project) => void
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
  useEffect(() => {
    const ids = new Set(project.assemblies?.instances.map(instance => instance.id))
    if (editingId && !ids.has(editingId)) setEditingId(null)
    if (placement && (!ids.has(placement.targetId) || placement.sourceId && !ids.has(placement.sourceId))) setPlacement(null)
  }, [project.assemblies, editingId, placement])
  const editingInstance = instances.find(instance => instance.id === editingId)
  const editingDefinition = definitions.find(definition => definition.id === editingInstance?.definitionId)
  const owners = selectedIds.map(id => getAssemblyInstance(project, id))
  const memberInstance = owners[0] && owners.every(owner => owner?.id === owners[0]?.id) ? owners[0] : undefined
  const selectedInstance = !editingInstance && memberInstance && Object.values(memberInstance.panelIds).length === selectedIds.length ? memberInstance : undefined
  const definition = definitions.find(item => item.id === (selectedInstance ?? memberInstance)?.definitionId)
  const hasMembers = owners.some(Boolean)
  const targetInstanceId = !editingInstance ? selectedInstance?.id : undefined
  const sourceInstanceId = placement && placement.targetId === targetInstanceId ? placement.sourceId : undefined
  const targets = useMemo(() => {
    if (!targetInstanceId) return []
    return getAssemblyAttachmentTargets(project, targetInstanceId, sourceInstanceId)
  }, [project, targetInstanceId, sourceInstanceId])
  const target = hover?.project === project ? targets.find(item => item.id === hover.id) : undefined
  const preview = target?.project
  const existingIds = useMemo(() => new Set(project.panels.map(panel => panel.id)), [project.panels])
  const sourceIds = useMemo(() => new Set(Object.values(project.assemblies?.instances.find(instance => instance.id === sourceInstanceId)?.panelIds ?? {})), [project.assemblies, sourceInstanceId])
  // Rebuilding rotated instances introduces harmless float noise. Only the
  // placed instance is a ghost; neighbors keep their solid, unchanged panels.
  const previewPanels = preview?.panels.filter(panel => !existingIds.has(panel.id) || sourceIds.has(panel.id)) ?? []
  const attachmentBoundsPanels = useMemo(() => targets.flatMap(item => item.project?.panels.filter(panel => !existingIds.has(panel.id) || sourceIds.has(panel.id)) ?? []), [targets, existingIds, sourceIds])
  const previewIds = new Set(previewPanels.map(panel => panel.id))
  const previewConnections = preview?.connections.filter(connection => {
    const old = project.connections.find(item => item.id === connection.id)
    return !old || JSON.stringify(old) !== JSON.stringify(connection) || previewIds.has(connection.parentId) || previewIds.has(connection.childId)
  }) ?? []
  const suppressedConnectionIds = preview ? project.connections.filter(connection => !preview.connections.some(item => item.id === connection.id)).map(connection => connection.id) : []
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
    const partIds = Object.entries(editingInstance.panelIds).filter(([, id]) => selectedIds.includes(id)).map(([id]) => id)
    return run(() => updateAssemblyDefinition(project, editingInstance.id, patch, partIds))
  }
  const attach = (id: string) => {
    const candidate = targets.find(item => item.id === id)
    if (!candidate?.project) { if (candidate?.error) notify(candidate.error); return }
    const next = candidate.project
    const placedId = sourceInstanceId ?? next.assemblies!.instances.at(-1)!.id
    commit(next)
    select(placedId, next)
    fit()
    notify('Instance attached. Shared connectors fitted automatically.')
  }
  return {
    instances, definitions, selectedInstance, memberInstance, hasMembers, definition,
    editingInstance, editingDefinition, targets, target, preview, previewPanels, previewConnections, suppressedConnectionIds, attachmentBoundsPanels,
    placementActive: !!placement && placement.targetId === targetInstanceId,
    select, edit, drillIn, updateDefinition, close, clearPlacement,
    done: () => { if (editingInstance) select(editingInstance.id); else close() },
    create: (name: string) => run(() => createAssembly(project, selectedIds, name), 'Reusable assembly created. Use a + to attach a linked copy.', true),
    insert: (id: string) => run(() => instantiateAssembly(project, id), 'Linked instance added.', true),
    duplicate: (id: string) => run(() => duplicateAssembly(project, id), 'Linked instance duplicated.', true),
    remove: (id: string) => run(() => removeAssembly(project, id), 'Instance removed. Neighboring connectors restored.'),
    disconnect: (id: string) => { if (run(() => disconnectAssembly(project, id), 'Instance disconnected and moved clear of its neighbors. Corner connectors restored.')) fit() },
    independent: (id: string) => run(() => makeAssemblyIndependent(project, id), 'Instance now has its own assembly design. Physical connections kept.'),
    rename: (id: string, name: string) => run(() => renameAssembly(project, id, name)),
    finish: (id: string, color: string) => run(() => updateAssemblyFinish(project, id, { color })),
    resetFinish: (id: string) => run(() => resetAssemblyFinish(project, id)),
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
