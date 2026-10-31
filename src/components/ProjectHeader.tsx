import { useState } from 'react'
import { ArrowDownToLine, BookOpen, ChevronDown, FilePlus2, LayoutTemplate, Redo2, Undo2 } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'

interface Props {
  projectName: string
  saveStatus: string
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  onNew: () => void
  onRename: (name: string) => void
  onHelp: () => void
  onTemplates: () => void
  onExport: () => void
}

export function ProjectHeader({projectName,saveStatus,canUndo,canRedo,undo,redo,onNew,onRename,onHelp,onTemplates,onExport}: Props) {
  const [editingName,setEditingName]=useState(false)
  return <header className="app-header">
      <button type="button" className="brand" onClick={onHelp} aria-label="About playwood. APP"><img className="brand-mark" src="/favicon.svg" width="36" height="36" alt=""/><span>playwood<span className="brand-dot">.</span></span><span className="app-tag">APP</span></button>
      <div className="header-divider"/>
      <div className="project-heading">{editingName?<input className="project-name-input" aria-label="Project name" autoFocus defaultValue={projectName} maxLength={80} onBlur={e=>{onRename(e.target.value.trim()||'Untitled project');setEditingName(false)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setEditingName(false)}}/>:<button className="project-name" onClick={()=>setEditingName(true)} title="Rename project">{projectName}<ChevronDown size={14}/></button>}<span className="save-label"><span className="status-dot"/>{saveStatus}</span></div>
      <div className="header-actions"><div className="undo-actions"><IconButton label="Undo (⌘/Ctrl Z)" disabled={!canUndo} onClick={undo}><Undo2 size={18}/></IconButton><IconButton label="Redo (⌘/Ctrl Shift Z)" disabled={!canRedo} onClick={redo}><Redo2 size={18}/></IconButton></div><Button variant="outline" onClick={onNew} className="new-project-button" aria-label="New project"><FilePlus2 size={17}/><span>New<span className="new-project-suffix"> project</span></span></Button><Button variant="ghost" onClick={onHelp} className="guide-open-button" aria-label="Open building guide"><BookOpen size={17}/><span>Guide</span></Button><Button variant="ghost" onClick={onTemplates} className="templates-button"><LayoutTemplate size={17}/>Templates</Button><Button variant="secondary" onClick={onExport} className="export-project-button" aria-label="Export project"><ArrowDownToLine size={17}/><span>Export project</span></Button></div>
    </header>
}
