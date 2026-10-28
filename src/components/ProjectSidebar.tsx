import { useState, type ComponentProps } from 'react'
import { ArrowRight, ChevronRight, CircleHelp, Layers, Link2, ListChecks, PanelLeftClose, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'
import { PanelList } from './PanelList'
import { ExampleBrowser } from './ExampleBrowser'

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
}

export function ProjectSidebar({panelListProps,selectedCount,connectorCount,connectorSummary,onSelectAll,onCollapse,onParts,onHelp,addPanel,loadTemplate}: Props) {
  const [leftTab,setLeftTab]=useState<'assembly'|'library'>('assembly')
  const { panels } = panelListProps
  return <aside className="left-sidebar" aria-label="Project panels">
      <div className="sidebar-tabs"><button className={leftTab==='assembly'?'active':''} onClick={()=>setLeftTab('assembly')}>Assembly</button><button className={leftTab==='library'?'active':''} onClick={()=>setLeftTab('library')}>Library</button><IconButton label="Collapse panel list" onClick={onCollapse}><PanelLeftClose size={17}/></IconButton></div>
      <div className="sidebar-scroll">
        {leftTab==='assembly'?<><div className="section-label"><span>YOUR PANELS</span><span className="count-badge">{panels.length.toString().padStart(2,'0')}</span></div>
          <div className="selection-tools"><span aria-live="polite" aria-atomic="true">{selectedCount?`${selectedCount} selected`:'Shift-click to select more'}</span><button onClick={onSelectAll} disabled={!panels.length}>{selectedCount===panels.length&&panels.length?'Clear':'Select all'}</button></div><PanelList {...panelListProps}/>
          {!panels.length&&<div className="empty-panels"><Layers size={30}/><p>Every idea starts<br/>with a panel.</p></div>}
          <Button variant="outline" className="add-panel-button" onClick={addPanel}><Plus size={17}/>Add a panel<span className="key-hint">+</span></Button>
          <div className="sidebar-rule"/><div className="section-label"><span>CONNECTIONS</span><span className="count-badge">{connectorCount.toString().padStart(2,'0')}</span></div>
          <div className="connection-summary"><span className="connector-mini"><Link2 size={20}/></span><div><strong>Playwood connectors</strong><span>{connectorSummary||'Select a panel to connect'}</span></div></div>
          <Button variant="ghost" size="sm" className="full-button" onClick={onParts}><ListChecks size={16}/>View parts list<ChevronRight size={15}/></Button>
        </>:<><div className="library-intro"><h2>A place to start.</h2><p>Explore individual builds.<br/>Choose one and make it yours.</p></div><ExampleBrowser compact onSelect={loadTemplate}/><button className="library-reference" onClick={onHelp}>About the connector system<ArrowRight size={15}/></button></>}
      </div>
      <div className="sidebar-footer"><span className="little-mark">p.</span><div><strong>Less, but better.</strong><span>Made to be made your own.</span></div><IconButton label="Help and reference" onClick={onHelp}><CircleHelp size={18}/></IconButton></div>
    </aside>
}
