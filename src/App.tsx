import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, MousePointer2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectHeader } from '@/components/ProjectHeader'
import { ProjectDialogs, type ProjectDialog } from '@/components/ProjectDialogs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AssemblyWorkspace } from '@/components/AssemblyWorkspace'
import { InspectorSidebar } from '@/components/InspectorSidebar'
import { SinglePanelInspector } from '@/components/SinglePanelInspector'
import { AttachmentInspector } from '@/components/AttachmentInspector'
import { CONNECTORS } from '@/lib/connector-options'
import { MultiPanelInspector } from '@/components/MultiPanelInspector'
import { ProjectStatus } from '@/components/ProjectStatus'
import { ProjectSidebar } from '@/components/ProjectSidebar'
import { createExampleProject } from '@/lib/example-library'
import { getSharedPanelFields, selectPanelIds, updateSelectedPanels, updateSelectedConnections } from '@/lib/selection'
import { movePanels, resizePanels } from '@/lib/structure-edit'
import { useAttachmentPreview } from '@/hooks/use-attachment-preview'
import { useProject } from '@/hooks/use-project'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { repairLegacyExampleInserts } from '@/lib/legacy-example-inserts'
import { detachPanel, createPanel, duplicatePanel, getProjectBounds, parseProject, projectToCsv, removePanel, resolvePanels, rotateProject, validateProject } from '@/lib/model'
import type { AttachmentOptions, CameraView, Panel, Vec3 } from '@/lib/types'

const INITIAL_ATTACHMENT: AttachmentOptions = {side:'right',type:'90',offset:0,inset:0,flip:false,color:'#e86536',count:2}
function download(content:string,name:string,type:string) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}

