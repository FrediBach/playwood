import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Box, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Copy, Download, Expand, FolderOpen, Grid2X2, House, Layers, LayoutTemplate, Link2, ListChecks, Maximize, Minus, MousePointer2, Move3D, PanelLeftClose, PanelLeftOpen, Plus, Redo2, Ruler, Settings2, SlidersHorizontal, Sun, Trash2, Undo2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip'
import { NumberField, PanelFields, SelectField, MATERIALS } from '@/components/fields'
import Scene from '@/components/Scene'
import { MultiPanelInspector } from '@/components/MultiPanelInspector'
import { PanelList } from '@/components/PanelList'
import { ExampleBrowser } from '@/components/ExampleBrowser'
import { createExampleProject } from '@/lib/example-library'
import { selectPanelIds, updateSelectedPanels, updateSelectedConnections } from '@/lib/selection'
import { useProject } from '@/hooks/use-project'
import { repairLegacyShelf } from '@/lib/legacy-shelf'
import { attachPanel, attachExistingPanel, detachPanel, createPanel, duplicatePanel, getProjectBounds, parseProject, projectToCsv, removePanel, resolvePanels, validateProject } from '@/lib/model'
import type { AttachmentOptions, CameraView, ConnectorType, Panel, Side, Vec3 } from '@/lib/types'

