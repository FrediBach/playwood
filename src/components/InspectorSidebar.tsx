import type { ConnectorType } from '@/lib/types'
import { ArrowLeft,ArrowRight,Link2,Plus,Settings2,X } from 'lucide-react'
import { useLayoutEffect,useRef,type ReactNode } from 'react'
import { IconButton } from './editor-controls'
import './inspector.css'
import { Button } from './ui/button'

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
  contextLabel?: string
  contextDetail?: string
  selectionKey: string
  footer?: ReactNode
  attachmentStatus?: string
  onDoneEditing?: () => void
}

export function InspectorSidebar({
  children, inspectorTab, selectedCount, hasSelection,
  onCollapse, onPanel, startAttach, applyAttachment,
  canAttach, attachmentType, contextLabel, contextDetail,
  selectionKey, footer, attachmentStatus, onDoneEditing
}: Props) {
  const attaching = inspectorTab==='attach'&&!contextLabel
  const scroll = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = 0 }, [selectionKey])
  return <aside className="right-sidebar" aria-label="Inspector">
    <div className="inspector-header"><span><Settings2 size={17}/>{attaching?'Attach panel':contextLabel??(selectedCount>1?'Panel selection':'Inspector')}</span><IconButton label="Collapse inspector" onClick={onCollapse}><X size={17}/></IconButton></div>
    {onDoneEditing&&<div className="inspector-edit-context"><p><strong>Editing shared design</strong><span>{contextDetail}</span></p><Button variant="outline" size="sm" onClick={onDoneEditing}>Done editing</Button></div>}
    {attaching&&<div className="inspector-task-back"><Button variant="ghost" size="sm" onClick={onPanel}><ArrowLeft size={14}/>Panel</Button></div>}
    <div ref={scroll} className="inspector-scroll">{children}</div>
    <InspectorFooter footer={footer} contextLabel={contextLabel} hasSelection={hasSelection} attaching={attaching} canAttach={canAttach} attachmentStatus={attachmentStatus} applyAttachment={applyAttachment} attachmentType={attachmentType} onPanel={onPanel} startAttach={startAttach}/>
  </aside>
}

function InspectorFooter({ footer, contextLabel, hasSelection, attaching, canAttach, attachmentStatus, applyAttachment, attachmentType, onPanel, startAttach }: { footer: React.ReactNode; contextLabel: string|undefined; hasSelection: boolean; attaching: boolean; canAttach: boolean; attachmentStatus: string|undefined; applyAttachment: () => void; attachmentType: import("@/lib/types").ConnectorType; onPanel: () => void; startAttach: () => void })  {
  return footer!==undefined? <div className="inspector-footer">{footer}</div>:!contextLabel&&hasSelection&&<div className="inspector-footer">
    {attaching? <AttachmentFooter canAttach={canAttach} attachmentStatus={attachmentStatus} applyAttachment={applyAttachment} attachmentType={attachmentType} onPanel={onPanel}/>:<Button className="full-button" onClick={startAttach}><Plus size={18} />Attach a panel<ArrowRight size={17} /></Button>}
  </div>
}

function AttachmentFooter({ canAttach, attachmentStatus, applyAttachment, attachmentType, onPanel }: { canAttach: boolean; attachmentStatus: string|undefined; applyAttachment: () => void; attachmentType: import("@/lib/types").ConnectorType; onPanel: () => void })  {
  return <>
    <p className={`inspector-task-status ${canAttach? '':'is-blocked'}`} id="attachment-status" role="status">{attachmentStatus||(canAttach? 'Ready to attach':'Choose a compatible connection.')}</p>
    <Button className="full-button" onClick={applyAttachment} disabled={!canAttach} aria-describedby="attachment-status"><Link2 size={17} />Attach {attachmentType==='t'? '2 panels':attachmentType==='cross'? '3 panels':'panel'}<ArrowRight size={16} /></Button>
    <button className="text-button" onClick={onPanel}>Cancel preview</button>
  </>
}
