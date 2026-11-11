import { useLayoutEffect,useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCheck,Info,TriangleAlert,X } from 'lucide-react'
import type { EditorNotification } from '@/editor/editor-notifications'
import './editor-notifications.css'

export function EditorNotifications({toast,error,dismissError,drawer}:{
  toast:EditorNotification|null;error:EditorNotification|null;dismissError:()=>void;drawer:'left'|'right'|null
}) {
  const [host,setHost]=useState<HTMLElement|null>(null)
  useLayoutEffect(()=>{setHost(drawer?document.querySelector<HTMLElement>(`.${drawer}-sidebar`):document.body)},[drawer])
  const dismiss=()=>{
    // Keep keyboard focus usable when the dismiss button disappears.
    const target=drawer?host?.querySelector<HTMLButtonElement>('button'):document.querySelector<HTMLCanvasElement>('canvas')
    target?.focus({preventScroll:true})
    dismissError()
  }
  return <>
    {toast&&<div className="toast" role="status" data-severity={toast.severity}>
      {toast.severity==='success'?<CheckCheck size={18} aria-hidden="true"/>:<Info size={18} aria-hidden="true"/>}{toast.message}
    </div>}
    {error&&host&&createPortal(<div className="editor-error-notice" role="alert" aria-label="Action not applied" data-severity="error">
      <TriangleAlert size={20} aria-hidden="true"/>
      <div><strong>Action not applied</strong><p>{error.message}</p></div>
      <button aria-label="Dismiss error" onClick={dismiss}><X size={18} aria-hidden="true"/></button>
    </div>,host)}
  </>
}