const SIDES: Side[] = ['left','right','top','bottom','front','back']
const CONNECTORS: {id:ConnectorType;name:string;description:string}[] = [{id:'90',name:'90°',description:'Right angle'},{id:'105',name:'105°',description:'Open angle'},{id:'150',name:'150°',description:'Wide angle'},{id:'t',name:'T',description:'3-way joint'},{id:'cross',name:'Cross',description:'4-way joint'}]
const INITIAL_ATTACHMENT: AttachmentOptions = {side:'right',type:'90',offset:0,inset:0,flip:false,color:'#e86536',count:2}
const SOURCE_URL = 'https://www.playwood.it/site/assets/files/18237/technical_information_playwood_connectors.pdf'
const number = (n:number)=>Math.round(n).toLocaleString()
function download(content:string,name:string,type:string) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500)}
function IconButton({label,children,...props}: React.ComponentProps<typeof Button>&{label:string}) {return <Tooltip label={label}><Button variant="ghost" size="icon" aria-label={label} {...props}>{children}</Button></Tooltip>}
function ConnectorGlyph({type}: {type:ConnectorType}) {return <svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">{type==='90'?<path d="M10 7v19h19"/>:type==='105'?<path d="M13 7 8 26h21"/>:type==='150'?<path d="m5 14 12 12h15"/>:type==='t'?<path d="M5 12h26M18 12v19"/>:<path d="M5 18h26M18 5v26"/>}</g></svg>}

export default function App() {
  const {project,commit,undo,redo,canUndo,canRedo,saveStatus,repairNotice}=useProject()
  const [selectedIds,setSelectedIds]=useState<string[]>(project.panels[0]?[project.panels[0].id]:[])
  const setSelectedId=useCallback((id:string|null)=>setSelectedIds(id?[id]:[]),[])
  const [inspectorTab,setInspectorTab]=useState<'panel'|'attach'>('panel')
  const [leftTab,setLeftTab]=useState<'assembly'|'library'>('assembly')
  const [dialog,setDialog]=useState<'add'|'templates'|'export'|'help'|'parts'|null>(null)
  const [draft,setDraft]=useState(()=>createPanel({name:'My panel',width:600,height:360,thickness:18}))
  const [attachTarget,setAttachTarget]=useState('new')
  const [attachment,setAttachment]=useState<AttachmentOptions>(INITIAL_ATTACHMENT)
  const [view,setView]=useState<CameraView>('perspective')
  const [realisticPreview,setRealisticPreview]=useState(false)
  const [showGrid,setShowGrid]=useState(true),[showDimensions,setShowDimensions]=useState(false),[exploded,setExploded]=useState(false)
  const [fitSignal,setFitSignal]=useState(0),[zoomSignal,setZoomSignal]=useState({direction:0,key:0})
  const [leftOpen,setLeftOpen]=useState(window.innerWidth>900),[rightOpen,setRightOpen]=useState(window.innerWidth>680)
  const [toast,setToast]=useState(''),[importError,setImportError]=useState('')
  const [editingName,setEditingName]=useState(false)
  const importRef=useRef<HTMLInputElement>(null)
  const panels=useMemo(()=>resolvePanels(project),[project])
  const selectedPanels=panels.filter(p=>selectedIds.includes(p.id))
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
  const updatePanel=useCallback((patch:Partial<Panel>)=>{if(selectedId)commit(p=>({...p,panels:p.panels.map(panel=>panel.id===selectedId?{...panel,...patch}:panel)}))},[commit,selectedId])
  const deleteSelected=useCallback(()=>{if(selectedIds.length){commit(p=>selectedIds.reduce((current,id)=>removePanel(current,id),p));notify(`${selectedIds.length===1?'Panel':'Panels'} removed. Undo to bring them back.`)}},[selectedIds,commit,notify])
  const duplicateSelected=useCallback(()=>{if(selectedIds.length){let next=project;const copies:string[]=[];for(const id of selectedIds){const duplicate=duplicatePanel(next,id);if(duplicate!==next)copies.push(duplicate.panels.at(-1)!.id);next=duplicate}commit(next);setSelectedIds(copies);notify(`${copies.length===1?'Panel':'Panels'} duplicated`)}},[selectedIds,project,commit,notify])
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')||target.isContentEditable||dialog)return;if(realisticPreview){if(e.metaKey||e.ctrlKey){if(['a','d','z'].includes(e.key.toLowerCase()))e.preventDefault();return}if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1);if(e.key==='Escape')setRealisticPreview(false);return}if(e.metaKey||e.ctrlKey){if(e.key.toLowerCase()==='a'){e.preventDefault();setSelectedIds(project.panels.map(p=>p.id));setInspectorTab('panel');setRightOpen(true)}else if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(e.key.toLowerCase()==='d'){e.preventDefault();duplicateSelected()}}else if(!dialog){if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelected()}if(e.key.toLowerCase()==='f')setFitSignal(v=>v+1);if(e.key==='Escape'){setInspectorTab('panel');setSelectedId(null)}}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[undo,redo,deleteSelected,duplicateSelected,dialog,project.panels,setSelectedId,realisticPreview])
  const previewResult=useMemo(()=>{
    if(inspectorTab!=='attach'||!selected)return {project:null,error:''}
    try {
      const base=attachTarget==='new'?project:{...project,panels:project.panels.map(p=>p.id===attachTarget?{...p,...draft,id:attachTarget}:p)}
      return {project:attachTarget==='new'?attachPanel(base,selected.id,draft,attachment):attachExistingPanel(base,selected.id,attachTarget,attachment),error:''}
    }catch(error){return {project:null,error:error instanceof Error?error.message:'This panel cannot be attached here.'}}
  },[project,selected,draft,attachment,inspectorTab,attachTarget])
  const previewProject=previewResult.project
  const previewPanels=useMemo(()=>previewProject?resolvePanels(previewProject).filter(p=>{const old=panels.find(old=>old.id===p.id);return !old||p.id===attachTarget||JSON.stringify(old.position)!==JSON.stringify(p.position)||JSON.stringify(old.rotation)!==JSON.stringify(p.rotation)}):[],[previewProject,panels,attachTarget])
  const previewIds=new Set(previewPanels.map(p=>p.id))
  const previewConnections=previewProject?.connections.filter(c=>!project.connections.some(old=>old.id===c.id)||previewIds.has(c.childId)||previewIds.has(c.parentId))??[]
  const previewIssues=previewProject?validateProject(previewProject).filter(i=>i.panelIds.some(id=>previewPanels.some(p=>p.id===id))):[]
  const attachmentErrors=previewIssues.filter(i=>i.severity==='error')
  const choosePanel=(id:string|null,additive=false)=>{setSelectedIds(ids=>selectPanelIds(ids,id,additive));if(additive||!id)setInspectorTab('panel');if(id)setRightOpen(true)}
  const addPanel=()=>{setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:600,height:360,thickness:18,position:[0,500,0]}));setDialog('add')}
  const startAttach=()=>{if(!selected)return;setAttachTarget('new');setExploded(false);setDraft(createPanel({name:`Panel ${project.panels.length+1}`,width:selected?.width??600,height:360,thickness:selected?.thickness??18,material:selected?.material??'birch',color:selected?.color??'#d9bb87'}));setInspectorTab('attach');setRightOpen(true)}
  const applyAttachment=()=>{if(!previewProject||attachmentErrors.length)return;commit(previewProject);setSelectedId(attachTarget==='new'?draft.id:attachTarget);setInspectorTab('panel');setDraft(createPanel());notify(`${previewPanels.length===1?'Panel':`${previewPanels.length} panels`} attached`)}
  const updateConnection=(patch:Partial<AttachmentOptions>)=>{if(!connection)return;const group=connection.id.replace(/:\d+$/,'');commit(p=>({...p,connections:p.connections.map(c=>c.id.replace(/:\d+$/,'')===group?{...c,...patch}:c)}))}
  const loadTemplate=(template:string)=>{const next=createExampleProject(template);commit(next);setSelectedId(next.panels[0]?.id??null);setInspectorTab('panel');setDialog(null);setExploded(false);setFitSignal(v=>v+1);notify(template==='blank'?'A fresh start. Add your first panel.':'Template loaded. Make it your own.')}
  const exportName=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'playwood-project'
  const exportProject=()=>{download(JSON.stringify(project,null,2),`${exportName}.playwood.json`,'application/json');notify('Project exported')}
  const importProject=async(file:File)=>{try{if(file.size>2_000_000)throw new Error('Choose a project file smaller than 2 MB.');const imported=parseProject(JSON.parse(await file.text()));const repaired=repairLegacyShelf(imported);commit(repaired);setSelectedId(repaired.panels[0]?.id??null);setFitSignal(v=>v+1);setImportError('');setDialog(null);notify(repaired===imported?'Project imported':'Project imported · middle shelf joints corrected')}catch(e){setImportError(e instanceof Error?e.message:'This project file could not be read.');setDialog('export')}}

  return <TooltipProvider delayDuration={350}><div className={`app-shell ${leftOpen?'':'left-closed'} ${rightOpen?'':'right-closed'} ${realisticPreview?'room-preview':''}`}>
    <header className="app-header">
      <a className="brand" href="#" onClick={e=>{e.preventDefault();setDialog('help')}} aria-label="About Playwood Studio"><span className="brand-mark"><span/><span/><span/></span><span>playwood<span className="brand-dot">.</span></span><span className="studio-tag">STUDIO</span></a>
      <div className="header-divider"/>
      <div className="project-heading">{editingName?<input className="project-name-input" aria-label="Project name" autoFocus defaultValue={project.name} maxLength={80} onBlur={e=>{commit(p=>({...p,name:e.target.value.trim()||'Untitled project'}));setEditingName(false)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setEditingName(false)}}/>:<button className="project-name" onClick={()=>setEditingName(true)} title="Rename project">{project.name}<ChevronDown size={14}/></button>}<span className="save-label"><span className="status-dot"/>{saveStatus}</span></div>
      <div className="header-actions"><div className="undo-actions"><IconButton label="Undo (⌘/Ctrl Z)" disabled={!canUndo} onClick={undo}><Undo2 size={18}/></IconButton><IconButton label="Redo (⌘/Ctrl Shift Z)" disabled={!canRedo} onClick={redo}><Redo2 size={18}/></IconButton></div><Button variant="ghost" onClick={()=>setDialog('templates')} className="templates-button"><LayoutTemplate size={17}/>Templates</Button><Button variant="secondary" onClick={()=>setDialog('export')}><ArrowDownToLine size={17}/><span>Export project</span></Button></div>
    </header>

    <aside className="left-sidebar" aria-label="Project panels">
      <div className="sidebar-tabs"><button className={leftTab==='assembly'?'active':''} onClick={()=>setLeftTab('assembly')}>Assembly</button><button className={leftTab==='library'?'active':''} onClick={()=>setLeftTab('library')}>Library</button><IconButton label="Collapse panel list" onClick={()=>setLeftOpen(false)}><PanelLeftClose size={17}/></IconButton></div>
      <div className="sidebar-scroll">
        {leftTab==='assembly'?<><div className="section-label"><span>YOUR PANELS</span><span className="count-badge">{project.panels.length.toString().padStart(2,'0')}</span></div>
          <div className="selection-tools"><span aria-live="polite" aria-atomic="true">{selectedPanels.length?`${selectedPanels.length} selected`:'Shift-click to select more'}</span><button onClick={()=>{setSelectedIds(selectedPanels.length===panels.length?[]:panels.map(p=>p.id));setInspectorTab('panel');setRightOpen(true)}} disabled={!panels.length}>{selectedPanels.length===panels.length&&panels.length?'Clear':'Select all'}</button></div><PanelList panels={panels} selectedIds={selectedIds} issues={issues} onSelect={choosePanel}
            onRename={(id,name)=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,name}:panel)}))}
            onRemove={id=>{commit(p=>removePanel(p,id));notify('Panel removed. Undo to bring it back.')}}
            onToggleVisibility={id=>commit(p=>({...p,panels:p.panels.map(panel=>panel.id===id?{...panel,visible:!panel.visible}:panel)}))}
            onReorder={(id,beforeId)=>commit(p=>{const panel=p.panels.find(panel=>panel.id===id);if(!panel)return p;const remaining=p.panels.filter(panel=>panel.id!==id);const index=beforeId===null?remaining.length:remaining.findIndex(panel=>panel.id===beforeId);if(index<0)return p;remaining.splice(index,0,panel);return {...p,panels:remaining}})} />
          {!panels.length&&<div className="empty-panels"><Layers size={30}/><p>Every idea starts<br/>with a panel.</p></div>}
          <Button variant="outline" className="add-panel-button" onClick={addPanel}><Plus size={17}/>Add a panel<span className="key-hint">+</span></Button>
          <div className="sidebar-rule"/><div className="section-label"><span>CONNECTIONS</span><span className="count-badge">{connectorCount.toString().padStart(2,'0')}</span></div>
          <div className="connection-summary"><span className="connector-mini"><Link2 size={20}/></span><div><strong>Playwood connectors</strong><span>{connectorSummary||'Select a panel to connect'}</span></div></div>
          <Button variant="ghost" size="sm" className="full-button" onClick={()=>setDialog('parts')}><ListChecks size={16}/>View parts list<ChevronRight size={15}/></Button>
        </>:<><div className="library-intro"><h2>A place to start.</h2><p>Explore individual builds.<br/>Choose one and make it yours.</p></div><ExampleBrowser compact onSelect={loadTemplate}/><button className="library-reference" onClick={()=>setDialog('help')}>About the connector system<ArrowRight size={15}/></button></>}
      </div>
      <div className="sidebar-footer"><span className="little-mark">p.</span><div><strong>Less, but better.</strong><span>Made to be made your own.</span></div><IconButton label="Help and reference" onClick={()=>setDialog('help')}><CircleHelp size={18}/></IconButton></div>
    </aside>

    <main className="workspace" aria-label="3D assembly workspace">
      <div className="workspace-top">
        <div className="workspace-heading"><span className="overline">{realisticPreview?'A PLACE FOR YOUR DESIGN':'YOUR WORKSPACE'}</span><h1>{realisticPreview?'See it at home':'Make room for ideas'}<span>.</span></h1></div>
        <div className="workspace-options">
          {!realisticPreview&&!leftOpen&&<IconButton label="Open panel list" onClick={()=>setLeftOpen(true)}><PanelLeftOpen size={18}/></IconButton>}
          <Tooltip label="Show dimensions"><button className={`canvas-toggle ${showDimensions?'active':''}`} aria-label="Show dimensions" aria-pressed={showDimensions} onClick={()=>setShowDimensions(v=>!v)}><Ruler size={18}/></button></Tooltip>
          {!realisticPreview&&<Tooltip label="Show grid"><button className={`canvas-toggle ${showGrid?'active':''}`} aria-label="Show grid" aria-pressed={showGrid} onClick={()=>setShowGrid(v=>!v)}><Grid2X2 size={17}/></button></Tooltip>}
          {!realisticPreview&&!rightOpen&&<IconButton label="Open inspector" onClick={()=>setRightOpen(true)}><SlidersHorizontal size={18}/></IconButton>}
        </div>
      </div>
      <div className="preview-mode-switch" role="group" aria-label="Preview mode">
        <button aria-pressed={!realisticPreview} onClick={()=>setRealisticPreview(false)}><Box size={15}/>Studio</button>
        <button aria-pressed={realisticPreview} onClick={()=>setRealisticPreview(true)}><House size={15}/>Realistic preview</button>
      </div>
      <div className="scene-container"><Scene panels={realisticPreview?panels:panels.filter(p=>!previewIds.has(p.id))} connections={realisticPreview?project.connections:project.connections.filter(c=>!previewIds.has(c.childId)&&!previewIds.has(c.parentId))} selectedIds={realisticPreview?[]:selectedIds} onSelect={realisticPreview?()=>{}:choosePanel} previewPanels={realisticPreview?[]:previewPanels} previewConnections={realisticPreview?[]:previewConnections} view={realisticPreview?'perspective':view} showGrid={!realisticPreview&&showGrid} showDimensions={showDimensions} exploded={!realisticPreview&&exploded} realisticPreview={realisticPreview} fitSignal={fitSignal} zoomSignal={zoomSignal}/></div>
      {!realisticPreview&&inspectorTab==='attach'&&selected&&<div className="preview-badge"><span className="pulsing-dot"/>Attachment preview <span>·</span> {attachment.side} side</div>}
      {!realisticPreview&&!panels.length&&<div className="canvas-empty"><h2>Something good starts here.</h2><p>Bring a panel. Build an idea.</p><Button onClick={addPanel}><Plus size={18}/>Add your first panel</Button></div>}
      {realisticPreview&&<div className="room-details" aria-label="Room scale reference">
        <span className="room-eyebrow"><Sun size={14}/>THE DAYLIGHT ROOM</span>
        <h2>{hasVisiblePanels?'Your design, in proportion.':'A room for your next idea.'}</h2>
        {hasVisiblePanels?<p className="room-dimensions">{number(visibleBounds.width)} × {number(visibleBounds.height)} × {number(visibleBounds.depth)} <span>mm · W × H × D</span></p>:<p>Add or show a panel in Studio to see it here.</p>}
        <p className="room-scale-note">Life-size setting · floor lamp 165 cm tall</p>
      </div>}
      <div className="canvas-bottom">
        <div className="canvas-instructions"><MousePointer2 size={14}/><span>Drag to orbit<span className="instruction-dot">·</span>Scroll to zoom{!realisticPreview&&<><span className="instruction-dot">·</span>Shift-click to multi-select</>}</span></div>
        <div className="view-controls">
          {realisticPreview?<span className="room-view-label"><House size={15}/>Room view</span>:<div className="view-select"><Box size={16}/><select aria-label="Camera view" value={view} onChange={e=>setView(e.target.value as CameraView)}><option value="perspective">Perspective</option><option value="front">Front</option><option value="top">Top</option><option value="right">Right</option></select><ChevronDown size={13}/></div>}
          <span className="control-divider"/><IconButton label="Zoom out" onClick={()=>setZoomSignal(v=>({direction:-1,key:v.key+1}))}><Minus size={17}/></IconButton><IconButton label="Zoom in" onClick={()=>setZoomSignal(v=>({direction:1,key:v.key+1}))}><Plus size={17}/></IconButton><span className="control-divider"/>
          <IconButton label={realisticPreview?'Reset room view (F)':'Fit assembly (F)'} onClick={()=>setFitSignal(v=>v+1)}><Maximize size={17}/></IconButton>
          {!realisticPreview&&<IconButton label="Exploded view" aria-pressed={exploded} className={exploded?'is-active':''} onClick={()=>setExploded(v=>!v)}><Expand size={17}/></IconButton>}
        </div>
      </div>
      {!realisticPreview&&<div className="axis-label" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><i/><b/></div>}
    </main>

    <aside className="right-sidebar" aria-label="Panel inspector"><div className="inspector-header"><span><Settings2 size={17}/>Inspector</span><IconButton label="Collapse inspector" onClick={()=>setRightOpen(false)}><X size={17}/></IconButton></div>
      <div className="inspector-tabs"><button className={inspectorTab==='panel'?'active':''} onClick={()=>setInspectorTab('panel')}>Panel</button><button className={inspectorTab==='attach'?'active':''} disabled={!selected} onClick={startAttach}><Link2 size={15}/>Attach</button></div>
      <div className="inspector-scroll">
        {selectedPanels.length>1?<MultiPanelInspector panels={selectedPanels} connections={project.connections} issues={issues} onChange={patch=>commit(p=>updateSelectedPanels(p,selectedIds,patch))} onConnectionChange={patch=>commit(p=>updateSelectedConnections(p,selectedIds,patch))} onDuplicate={duplicateSelected} onDelete={deleteSelected}/>:selected?inspectorTab==='panel'?<>
          <div className="selected-heading"><span className="selection-indicator"/><span>SELECTED PANEL</span><span className="selected-index">{String(panels.findIndex(p=>p.id===selectedId)+1).padStart(2,'0')}</span></div>
          <label className="field panel-name-field"><span>Name</span><input key={`${selected.id}-${selected.name}`} defaultValue={selected.name} aria-label="Panel name" maxLength={60} onBlur={e=>updatePanel({name:e.target.value.trim()||'Untitled panel'})} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
          <section className="inspector-section"><div className="section-title"><h2>Make it yours</h2><span>mm</span></div><PanelFields panel={selected} onChange={updatePanel}/></section>
          <section className="inspector-section"><div className="section-title"><h2>{connection?'Connection':'Placement'}</h2><Move3D size={16}/></div>
          {connection?<><div className="connection-type" aria-label="Connector type"><ConnectorGlyph type={connection.type}/><span><strong>{CONNECTORS.find(c=>c.id===connection.type)?.name} connector</strong><small>{CONNECTORS.find(c=>c.id===connection.type)?.description}</small></span></div><div className="attached-to"><Link2 size={15}/><span>Attached to <strong>{panels.find(p=>p.id===connection.parentId)?.name}</strong></span></div><SelectField label="Side" value={connection.side} onChange={side=>updateConnection({side:side as Side})}>{SIDES.map(side=><option key={side} value={side}>{side[0].toUpperCase()+side.slice(1)}</option>)}</SelectField><div className="field-row"><NumberField label="Offset" value={connection.offset} onChange={offset=>updateConnection({offset})}/><NumberField label="Inset" value={connection.inset} onChange={inset=>updateConnection({inset})}/></div><label className="checkbox-label"><input type="checkbox" checked={connection.flip} onChange={e=>updateConnection({flip:e.target.checked})}/>Flip joint direction</label><Button variant="ghost" size="sm" className="detach-button" onClick={()=>{commit(p=>detachPanel(p,selected.id));notify('Panel detached. Its position is unchanged.')}}>Detach for free placement<ArrowRight size={14}/></Button></>:<><SelectField label="Orientation" value={Math.abs(selected.rotation[0]+Math.PI/2)<.001?'horizontal':Math.abs(selected.rotation[1]-Math.PI/2)<.001?'side':selected.rotation.every(n=>n===0)?'vertical':'custom'} onChange={v=>updatePanel({rotation:v==='horizontal'?[-Math.PI/2,0,0]:v==='side'?[0,Math.PI/2,0]:[0,0,0]})}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option><option value="custom" disabled>Custom rotation</option></SelectField><div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Position ${axis}`} value={selected.position[i]} onChange={v=>{const pos=[...selected.position] as Vec3;pos[i]=v;updatePanel({position:pos})}}/>)}</div><div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Rotate ${axis}`} value={selected.rotation[i]*180/Math.PI} min={-360} max={360} unit="°" onChange={v=>{const rot=[...selected.rotation] as Vec3;rot[i]=v*Math.PI/180;updatePanel({rotation:rot})}}/>)}</div></>}
          </section>
          {issues.filter(i=>i.panelIds.includes(selected.id)).map(i=><div className={`validation-note ${i.severity}`} key={i.id}><CircleHelp size={16}/><span>{i.message}</span></div>)}
          <div className="panel-actions"><Button variant="outline" size="sm" onClick={duplicateSelected}><Copy size={15}/>Duplicate</Button><IconButton label="Delete selected panel" className="delete-button" onClick={deleteSelected}><Trash2 size={16}/></IconButton></div>
        </>:<>
          <div className="attach-intro"><span className="connector-mini"><Link2 size={20}/></span><div><h2>Keep building.</h2><p>Attach to {selected.name}</p></div></div>
          <SelectField label="Panel to attach" value={attachTarget} onChange={value=>{setAttachTarget(value);setDraft(value==='new'?createPanel({name:`Panel ${project.panels.length+1}`,width:selected.width,height:360,thickness:selected.thickness,material:selected.material,color:selected.color}):{...panels.find(p=>p.id===value)!})}}><option value="new">Create a new panel</option>{panels.filter(p=>p.id!==selected.id).map(p=><option key={p.id} value={p.id}>{p.name} · existing</option>)}</SelectField>
          <div className="field"><span>Choose a side</span><div className="side-options">{SIDES.map(side=><button key={side} className={attachment.side===side?'selected':''} aria-pressed={attachment.side===side} onClick={()=>setAttachment(a=>({...a,side}))}>{side[0].toUpperCase()+side.slice(1)}</button>)}</div></div>
          <div className="field"><span>Connector</span><div className="connector-options">{CONNECTORS.map(c=><Tooltip key={c.id} label={c.description}><button className={attachment.type===c.id?'selected':''} aria-label={`${c.name} connector`} aria-pressed={attachment.type===c.id} onClick={()=>setAttachment(a=>({...a,type:c.id}))}><ConnectorGlyph type={c.id}/><span>{c.name}</span></button></Tooltip>)}</div></div>
          <div className="field-row"><NumberField label="Offset" value={attachment.offset} onChange={offset=>setAttachment(a=>({...a,offset}))}/><NumberField label="Inset" value={attachment.inset} onChange={inset=>setAttachment(a=>({...a,inset}))}/></div><p className="field-note">Offset slides along the joint. Inset moves it across the panel.</p>
          <label className="checkbox-label"><input type="checkbox" checked={attachment.flip} onChange={e=>setAttachment(a=>({...a,flip:e.target.checked}))}/>Flip joint direction</label>
          <div className="field-row"><NumberField label="Connectors" value={attachment.count} min={1} max={8} unit="pcs" onChange={count=>setAttachment(a=>({...a,count:Math.round(count)}))}/><label className="field"><span>Connector color</span><input className="connector-color-input" type="color" aria-label="Connector color" value={attachment.color} onChange={e=>setAttachment(a=>({...a,color:e.target.value}))}/></label></div>
          <section className="inspector-section"><div className="section-title"><h2>{attachment.type==='t'?'2 new panels':attachment.type==='cross'?'3 new panels':attachTarget==='new'?'New panel':'Your panel'}</h2><Layers size={16}/></div><PanelFields panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))} compact/></section>
          {previewResult.error&&<div className="validation-note error" role="alert"><CircleHelp size={16}/><span>{previewResult.error}</span></div>}
          {previewIssues.length?previewIssues.map(i=><div className={`validation-note ${i.severity}`} key={i.id}><CircleHelp size={16}/><span>{i.message}</span></div>):previewProject?<div className="compatibility-note"><Check size={16}/><span>Panel thickness is compatible</span></div>:null}
        </>:<div className="no-selection"><MousePointer2 size={28}/><h2>A little more detail.</h2><p>Select a panel in the workspace<br/>to make it your own.</p><Button variant="outline" onClick={addPanel}><Plus size={16}/>Add a panel</Button></div>}
      </div>
      {selectedPanels.length>1&&<div className="inspector-footer multi-selection-footer"><Layers size={16}/><span>Editing {selectedPanels.length} panels together</span></div>}
      {selected&&<div className="inspector-footer">{inspectorTab==='attach'?<><Button className="full-button" onClick={applyAttachment} disabled={!previewProject||attachmentErrors.length>0}><Link2 size={17}/>Attach {attachment.type==='t'?'2 panels':attachment.type==='cross'?'3 panels':'panel'}<ArrowRight size={16}/></Button><button className="text-button" onClick={()=>setInspectorTab('panel')}>Cancel preview</button></>:<Button className="full-button" onClick={startAttach}><Plus size={18}/>Attach a panel<ArrowRight size={17}/></Button>}</div>}
    </aside>

    <footer className="status-bar"><div><span className="status-dot"/><span>{project.panels.length} panels</span><span className="status-separator">/</span><span>{connectorCount} connectors</span><span className="status-separator">/</span><button onClick={()=>setDialog('parts')} className={issues.length?'status-warning':''}>{issues.length?`${issues.length} ${issues.length===1?'check':'checks'} to review`:'Ready to explore'}</button></div><div className="assembly-size"><span>ASSEMBLY</span>{number(bounds.width)} × {number(bounds.height)} × {number(bounds.depth)} mm</div><button className="status-help" onClick={()=>setDialog('help')}><CircleHelp size={14}/>Shortcuts & help</button></footer>
    {toast&&<div className="toast" role="status"><CheckCheck size={18}/>{toast}</div>}

    <Dialog open={dialog!==null} onOpenChange={open=>{if(!open)setDialog(null)}}><DialogContent className={dialog==='templates'?'wide-dialog':dialog==='parts'?'parts-dialog':''}>
      {dialog==='add'&&<><span className="dialog-eyebrow">YOUR MATERIAL, YOUR POSSIBILITIES</span><DialogTitle>Bring your own panel.</DialogTitle><DialogDescription>Start with what you have. Every detail can be changed later.</DialogDescription><div className="dialog-form"><label className="field"><span>Panel name</span><input value={draft.name} maxLength={60} onChange={e=>setDraft(p=>({...p,name:e.target.value}))}/></label><PanelFields panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))}/><SelectField label="Orientation" value={draft.rotation[0]===-Math.PI/2?'horizontal':draft.rotation[1]===Math.PI/2?'side':'vertical'} onChange={v=>setDraft(p=>({...p,rotation:v==='horizontal'?[-Math.PI/2,0,0]:v==='side'?[0,Math.PI/2,0]:[0,0,0]}))}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option></SelectField></div><div className="dialog-footer"><Button variant="ghost" onClick={()=>setDialog(null)}>Cancel</Button><Button onClick={()=>{commit(p=>({...p,panels:[...p.panels,{...draft,name:draft.name.trim()||'My panel'}]}));setSelectedId(draft.id);setInspectorTab('panel');setRightOpen(true);setDialog(null);setFitSignal(v=>v+1);notify('Your panel is ready')}}><Plus size={17}/>Add to workspace</Button></div></>}
      {dialog==='templates'&&<><span className="dialog-eyebrow">A FEW GOOD STARTING POINTS</span><DialogTitle>Simple parts. Endless possibilities.</DialogTitle><DialogDescription>Choose an assembly and make it your own. You can undo switching templates.</DialogDescription><ExampleBrowser onSelect={loadTemplate}/></>}
      {dialog==='export'&&<><span className="dialog-eyebrow">FROM IDEA TO SOMETHING REAL</span><DialogTitle>Take your project with you.</DialogTitle><DialogDescription>Save an editable project or a parts list for your next build.</DialogDescription><div className="export-options"><button onClick={exportProject}><span className="export-icon"><FolderOpen size={23}/></span><span><strong>Project file</strong><small>All panels, connections, and materials · JSON</small></span><Download size={19}/></button><button onClick={()=>{download(projectToCsv(project),`${exportName}-parts.csv`,'text/csv');notify('Parts list exported')}}><span className="export-icon"><ListChecks size={23}/></span><span><strong>Parts & cutting list</strong><small>Panel dimensions and connector quantities · CSV</small></span><Download size={19}/></button></div><div className="import-area"><span>Picking up where you left off?</span><Button variant="outline" onClick={()=>importRef.current?.click()}><Upload size={16}/>Import project</Button></div>{importError&&<p role="alert" className="error-message">{importError}</p>}<p className="dialog-note">Changes are saved automatically in this browser. Export a project file to keep a separate copy.</p></>}
      {dialog==='help'&&<><span className="dialog-eyebrow">LESS, BUT BETTER</span><DialogTitle>A space to think with your hands.</DialogTitle><DialogDescription>Playwood Studio lets you explore furniture made from your own panels and the Playwood connector system.</DialogDescription><div className="help-steps"><div><span>01</span><p><strong>Bring a panel.</strong> Choose its size, material, finish, and surface. Pegboards and rounded slots are cut through the 3D geometry.</p></div><div><span>02</span><p><strong>Make a connection.</strong> Select a panel, choose Attach, and explore a side, connector angle, and offset. The preview updates before you commit.</p></div><div><span>03</span><p><strong>Make it yours.</strong> Keep building, explore the view, then export a project or cutting list.</p></div></div><div className="shortcut-list"><span>Orbit <kbd>Drag</kbd></span><span>Pan <kbd>Right-drag</kbd></span><span>Multi-select <kbd>Shift-click</kbd></span><span>Select all <kbd>⌘ / Ctrl A</kbd></span><span>Fit view <kbd>F</kbd></span><span>Duplicate <kbd>⌘ / Ctrl D</kbd></span><span>Undo <kbd>⌘ / Ctrl Z</kbd></span><span>Delete <kbd>Delete</kbd></span></div><div className="reference-note"><strong>Built around the real system.</strong><p>90°, 105°, and 150° connectors accept 16–19 mm panels. T and cross connectors accept 18–19 mm panels. Connector shapes use the supplied 3D models; this editor is a design study, not a structural or fabrication simulation. Review joint clearances before making.</p><a href={SOURCE_URL} target="_blank" rel="noreferrer">Official technical drawings <ArrowRight size={14}/></a><a href="https://www.playwood.it/en/diy-wooden-projects-connectors/" target="_blank" rel="noreferrer">Explore Playwood connectors <ArrowRight size={14}/></a></div></>}
      {dialog==='parts'&&<><span className="dialog-eyebrow">THE SUM OF SIMPLE PARTS</span><DialogTitle>Your assembly, item by item.</DialogTitle><DialogDescription>{project.panels.length} panels and {connectorCount} connectors in {project.name}.</DialogDescription><div className="parts-table-wrap"><table><thead><tr><th>Panel</th><th>Material</th><th>Dimensions · mm</th></tr></thead><tbody>{panels.map(p=><tr key={p.id}><td>{p.name}<small>{p.pattern==='solid'?'Solid':p.pattern==='pegboard'?'Pegboard':'Rounded slots'}</small></td><td>{MATERIALS.find(m=>m.id===p.material)?.name}</td><td>{p.width} × {p.height} × {p.thickness}</td></tr>)}</tbody></table></div><div className="parts-connectors">{CONNECTORS.map(c=>{const count=project.connections.filter(conn=>conn.type===c.id).reduce((n,conn)=>n+conn.count,0);return count>0?<span key={c.id}><ConnectorGlyph type={c.id}/><strong>{count}</strong> × {c.name}</span>:null})}</div>{issues.length>0&&<div className="parts-issues"><h3>Before you build</h3>{issues.map(i=><p key={i.id}><CircleHelp size={15}/>{i.message}</p>)}</div>}<div className="dialog-footer"><Button variant="outline" onClick={()=>{download(projectToCsv(project),`${exportName}-parts.csv`,'text/csv');notify('Parts list exported')}}><Download size={16}/>Export cutting list</Button></div></>}
    </DialogContent></Dialog>
    <input ref={importRef} type="file" accept=".json,.playwood.json" className="visually-hidden" aria-label="Import project file" onChange={e=>{const file=e.target.files?.[0];if(file)void importProject(file);e.target.value=''}}/>
  </div></TooltipProvider>
}
