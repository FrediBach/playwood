import { useId, useState, type ComponentProps } from 'react'
import { ArrowRight, Box, ChevronDown, ChevronRight, Layers, Link2, ListChecks, PanelLeftClose, Plus } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'
import { PanelList } from './PanelList'
import { ConnectorList } from './ConnectorList'
import { ExampleBrowser } from './ExampleBrowser'
import './assemblies.css'
import { getProjectPalette } from '@/lib/custom-colors'
import { ListFilters, FilterChoices, FilterResults, emptyFilters, filterCount, matchesCommon, matchesChoice } from './ListFilters'

export interface SidebarAssembly { id: string; name: string; definitionName: string; panelIds: string[] }
export interface LibraryAssembly { id: string; name: string; instanceCount: number; panelCount: number }

interface Props {
  panelListProps: ComponentProps<typeof PanelList>
  connectorListProps: ComponentProps<typeof ConnectorList>
  assemblyTab: 'panels' | 'connectors'
  onAssemblyTabChange: (tab: 'panels' | 'connectors') => void
  selectedCount: number
  connectorCount: number
  connectorSummary: string
  onSelectAll: () => void
  onCollapse: () => void
  onParts: () => void
  onHelp: () => void
  addPanel: () => void
  onInsertLibraryAssembly: (id: string) => void
  loadTemplate: (template: string) => void
  assemblies?: SidebarAssembly[]
  selectedAssemblyId?: string | null
  onSelectAssembly?: (id: string) => void
  onSelectAssemblyPanel?: (id: string) => void
  libraryAssemblies?: LibraryAssembly[]
  onInsertAssembly?: (id: string) => void
  onImportAssembly: () => void
  assemblyImportError: string
}

