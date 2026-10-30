import { useEffectEvent, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './preview-context-menu.css'

export interface PreviewMenuAction {
  label: string
  run: () => void
  danger?: boolean
}

export function PreviewContextMenu({ x, y, title, actions, onClose }: {
  x: number; y: number; title: string; actions: PreviewMenuAction[]; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useEffectEvent(() => onClose())
  useLayoutEffect(() => {
    const menu = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector('button')?.focus()
    const dismiss = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close() }
    const dismissWindow = () => close()
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('resize', dismissWindow)
    window.addEventListener('blur', dismissWindow)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('resize', dismissWindow)
      window.removeEventListener('blur', dismissWindow)
      if (menu.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true })
    }
  }, [x, y])
  return createPortal(<div ref={ref} className="preview-context-menu" role="menu" aria-label="Preview actions" style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation()
      const buttons = [...ref.current!.querySelectorAll('button')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose() }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
    <div className="preview-context-title">{title}</div>
    {actions.map(action => <button key={action.label} role="menuitem" className={action.danger ? 'is-destructive' : undefined} onClick={() => { onClose(); action.run() }}>{action.label}</button>)}
  </div>, document.body)
}
