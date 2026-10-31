import { createListGroup, moveListItems, orderedConnectors, renameListGroup, ungroupList } from '@/lib/list-groups'
import type { ListGroupingProps } from '@/components/GroupedList'
import { PreviewContextMenu, type PreviewMenuAction } from '@/components/PreviewContextMenu'
import { ConnectorInspector } from '@/components/ConnectorInspector'
import { CloseHoles } from '@/components/CloseHoles'
import { closePanelHole, findPanelHoles } from '@/lib/close-holes'
import { editConnectors } from '@/lib/connector-selection'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { Box, CheckCheck, Copy, Link2, MousePointer2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectHeader } from '@/components/ProjectHeader'
import { ProjectDialogs, type ProjectDialog } from '@/components/ProjectDialogs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AssemblyWorkspace } from '@/components/AssemblyWorkspace'
import { InspectorSidebar } from '@/components/InspectorSidebar'
import { SinglePanelInspector } from '@/components/SinglePanelInspector'
import { AttachmentInspector } from '@/components/AttachmentInspector'
import { AssemblyInspector, CreateAssemblyForm } from '@/components/AssemblyInspector'
import { AssemblyEditingInspector, AssemblyPartInspector } from '@/components/AssemblyEditingInspector'
import { CONNECTORS, DEFAULT_CONNECTOR_COLOR } from '@/lib/connector-options'
import { MultiPanelInspector } from '@/components/MultiPanelInspector'
import { ProjectStatus } from '@/components/ProjectStatus'
import { ProjectSidebar } from '@/components/ProjectSidebar'
import { insertAssemblyDefinition } from '@/lib/assembly-library'
import { createAssemblyFile, parseAssemblyFile } from '@/lib/assembly-file'
import { createExampleProject } from '@/lib/example-library'
import { getSharedPanelFields, panelValuesEqual, selectPanelIds, updateSelectedPanels, updateSelectedConnections } from '@/lib/selection'
import { parallelPanelCut, splitParallelPanels } from '@/lib/parallel-panels'
import { autoConnect } from '@/lib/auto-connect'
import { getConnectorPanelFit } from '@/lib/connect-panel'
import { movePanels, resizePanels } from '@/lib/structure-edit'
import { rotateSelection } from '@/lib/selection-rotation'
import { useAttachmentPreview } from '@/hooks/use-attachment-preview'
import { useProject } from '@/hooks/use-project'
import { useCopyPaste } from '@/hooks/use-copy-paste'
import { useAssemblyEditor } from '@/hooks/use-assembly-editor'
import { usePreviewDrag } from '@/hooks/use-preview-drag'
import { usePreviewResize } from '@/hooks/use-preview-resize'
import { duplicateAssembly, getAssemblyInstance, getAssemblyMovementPanelIds, isPanelConnectedToAssembly, moveAssemblies, removeAssembly } from '@/lib/assemblies'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import { detachPanel, createPanel, duplicatePanel, getProjectBounds, parseProject, projectToCsv, removePanel, resolvePanels, rotateProject, validateProject } from '@/lib/model'
import type { AssemblyDefinition, AttachmentOptions, CameraView, Panel, Vec3, ListKind } from '@/lib/types'

const INITIAL_ATTACHMENT: AttachmentOptions = {side:'right',type:'90',offset:0,inset:0,flip:false,color:DEFAULT_CONNECTOR_COLOR,count:2}
function download(content:string,name:string,type:string) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}