export function ProjectSidebar({panelListProps,connectorListProps,assemblyTab,onAssemblyTabChange,selectedCount,connectorCount,connectorSummary,onSelectAll,onCollapse,onParts,onHelp,addPanel,loadTemplate,onInsertLibraryAssembly,assemblies=[],selectedAssemblyId,onSelectAssembly,onSelectAssemblyPanel,libraryAssemblies=[],onInsertAssembly,onImportAssembly,assemblyImportError}: Props) {
  const [leftTab,setLeftTab]=useState<'assembly'|'library'>('assembly')
  const tabsId=useId()
  const [expanded,setExpanded]=useState<string[]>([])
  const { panels } = panelListProps
  const [filters, setFilters] = useState(emptyFilters)
  const selectedIds = new Set(panelListProps.selectedIds)
  const filtering = filterCount(filters) > 0
  const matchingPanels = panels.filter(panel => matchesCommon(filters, panel.name, panel.color, panel.visible, selectedIds.has(panel.id)) && matchesChoice(filters.materials, panel.material) && matchesChoice(filters.patterns, panel.pattern) && matchesChoice(filters.thicknesses, String(panel.thickness)) && panel.width * panel.height / 1e6 >= filters.minArea && (filters.maxArea === null || panel.width * panel.height / 1e6 <= filters.maxArea))
  const matchingIds = new Set(matchingPanels.map(panel => panel.id))
  const maxArea = Math.max(0.01, Math.ceil(Math.max(0, ...panels.map(panel => panel.width * panel.height / 1e6), filters.minArea, filters.maxArea ?? 0) * 100) / 100)
  const choices = (values: string[]) => [...new Set(values)].sort().map(value => ({ value, label: value }))
  const matchingSelected = matchingPanels.filter(panel => selectedIds.has(panel.id)).length
  const panelsById = new Map(panels.map(panel => [panel.id, panel]))
  const expandedIds = new Set(expanded)
  const memberIds = new Set(assemblies.flatMap(assembly => assembly.panelIds))
  const loosePanels = matchingPanels.filter(panel => !memberIds.has(panel.id))
  return <aside className="left-sidebar" aria-label="Project panels">
      <div className="sidebar-tabs"><button className={leftTab==='assembly'?'active':''} onClick={()=>setLeftTab('assembly')}>Assembly</button><button className={leftTab==='library'?'active':''} onClick={()=>setLeftTab('library')}>Library</button><IconButton label="Collapse panel list" onClick={onCollapse}><PanelLeftClose size={17}/></IconButton></div>
      {leftTab==='assembly'&&<div className="assembly-subtabs" role="tablist" aria-label="Assembly contents" onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return
        event.preventDefault()
        const next=event.key==='Home'?'panels':event.key==='End'?'connectors':assemblyTab==='panels'?'connectors':'panels'
        onAssemblyTabChange(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`[id="${tabsId}-${next}"]`)?.focus()
      }}>
        <button role="tab" id={`${tabsId}-panels`} aria-controls={`${tabsId}-contents`} aria-selected={assemblyTab==='panels'} tabIndex={assemblyTab==='panels'?0:-1} onClick={()=>onAssemblyTabChange('panels')}><Layers size={13}/>Panels</button>
        <button role="tab" id={`${tabsId}-connectors`} aria-controls={`${tabsId}-contents`} aria-selected={assemblyTab==='connectors'} tabIndex={assemblyTab==='connectors'?0:-1} onClick={()=>onAssemblyTabChange('connectors')}><Link2 size={13}/>Connectors</button>
      </div>}
      <div className="sidebar-scroll">
        {leftTab==='assembly'?<div role="tabpanel" id={`${tabsId}-contents`} aria-labelledby={`${tabsId}-${assemblyTab}`} tabIndex={0}>
          {assemblyTab==='connectors'?<ConnectorList {...connectorListProps}/>:<><div className="section-label"><span>{assemblies.length?'YOUR ASSEMBLY':'YOUR PANELS'}</span><ListFilters kind="panels" filters={filters} onChange={setFilters} count={matchingPanels.length} total={panels.length}>
            <FilterChoices label="Color" colors values={choices(panels.map(panel => panel.color.toLowerCase())).map(option => ({ ...option, label: getProjectPalette({}).find(color => color.color.toLowerCase() === option.value)?.name ?? option.value }))} selected={filters.colors} onChange={colors => setFilters({ ...filters, colors })}/>
            <FilterChoices label="Material" values={choices(panels.map(panel => panel.material))} selected={filters.materials} onChange={materials => setFilters({ ...filters, materials })}/>
            <FilterChoices label="Pattern" values={choices(panels.map(panel => panel.pattern))} selected={filters.patterns} onChange={patterns => setFilters({ ...filters, patterns })}/>
            <FilterChoices label="Thickness" values={choices(panels.map(panel => String(panel.thickness))).map(option => ({ ...option, label: `${option.value} mm` }))} selected={filters.thicknesses} onChange={thicknesses => setFilters({ ...filters, thicknesses })}/>
            <fieldset className="filter-field filter-area"><legend>Panel size · m²</legend>
              <label>From {filters.minArea.toFixed(2)}<input aria-label="Minimum panel area" type="range" min="0" max={maxArea} step="0.01" value={filters.minArea} onChange={event => setFilters({ ...filters, minArea: Math.min(Number(event.target.value), filters.maxArea ?? maxArea) })}/></label>
              <label>To {(filters.maxArea ?? maxArea).toFixed(2)}<input aria-label="Maximum panel area" type="range" min="0" max={maxArea} step="0.01" value={filters.maxArea ?? maxArea} onChange={event => setFilters({ ...filters, maxArea: Math.max(filters.minArea, Number(event.target.value)) })}/></label>
              <small>Width × height, before cutouts.</small>
            </fieldset>
          </ListFilters><span className="count-badge">{panels.length.toString().padStart(2,'0')}</span></div>
          <div className="selection-tools"><span aria-live="polite" aria-atomic="true">{selectedAssemblyId?'Assembly selected':selectedCount?`${selectedCount} selected`:'Shift-click to select more'}</span><button onClick={() => filtering ? panelListProps.onSelectGroup(matchingPanels.map(panel => panel.id), matchingSelected !== matchingPanels.length) : onSelectAll()} disabled={!matchingPanels.length}>{matchingSelected===matchingPanels.length&&matchingPanels.length?'Clear':'Select all'}</button></div>
          {filtering && <FilterResults count={matchingPanels.length} total={panels.length} onReset={() => setFilters(emptyFilters())}/>}
          {assemblies.length>0&&<div className="assembly-tree">{assemblies.filter(assembly => !filtering || assembly.panelIds.some(id => matchingIds.has(id))).map(assembly=>{
            const open=filtering || expandedIds.has(assembly.id)
            const selected=selectedAssemblyId===assembly.id||assembly.panelIds.length>0&&assembly.panelIds.every(id=>selectedIds.has(id))
            return <div className={`assembly-tree-item ${selected?'is-selected':''}`} key={assembly.id} data-assembly-id={assembly.id}>
              <div className="assembly-tree-row"><button className="assembly-tree-toggle" aria-label={`${open?'Collapse':'Expand'} ${assembly.name}`} aria-expanded={open} onClick={()=>setExpanded(ids=>open?ids.filter(id=>id!==assembly.id):[...ids,assembly.id])}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>
                <button className="assembly-tree-select" aria-label={`Select assembly ${assembly.name}`} aria-pressed={selected} onClick={()=>onSelectAssembly?.(assembly.id)}><Box size={20}/><span><strong>{assembly.name}</strong><small>{assembly.definitionName} · {assembly.panelIds.length} panels</small></span></button></div>
              {open&&<div className="assembly-tree-children">{assembly.panelIds.map(id=>{
                const panel=panelsById.get(id)
                if(!panel || !matchingIds.has(id))return null
                return <button key={id} className={`assembly-tree-panel ${!selected&&selectedIds.has(id)?'is-selected':''}`} aria-label={`Select panel ${panel.name} in ${assembly.name}`} aria-pressed={!selected&&selectedIds.has(id)} onClick={()=>onSelectAssemblyPanel?.(id)}><span className="assembly-tree-panel-color" style={{background:panel.color}}/><span>{panel.name}</span></button>
              })}</div>}
            </div>
          })}</div>}
          <PanelList {...panelListProps} panels={loosePanels}/>
          {!panels.length&&<div className="empty-panels"><Layers size={30}/><p>Every idea starts<br/>with a panel.</p></div>}
          <Button variant="outline" className="add-panel-button" onClick={addPanel}><Plus size={17}/>Add a panel<span className="key-hint">+</span></Button>
          <div className="sidebar-rule"/><div className="section-label"><span>CONNECTIONS</span><span className="count-badge">{connectorCount.toString().padStart(2,'0')}</span></div>
          <div className="connection-summary"><span className="connector-mini"><Link2 size={20}/></span><div><strong>Playwood connectors</strong><span>{connectorSummary||'Select a panel to connect'}</span></div></div>
          <Button variant="ghost" size="sm" className="full-button" onClick={onParts}><ListChecks size={16}/>View parts list<ChevronRight size={15}/></Button>
        </>}</div>:<><div className="library-intro"><h2>A place to start.</h2><p>Explore builds and reusable modules.<br/>Choose one and make it yours.</p></div><ExampleBrowser compact onImportAssembly={onImportAssembly} assemblyImportError={assemblyImportError} onSelect={loadTemplate} onInsertAssembly={onInsertLibraryAssembly} myAssemblies={libraryAssemblies.length>0&&<section className="assembly-library"><div className="section-label"><span>MY ASSEMBLIES</span><span className="count-badge">{libraryAssemblies.length}</span></div>{libraryAssemblies.map(assembly=><button key={assembly.id} className="assembly-library-card" aria-label={`Insert ${assembly.name} instance`} onClick={()=>onInsertAssembly?.(assembly.id)}><Box size={23}/><span><strong>{assembly.name}</strong><small>{assembly.panelCount} panels · {assembly.instanceCount} {assembly.instanceCount===1?'instance':'instances'}</small></span><Plus size={16}/></button>)}<p className="assembly-help">Insert a linked copy, then attach it in the workspace.</p></section>}/><button className="library-reference" onClick={onHelp}>About the connector system<ArrowRight size={15}/></button></>}
      </div>
    </aside>
}
