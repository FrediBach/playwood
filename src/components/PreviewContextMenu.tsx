import { createPreviewShortcutHandler, flattenPreviewMenuActions, shortcutAria, shortcutLabel } from '@/lib/preview-shortcuts'
import { useState, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import './preview-context-menu.css'

export interface PreviewMenuAction {
  /** Stable identity for actions whose labels can repeat or change. */
  id?: string
  shortcut?: string
  label: string
  group?: string
  icon: LucideIcon
  run: () => void
  danger?: boolean
  disabled?: boolean
  /** Opens a nested menu instead of running; nested items may keep their own shortcuts. */
  submenu?: PreviewMenuAction[]
  /** Present on one-of-several choices; renders a radio item with its state. */
  checked?: boolean
}

function groupActions(actions: readonly PreviewMenuAction[]) {
  return actions.reduce<{ label?: string; actions: PreviewMenuAction[] }[]>((result, action) => {
    const previous = result.at(-1)
    if (previous && previous.label === action.group) previous.actions.push(action)
    else result.push({ label: action.group, actions: [action] })
    return result
  }, [])
}

function MenuGroups({ actions, item }: { actions: readonly PreviewMenuAction[]; item: (action: PreviewMenuAction) => React.ReactNode }) {
  return groupActions(actions).map(group => <div key={group.label ?? 'ungrouped'} role="group" aria-label={group.label} className={group.label ? 'preview-context-group' : undefined}>
    {group.label && <div className="preview-context-group-title" aria-hidden="true">{group.label}</div>}
    {group.actions.map(item)}
  </div>)
}

function MenuItem({ action, onRun, expanded, onOpen, onHover }: {
  action: PreviewMenuAction; onRun: () => void; expanded?: boolean; onOpen?: () => void; onHover?: () => void
}) {
  const submenu = !!action.submenu
  const choice = action.checked !== undefined
  return <button role={choice ? 'menuitemradio' : 'menuitem'} aria-checked={choice ? action.checked : undefined} aria-label={action.label} aria-haspopup={submenu ? 'menu' : undefined} aria-expanded={submenu ? !!expanded : undefined}
    aria-keyshortcuts={action.shortcut ? shortcutAria(action.shortcut) : undefined} aria-disabled={action.disabled || undefined}
    className={[action.danger && 'is-destructive', expanded && 'is-expanded'].filter(Boolean).join(' ') || undefined}
    data-submenu={submenu ? action.id ?? action.label : undefined} onPointerEnter={onHover}
    onClick={() => { if (action.disabled) return; if (submenu) onOpen?.(); else onRun() }}>
    <action.icon size={16} strokeWidth={1.75} aria-hidden="true" focusable="false"/>
    <span>{action.label}</span>
    {action.shortcut && <kbd aria-hidden="true">{shortcutLabel(action.shortcut)}</kbd>}
    {action.checked && <Check className="preview-context-chevron" size={14} strokeWidth={2} aria-hidden="true" focusable="false"/>}
    {submenu && <ChevronRight className="preview-context-chevron" size={14} strokeWidth={1.75} aria-hidden="true" focusable="false"/>}
  </button>
}

const focusableItems = (root: HTMLElement | null) => root ? [...root.querySelectorAll<HTMLButtonElement>(':scope button[role="menuitem"], :scope button[role="menuitemradio"]')] : []

function moveFocus(event: React.KeyboardEvent, buttons: HTMLButtonElement[]) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return false
  event.preventDefault()
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  return true
}

