import type { SyncedProjectLibrary } from '@/components/ExampleBrowser'
import { ConstructionObjectsList } from '@/components/ConstructionObjectsList'
import type { ListGroupingProps } from '@/components/GroupedList'
import type { ProjectDialog } from '@/components/ProjectDialogs'
import { ProjectSidebar } from '@/components/ProjectSidebar'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useProject } from '@/hooks/use-project'
import { updateConstructionObject } from '@/lib/construction-objects'
import { orderedConnectors } from '@/lib/list-groups'
import { removePanel,validateProject } from '@/lib/model'
import { selectPanelIds } from '@/lib/selection'
import type { AssemblyInstance,ListKind,Panel } from '@/lib/types'
import { type SetStateAction } from 'react'


interface EditorSidebarProps {
  onRepairPanel: (id: string) => void
  syncedProjects?: SyncedProjectLibrary
  objects: ReturnType<typeof useConstructionEditor>
  objectControlsDisabled: boolean
  chooseObject: (id: string|null,additive?: boolean) => void
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFrameSignal: React.Dispatch<React.SetStateAction<number>>
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>
  commit: ReturnType<typeof useProject>['commit']
  notify: (message: string) => void
  assemblyTab: ListKind | "objects"
  changeAssemblyTab: (tab: ListKind|"objects") => void
  listGrouping: (kind: ListKind) => ListGroupingProps
  panels: Panel[]
  selectedIds: string[]
  issues: ReturnType<typeof validateProject>
  choosePanel: (id: string|null,additive?: boolean) => void
  selectedPanels: Panel[]
  connectorCount: number
  connectorSummary: string
  assembly: ReturnType<typeof useAssemblyEditor>
  setPanelSelection: React.Dispatch<React.SetStateAction<string[]>>
  selectAll: (includeConnectors?: boolean) => void
  physicalConnectors: ReturnType<typeof orderedConnectors>
  selectedConnectorIds: string[]
  selectConnectors: (next: SetStateAction<string[]>,revealInspector?: boolean,additive?: boolean) => void
  setDialog: React.Dispatch<React.SetStateAction<ProjectDialog>>
  addPanel: () => void
  loadTemplate: (template: string) => void
  insertModule: (id: string) => void
  instance: AssemblyInstance|undefined
  clipboard: ReturnType<typeof useCopyPaste>
  insertSavedAssembly: (id: string) => void
  setAssemblyImportError: React.Dispatch<React.SetStateAction<string>>
  assemblyImportRef: React.RefObject<HTMLInputElement | null>
  assemblyImportError: string
}

export function EditorSidebar({
  onRepairPanel, objects, objectControlsDisabled, chooseObject, setRightOpen,
  setFrameSignal, setLeftOpen, commit, notify,
  assemblyTab, changeAssemblyTab, listGrouping, panels,
  selectedIds, issues, choosePanel, selectedPanels,
  connectorCount, connectorSummary, assembly, setPanelSelection,
  selectAll, physicalConnectors, selectedConnectorIds, selectConnectors,
  setDialog, addPanel, loadTemplate, insertModule,
  instance, clipboard, insertSavedAssembly, setAssemblyImportError,
  assemblyImportRef, assemblyImportError, syncedProjects
}: EditorSidebarProps)  {
  return <ProjectSidebar syncedProjects={syncedProjects}
    objectsContent={<ConstructionObjectsList objects={objects.objects} selectedIds={objects.selectedIds} disabled={objectControlsDisabled||objects.editing}
    onSelect={chooseObject} onAdd={() => { if(objects.add()) { setRightOpen(true); setFrameSignal(v => v+1); if(window.innerWidth<=900) setLeftOpen(false)}  } }
    onVisibility={node => { try { commit(current => updateConstructionObject(current,node))}  catch(error) { notify(error instanceof Error? error.message:'Could not change object visibility.')}  } } />}
    assemblyTab={assemblyTab}
    onAssemblyTabChange={changeAssemblyTab}
    panelListProps={{
      ...listGrouping('panels'),panels: panels,
      selectedIds: selectedIds,
      issues: issues,
      onSelect: choosePanel,
      onRepair: onRepairPanel,
      onRename: (id,name) => commit(p => ({ ...p,panels: p.panels.map(panel => panel.id===id? { ...panel,name }:panel) })),
      onRemove: id => { commit(p => removePanel(p,id)); notify('Panel removed. Undo to bring it back.') },
      onToggleVisibility: id => commit(p => ({ ...p,panels: p.panels.map(panel => panel.id===id? { ...panel,visible: !panel.visible }:panel) })),
    }}
    selectedCount={selectedPanels.length}
    connectorCount={connectorCount}
    connectorSummary={connectorSummary}
    onSelectAll={() => { if(selectedPanels.length===panels.length&&!assembly.editingInstance) setPanelSelection([]); else selectAll() } }
    connectorListProps={{
      ...listGrouping('connectors'),connectors: physicalConnectors,panels,selectedIds: selectedConnectorIds,
      onSelect: (id,additive=false) => selectConnectors(ids => selectPanelIds(ids,id,additive),!additive,additive),
      onSelectAll: selected => selectConnectors(selected? physicalConnectors.map(connector => connector.id):[],selected,true)
    }}
    onCollapse={() => setLeftOpen(false)}
    onParts={() => setDialog('parts')}
    onHelp={() => setDialog('help')}
    addPanel={addPanel}
    loadTemplate={loadTemplate}
    onInsertLibraryAssembly={insertModule}
    assemblies={assembly.sidebarAssemblies}
    selectedAssemblyId={instance?.id}
    onSelectAssembly={id => { clipboard.cancel(); assembly.select(id) } }
    onSelectAssemblyPanel={assembly.drillIn}
    libraryAssemblies={assembly.libraryAssemblies}
    onInsertAssembly={insertSavedAssembly}
    onImportAssembly={() => { setAssemblyImportError(''); assemblyImportRef.current?.click() } }
    assemblyImportError={assemblyImportError} />
}
