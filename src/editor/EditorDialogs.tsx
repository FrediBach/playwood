import { ConnectorInfillDialog } from '@/components/ConnectorInfillDialog'
import { ObjectConversionDialog } from '@/components/ObjectConversionDialog'
import { ProjectDialogs,type ProjectDialog } from '@/components/ProjectDialogs'
import { download } from '@/editor/project-file-commands'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useConstructionEditor } from '@/hooks/use-construction-editor'
import { useProject } from '@/hooks/use-project'
import { addConnectorsBetween } from '@/lib/connector-infill'
import { moveProject,projectToCsv,rotateProject,validateProject } from '@/lib/model'
import { panelSvgFilename,panelToSvg } from '@/lib/panel-svg'
import { rescaleProject } from '@/lib/project-rescale'
import type { Panel,Project } from '@/lib/types'
import { type SetStateAction } from 'react'

interface EditorDialogsProps {
  startNewProject: () => void
  dialog: ProjectDialog
  closeProjectDialog: () => void
  draft: Panel
  setDraft: React.Dispatch<React.SetStateAction<Panel>>
  loadTemplate: (template: string) => void
  pendingTemplate: { id: string; project: Project; returnTo: ProjectDialog }|null
  applyTemplate: (template: string,next: Project) => void
  exportName: string
  notify: (message: string) => void
  exportProject: () => void
  project: Project
  importRef: React.RefObject<HTMLInputElement | null>
  importError: string
  panels: Panel[]
  connectorCount: number
  issues: ReturnType<typeof validateProject>
  commit: ReturnType<typeof useProject>['commit']
  assembly: ReturnType<typeof useAssemblyEditor>
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  setDialog: React.Dispatch<React.SetStateAction<ProjectDialog>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  inspectingConnectors: boolean
  selectedIds: string[]
  addDraftPanel: () => void
}

export function EditorDialogs({
  startNewProject, dialog, closeProjectDialog, draft,
  setDraft, loadTemplate, pendingTemplate, applyTemplate,
  exportName, notify, exportProject, project,
  importRef, importError, panels, connectorCount,
  issues, commit, assembly, setInspectorTab,
  setExploded, setDialog, setFitSignal, inspectingConnectors,
  selectedIds, addDraftPanel
}: EditorDialogsProps)  {
  return <ProjectDialogs
    onNew={startNewProject}
    dialog={dialog}
    onClose={closeProjectDialog}
    draft={draft}
    setDraft={setDraft}
    loadTemplate={loadTemplate}
    replacementName={pendingTemplate?.project.name??''}
    onReplace={() => { if(pendingTemplate) applyTemplate(pendingTemplate.id,pendingTemplate.project) } }
    onExportPanelSvg={(panel,index) => { download(panelToSvg(panel),`${exportName}-${panelSvgFilename(panel,index)}`,'image/svg+xml'); notify('Panel SVG exported') } }
    exportProject={exportProject}
    onExportParts={() => { download(projectToCsv(project),`${exportName}-parts.csv`,'text/csv'); notify('Parts list exported') } }
    onImport={() => importRef.current?.click()}
    importError={importError}
    project={project}
    panels={panels}
    connectorCount={connectorCount}
    issues={issues}
    onMoveCreation={delta => { commit(p => moveProject(p,delta)); assembly.close(); setInspectorTab('panel'); setExploded(false); setDialog(null); notify('Creation moved. Undo is available.') } }
    onRescale={(changes,niceValues) => { commit(p => { if(p!==project) throw new Error('The project changed. Close and reopen Rescale creation.'); return rescaleProject(p,changes,niceValues) }); assembly.close(); setInspectorTab('panel'); setExploded(false); setDialog(null); setFitSignal(v => v+1); notify('Rescale settings applied. Undo is available.') } }
    onRotate={(axis,degrees) => { commit(p => rotateProject(p,axis,degrees)); assembly.close(); setInspectorTab('panel'); setExploded(false); setDialog(null); setFitSignal(v => v+1); notify(`Creation rotated ${degrees}° around ${axis.toUpperCase()}. Undo is available.`) } }
    attachNewPanel={!inspectingConnectors&&selectedIds.length>0}
    onAdd={addDraftPanel} />
}

interface EditorObjectConversionProps {
  objectConversion: { source: Project; ids: string[] }
  project: Project
  setObjectConversion: React.Dispatch<React.SetStateAction<{ source: Project; ids: string[]; } | null>>
  commit: ReturnType<typeof useProject>['commit']
  objects: ReturnType<typeof useConstructionEditor>
  setSelectedIds: (next: SetStateAction<string[]>) => void
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  notify: (message: string) => void
}

export function EditorObjectConversion({ objectConversion, project, setObjectConversion, commit, objects, setSelectedIds, setInspectorTab, setRightOpen, setFitSignal, notify }: EditorObjectConversionProps)  {
  return <ObjectConversionDialog source={objectConversion.source} project={project} ids={objectConversion.ids} onCancel={() => setObjectConversion(null)} onAccept={result => {
    try {
      commit(current => { if(current!==objectConversion.source) throw new Error('The project changed. Convert again.'); return result.project })
      setObjectConversion(null); objects.select(null); setSelectedIds(result.panelIds); setInspectorTab('panel'); setRightOpen(true); setFitSignal(v => v+1)
      notify(`Created ${result.panelIds.length} panels. Source objects are retained and hidden.`)
    } catch(error) { notify(error instanceof Error? error.message:'Could not create panels.')}
  } } />
}

interface EditorConnectorInfillProps {
  project: Project
  connectorInfill: { source: Project; ids: string[] }
  setConnectorInfill: React.Dispatch<React.SetStateAction<{ source: Project; ids: string[]; } | null>>
  notify: (message: string) => void
  commitWithInsertChecks: (change: (current: Project) => Project,options?: { group: string; repeat: boolean }) => boolean
}

export function EditorConnectorInfill({ project, connectorInfill, setConnectorInfill, notify, commitWithInsertChecks }: EditorConnectorInfillProps)  {
  return <ConnectorInfillDialog project={project} ids={connectorInfill.ids} onCancel={() => setConnectorInfill(null)} onApply={count => {
    if(project!==connectorInfill.source) { notify('The project changed. Select the connectors again.'); setConnectorInfill(null); return}
    if(commitWithInsertChecks(current => addConnectorsBetween(current,connectorInfill.ids,count))) { setConnectorInfill(null); notify(`Added ${count} connectors. Undo is available.`)}
  } } />
}
