import { type ProjectDialog } from '@/components/ProjectDialogs'
import { INITIAL_ATTACHMENT } from '@/editor/editor-defaults'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useDesignConstraints } from '@/hooks/use-design-constraints'
import { useProject } from '@/hooks/use-project'
import { createAssemblyFile,parseAssemblyFile } from '@/lib/assembly-file'
import { insertAssemblyDefinition } from '@/lib/assembly-library'
import { createExampleProject } from '@/lib/example-library'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { parseProject } from '@/lib/model'
import type { AssemblyDefinition,AttachmentOptions,CameraView,Project } from '@/lib/types'
import { type SetStateAction } from 'react'

interface CreateProjectFileCommandsOptions {
  inspectingConnectors: boolean
  selectedIds: string[]
  clipboard: ReturnType<typeof useCopyPaste>
  project: Project
  commit: ReturnType<typeof useProject>['commit']
  assembly: ReturnType<typeof useAssemblyEditor>
  setSelectedIds: (next: SetStateAction<string[]>) => void
  setInspectorTab: React.Dispatch<React.SetStateAction<"panel" | "attach">>
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>
  setExploded: React.Dispatch<React.SetStateAction<boolean>>
  setRealisticPreview: React.Dispatch<React.SetStateAction<boolean>>
  setFitSignal: React.Dispatch<React.SetStateAction<number>>
  notify: (message: string) => void
  setAssemblyImportError: React.Dispatch<React.SetStateAction<string>>
  setPendingTemplate: React.Dispatch<React.SetStateAction<{ id: string; project: Project; returnTo: ProjectDialog; } | null>>
  dialog: ProjectDialog
  setDialog: React.Dispatch<React.SetStateAction<ProjectDialog>>
  setProjectConstraintsOpen: React.Dispatch<React.SetStateAction<boolean>>
  constraints: ReturnType<typeof useDesignConstraints>
  pendingTemplate: { id: string; project: Project; returnTo: ProjectDialog }|null
  closeContextMenu: () => void
  setView: React.Dispatch<React.SetStateAction<CameraView>>
  setAttachTarget: React.Dispatch<React.SetStateAction<string>>
  setAttachment: React.Dispatch<React.SetStateAction<AttachmentOptions>>
  setImportError: React.Dispatch<React.SetStateAction<string>>
}