export function PreviewContextMenu({ x, y, title, actions, onClose, ariaLabel = 'Preview actions' }: {
  x: number; y: number; title: string; actions: PreviewMenuAction[]; onClose: () => void; ariaLabel?: string
}) {
  const [shortcutHandler] = useState(createPreviewShortcutHandler)
  const ref = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  /** Keyboard and click opening move focus into the submenu once; hover does not. */
  const focusSubmenu = useRef(false)
  const openAction = openId ? actions.find(action => (action.id ?? action.label) === openId && action.submenu && !action.disabled) : undefined
  const openSubmenu = (id: string | null, focus: boolean) => { focusSubmenu.current = focus && id !== null; setOpenId(id) }
  const close = useEffectEvent(() => onClose())
  const inSubmenu = useEffectEvent((node: Node | null) => !!node && !!subRef.current?.contains(node))
  useLayoutEffect(() => {
    const menu = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector('button')?.focus()
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menu.contains(target) && !inSubmenu(target)) close()
    }
    const dismissWindow = () => close()
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('resize', dismissWindow)
    window.addEventListener('blur', dismissWindow)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('resize', dismissWindow)
      window.removeEventListener('blur', dismissWindow)
      const active = document.activeElement
      if (menu.contains(active) || inSubmenu(active) || active === document.body) previous?.focus({ preventScroll: true })
    }
  }, [x, y])
  const trigger = () => ref.current?.querySelector<HTMLButtonElement>(`button[aria-expanded="true"]`)
  const hasSubmenu = !!openAction
  useLayoutEffect(() => {
    const submenu = subRef.current, anchor = ref.current?.querySelector<HTMLButtonElement>(`button[aria-expanded="true"]`)
    if (!hasSubmenu || !submenu || !anchor) return
    const item = anchor.getBoundingClientRect(), menu = ref.current!.getBoundingClientRect(), bounds = submenu.getBoundingClientRect()
    // Prefer a flyout beside the menu; on narrow screens overlap it below the trigger.
    const right = menu.right - 4, left = menu.left - bounds.width + 4
    const fitsRight = right + bounds.width <= window.innerWidth - 8, fitsLeft = left >= 8
    const besides = fitsRight || fitsLeft
    submenu.style.left = `${fitsRight ? right : fitsLeft ? left : Math.max(8, Math.min(item.left + 16, window.innerWidth - bounds.width - 8))}px`
    submenu.style.top = `${Math.max(8, Math.min(besides ? item.top - 7 : item.bottom, window.innerHeight - bounds.height - 8))}px`
    if (focusSubmenu.current) { focusSubmenu.current = false; submenu.querySelector<HTMLButtonElement>('button')?.focus() }
  }, [hasSubmenu, openId, x, y])
  const closeSubmenu = (focusTrigger: boolean) => {
    const anchor = trigger()
    openSubmenu(null, false)
    if (focusTrigger) anchor?.focus()
  }
  const run = (action: PreviewMenuAction) => { onClose(); action.run() }
  return createPortal(<>
    <div ref={ref} className="preview-context-menu" role="menu" aria-label={ariaLabel} style={{ left: x, top: y }}
      onContextMenu={event => event.preventDefault()} onKeyDown={event => {
        event.stopPropagation()
        if (shortcutHandler(event.nativeEvent, flattenPreviewMenuActions(actions), onClose)) return
        const focused = document.activeElement as HTMLButtonElement | null
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return }
        if (focused?.dataset.submenu && ['ArrowRight', 'Enter', ' '].includes(event.key)) {
          event.preventDefault()
          openSubmenu(focused.dataset.submenu, true)
          return
        }
        if (moveFocus(event, focusableItems(ref.current))) openSubmenu(null, false)
      }}>
      <div className="preview-context-title">{title}</div>
      <MenuGroups actions={actions} item={action => {
        const id = action.id ?? action.label
        return <MenuItem key={id} action={action} onRun={() => run(action)} expanded={openAction === action}
          onOpen={() => openSubmenu(openId === id ? null : id, true)}
          onHover={() => { if (action.submenu && !action.disabled) { if (openId !== id) openSubmenu(id, false) } else if (openId) openSubmenu(null, false) }}/>
      }}/>
    </div>
    {openAction && <div ref={subRef} className="preview-context-menu preview-context-submenu" role="menu" aria-label={openAction.label}
      onContextMenu={event => event.preventDefault()} onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape' || event.key === 'ArrowLeft') { event.preventDefault(); closeSubmenu(true); return }
        if (event.key === 'Tab') { event.preventDefault(); onClose(); return }
        if (shortcutHandler(event.nativeEvent, flattenPreviewMenuActions(actions), onClose)) return
        moveFocus(event, focusableItems(subRef.current))
      }}>
      <MenuGroups actions={openAction.submenu!} item={action => <MenuItem key={action.id ?? action.label} action={action} onRun={() => run(action)}/>}/>
    </div>}
  </>, document.body)
}