export default function App() {
  const {project,commit,undo,redo,canUndo,canRedo,saveStatus,repairNotice}=useProject()
  const [selectedConnectorIds,setSelectedConnectorIds]=useState<string[]>([])
  const [selectedIds,setPanelSelection]=useState<string[]>(()=>{const first=project.panels[0];const instance=first&&getAssemblyInstance(project,first.id);return instance?Object.values(instance.panelIds):first?[first.id]:[]})
  const setSelectedIds=useCallback((next:SetStateAction<string[]>)=>{setSelectedConnectorIds([]);setPanelSelection(next)},[])
  const setSelectedId=useCallback((id:string|null)=>setSelectedIds(id?[id]:[]),[])
  const [contextMenu,setContextMenu]=useState<{x:number;y:number}|null>(null)
  const closeContextMenu=useCallback(()=>setContextMenu(null),[])
  const [inspectorTab,setInspectorTab]=useState<'panel'|'attach'>('panel')
  const [dialog,setDialog]=useState<ProjectDialog>(null)
  const [draft,setDraft]=useState(()=>createPanel({name:'My panel',width:600,height:360,thickness:18}))
  const [attachTarget,setAttachTarget]=useState('new')
  const [attachment,setAttachment]=useState<AttachmentOptions>(INITIAL_ATTACHMENT)
  const [view,setView]=useState<CameraView>('perspective')
  const [realisticPreview,setRealisticPreview]=useState(false)
  const [showGrid,setShowGrid]=useState(true),[showDimensions,setShowDimensions]=useState(false),[exploded,setExploded]=useState(false)
  const [fitSignal,setFitSignal]=useState(0),[zoomSignal,setZoomSignal]=useState({direction:0,key:0})
  const [frameSignal,setFrameSignal]=useState(0)
  const [leftOpen,setLeftOpen]=useState(window.innerWidth>900),[rightOpen,setRightOpen]=useState(window.innerWidth>680)
  useEffect(()=>{
    const closeOverlappingSidebar=()=>{if(window.innerWidth<=900)setLeftOpen(false)}
    window.addEventListener('resize',closeOverlappingSidebar)
    return()=>window.removeEventListener('resize',closeOverlappingSidebar)
  },[])
  const [toast,setToast]=useState(''),[importError,setImportError]=useState('')
  const importRef=useRef<HTMLInputElement>(null)
  const assemblyImportRef=useRef<HTMLInputElement>(null)
  const [assemblyImportError,setAssemblyImportError]=useState('')
  const panels=useMemo(()=>resolvePanels(project),[project])
  const selectedIdSet=useMemo(()=>new Set(selectedIds),[selectedIds])
  const selectedPanels=panels.filter(p=>selectedIdSet.has(p.id))
  const selectedFinishCoverages=selectedPanels.map(p=>p.material==='painted'?1:p.finishCoverage??0)
  const selected=selectedPanels.length===1?selectedPanels[0]:undefined
  const selectedId=selected?.id??null
  const connection=project.connections.find(c=>c.childId===selectedId&&c.role!=='support')
  const bounds=useMemo(()=>getProjectBounds(panels),[panels])
  const visibleBounds=useMemo(()=>getProjectBounds(panels.filter(panel=>panel.visible)),[panels])
  const hasVisiblePanels=panels.some(panel=>panel.visible)
  const issues=useMemo(()=>validateProject(project),[project])
  const physicalConnectors=useMemo(()=>orderedConnectors(project),[project])
  const selectedConnectorIdSet=useMemo(()=>new Set(selectedConnectorIds),[selectedConnectorIds])
  const selectedConnectors=physicalConnectors.filter(connector=>selectedConnectorIdSet.has(connector.id))
  const connectorPanelFit=useMemo(()=>getConnectorPanelFit(project,selectedConnectorIds),[project,selectedConnectorIds])
  const connectorCount=physicalConnectors.length
  const connectorSummary=CONNECTORS.map(type=>({name:type.name,count:physicalConnectors.filter(c=>c.type===type.id).length})).filter(type=>type.count>0).map(type=>`${type.count} × ${type.name}`).join(' · ')
  const notify=useCallback((message:string)=>setToast(message),[])
  const drag=usePreviewDrag({project,selectedIds,commit,notify,select:setSelectedIds})
  const assembly=useAssemblyEditor({project,selectedIds,setSelectedIds,commit,notify,
    prepareSelection:()=>{setInspectorTab('panel');setRightOpen(true);setExploded(false);if(window.innerWidth<=900)setLeftOpen(false)},fit:()=>setFrameSignal(v=>v+1)})
  const clipboard=useCopyPaste({project,selectedIds,commit,notify,
    prepare:()=>{assembly.clearPlacement();setInspectorTab('panel');setExploded(false);setRealisticPreview(false);setFrameSignal(v=>v+1)},
    select:ids=>{assembly.close();setSelectedIds(ids);setInspectorTab('panel');setRightOpen(true);setFrameSignal(v=>v+1)}})
  const assemblyCount=(definitionId:string)=>assembly.instances.filter(instance=>instance.definitionId===definitionId).length
  useEffect(()=>{if(repairNotice)notify(repairNotice)},[repairNotice,notify])
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)}},[toast])
  useEffect(()=>{setPanelSelection(ids=>{const remaining=ids.filter(id=>project.panels.some(p=>p.id===id));return remaining.length===ids.length?ids:remaining})},[project.panels])
  useEffect(()=>{setSelectedConnectorIds(ids=>{
    const remaining=ids.filter(id=>physicalConnectors.some(connector=>connector.id===id))
    return remaining.length===ids.length?ids:remaining
  })},[physicalConnectors])
  const removeSelectedConnectors=()=>{
    commit(current=>editConnectors(current,selectedConnectorIds,{removed:true}))
    setSelectedConnectorIds([]);notify('Connectors removed. Undo to bring them back.')
  }
  const selectConnectors=(next:SetStateAction<string[]>,revealInspector=true)=>{
    clipboard.cancel();assembly.close();setPanelSelection([])
    setSelectedConnectorIds(next)
    setInspectorTab('panel');setRightOpen(true)
    if(revealInspector&&window.innerWidth<=900)setLeftOpen(false)
  }
  const chooseConnector=(id:string,additive=false)=>selectConnectors(ids=>selectPanelIds(ids,id,additive))
  const checkLoosePanelPatch=(patch:Partial<Panel>)=>{
    if(selectedPanels.some(panel=>isPanelConnectedToAssembly(project,panel.id)&&(['position','rotation','thickness'] as const).some(key=>patch[key]!==undefined&&!panelValuesEqual(panel[key],patch[key])))) {
      throw new Error('These panels still connect to an assembly. Detach the panels before changing their placement or thickness.')
    }
  }
  const updatePanel=(patch:Partial<Panel>)=>{
    if(!selectedId)return false
    if(assembly.hasMembers)return assembly.editingInstance?assembly.updateDefinition(patch):false
    try {
      checkLoosePanelPatch(patch)
      const {width,height,...rest}=patch
      const base={...project,panels:project.panels.map(panel=>panel.id===selectedId?{...panel,...rest}:panel)}
      commit(width!==undefined||height!==undefined?resizePanels(base,[selectedId],{width,height}):base)
      return true
    } catch(error) {notify(error instanceof Error?error.message:'This panel size cannot keep the joints aligned.');return false}
  }
  const updateMultiplePanels=(patch:Partial<Panel>)=>{
    if(assembly.hasMembers)return assembly.editingInstance?assembly.updateDefinition(patch):false
    try {
      checkLoosePanelPatch(patch)
      const {width,height,...rest}=patch
      const shared=getSharedPanelFields(selectedPanels)
      const dimensions={width:shared.has('width')?width:undefined,height:shared.has('height')?height:undefined}
      const base=updateSelectedPanels(project,selectedIds,rest)
      commit(dimensions.width!==undefined||dimensions.height!==undefined?resizePanels(base,selectedIds,dimensions):base)
      return true
    } catch(error) {notify(error instanceof Error?error.message:'These panel sizes cannot keep the joints aligned.');return false}
  }
  const moveSelection=(delta:Vec3,repeat:boolean)=>{
    try {
      if(assembly.editingInstance)return
      commit(current=>{
        const instanceIds=[...new Set(selectedIds.map(id=>getAssemblyInstance(current,id)?.id).filter((id):id is string=>!!id))]
        const carriedIds=new Set(getAssemblyMovementPanelIds(current,instanceIds))
        const looseIds=selectedIds.filter(id=>!getAssemblyInstance(current,id)&&!carriedIds.has(id))
        const next=instanceIds.length?moveAssemblies(current,instanceIds,delta):current
        return looseIds.length?movePanels(next,looseIds,delta):next
      },{group:'panel-move',repeat})
    } catch(error) {notify(error instanceof Error?error.message:'This move cannot keep the joints aligned.')}
  }
  const splitSelection=()=>{
    try {
      const result=splitParallelPanels(project,selectedIds)
      commit(result.project);setSelectedIds(result.panelIds)
      notify(`Panels split into four sections with a center divider and ${result.connectors} new connectors. Undo is available.`)
    } catch(error) {notify(error instanceof Error?error.message:'These panels could not be split.')}
  }
  const detachSelection=()=>{
    try{commit(current=>selectedIds.reduce((next,id)=>detachPanel(next,id),current));setInspectorTab('panel');notify('Panels detached. Their positions are unchanged.')}
    catch(error){notify(error instanceof Error?error.message:'These panels could not be detached.')}
  }
  const deleteSelected=()=>{
    if(selectedConnectors.length){removeSelectedConnectors();return}
    if(assembly.editingInstance||assembly.memberInstance&&!assembly.selectedInstance){notify('Select the whole instance to remove it.');return}
    if(!selectedIds.length)return
    try{commit(current=>{
      const instanceIds=[...new Set(selectedIds.map(id=>getAssemblyInstance(current,id)?.id).filter((id):id is string=>!!id))]
      const looseIds=selectedIds.filter(id=>!getAssemblyInstance(current,id))
      const next=instanceIds.reduce((p,id)=>removeAssembly(p,id),current)
      return looseIds.reduce((p,id)=>removePanel(p,id),next)
    });assembly.clearPlacement();notify('Selection removed. Undo to bring it back.')}catch(error){notify(error instanceof Error?error.message:'This selection could not be removed.')}
  }
  const duplicateSelected=()=>{
    if(assembly.editingInstance||assembly.memberInstance&&!assembly.selectedInstance){notify('Select the whole instance to duplicate it.');return}
    if(!selectedIds.length)return
    try{let next=project;const copies:string[]=[];const copied=new Set<string>()
      for(const id of selectedIds){const instance=getAssemblyInstance(project,id)
        if(instance){if(copied.has(instance.id))continue;copied.add(instance.id);next=duplicateAssembly(next,instance.id);copies.push(...Object.values(next.assemblies!.instances.at(-1)!.panelIds))}
        else{const duplicate=duplicatePanel(next,id);if(duplicate!==next)copies.push(duplicate.panels.at(-1)!.id);next=duplicate}
      }
      commit(next);assembly.close();setSelectedIds(copies);if(copied.size)setFrameSignal(v=>v+1);notify(copied.size?'Linked instances duplicated':'Panels duplicated')
    }catch(error){notify(error instanceof Error?error.message:'This selection could not be duplicated.')}
  }
  const addAutoConnectors=()=>{
    try {
      const result=autoConnect(project,selectedIds)
      if(!result.joints){notify('No compatible unconnected edges found. Check panel angles, edge alignment, and connector clearance.');return}
      commit(result.project);clipboard.cancel();assembly.clearPlacement();setInspectorTab('panel');setExploded(false)
      if(result.splits&&selectedIds.length>1)setSelectedIds(ids=>[...ids,...result.addedPanelIds])
      notify(`${result.connectors} connectors ${result.upgrades?'fitted':'added'} at ${result.joints} ${result.joints===1?'joint':'joints'}. ${result.upgrades?`${result.upgrades} existing ${result.upgrades===1?'joint':'joints'} upgraded. `:''}${result.splits?`${result.splits} panel ${result.splits===1?'split':'splits'} for T joints; outer dimensions kept.`:'Panel positions kept.'}${result.disassembledNames.length?` Made independent: ${result.disassembledNames.join(', ')}.`:''} Undo is available.`)
    } catch(error){notify(error instanceof Error?error.message:'Connectors could not be added.')}
  }
  const connectWithPanel=()=>{
    if(assembly.editingInstance||dialog)return
    const result=connectorPanelFit.result
    if(!result){notify(connectorPanelFit.reason);return}
    commit(result.project);clipboard.cancel();assembly.clearPlacement();setSelectedId(result.panelId);setInspectorTab('panel');setRightOpen(true);setExploded(false);setFitSignal(v=>v+1)
    notify(`Panel fitted to ${selectedConnectors.length} connectors.${result.disassembledNames.length?` Made independent: ${result.disassembledNames.join(', ')}.`:''} Undo is available.`)
  }
  const selectAll=(includeConnectors=false)=>{
    if(includeConnectors&&selectedConnectors.length){setSelectedConnectorIds(physicalConnectors.filter(c=>[c.connection.parentId,c.connection.childId].every(id=>panels.some(p=>p.id===id&&p.visible))).map(c=>c.id));return}
    const ids=assembly.editingInstance?Object.values(assembly.editingInstance.panelIds):project.panels.map(p=>p.id)
    setSelectedIds(ids);assembly.clearPlacement();setInspectorTab('panel');setRightOpen(true)
  }
  const movementEnabled=!clipboard.active&&!dialog&&!assembly.editingInstance&&!(assembly.memberInstance&&!assembly.selectedInstance)&&!assembly.placementActive&&(realisticPreview||(!exploded&&inspectorTab!=='attach'))
  const resize=usePreviewResize({project,selectedIds,selectedConnectorIds,enabled:movementEnabled&&!drag.active&&!contextMenu,commit,notify})
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement
      if(e.defaultPrevented||e.isComposing||target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')||target.isContentEditable||dialog)return
      if((e.metaKey||e.ctrlKey)&&['c','v'].includes(e.key.toLowerCase())){
        e.preventDefault();if(!e.repeat){if(e.key.toLowerCase()==='c')clipboard.copy();else clipboard.paste()}return
      }
      const axis=e.key.toLowerCase()
      if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&(axis==='x'||axis==='y'||axis==='z')){
        if(movementEnabled&&!drag.active&&!resize.active&&!assembly.target&&selectedPanels.length){
          e.preventDefault()
          if(!e.repeat){
            try{commit(current=>rotateSelection(current,selectedIds,axis))}
            catch(error){notify(error instanceof Error?error.message:'This selection cannot rotate while keeping its joints aligned.')}
          }
        }
        return
      }
      if(realisticPreview){
        if(e.metaKey||e.ctrlKey){if(['a','d','z'].includes(e.key.toLowerCase()))e.preventDefault();if(e.key.toLowerCase()==='z')e.shiftKey?redo():undo();return}
        if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1)
        if(e.key==='Escape')setRealisticPreview(false)
        return
      }
      if(e.metaKey||e.ctrlKey){
        if(e.key.toLowerCase()==='a'){e.preventDefault();selectAll(true)}
        else if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}
        else if(e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelected()}
      }else{
        if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected()}
        if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1)
        if(e.key==='Escape'){
          if(clipboard.active){clipboard.cancel();(document.activeElement as HTMLElement)?.blur()}
          else if(assembly.target||assembly.placementActive){assembly.clearPlacement();(document.activeElement as HTMLElement)?.blur()}
          else if(assembly.editingInstance)assembly.done()
          else if(assembly.memberInstance&&!assembly.selectedInstance)assembly.select(assembly.memberInstance.id)
          else{setInspectorTab('panel');setSelectedId(null)}
        }
      }
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  })
  const {previewResult,previewProject,previewPanels,previewConnections,previewIssues,attachmentErrors}=useAttachmentPreview({project,selected,panels,draft,attachment,inspectorTab,attachTarget})
  const choosePanel=(id:string|null,additive=false)=>{
    if(!id&&additive&&selectedConnectors.length)return
    setSelectedConnectorIds([])
    clipboard.cancel()
    const owner=id?getAssemblyInstance(project,id):undefined
    if(assembly.editingInstance){
      if(owner?.id===assembly.editingInstance.id){setSelectedIds(ids=>selectPanelIds(ids,id,additive));return}
      if(owner?.definitionId===assembly.editingDefinition?.id&&id){assembly.drillIn(id);return}
      if(!id)return
      assembly.close()
    }
    if(owner){
      if(additive){
        const members=Object.values(owner.panelIds),memberIds=new Set(members)
        assembly.clearPlacement()
        setSelectedIds(ids=>{
          const selected=new Set(ids)
          return members.every(member=>selected.has(member))?ids.filter(member=>!memberIds.has(member)):[...new Set([...ids,...members])]
        })
        setInspectorTab('panel');setRightOpen(true)
      }
      else assembly.select(owner.id)
      return
    }
    assembly.clearPlacement();setSelectedIds(ids=>selectPanelIds(ids,id,additive));if(additive||!id)setInspectorTab('panel');if(id)setRightOpen(true)
  }
  const addPanel=()=>{clipboard.cancel();assembly.close();setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:600,height:360,thickness:18,position:[0,500,0]}));setDialog('add')}
  const addDraftPanel = () => {
    const panel = { ...draft, name: draft.name.trim() || 'My panel' }
    setDialog(null)
    if (selectedIds.length) { clipboard.insert({ kind: 'panel', panel }); return }
    commit(p => ({ ...p, panels: [...p.panels, panel] }))
    setSelectedId(panel.id); setInspectorTab('panel'); setRightOpen(true)
    setFitSignal(v => v + 1); notify('Your panel is ready')
  }
  const startAttach=()=>{clipboard.cancel();if(!selected||assembly.hasMembers)return;setAttachTarget('new');setExploded(false);setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:selected?.width??600,height:360,thickness:selected?.thickness??18,material:selected?.material??'birch',color:selected?.color??'#d9bb87',...(selected.finishCoverage!==undefined?{finishCoverage:selected.finishCoverage}:{})}));setInspectorTab('attach');setRightOpen(true)}
  const applyAttachment=()=>{if(!previewProject||attachmentErrors.length)return;commit(previewProject);setSelectedId(attachTarget==='new'?draft.id:attachTarget);setInspectorTab('panel');setDraft(createPanel());notify(`${previewPanels.length===1?'Panel':`${previewPanels.length} panels`} attached`)}
  const updateConnection=(patch:Partial<AttachmentOptions>)=>{if(!connection)return;const group=connection.id.replace(/:\d+$/,'');commit(p=>({...p,connections:p.connections.map(c=>c.id.replace(/:\d+$/,'')===group?{...c,...patch}:c)}))}
  const insertModuleDefinition = (definition: AssemblyDefinition) => {
    try {
      if (selectedIds.length) {
        clipboard.insert({ kind: 'assembly', definition, instance: {
          id: crypto.randomUUID(), definitionId: definition.id, name: definition.name,
          position: [0, 0, 0], rotation: [0, 0, 0], panelIds: {},
        } })
        return
      }
      clipboard.cancel()
      const next = insertAssemblyDefinition(project, definition)
      commit(next); assembly.close()
      setSelectedIds(Object.values(next.assemblies!.instances.at(-1)!.panelIds))
      setInspectorTab('panel'); setRightOpen(true); setExploded(false); setRealisticPreview(false); setFitSignal(v => v + 1)
      notify('Assembly inserted. Duplicate it or attach it to your build.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not insert assembly.') }
  }
  const insertModule = (id: string) => insertModuleDefinition(createExampleProject(id).assemblies!.definitions[0])
  const exportAssembly = () => {
    if (!assembly.selectedInstance) return
    try {
      const file = createAssemblyFile(project, assembly.selectedInstance.id)
      const name = file.definition.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'assembly'
      download(JSON.stringify(file, null, 2), `${name}.playwood-assembly.json`, 'application/json')
      notify('Assembly exported')
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not export assembly.') }
  }
  const importAssembly = async (file: File) => {
    try {
      if (file.size > 2_000_000) throw new Error('Choose an assembly file smaller than 2 MB.')
      const definition = parseAssemblyFile(JSON.parse(await file.text()))
      setAssemblyImportError('')
      insertModuleDefinition(definition)
    } catch (error) { setAssemblyImportError(error instanceof Error ? error.message : 'This assembly file could not be read.') }
  }
  const insertSavedAssembly = (id: string) => {
    if (!selectedIds.length) { clipboard.cancel(); assembly.insert(id); return }
    const definition = assembly.definitions.find(item => item.id === id)
    if (!definition) return
    clipboard.insert({ kind: 'assembly', definition, instance: {
      id: crypto.randomUUID(), definitionId: id, name: definition.name,
      position: [0, 0, 0], rotation: [0, 0, 0], panelIds: {},
    } })
  }
  const loadTemplate=(template:string)=>{const next=createExampleProject(template);commit(next);assembly.close();const instance=next.assemblies?.instances[0];setSelectedIds(instance?Object.values(instance.panelIds):next.panels.slice(0,1).map(p=>p.id));setInspectorTab('panel');setDialog(null);setExploded(false);setFitSignal(v=>v+1);notify(template==='blank'?'A fresh start. Add your first panel.':'Template loaded. Make it your own.')}
  const exportName=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'playwood-project'
  const startNewProject=()=>{clipboard.cancel();closeContextMenu();loadTemplate('blank');setRealisticPreview(false);setView('perspective');setAttachTarget('new');setAttachment(INITIAL_ATTACHMENT);setImportError('');notify('New project started. Undo to restore your previous project.')}
  const exportProject=()=>{download(JSON.stringify(project,null,2),`${exportName}.playwood.json`,'application/json');notify('Project exported')}
  const importProject=async(file:File)=>{try{if(file.size>2_000_000)throw new Error('Choose a project file smaller than 2 MB.');const imported=parseProject(JSON.parse(await file.text()));const shelf=repairLegacyShelf(imported);const repaired=repairLegacyExampleInserts(shelf);commit(repaired);assembly.close();const first=repaired.assemblies?.instances[0];setSelectedIds(first?Object.values(first.panelIds):repaired.panels.slice(0,1).map(panel=>panel.id));setInspectorTab('panel');setFitSignal(v=>v+1);setImportError('');setDialog(null);notify(repaired===imported?'Project imported':repaired!==shelf?'Project imported · library inserts fitted':'Project imported · middle shelf joints corrected')}catch(e){setImportError(e instanceof Error?e.message:'This project file could not be read.');setDialog('export')}}
  const instance=assembly.selectedInstance
  const holes=useMemo(()=>findPanelHoles(panels.filter(panel=>selectedIdSet.has(panel.id)),panels),[panels,selectedIdSet])
  const closeHole=(id:string)=>{
    try {
      const result=closePanelHole(project,selectedIds,id)
      commit(result.project)
      if(result.instanceId)setSelectedIds(Object.values(result.project.assemblies!.instances.find(item=>item.id===result.instanceId)!.panelIds))
      else setSelectedIds([...selectedIds,result.panelId])
      notify(`${result.label} hole closed. Undo to restore the opening.`)
    } catch(error) { notify(error instanceof Error?error.message:'Could not close this opening.') }
  }
  const validTargets=assembly.targets.filter(target=>target.project)
  const assemblyHint=clipboard.active?`Hover a + to preview the ${clipboard.inserting||'copy'}. Click to attach · Esc to cancel.`:instance&&!exploded&&!realisticPreview
    ?validTargets.length?'Hover a + to preview. Click to attach.':assembly.targets.find(target=>target.error)?.error??'This assembly has no compatible corner attachments. Duplicate it to place another instance.'
    :undefined
  const attachmentWarning=clipboard.active?clipboard.hovered?.warning:assembly.target?.warning
  const attachmentSummary=attachmentWarning??(clipboard.active?clipboard.hovered?.error:assembly.target?.error??(assembly.preview?'Corner connectors replaced with shared cross connectors.':undefined))
  const loosePanels=panels.filter(panel=>!getAssemblyInstance(project,panel.id))

  const listGrouping = (kind: ListKind): ListGroupingProps => ({
    groups: (project.listGroups ?? []).filter(group => group.kind === kind),
    onSelectGroup: (ids, selected) => {
      const members = new Set(ids)
      const update = (current: string[]) => selected ? [...new Set([...current, ...ids])] : current.filter(id => !members.has(id))
      if (kind === 'connectors') selectConnectors(update, false)
      else {
        clipboard.cancel();assembly.close();setSelectedIds(update)
        setInspectorTab('panel');setRightOpen(true)
      }
    },
    onCreateGroup: (id, ids) => commit(p => createListGroup(p, kind, ids, id)),
    onRenameGroup: (id, name) => commit(p => renameListGroup(p, id, name)),
    onUngroup: id => commit(p => ungroupList(p, id)),
    onMove: (ids, groupId, beforeId) => commit(p => moveListItems(p, kind, ids, groupId, beforeId)),
  })
  const groupSelected = (kind: ListKind, ids: string[]) => {
    commit(p => createListGroup(p, kind, ids, crypto.randomUUID()))
    setLeftOpen(true)
  }

  const menuActions: PreviewMenuAction[] = []
  const menuAction = (label: string, run: () => void, danger = false) => menuActions.push({ label, run, danger })
  if (selectedConnectors.length) {
    if(connectorPanelFit.result&&!assembly.editingInstance&&!dialog)menuAction('Connect with a panel',connectWithPanel)
    menuAction('Group selected',()=>groupSelected('connectors',selectedConnectorIds))
    menuAction('Inspect connectors',()=>setRightOpen(true))
    menuAction('Remove connectors',removeSelectedConnectors,true)
  } else if (assembly.editingInstance) {
    menuAction('Inspect assembly parts',()=>setRightOpen(true))
    menuAction('Done editing assembly',assembly.done)
  } else {
    if (selectedPanels.length) {
      menuAction('Inspect selection',()=>{setInspectorTab('panel');setRightOpen(true)})
      if (instance) {
        menuAction('Edit assembly',()=>assembly.edit(instance.id))
        if (validTargets.length) menuAction('Attach a copy',()=>{clipboard.cancel();assembly.startAttach()})
        if (project.assemblies?.links.some(link=>link.a.instanceId===instance.id||link.b.instanceId===instance.id)) menuAction('Disconnect from neighbors',()=>assembly.disconnect(instance.id))
        menuAction('Make independent',()=>assembly.independent(instance.id))
        menuAction('Disassemble',()=>assembly.disassemble(instance.id))
      } else if (!assembly.hasMembers) {
        menuAction('Group selected',()=>groupSelected('panels',selectedIds))
        if (selected) menuAction('Attach panel',startAttach)
        if (project.connections.some(c=>selectedIdSet.has(c.parentId)||selectedIdSet.has(c.childId))) menuAction('Disconnect panels',detachSelection)
        if (parallelPanelCut(selectedPanels)) menuAction('Split in the middle',splitSelection)
      }
      if (instance || !assembly.hasMembers) for (const hole of holes) menuAction(`Fill hole · ${hole.label}`,()=>closeHole(hole.id))
      if (!assembly.memberInstance || instance) {
        menuAction('Copy',clipboard.copy)
        menuAction('Duplicate',duplicateSelected)
        menuAction('Delete selection',deleteSelected,true)
      }
    } else menuAction('Add panel',addPanel)
    if (panels.length>1) menuAction('Auto-connect',addAutoConnectors)
  }
  if (panels.length) menuAction('Select all panels',()=>selectAll())
  menuAction('Fit view',()=>setFitSignal(v=>v+1))

  return <TooltipProvider delayDuration={350}><div className={`app-shell ${leftOpen?'':'left-closed'} ${rightOpen?'':'right-closed'} ${realisticPreview?'room-preview':''}`}>
    <ProjectHeader projectName={project.name} saveStatus={saveStatus} canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo}
      onNew={()=>setDialog('new')} onRename={name=>commit(p=>({...p,name}))} onHelp={()=>setDialog('help')} onTemplates={()=>setDialog('templates')} onExport={()=>setDialog('export')}/>

    <ProjectSidebar panelListProps={{...listGrouping('panels'),panels: panels,
      selectedIds: selectedIds,
      issues: issues,
      onSelect: choosePanel,
      onRename: (id,name)=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,name}:panel)})),
      onRemove: id=>{commit(p=>removePanel(p,id));notify('Panel removed. Undo to bring it back.')},
      onToggleVisibility: id=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,visible:!panel.visible}:panel)})),
      }} selectedCount={selectedPanels.length} connectorCount={connectorCount} connectorSummary={connectorSummary}
      onSelectAll={()=>{if(selectedPanels.length===panels.length&&!assembly.editingInstance)setSelectedIds([]);else selectAll()}}
      connectorListProps={{...listGrouping('connectors'),connectors:physicalConnectors,panels,selectedIds:selectedConnectorIds,
        onSelect:(id,additive=false)=>selectConnectors(ids=>selectPanelIds(ids,id,additive),!additive),
        onSelectAll:selected=>selectConnectors(selected?physicalConnectors.map(connector=>connector.id):[],selected)}}
      onCollapse={()=>setLeftOpen(false)} onParts={()=>setDialog('parts')} onHelp={()=>setDialog('help')} addPanel={addPanel} loadTemplate={loadTemplate} onInsertLibraryAssembly={insertModule}
      assemblies={assembly.sidebarAssemblies} selectedAssemblyId={instance?.id} onSelectAssembly={id=>{clipboard.cancel();assembly.select(id)}}
      onSelectAssemblyPanel={assembly.drillIn} libraryAssemblies={assembly.libraryAssemblies} onInsertAssembly={insertSavedAssembly}
      onImportAssembly={()=>{setAssemblyImportError('');assemblyImportRef.current?.click()}} assemblyImportError={assemblyImportError}/>

    {contextMenu&&<PreviewContextMenu {...contextMenu} title={selectedConnectors.length?`${selectedConnectors.length} connectors`:instance?.name??(selectedPanels.length===1?selectedPanels[0].name:selectedPanels.length?`${selectedPanels.length} panels`:'Preview')} actions={menuActions} onClose={closeContextMenu}/>}
    <AssemblyWorkspace onPreviewContextMenu={dialog||drag.active||resize.active||clipboard.active||assembly.placementActive||inspectorTab==='attach'?undefined:(target,x,y)=>{
      if(target.connectorId&&!realisticPreview){if(!selectedConnectorIds.includes(target.connectorId))chooseConnector(target.connectorId)}
      else if(target.panelId!==undefined){if(!target.panelId||!selectedIds.includes(target.panelId))choosePanel(target.panelId||null)}
      setContextMenu({x,y})
    }} connectorOverrides={(resize.project??drag.project??clipboard.preview??assembly.preview??project).connectorOverrides} selectedConnectorIds={selectedConnectorIds} onSelectConnector={chooseConnector} panels={resize.panels??drag.panels??panels} connections={(resize.project??drag.project??project).connections} selectedIds={selectedIds} choosePanel={choosePanel}
      onDragStart={drag.start} onDragMove={drag.move} onDragEnd={drag.end} dragging={drag.active} dragSnap={drag.snap}
      resizeHandles={resize.handles} onResizeStart={resize.start} onResizeMove={resize.move} onResizeEnd={resize.end} resizing={resize.active} resizeDistance={resize.distance} resizeLimited={resize.limited}
      onAutoConnect={addAutoConnectors} autoConnectDisabled={!!dialog||!!assembly.editingInstance||panels.length<2}
      onMoveConnectors={(slides,repeat)=>commit(current=>{
        let next=current
        for(const [id,slide] of Object.entries(slides))next=editConnectors(next,[id],{slide})
        return next
      },{group:'connector-move',repeat})}
      onMove={moveSelection} movementEnabled={movementEnabled}
      previewPanels={clipboard.active?clipboard.previewPanels:assembly.preview?assembly.previewPanels:previewPanels} previewConnections={clipboard.active?clipboard.previewConnections:assembly.preview?assembly.previewConnections:previewConnections} view={view} showGrid={showGrid} showDimensions={showDimensions}
      exploded={exploded} realisticPreview={realisticPreview} fitSignal={fitSignal} frameSignal={frameSignal} zoomSignal={zoomSignal}
      setRealisticPreview={setRealisticPreview} leftOpen={leftOpen} rightOpen={rightOpen} setLeftOpen={setLeftOpen} setRightOpen={setRightOpen}
      setShowDimensions={setShowDimensions} setShowGrid={setShowGrid} setView={setView} setZoomSignal={setZoomSignal} setFitSignal={setFitSignal}
      setExploded={setExploded} onRotate={()=>setDialog('rotate')} addPanel={addPanel} isAttaching={inspectorTab==='attach'&&!!selected}
      attachmentSide={attachment.side} visibleBounds={visibleBounds} hasVisiblePanels={hasVisiblePanels}
      attachmentHandles={!dialog?(clipboard.active?clipboard.targets:validTargets).map(target=>({id:target.id,label:`${clipboard.active?(clipboard.inserting?`Attach ${clipboard.inserting} at`:'Paste at'):'Attach'} ${target.label}${target.warning?` · ${target.warning}`:''}`,position:target.position,warning:target.warning,active:(clipboard.active?clipboard.hovered:assembly.target)?.id===target.id})):[]}
      onAttachmentPreview={clipboard.active?clipboard.hover:assembly.hover} onAttachmentCommit={clipboard.active?clipboard.attach:assembly.attach} suppressedConnectionIds={clipboard.active?clipboard.suppressedConnectionIds:assembly.suppressedConnectionIds}
      suppressedPanelIds={clipboard.active?clipboard.suppressedPanelIds:assembly.suppressedPanelIds}
      attachmentBoundsPanels={clipboard.active?clipboard.boundsPanels:assembly.attachmentBoundsPanels}
      onDrillIn={assembly.drillIn} assemblyHint={assemblyHint} attachmentSummary={attachmentSummary} attachmentWarning={!!attachmentWarning}
      editingAssembly={assembly.editingDefinition?{name:assembly.editingDefinition.name,instanceCount:assemblyCount(assembly.editingDefinition.id),onDone:assembly.done}:undefined}/>

    <InspectorSidebar inspectorTab={inspectorTab} selectedCount={selectedPanels.length} hasSelection={!!selected}
      onCollapse={()=>setRightOpen(false)} onPanel={()=>setInspectorTab('panel')} startAttach={startAttach} applyAttachment={applyAttachment}
      canAttach={!!previewProject&&!attachmentErrors.length} attachmentType={attachment.type}
      contextLabel={selectedConnectors.length?'Connectors':assembly.editingInstance?'Shared assembly':assembly.hasMembers?'Assembly':undefined}
      onDoneEditing={assembly.editingInstance?assembly.done:undefined}>
        {selectedConnectors.length?<ConnectorInspector connectors={selectedConnectors} onChange={patch=>commit(current=>editConnectors(current,selectedConnectorIds,patch))} onRemove={removeSelectedConnectors} onConnectPanel={connectWithPanel} panelFitReason={assembly.editingInstance?'Finish editing the assembly before connecting a panel.':dialog?'Close the dialog before connecting a panel.':connectorPanelFit.reason}/>:<>
        {clipboard.inserting&&<section className="inspector-section"><p>Choose a + in the preview to attach the {clipboard.inserting}.</p><Button variant="outline" onClick={clipboard.cancel}>Cancel placement</Button></section>}
        {!assembly.editingInstance&&!clipboard.active&&!assembly.placementActive&&(instance||!assembly.hasMembers)&&<CloseHoles key={selectedIds.join('/')} holes={holes} assembly={!!instance} onClose={closeHole}/>}
        {!assembly.editingInstance&&<section className="inspector-section"><Button variant="outline" size="sm" onClick={addAutoConnectors} disabled={panels.length<2}><Link2 size={15}/>Auto-add connectors</Button><p className="field-note">{selectedIds.length>1?'Connect matching edges between selected panels.':selectedIds.length===1?'Connect this panel to matching nearby edges.':'Connect matching edges throughout the design.'} Interior T joints split continuous panels, keeping their outer dimensions. Undo restores the original panels.</p></section>}
        {assembly.editingInstance&&assembly.editingDefinition?<AssemblyEditingInspector
          panels={assembly.editingDefinition.panels.filter(panel=>selectedIdSet.has(assembly.editingInstance!.panelIds[panel.id]))}
          definitionPanels={assembly.editingDefinition.panels} parameters={assembly.editingDefinition.parameters} onParametersChange={assembly.parameters}
          name={assembly.editingDefinition.name} count={assemblyCount(assembly.editingDefinition.id)} onChange={assembly.updateDefinition}/>
        :instance&&assembly.definition?<AssemblyInspector key={instance.id} name={instance.name} definitionName={assembly.definition.name}
          parameters={assembly.definition.parameters} parameterValues={instance.parameterValues} onParameterChange={(id,value)=>assembly.parameter(instance.id,id,value)} onResetParameters={()=>assembly.resetParameters(instance.id)}
          instanceCount={assemblyCount(instance.definitionId)} panelCount={Object.keys(instance.panelIds).length} color={instance.finish?.color??selectedPanels[0]?.color??'#d9bb87'} hasColorOverride={!!instance.finish?.color}
          finishCoverage={selectedFinishCoverages[0]??0} finishCoverageMixed={selectedFinishCoverages.some(value=>value!==selectedFinishCoverages[0])} finishCoverageDisabled={selectedPanels.every(p=>p.material==='painted')}
          hasFinishCoverageOverride={instance.finish?.finishCoverage!==undefined} onFinishCoverageChange={finishCoverage=>assembly.finish(instance.id,{finishCoverage})} onResetFinishCoverage={()=>assembly.resetFinish(instance.id,'finishCoverage')}
          connected={project.assemblies?.links.some(link=>link.a.instanceId===instance.id||link.b.instanceId===instance.id)}
          attachmentTargets={assembly.instances.filter(item=>item.id!==instance.id&&!project.assemblies?.links.some(link=>link.a.instanceId===item.id||link.b.instanceId===item.id)).map(item=>({id:item.id,name:item.name}))}
          attachmentActive={assembly.placementActive} attachmentMessage={assemblyHint} onCancelAttach={assembly.clearPlacement} canAttachCopy={validTargets.length>0}
          onRename={name=>assembly.rename(instance.id,name)} onColorChange={color=>assembly.finish(instance.id,{color})} onResetColor={()=>assembly.resetFinish(instance.id,'color')}
          onDuplicate={duplicateSelected} onExport={exportAssembly} onAttachCopy={()=>{clipboard.cancel();assembly.startAttach()}} onAttachExisting={id=>{clipboard.cancel();assembly.startAttach(id)}}
          onEdit={()=>assembly.edit(instance.id)} onDisconnect={()=>assembly.disconnect(instance.id)} onMakeIndependent={()=>assembly.independent(instance.id)} onDisassemble={()=>assembly.disassemble(instance.id)} onDelete={deleteSelected}/>
        :assembly.memberInstance&&selected&&assembly.definition?<AssemblyPartInspector panel={selected} instanceName={assembly.memberInstance.name} definitionName={assembly.definition.name} count={assemblyCount(assembly.definition.id)} onSelectInstance={()=>assembly.select(assembly.memberInstance!.id)} onEdit={()=>assembly.edit(assembly.memberInstance!.id)}/>
        :assembly.hasMembers?<><div className="selected-heading"><Box size={15}/><span>MULTIPLE OBJECTS</span></div><p className="assembly-help">{selectedPanels.length} panels selected, including linked instances. Select one assembly to edit its design. Arrow keys move connected instances together.</p><div className="panel-actions"><Button variant="outline" onClick={duplicateSelected}><Copy size={15}/>Duplicate selection</Button><Button variant="ghost" onClick={deleteSelected}><Trash2 size={15}/>Remove</Button></div></>
        :<>
          {parallelPanelCut(selectedPanels)&&<section className="inspector-section"><Button variant="outline" size="sm" onClick={splitSelection}>Split in the middle</Button><p className="field-note">Create four equal sections and a center divider with T connectors. Keeps the outer dimensions.</p></section>}
          {selectedPanels.length>1&&<CreateAssemblyForm key={selectedIds.join('/')} panelCount={selectedPanels.length} panels={selectedPanels} onCreate={assembly.create}/>}
          {selectedPanels.length>1&&<MultiPanelInspector panels={selectedPanels} connections={project.connections} issues={issues} onChange={updateMultiplePanels} onConnectionChange={patch=>commit(p=>updateSelectedConnections(p,selectedIds,patch))} onDuplicate={duplicateSelected} onDelete={deleteSelected} onDetach={detachSelection}/>}
          {selected&&(inspectorTab==='panel'?<SinglePanelInspector selected={selected} panels={panels} connection={connection} supportConnected={project.connections.some(c=>c.role==='support'&&(c.parentId===selected.id||c.childId===selected.id))} issues={issues} updatePanel={updatePanel} updateConnection={updateConnection} onDetach={detachSelection} duplicateSelected={duplicateSelected} deleteSelected={deleteSelected}/>:<AttachmentInspector selected={selected} panels={loosePanels} draft={draft} setDraft={setDraft} attachment={attachment} setAttachment={setAttachment} attachTarget={attachTarget} setAttachTarget={setAttachTarget} previewError={previewResult.error} previewIssues={previewIssues} hasPreview={!!previewProject}/>)}
          {!selectedPanels.length&&<div className="no-selection"><MousePointer2 size={28}/><h2>A little more detail.</h2><p>Select a panel or connector in the workspace<br/>to make it your own.</p><Button variant="outline" onClick={addPanel}><Plus size={16}/>Add a panel</Button></div>}
        </>}
        </>}
    </InspectorSidebar>

    <ProjectStatus panelCount={project.panels.length} connectorCount={connectorCount} issueCount={issues.length} bounds={bounds} onParts={()=>setDialog('parts')} onHelp={()=>setDialog('help')}/>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}</div>}

    <ProjectDialogs onNew={startNewProject} dialog={dialog} onClose={()=>setDialog(null)} draft={draft} setDraft={setDraft} loadTemplate={loadTemplate}
      exportProject={exportProject} onExportParts={()=>{download(projectToCsv(project),`${exportName}-parts.csv`,'text/csv');notify('Parts list exported')}}
      onImport={()=>importRef.current?.click()} importError={importError} project={project} panels={panels} connectorCount={connectorCount} issues={issues}
      onRotate={(axis,degrees)=>{commit(p=>rotateProject(p,axis,degrees));assembly.close();setInspectorTab('panel');setExploded(false);setDialog(null);setFitSignal(v=>v+1);notify(`Creation rotated ${degrees}° around ${axis.toUpperCase()}. Undo is available.`)}}
      attachNewPanel={selectedIds.length>0} onAdd={addDraftPanel}/>
    <input ref={importRef} type="file" accept=".json,.playwood.json" className="visually-hidden" aria-label="Import project file" onChange={e=>{const file=e.target.files?.[0];if(file)void importProject(file);e.target.value=''}}/>
    <input ref={assemblyImportRef} type="file" accept=".json,.playwood-assembly.json" className="visually-hidden" aria-label="Import assembly file" onChange={e=>{const file=e.target.files?.[0];if(file)void importAssembly(file);e.target.value=''}}/>
  </div></TooltipProvider>
}
