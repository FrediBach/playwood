import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { getAutoConnectFit } from '@/lib/auto-connect-fit'
import { autoConnectNearby } from '@/lib/auto-connect-nearby'
import type { ListKind,Project } from '@/lib/types'
import { useMemo } from 'react'


interface UseConstraintActionsOptions {
  contextMenu: { x: number; y: number }|null
  inspectingConnectors: boolean
  assembly: ReturnType<typeof useAssemblyEditor>
  project: Project
  selectedIds: string[]
  objects: ReturnType<typeof useConstructionEditor>
  setAssemblyTab: React.Dispatch<React.SetStateAction<ListKind | "objects">>
  notify: (message: string) => void
  clipboard: ReturnType<typeof useCopyPaste>
  closeContextMenu: () => void
  selectedConnectorIds: string[]
  setSelectedConnectorIds: React.Dispatch<React.SetStateAction<string[]>>
  setProjectConstraintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRealisticPreview: React.Dispatch<React.SetStateAction<boolean>>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
  constraints: ReturnType<typeof useDesignConstraints>
}

export function useConstraintActions({
  contextMenu, inspectingConnectors, assembly, project,
  selectedIds, objects, setAssemblyTab, notify,
  clipboard, closeContextMenu, selectedConnectorIds, setSelectedConnectorIds,
  setProjectConstraintsOpen, setInspectorTab, setRightOpen, setRealisticPreview,
  setExploded, setLeftOpen, constraints
}: UseConstraintActionsOptions) {
  const canMenuAutoConnect=useMemo(() => {
    if(!contextMenu||inspectingConnectors||assembly.editingInstance||project.panels.length<2) return false
    try {
      const result=autoConnectNearby(project,selectedIds)
      return result.joints>0||!!getAutoConnectFit(result.project,selectedIds)
    } catch { return false}
  },[contextMenu,inspectingConnectors,assembly.editingInstance,project,selectedIds])

  const openConstraints=(add=false) => {
    objects.cancel(); setAssemblyTab('panels')
    if(assembly.editingInstance) { notify('Finish editing the shared assembly before managing project constraints.'); return}
    clipboard.cancel(); assembly.clearPlacement(); closeContextMenu(); if(selectedConnectorIds.length) setSelectedConnectorIds([])
    setProjectConstraintsOpen(!add)
    setInspectorTab('panel'); setRightOpen(true); setRealisticPreview(false); setExploded(false)
    if(window.innerWidth<=900) setLeftOpen(false)
    if(add) constraints.open(); else constraints.manage()
  }
  return { canMenuAutoConnect,openConstraints }
}
