import { useState } from 'react'
import { ShoppingCart, ArrowDownToLine, BookOpen, Check, ChevronDown, FilePlus2, FolderSync, LayoutTemplate, Redo2, Undo2 } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'
import './project-header.css'

interface Props {
  projectName: string
  saveStatus: string
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  onNew: () => void
  onSync: () => void
  syncFolderName: string | null
  syncConnected: boolean
  syncNeedsAttention: boolean
  onRename: (name: string) => void
  onHelp: () => void
  onTemplates: () => void
  onBuy: () => void
  onExport: () => void
}

export function ProjectHeader({projectName,saveStatus,canUndo,canRedo,undo,redo,onNew,onSync,syncFolderName,syncConnected,syncNeedsAttention,onRename,onHelp,onTemplates,onExport,onBuy}: Props) {
  const [editingName,setEditingName]=useState(false)
  return <header className="app-header">
      <button type="button" className="brand" onClick={onHelp} aria-label="About playwood. APP"><img className="brand-mark" src="/favicon.svg" width="36" height="36" alt=""/><span>playwood<span className="brand-dot">.</span></span><span className="app-tag">APP</span></button>
      <div className="header-divider"/>
      <div className="project-heading">{editingName?<input className="project-name-input" aria-label="Project name" autoFocus defaultValue={projectName} maxLength={80} onBlur={e=>{onRename(e.target.value.trim()||'Untitled project');setEditingName(false)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setEditingName(false)}}/>:<button className="project-name" onClick={()=>setEditingName(true)} title="Rename project"><span>{projectName}</span><ChevronDown size={14}/></button>}<span className="save-label"><span className="status-dot"/><span className="project-save-copy">{saveStatus}</span></span></div>
      <div className="header-actions"><div className="undo-actions"><IconButton label="Undo (⌘/Ctrl Z)" disabled={!canUndo} onClick={undo}><Undo2 size={18}/></IconButton><IconButton label="Redo (⌘/Ctrl Shift Z)" disabled={!canRedo} onClick={redo}><Redo2 size={18}/></IconButton></div><Button variant="outline" onClick={onNew} className="new-project-button" aria-label="New project"><FilePlus2 size={17}/><span>New<span className="new-project-suffix"> project</span></span></Button><SyncButton onSync={onSync} syncFolderName={syncFolderName} syncConnected={syncConnected} syncNeedsAttention={syncNeedsAttention}/><Button variant="ghost" onClick={onHelp} className="guide-open-button" aria-label="Open building guide"><BookOpen size={17}/><span>Guide</span></Button><Button variant="ghost" onClick={onTemplates} className="templates-button"><LayoutTemplate size={17}/>Templates</Button><Button variant="secondary" onClick={onExport} className="export-project-button" aria-label="Export project"><ArrowDownToLine size={17}/><span>Export project</span></Button><Button variant="outline" onClick={onBuy} className="buy-connectors-button" aria-label="Buy connectors"><ShoppingCart size={17}/><span>Buy</span></Button></div>
    </header>
}

function SyncButton({onSync,syncFolderName,syncConnected,syncNeedsAttention}: Pick<Props, 'onSync' | 'syncFolderName' | 'syncConnected' | 'syncNeedsAttention'>) {
  const status=syncFolderName?(syncConnected&&!syncNeedsAttention?'connected':'attention'):undefined
  const description=status==='connected'?`Connected to folder: ${syncFolderName}`:status==='attention'?`${syncNeedsAttention?'Folder sync needs attention':'Reconnect folder'}: ${syncFolderName}`:'Sync projects with a local folder'
  return <Button variant="outline" onClick={onSync} className="sync-projects-button" aria-label="Sync" aria-description={description} title={description} data-sync-status={status}>
    <FolderSync size={17}/><span className="sync-button-label">Sync</span>
    {status&&<span className="sync-status-badge" aria-hidden="true">{status==='connected'?<Check size={10} strokeWidth={3}/>:<span>!</span>}</span>}
  </Button>
}