export default function App() {
  const {project,commit,undo,redo,canUndo,canRedo,saveStatus,repairNotice}=useProject()
  const [selectedIds,setSelectedIds]=useState<string[]>(()=>project.panels.slice(0,1).map(panel=>panel.id))
  const setSelectedId=useCallback((id:string|null)=>setSelectedIds(id?[id]:[]),[])
  const [inspectorTab,setInspectorTab]=useState<'panel'|'attach'>('panel')
  const [dialog,setDialog]=useState<ProjectDialog>(null)
  const [draft,setDraft]=useState(()=>createPanel({name:'My panel',width:600,height:360,thickness:18}))
  const [attachTarget,setAttachTarget]=useState('new')
  const [attachment,setAttachment]=useState<AttachmentOptions>(INITIAL_ATTACHMENT)
  const [view,setView]=useState<CameraView>('perspective')
  const [realisticPreview,setRealisticPreview]=useState(false)
  const [showGrid,setShowGrid]=useState(true),[showDimensions,setShowDimensions]=useState(false),[exploded,setExploded]=useState(false)
  const [fitSignal,setFitSignal]=useState(0),[zoomSignal,setZoomSignal]=useState({direction:0,key:0})
  const [leftOpen,setLeftOpen]=useState(window.innerWidth>900),[rightOpen,setRightOpen]=useState(window.innerWidth>680)
  const [toast,setToast]=useState(''),[importError,setImportError]=useState('')
  const importRef=useRef<HTMLInputElement>(null)
  const panels=useMemo(()=>resolvePanels(project),[project])
  const selectedIdSet=useMemo(()=>new Set(selectedIds),[selectedIds])
  const selectedPanels=panels.filter(p=>selectedIdSet.has(p.id))
  const selected=selectedPanels.length===1?selectedPanels[0]:undefined
  const selectedId=selected?.id??null
  const connection=project.connections.find(c=>c.childId===selectedId&&c.role!=='support')
  const bounds=useMemo(()=>getProjectBounds(panels),[panels])
  const visibleBounds=useMemo(()=>getProjectBounds(panels.filter(panel=>panel.visible)),[panels])
  const hasVisiblePanels=panels.some(panel=>panel.visible)
  const issues=useMemo(()=>validateProject(project),[project])
  const connectorCount=project.connections.reduce((sum,c)=>sum+c.count,0)
  const connectorSummary=CONNECTORS.map(type=>({name:type.name,count:project.connections.filter(c=>c.type===type.id).reduce((sum,c)=>sum+c.count,0)})).filter(type=>type.count>0).map(type=>`${type.count} × ${type.name}`).join(' · ')
  const notify=useCallback((message:string)=>setToast(message),[])
  useEffect(()=>{if(repairNotice)notify(repairNotice)},[repairNotice,notify])
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)}},[toast])
  useEffect(()=>{setSelectedIds(ids=>{const remaining=ids.filter(id=>project.panels.some(p=>p.id===id));return remaining.length===ids.length?ids:remaining})},[project.panels])
  const updatePanel=(patch:Partial<Panel>)=>{
    if(!selectedId)return false
    try {
      const {width,height,...rest}=patch
      const base={...project,panels:project.panels.map(panel=>panel.id===selectedId?{...panel,...rest}:panel)}
      commit(width!==undefined||height!==undefined?resizePanels(base,[selectedId],{width,height}):base)
      return true
    } catch(error) {notify(error instanceof Error?error.message:'This panel size cannot keep the joints aligned.');return false}
  }
  const updateMultiplePanels=(patch:Partial<Panel>)=>{
    try {
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
      commit(current=>movePanels(current,selectedIds,delta),{group:'panel-move',repeat})
    } catch(error) {notify(error instanceof Error?error.message:'This move cannot keep the joints aligned.')}
  }
  const deleteSelected=useCallback(()=>{if(selectedIds.length){commit(p=>selectedIds.reduce((current,id)=>removePanel(current,id),p));notify(`${selectedIds.length===1?'Panel':'Panels'} removed. Undo to bring them back.`)}},[selectedIds,commit,notify])
  const duplicateSelected=useCallback(()=>{if(selectedIds.length){let next=project;const copies:string[]=[];for(const id of selectedIds){const duplicate=duplicatePanel(next,id);if(duplicate!==next)copies.push(duplicate.panels.at(-1)!.id);next=duplicate}commit(next);setSelectedIds(copies);notify(`${copies.length===1?'Panel':'Panels'} duplicated`)}},[selectedIds,project,commit,notify])
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')||target.isContentEditable||dialog)return;if(realisticPreview){if(e.metaKey||e.ctrlKey){if(['a','d','z'].includes(e.key.toLowerCase()))e.preventDefault();if(e.key.toLowerCase()==='z')e.shiftKey?redo():undo();return}if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1);if(e.key==='Escape')setRealisticPreview(false);return}if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='a'){e.preventDefault();setSelectedIds(project.panels.map(p=>p.id));setInspectorTab('panel');setRightOpen(true)}else if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelected()}}else if(!dialog){if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected()}if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1);if(e.key==='Escape'){setInspectorTab('panel');setSelectedId(null)}}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[undo,redo,deleteSelected,duplicateSelected,dialog,project.panels,setSelectedId,realisticPreview])
  const {previewResult,previewProject,previewPanels,previewConnections,previewIssues,attachmentErrors}=useAttachmentPreview({project,selected,panels,draft,attachment,inspectorTab,attachTarget})
  const choosePanel=(id:string|null,additive=false)=>{setSelectedIds(ids=>selectPanelIds(ids,id,additive));if(additive||!id)setInspectorTab('panel');if(id)setRightOpen(true)}
  const addPanel=()=>{setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:600,height:360,thickness:18,position:[0,500,0]}));setDialog('add')}
  const startAttach=()=>{if(!selected)return;setAttachTarget('new');setExploded(false);setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:selected?.width??600,height:360,thickness:selected?.thickness??18,material:selected?.material??'birch',color:selected?.color??'#d9bb87'}));setInspectorTab('attach');setRightOpen(true)}
  const applyAttachment=()=>{if(!previewProject||attachmentErrors.length)return;commit(previewProject);setSelectedId(attachTarget==='new'?draft.id:attachTarget);setInspectorTab('panel');setDraft(createPanel());notify(`${previewPanels.length===1?'Panel':`${previewPanels.length} panels`} attached`)}
  const updateConnection=(patch:Partial<AttachmentOptions>)=>{if(!connection)return;const group=connection.id.replace(/:\d+$/,'');commit(p=>({...p,connections:p.connections.map(c=>c.id.replace(/:\d+$/,'')===group?{...c,...patch}:c)}))}
  const loadTemplate=(template:string)=>{const next=createExampleProject(template);commit(next);setSelectedId(next.panels[0]?.id??null);setInspectorTab('panel');setDialog(null);setExploded(false);setFitSignal(v=>v+1);notify(template==='blank'?'A fresh start. Add your first panel.':'Template loaded. Make it your own.')}
  const exportName=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'playwood-project'
  const exportProject=()=>{download(JSON.stringify(project,null,2),`${exportName}.playwood.json`,'application/json');notify('Project exported')}
  const importProject=async(file:File)=>{try{if(file.size>2_000_000)throw new Error('Choose a project file smaller than 2 MB.');const imported=parseProject(JSON.parse(await file.text()));const shelf=repairLegacyShelf(imported);const repaired=repairLegacyExampleInserts(shelf);commit(repaired);setSelectedId(repaired.panels[0]?.id??null);setFitSignal(v=>v+1);setImportError('');setDialog(null);notify(repaired===imported?'Project imported':repaired!==shelf?'Project imported · library inserts fitted':'Project imported · middle shelf joints corrected')}catch(e){setImportError(e instanceof Error?e.message:'This project file could not be read.');setDialog('export')}}

  return <TooltipProvider delayDuration={350}><div className={`app-shell ${leftOpen?'':'left-closed'} ${rightOpen?'':'right-closed'} ${realisticPreview?'room-preview':''}`}>
    <ProjectHeader projectName={project.name} saveStatus={saveStatus} canUndo={canUndo} canRedo={canRedo} undo={undo} redo={redo}
      onRename={name=>commit(p=>({...p,name}))} onHelp={()=>setDialog('help')} onTemplates={()=>setDialog('templates')} onExport={()=>setDialog('export')}/>

    <ProjectSidebar panelListProps={{panels: panels,
      selectedIds: selectedIds,
      issues: issues,
      onSelect: choosePanel,
      onRename: (id,name)=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,name}:panel)})),
      onRemove: id=>{commit(p=>removePanel(p,id));notify('Panel removed. Undo to bring it back.')},
      onToggleVisibility: id=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,visible:!panel.visible}:panel)})),
      onReorder: (id,beforeId)=>commit(p=>{const panel=p.panels.find(panel=>panel.id===id);if(!panel)return p;const remaining=p.panels.filter(panel=>panel.id!==id);const index=beforeId===null?remaining.length:remaining.findIndex(panel=>panel.id===beforeId);if(index<0)return p;remaining.splice(index,0,panel);return {...p,panels:remaining}})}} selectedCount={selectedPanels.length} connectorCount={connectorCount} connectorSummary={connectorSummary}
      onSelectAll={()=>{setSelectedIds(selectedPanels.length===panels.length?[]:panels.map(p=>p.id));setInspectorTab('panel');setRightOpen(true)}}
      onCollapse={()=>setLeftOpen(false)} onParts={()=>setDialog('parts')} onHelp={()=>setDialog('help')} addPanel={addPanel} loadTemplate={loadTemplate}/>

    <AssemblyWorkspace panels={panels} connections={project.connections} selectedIds={selectedIds} choosePanel={choosePanel}
      onMove={moveSelection} movementEnabled={!dialog&&(realisticPreview||(!exploded&&inspectorTab!=='attach'))}
      previewPanels={previewPanels} previewConnections={previewConnections} view={view} showGrid={showGrid} showDimensions={showDimensions}
      exploded={exploded} realisticPreview={realisticPreview} fitSignal={fitSignal} zoomSignal={zoomSignal}
      setRealisticPreview={setRealisticPreview} leftOpen={leftOpen} rightOpen={rightOpen} setLeftOpen={setLeftOpen} setRightOpen={setRightOpen}
      setShowDimensions={setShowDimensions} setShowGrid={setShowGrid} setView={setView} setZoomSignal={setZoomSignal} setFitSignal={setFitSignal}
      setExploded={setExploded} onRotate={()=>setDialog('rotate')} addPanel={addPanel} isAttaching={inspectorTab==='attach'&&!!selected}
      attachmentSide={attachment.side} visibleBounds={visibleBounds} hasVisiblePanels={hasVisiblePanels}/>

    <InspectorSidebar inspectorTab={inspectorTab} selectedCount={selectedPanels.length} hasSelection={!!selected}
      onCollapse={()=>setRightOpen(false)} onPanel={()=>setInspectorTab('panel')} startAttach={startAttach} applyAttachment={applyAttachment}
      canAttach={!!previewProject&&!attachmentErrors.length} attachmentType={attachment.type}>
        {selectedPanels.length>1&&<MultiPanelInspector panels={selectedPanels} connections={project.connections} issues={issues} onChange={updateMultiplePanels} onConnectionChange={patch=>commit(p=>updateSelectedConnections(p,selectedIds,patch))} onDuplicate={duplicateSelected} onDelete={deleteSelected}/>}
        {selected&&(inspectorTab==='panel'?<SinglePanelInspector selected={selected} panels={panels} connection={connection} issues={issues} updatePanel={updatePanel} updateConnection={updateConnection} onDetach={()=>{commit(p=>detachPanel(p,selected.id));notify('Panel detached. Its position is unchanged.')}} duplicateSelected={duplicateSelected} deleteSelected={deleteSelected}/>:<AttachmentInspector selected={selected} panels={panels} draft={draft} setDraft={setDraft} attachment={attachment} setAttachment={setAttachment} attachTarget={attachTarget} setAttachTarget={setAttachTarget} previewError={previewResult.error} previewIssues={previewIssues} hasPreview={!!previewProject}/>)}
        {!selectedPanels.length&&<div className="no-selection"><MousePointer2 size={28}/><h2>A little more detail.</h2><p>Select a panel in the workspace<br/>to make it your own.</p><Button variant="outline" onClick={addPanel}><Plus size={16}/>Add a panel</Button></div>}
    </InspectorSidebar>

    <ProjectStatus panelCount={project.panels.length} connectorCount={connectorCount} issueCount={issues.length} bounds={bounds} onParts={()=>setDialog('parts')} onHelp={()=>setDialog('help')}/>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}</div>}

    <ProjectDialogs dialog={dialog} onClose={()=>setDialog(null)} draft={draft} setDraft={setDraft} loadTemplate={loadTemplate}
      exportProject={exportProject} onExportParts={()=>{download(projectToCsv(project),`${exportName}-parts.csv`,'text/csv');notify('Parts list exported')}}
      onImport={()=>importRef.current?.click()} importError={importError} project={project} panels={panels} connectorCount={connectorCount} issues={issues}
      onRotate={(axis,degrees)=>{commit(p=>rotateProject(p,axis,degrees));setInspectorTab('panel');setExploded(false);setDialog(null);setFitSignal(v=>v+1);notify(`Creation rotated ${degrees}° around ${axis.toUpperCase()}. Undo is available.`)}}
      onAdd={()=>{commit(p=>({...p,panels:[...p.panels,{...draft,name:draft.name.trim()||'My panel'}]}));setSelectedId(draft.id);setInspectorTab('panel');setRightOpen(true);setDialog(null);setFitSignal(v=>v+1);notify('Your panel is ready')}}/>
    <input ref={importRef} type="file" accept=".json,.playwood.json" className="visually-hidden" aria-label="Import project file" onChange={e=>{const file=e.target.files?.[0];if(file)void importProject(file);e.target.value=''}}/>
  </div></TooltipProvider>
}