export function createProjectFileCommands({
  inspectingConnectors, selectedIds, clipboard, project,
  commit, assembly, setSelectedIds, setInspectorTab,
  setRightOpen, setExploded, setRealisticPreview, setFitSignal,
  notify, setAssemblyImportError, setPendingTemplate, dialog,
  setDialog, setProjectConstraintsOpen, constraints, pendingTemplate,
  closeContextMenu, setView, setAttachTarget, setAttachment,
  setImportError
}: CreateProjectFileCommandsOptions) {
  const insertModuleDefinition=(definition: AssemblyDefinition) => {
    try {
      if(!inspectingConnectors&&selectedIds.length) {
        clipboard.insert({
          kind: 'assembly',definition,instance: {
            id: crypto.randomUUID(),definitionId: definition.id,name: definition.name,
            position: [0,0,0],rotation: [0,0,0],panelIds: {},
          }
        })
        return
      }
      clipboard.cancel()
      const next=insertAssemblyDefinition(project,definition)
      commit(next); assembly.close()
      setSelectedIds(Object.values(next.assemblies!.instances.at(-1)!.panelIds))
      setInspectorTab('panel'); setRightOpen(true); setExploded(false); setRealisticPreview(false); setFitSignal(v => v+1)
      notify('Assembly inserted. Duplicate it or attach it to your build.')
    } catch(error) { notify(error instanceof Error? error.message:'Could not insert assembly.')}
  }
  const insertModule=(id: string) => insertModuleDefinition(createExampleProject(id).assemblies!.definitions[0])
  const exportAssembly=() => {
    if(!assembly.selectedInstance) return
    try {
      const file=createAssemblyFile(project,assembly.selectedInstance.id)
      const name=file.definition.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'assembly'
      download(JSON.stringify(file,null,2),`${name}.playwood-assembly.json`,'application/json')
      notify('Assembly exported')
    } catch(error) { notify(error instanceof Error? error.message:'Could not export assembly.')}
  }
  const importAssembly=async (file: File) => {
    try {
      if(file.size>2000000) throw new Error('Choose an assembly file smaller than 2 MB.')
      const definition=parseAssemblyFile(JSON.parse(await file.text()))
      setAssemblyImportError('')
      insertModuleDefinition(definition)
    } catch(error) { setAssemblyImportError(error instanceof Error? error.message:'This assembly file could not be read.')}
  }
  const insertSavedAssembly=(id: string) => {
    if(inspectingConnectors||!selectedIds.length) { clipboard.cancel(); assembly.insert(id); return}
    const definition=assembly.definitions.find(item => item.id===id)
    if(!definition) return
    clipboard.insert({
      kind: 'assembly',definition,instance: {
        id: crypto.randomUUID(),definitionId: id,name: definition.name,
        position: [0,0,0],rotation: [0,0,0],panelIds: {},
      }
    })
  }
  const loadTemplate=(template: string) => { setPendingTemplate({ id: template,project: createExampleProject(template),returnTo: dialog }); setDialog('replace') }
  const applyTemplate=(template: string,next: Project) => { setProjectConstraintsOpen(false); constraints.cancel(); clipboard.cancel(); commit(next,{ replace: true }); assembly.close(); const instance=next.assemblies?.instances[0]; setSelectedIds(instance? Object.values(instance.panelIds):next.panels.slice(0,1).map(p => p.id)); setInspectorTab('panel'); setDialog(null); setPendingTemplate(null); setExploded(false); setFitSignal(v => v+1); notify(template==='blank'? 'A fresh start. Add your first panel.':'Template loaded. Make it your own.') }
  const closeProjectDialog=() => { setDialog(dialog==='replace'? pendingTemplate?.returnTo??null:null); setPendingTemplate(null) }
  const exportName=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'playwood-project'
  const startNewProject=() => { closeContextMenu(); applyTemplate('blank',createExampleProject('blank')); setRealisticPreview(false); setView('perspective'); setAttachTarget('new'); setAttachment(INITIAL_ATTACHMENT); setImportError(''); notify('New project started. Undo to restore your previous project.') }
  const exportProject=() => { download(JSON.stringify(project,null,2),`${exportName}.playwood.json`,'application/json'); notify('Project exported') }
  const importProject=async (file: File) => { try { if(file.size>2000000) throw new Error('Choose a project file smaller than 2 MB.'); const imported=parseProject(JSON.parse(await file.text())); const shelf=(imported.constraints?.length||imported.spaceConstraint?.enabled)? imported:repairLegacyShelf(imported); const repaired=(imported.constraints?.length||imported.spaceConstraint?.enabled)? shelf:repairLegacyExampleInserts(shelf); setProjectConstraintsOpen(false); constraints.cancel(); commit(repaired,{ replace: true }); assembly.close(); const first=repaired.assemblies?.instances[0]; setSelectedIds(first? Object.values(first.panelIds):repaired.panels.slice(0,1).map(panel => panel.id)); setInspectorTab('panel'); setFitSignal(v => v+1); setImportError(''); setDialog(null); notify(repaired===imported? 'Project imported':repaired!==shelf? 'Project imported · library inserts fitted':'Project imported · middle shelf joints corrected')}  catch(e) { setImportError(e instanceof Error? e.message:'This project file could not be read.'); setDialog('export')}  }
  return { loadTemplate,insertModule,insertSavedAssembly,exportAssembly,startNewProject,closeProjectDialog,applyTemplate,exportName,exportProject,importProject,importAssembly }
}

export function download(content:string,name:string,type:string) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}
