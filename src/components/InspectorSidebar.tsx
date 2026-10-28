import type { ReactNode } from 'react'
import { ArrowRight, Layers, Link2, Plus, Settings2, X } from 'lucide-react'
import { Button } from './ui/button'
import { IconButton } from './editor-controls'
import type { ConnectorType } from '@/lib/types'

interface Props {
  children: ReactNode
  inspectorTab: 'panel' | 'attach'
  selectedCount: number
  hasSelection: boolean
  onCollapse: () => void
  onPanel: () => void
  startAttach: () => void
  applyAttachment: () => void
  canAttach: boolean
  attachmentType: ConnectorType
}

export function InspectorSidebar({children,inspectorTab,selectedCount,hasSelection,onCollapse,onPanel,startAttach,applyAttachment,canAttach,attachmentType}: Props) {
  return <aside className="right-sidebar" aria-label="Panel inspector"><div className="inspector-header"><span><Settings2 size={17}/>Inspector</span><IconButton label="Collapse inspector" onClick={onCollapse}><X size={17}/></IconButton></div>
      <div className="inspector-tabs"><button className={inspectorTab==='panel'?'active':''} onClick={onPanel}>Panel</button><button className={inspectorTab==='attach'?'active':''} disabled={!hasSelection} onClick={startAttach}><Link2 size={15}/>Attach</button></div>
      <div className="inspector-scroll">{children}</div>
      {selectedCount>1&&<div className="inspector-footer multi-selection-footer"><Layers size={16}/><span>Editing {selectedCount} panels together</span></div>}
      {hasSelection&&<div className="inspector-footer">{inspectorTab==='attach'?<><Button className="full-button" onClick={applyAttachment} disabled={!canAttach}><Link2 size={17}/>Attach {attachmentType==='t'?'2 panels':attachmentType==='cross'?'3 panels':'panel'}<ArrowRight size={16}/></Button><button className="text-button" onClick={onPanel}>Cancel preview</button></>:<Button className="full-button" onClick={startAttach}><Plus size={18}/>Attach a panel<ArrowRight size={17}/></Button>}</div>}
    </aside>
}
