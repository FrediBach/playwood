import { useState, type ComponentProps } from 'react'
import { ArrowRight, Box, ChevronDown, ChevronRight, CircleHelp, Layers, Link2, ListChecks, PanelLeftClose, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'
import { PanelList } from './PanelList'
import { ExampleBrowser } from './ExampleBrowser'
import './assemblies.css'

export interface SidebarAssembly { id: string; name: string; definitionName: string; panelIds: string[] }
export interface LibraryAssembly { id: string; name: string; instanceCount: number; panelCount: number }

interface Props {
  panelListProps: ComponentProps<typeof PanelList>
  selectedCount: number
  connectorCount: number
  connectorSummary: string
  onSelectAll: () => void
  onCollapse: () => void
  onParts: () => void
  onHelp: () => void
  addPanel: () => void
  loadTemplate: (template: string) => void
  assemblies?: SidebarAssembly[]
  selectedAssemblyId?: string | null
  onSelectAssembly?: (id: string) => void
  onSelectAssemblyPanel?: (id: string) => void
  libraryAssemblies?: LibraryAssembly[]
  onInsertAssembly?: (id: string) => void
}

export function ProjectSidebar({panelListProps,selectedCount,connectorCount,connectorSummary,onSelectAll,onCollapse,onParts,onHelp,addPanel,loadTemplate,assemblies=[],selectedAssemblyId,onSelectAssembly,onSelectAssemblyPanel,libraryAssemblies=[],onInsertAssembly}: Props) {
  const [leftTab,setLeftTab]=useState<'assembly'|'library'>('assembly')
  const [expanded,setExpanded]=useState<string[]>([])
  const { panels } = panelListProps
  const memberIds = new Set(assemblies.flatMap(assembly => assembly.panelIds))
  const loosePanels = panels.filter(panel => !memberIds.has(panel.id))
  return <aside className="left-sidebar" aria-label="Project panels">
      <div className="sidebar-tabs"><button className={leftTab==='assembly'?'active':''} onClick={()=>setLeftTab('assembly')}>Assembly</button><button className={leftTab==='library'?'active':''} onClick={()=>setLeftTab('library')}>Library</button><IconButton label="Collapse panel list" onClick={onCollapse}><PanelLeftClose size={17}/></IconButton></div>
      <div className="sidebar-scroll">
        {leftTab==='assembly'?<><div className="section-label"><span>{assemblies.length?'YOUR ASSEMBLY':'YOUR PANELS'}</span><span className="count-badge">{panels.length.toString().padStart(2,'0')}</span></div>
          <div className="selection-tools"><span aria-live="polite" aria-atomic="true">{selectedAssemblyId?'Assembly selected':selectedCount?`${selectedCount} selected`:'Shift-click to select more'}</span><button onClick={onSelectAll} disabled={!panels.length}>{selectedCount===panels.length&&panels.length?'Clear':'Select all'}</button></div>
          {assemblies.length>0&&<div className="assembly-tree">{assemblies.map(assembly=>{
            const open=expanded.includes(assembly.id)
            const selected=selectedAssemblyId===assembly.id||assembly.panelIds.length>0&&assembly.panelIds.every(id=>panelListProps.selectedIds.includes(id))
            return <div className={`assembly-tree-item ${selected?'is-selected':''}`} key={assembly.id} data-assembly-id={assembly.id}>
              <div className="assembly-tree-row"><button className="assembly-tree-toggle" aria-label={`${open?'Collapse':'Expand'} ${assembly.name}`} aria-expanded={open} onClick={()=>setExpanded(ids=>open?ids.filter(id=>id!==assembly.id):[...ids,assembly.id])}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>
                <button className="assembly-tree-select" aria-label={`Select assembly ${assembly.name}`} aria-pressed={selected} onClick={()=>onSelectAssembly?.(assembly.id)}><Box size={20}/><span><strong>{assembly.name}</strong><small>{assembly.definitionName} · {assembly.panelIds.length} panels</small></span></button></div>
              {open&&<div className="assembly-tree-children">{assembly.panelIds.map(id=>{
                const panel=panels.find(item=>item.id===id)
                if(!panel)return null
                return <button key={id} className={`assembly-tree-panel ${!selected&&panelListProps.selectedIds.includes(id)?'is-selected':''}`} aria-label={`Select panel ${panel.name} in ${assembly.name}`} aria-pressed={!selected&&panelListProps.selectedIds.includes(id)} onClick={()=>onSelectAssemblyPanel?.(id)}><span className="assembly-tree-panel-color" style={{background:panel.color}}/><span>{panel.name}</span></button>
              })}</div>}
            </div>
          })}</div>}
          <PanelList {...panelListProps} panels={loosePanels}/>
          {!panels.length&&<div className="empty-panels"><Layers size={30}/><p>Every idea starts<br/>with a panel.</p></div>}
          <Button variant="outline" className="add-panel-button" onClick={addPanel}><Plus size={17}/>Add a panel<span className="key-hint">+</span></Button>
          <div className="sidebar-rule"/><div className="section-label"><span>CONNECTIONS</span><span className="count-badge">{connectorCount.toString().padStart(2,'0')}</span></div>
          <div className="connection-summary"><span className="connector-mini"><Link2 size={20}/></span><div><strong>Playwood connectors</strong><span>{connectorSummary||'Select a panel to connect'}</span></div></div>
          <Button variant="ghost" size="sm" className="full-button" onClick={onParts}><ListChecks size={16}/>View parts list<ChevronRight size={15}/></Button>
        </>:<>{libraryAssemblies.length>0&&<section className="assembly-library"><div className="section-label"><span>MY ASSEMBLIES</span><span className="count-badge">{libraryAssemblies.length}</span></div>{libraryAssemblies.map(assembly=><button key={assembly.id} className="assembly-library-card" aria-label={`Insert ${assembly.name} instance`} onClick={()=>onInsertAssembly?.(assembly.id)}><Box size={23}/><span><strong>{assembly.name}</strong><small>{assembly.panelCount} panels · {assembly.instanceCount} {assembly.instanceCount===1?'instance':'instances'}</small></span><Plus size={16}/></button>)}<p className="assembly-help">Insert a linked copy, then attach it in the workspace.</p></section>}<div className="library-intro"><h2>A place to start.</h2><p>Explore individual builds.<br/>Choose one and make it yours.</p></div><ExampleBrowser compact onSelect={loadTemplate}/><button className="library-reference" onClick={onHelp}>About the connector system<ArrowRight size={15}/></button></>}
      </div>
      <div className="sidebar-footer"><span className="little-mark">p.</span><div><strong>Less, but better.</strong><span>Made to be made your own.</span></div><IconButton label="Help and reference" onClick={onHelp}><CircleHelp size={18}/></IconButton></div>
    </aside>
}
