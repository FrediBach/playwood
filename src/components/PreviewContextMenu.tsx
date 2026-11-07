import { createPreviewShortcutHandler, shortcutAria, shortcutLabel } from '@/lib/preview-shortcuts'
import { useState, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import './preview-context-menu.css'

export interface PreviewMenuAction {
  shortcut?: string
  label: string
  group?: string
  icon: LucideIcon
  run: () => void
  danger?: boolean
  disabled?: boolean
}

export function PreviewContextMenu({ x, y, title, actions, onClose, ariaLabel = 'Preview actions' }: {
  x: number; y: number; title: string; actions: PreviewMenuAction[]; onClose: () => void; ariaLabel?: string
}) {
  const groups = actions.reduce<{ label?: string; actions: PreviewMenuAction[] }[]>((result, action) => {
    const previous = result.at(-1)
    if (previous && previous.label === action.group) previous.actions.push(action)
    else result.push({ label: action.group, actions: [action] })
    return result
  }, [])
  const [shortcutHandler] = useState(createPreviewShortcutHandler)
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
  return createPortal(<div ref={ref} className="preview-context-menu" role="menu" aria-label={ariaLabel} style={{ left: x, top: y }}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation()
      if (shortcutHandler(event.nativeEvent, actions, onClose)) return
      const buttons = [...ref.current!.querySelectorAll('button')]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose() }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
    <div className="preview-context-title">{title}</div>
    {groups.map((group, groupIndex) => <div key={group.label ?? groupIndex} role="group" aria-label={group.label} className={group.label ? 'preview-context-group' : undefined}>
      {group.label && <div className="preview-context-group-title" aria-hidden="true">{group.label}</div>}
      {group.actions.map((action, index) => <button key={`${index}-${action.label}`} role="menuitem" aria-label={action.label} aria-keyshortcuts={action.shortcut ? shortcutAria(action.shortcut) : undefined} aria-disabled={action.disabled || undefined} className={action.danger ? 'is-destructive' : undefined} onClick={() => { if (action.disabled) return; onClose(); action.run() }}>
      <action.icon size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/>
      <span>{action.label}</span>
      {action.shortcut && <kbd aria-hidden="true">{shortcutLabel(action.shortcut)}</kbd>}
    </button>)}
    </div>)}
  </div>, document.body)
}
