import type { Notify } from '@/editor/editor-notifications'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { useProject } from '@/hooks/use-project'
import type { SnapSettings } from '@/lib/preview-snap'
import { mirrorSelection } from '@/lib/selection-mirror'
import { rotateSelection } from '@/lib/selection-rotation'
import type { Panel } from '@/lib/types'


interface CreateEditorKeyHandlerOptions {
  connectMode?: boolean
  cancelConnect?: () => void
  previewShortcut: (event: KeyboardEvent) => boolean
  previewShortcutsEnabled: boolean
  modalOpen: boolean
  constraints: ReturnType<typeof useDesignConstraints>
  pickingConstraint: boolean
  constraintPicker: React.RefObject<((id: string) => boolean) | null>
  setPickingConstraint: React.Dispatch<React.SetStateAction<boolean>>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  projectConstraintsOpen: boolean
  closeProjectConstraints: () => void
  objectMode: boolean
  realisticPreview: boolean
  redo: () => void
  undo: () => void
  objects: ReturnType<typeof useConstructionEditor>
  objectControlsDisabled: boolean
  toggleBoxSelect: () => void
  boxSelectActive: boolean
  setSnapSettings: React.Dispatch<React.SetStateAction<SnapSettings>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  boxSelectAvailable: boolean
  canAttachPanel: boolean
  startAttach: () => void
  clipboard: ReturnType<typeof useCopyPaste>
  inspectingConnectors: boolean
  movementEnabled: boolean
  drag: ReturnType<typeof usePreviewDrag>
  resize: ReturnType<typeof usePreviewResize>
  assembly: ReturnType<typeof useAssemblyEditor>
  selectedPanels: Panel[]
  commit: ReturnType<typeof useProject>['commit']
  selectedIds: string[]
  notify: Notify
  setRealisticPreview: React.Dispatch<React.SetStateAction<boolean>>
  selectAll: (includeConnectors?: boolean) => void
  duplicateSelected: () => void
  deleteSelected: () => void
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setSelectedId: (id: string|null) => void
}

