import { useEffectEvent, useLayoutEffect, useSyncExternalStore } from 'react'

const subscribe=(notify:()=>void)=>{
  window.addEventListener('resize',notify)
  return ()=>window.removeEventListener('resize',notify)
}
const viewport=()=>window.innerWidth<=680?'phone':window.innerWidth<=900?'tablet':'desktop'
const focusable='button,input,select,textarea,a[href],[tabindex]'

/** CSS overlays become modal drawers; desktop sidebars keep normal navigation. */
export function useSidebarDrawers({leftOpen,rightOpen,realisticPreview,setLeftOpen,setRightOpen,cancelTask}:{
  leftOpen:boolean;rightOpen:boolean;realisticPreview:boolean
  setLeftOpen:(open:boolean)=>void;setRightOpen:(open:boolean)=>void
  cancelTask:(side:'left'|'right')=>boolean
}) {
  const size=useSyncExternalStore(subscribe,viewport)
  const active=realisticPreview?null:size!=='desktop'&&leftOpen?'left':size==='phone'&&rightOpen?'right':null
  const cancel=useEffectEvent(cancelTask)
  useLayoutEffect(()=>{
    if(!active)return
    const drawer=document.querySelector<HTMLElement>(`.${active}-sidebar`)
    if(!drawer)return
    const opener=active==='left'?'Open panel list':'Open inspector'
    const close=()=>active==='left'?setLeftOpen(false):setRightOpen(false)
    const siblings=Array.from(drawer.parentElement!.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==drawer)
    const inert=siblings.map(node=>[node,node.inert] as const)
    inert.forEach(([node])=>{node.inert=true})
    drawer.dataset.editorDrawer='true'
    drawer.setAttribute('role','dialog')
    drawer.setAttribute('aria-modal','true')
    drawer.tabIndex=-1
    const controls=()=>Array.from(drawer.querySelectorAll<HTMLElement>(focusable)).filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&!node.closest('[inert]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden')
    const focus=()=>{(controls()[0]??drawer).focus({preventScroll:true})}
    focus()
    const keydown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing)return
      // Nested dialogs/popovers own their own keyboard lifecycle.
      const nested=(event.target as HTMLElement).closest('dialog,[role="dialog"],[role="menu"]')
      if(nested&&nested!==drawer)return
      if(event.key==='Escape') {
        event.preventDefault()
        if(!cancel(active))close()
      } else if(event.key==='Tab') {
        const items=controls(),first=items[0],last=items.at(-1)
        if(!first) {event.preventDefault();drawer.focus()}
        else if(!drawer.contains(document.activeElement)) {event.preventDefault();(event.shiftKey?last!:first).focus()}
        else if(event.shiftKey&&(document.activeElement===first||document.activeElement===drawer)) {event.preventDefault();last!.focus()}
        else if(!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus()}
      }
    }
    const focusin=(event:FocusEvent)=>{
      const target=event.target as HTMLElement
      if(!drawer.contains(target)&&!target.closest('dialog,[role="dialog"],[role="menu"]'))focus()
    }
    document.addEventListener('keydown',keydown)
    document.addEventListener('focusin',focusin)
    return ()=>{
      document.removeEventListener('keydown',keydown)
      document.removeEventListener('focusin',focusin)
      inert.forEach(([node,value])=>{node.inert=value})
      delete drawer.dataset.editorDrawer
      drawer.removeAttribute('role')
      drawer.removeAttribute('aria-modal')
      drawer.removeAttribute('tabindex')
      // The opener remounts when the drawer closes. Do not steal nested-dialog focus.
      queueMicrotask(()=>{
        if(!document.querySelector('[data-editor-drawer],[role="dialog"][data-state="open"]'))
          document.querySelector<HTMLButtonElement>(`button[aria-label="${opener}"]`)?.focus({preventScroll:true})
      })
    }
  },[active,setLeftOpen,setRightOpen])
  return active
}