export function createEditorKeyHandler({
  connectMode, cancelConnect,
  previewShortcut, previewShortcutsEnabled, modalOpen, constraints, pickingConstraint, constraintPicker,
  setPickingConstraint, setRightOpen, projectConstraintsOpen, closeProjectConstraints,
  objectMode, realisticPreview, redo, undo,
  objects, objectControlsDisabled, toggleBoxSelect, boxSelectActive,
  setSnapSettings, setFitSignal, boxSelectAvailable, canAttachPanel,
  startAttach, clipboard, inspectingConnectors, movementEnabled,
  drag, resize, assembly, selectedPanels,
  commit, selectedIds, notify, setRealisticPreview,
  selectAll, duplicateSelected, deleteSelected, setInspectorTab,
  setSelectedId
}: CreateEditorKeyHandlerOptions) {
  return (e: KeyboardEvent) => {
    const target=e.target as HTMLElement
    if(e.defaultPrevented||e.isComposing||target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')||target.isContentEditable||target.closest('dialog,[role="dialog"]')||modalOpen||document.querySelector('[data-editor-drawer]')) return
    if(connectMode) {
      if(e.key==='Escape') { e.preventDefault(); cancelConnect?.(); document.querySelector<HTMLButtonElement>('button[aria-label="Connect mode"]')?.focus() }
      else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z') { e.preventDefault(); e.shiftKey?redo():undo() }
      else if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='b') { e.preventDefault(); if(!e.repeat)toggleBoxSelect() }
      else if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='f') setFitSignal(v=>v+1)
      return
    }
    if(constraints.editing) { if(e.key==='Escape') { e.preventDefault(); if(pickingConstraint) { constraintPicker.current=null; setPickingConstraint(false); setRightOpen(true)}  else constraints.cancel()}  return}
    if(projectConstraintsOpen&&e.key==='Escape') { e.preventDefault(); closeProjectConstraints(); return}
    if(objectMode&&!realisticPreview) {
      const key=e.key.toLowerCase(),command=e.metaKey||e.ctrlKey
      if(command&&key==='z') { e.preventDefault(); e.shiftKey? redo():undo(); return}
      if(e.key==='Escape') { e.preventDefault(); if(objects.editing) objects.cancel(); else objects.select(null); return}
      if(objectControlsDisabled||objects.editing) return
      if(!command&&!e.altKey&&key==='b') { e.preventDefault(); if(!e.repeat) toggleBoxSelect(); return}
      if(boxSelectActive) return
      if(!command&&!e.altKey&&(key==='g'||key==='s')) { e.preventDefault(); if(!e.repeat) setSnapSettings(value => ({ ...value,[key==='g'? 'grid':'geometry']: !value[key==='g'? 'grid':'geometry'] })); return}
      if(command&&['a','c','v','d'].includes(key)) {
        e.preventDefault(); if(e.repeat) return
        if(key==='a') objects.selectAll(); else if(key==='c') objects.copy(); else if(key==='v') objects.paste(); else objects.duplicate()
        return
      }
      if(!command&&!e.altKey) {
        if(['x','y','z'].includes(key)) { e.preventDefault(); if(!e.repeat) objects.rotate(['x','y','z'].indexOf(key) as 0|1|2)}
        if(e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); if(objects.selectedIds.length) objects.remove()}
        if(key==='f') setFitSignal(v => v+1)
      }
      return
    }
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='b') {
      if(boxSelectAvailable) { e.preventDefault(); if(!e.repeat) toggleBoxSelect()}
      return
    }
    if(boxSelectActive) return
    // Keep Select All scoped to connectors when that list is active.
    if(previewShortcutsEnabled && inspectingConnectors && (e.metaKey||e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase()==='a') { e.preventDefault(); if(!e.repeat) selectAll(true); return }
    if(previewShortcutsEnabled && previewShortcut(e)) return
    if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.toLowerCase()==='a') {
      if(canAttachPanel) { e.preventDefault(); if(!e.repeat) startAttach()}
      return
    }
    if((e.metaKey||e.ctrlKey)&&['c','v'].includes(e.key.toLowerCase())) {
      e.preventDefault(); if(!e.repeat) { if(e.key.toLowerCase()==='c') clipboard.copy(); else clipboard.paste()}  return
    }
    if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&['g','s'].includes(e.key.toLowerCase())) {
      e.preventDefault()
      if(!e.repeat) setSnapSettings(value => ({ ...value,[e.key.toLowerCase()==='g'? 'grid':'geometry']: !value[e.key.toLowerCase()==='g'? 'grid':'geometry'] }))
      return
    }
    const axis=e.key.toLowerCase()
    if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&(axis==='x'||axis==='y'||axis==='z')) {
      if(!inspectingConnectors&&movementEnabled&&!drag.active&&!resize.active&&!assembly.target&&selectedPanels.length) {
        e.preventDefault()
        if(!e.repeat) {
          try { commit(current => e.shiftKey? mirrorSelection(current,selectedIds,axis):rotateSelection(current,selectedIds,axis))}
          catch(error) { notify(error instanceof Error? error.message:'This selection cannot rotate while keeping its joints aligned.','error')}
        }
      }
      return
    }
    if(realisticPreview) {
      if(e.metaKey||e.ctrlKey) { if(['a','d','z'].includes(e.key.toLowerCase())) e.preventDefault(); if(e.key.toLowerCase()==='z') e.shiftKey? redo():undo(); return}
      if(e.key.toLowerCase()==='f') setFitSignal(v => v+1)
      if(e.key==='Escape') setRealisticPreview(false)
      return
    }
    if(e.metaKey||e.ctrlKey) {
      if(e.key.toLowerCase()==='a') { e.preventDefault(); selectAll(true)}
      else if(e.key.toLowerCase()==='z') { e.preventDefault(); e.shiftKey? redo():undo()}
      else if(e.key.toLowerCase()==='d') { e.preventDefault(); duplicateSelected()}
    } else {
      if(e.key==='Delete'||e.key==='Backspace') { e.preventDefault(); deleteSelected()}
      if(e.key.toLowerCase()==='f') setFitSignal(v => v+1)
      if(e.key==='Escape') {
        if(clipboard.active) { clipboard.cancel(); (document.activeElement as HTMLElement)?.blur()}
        else if(assembly.target||assembly.placementActive) { assembly.clearPlacement(); (document.activeElement as HTMLElement)?.blur()}
        else if(assembly.editingInstance) assembly.done()
        else if(!inspectingConnectors&&assembly.memberInstance&&!assembly.selectedInstance) assembly.select(assembly.memberInstance.id)
        else { setInspectorTab('panel'); setSelectedId(null)}
      }
    }
  }
}
