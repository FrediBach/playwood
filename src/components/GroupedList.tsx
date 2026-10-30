import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil } from 'lucide-react'
import type { ListGroup } from '@/lib/types'
import { PreviewContextMenu, type PreviewMenuAction } from './PreviewContextMenu'
import './grouped-list.css'

export interface ListGroupingProps {
  groups: ListGroup[]
  onSelectGroup: (itemIds: string[], selected: boolean) => void
  onCreateGroup: (id: string, itemIds: string[]) => void
  onRenameGroup: (id: string, name: string) => void
  onUngroup: (id: string) => void
  onMove: (ids: string[], groupId: string | null, beforeId: string | null) => void
}
interface Target { groupId: string | null; beforeId: string | null }
interface SortSession extends Target {
  id: string; ids: string[]; mode: 'pointer' | 'keyboard'; active: boolean
  startY: number; pointerY: number; offsetY: number; left: number; width: number
}
interface Props<T extends { id: string }> extends ListGroupingProps {
  items: T[]; selectedIds: string[]; kind: 'panels' | 'connectors'
  onSelect: (id: string, additive?: boolean) => void
  label: (item: T) => string
  renderItem: (item: T, handle: ButtonHTMLAttributes<HTMLButtonElement>) => ReactNode
}

function GroupName({ group, onSave, onDone }: { group: ListGroup; onSave: (name: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  useEffect(() => { ref.current?.select() }, [])
  const finish = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    const name = ref.current?.value.trim()
    if (save && name && name !== group.name) onSave(name)
    onDone()
  }
  return <input ref={ref} autoFocus defaultValue={group.name} maxLength={120} aria-label="Rename group" className="panel-inline-name"
    onBlur={() => finish(true)} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); finish(event.key === 'Enter') }
    }}/>
}

export function GroupedList<T extends { id: string }>({ items, selectedIds, groups, kind, label, renderItem, onSelect, onSelectGroup, onCreateGroup, onRenameGroup, onUngroup, onMove }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; groupId?: string } | null>(null)
  const [sort, setSort] = useState<SortSession | null>(null)
  const sortRef = useRef<SortSession | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const instructionsId = useId()
  const membership = new Map(groups.flatMap(group => group.itemIds.map(id => [id, group.id] as const)))
  const selected = items.filter(item => selectedIds.includes(item.id)).map(item => item.id)
  const sections = [
    ...groups.map(group => ({ group, items: items.filter(item => membership.get(item.id) === group.id) })),
    { group: null, items: items.filter(item => !membership.has(item.id)) },
  ]
  const updateSort = useCallback((next: SortSession | null) => { sortRef.current = next; setSort(next) }, [])
  const finishSort = (save: boolean) => {
    const current = sortRef.current
    if (!current) return
    if (save && current.active) {
      onMove(current.ids, current.groupId, current.beforeId)
      setAnnouncement(`${current.ids.length} ${kind} moved to ${groups.find(group => group.id === current.groupId)?.name ?? 'Ungrouped'}.`)
      if (current.groupId) setCollapsed(ids => ids.filter(id => id !== current.groupId))
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-list-item="${CSS.escape(current.id)}"] [data-list-handle]`)?.focus({ preventScroll: true }))
    } else if (current.active) setAnnouncement('Reorder cancelled.')
    updateSort(null)
  }
  const updatePointer = useCallback((pointerY: number) => {
    const current = sortRef.current
    if (!current || current.mode !== 'pointer') return
    const active = current.active || Math.abs(pointerY - current.startY) >= 4
    let target: Target = current
    if (active) {
      const sections = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-list-section]') ?? [])]
      const section = sections.find(section => pointerY < section.getBoundingClientRect().bottom) ?? sections.at(-1)
      if (section) {
        const rows = [...section.querySelectorAll<HTMLElement>('[data-list-item]')].filter(row => !current.ids.includes(row.dataset.listItem!))
        const before = rows.find(row => { const bounds = row.getBoundingClientRect(); return pointerY < bounds.top + bounds.height / 2 })
        target = { groupId: section.dataset.listSection || null, beforeId: before?.dataset.listItem ?? null }
      }
    }
    updateSort({ ...current, ...target, active, pointerY })
  }, [updateSort])
  useEffect(() => {
    if (!sort?.active || sort.mode !== 'pointer') return
    const scroller = listRef.current?.closest<HTMLElement>('.sidebar-scroll')
    if (!scroller) return
    let frame: number
    const scroll = () => {
      const current = sortRef.current
      if (!current) return
      const bounds = scroller.getBoundingClientRect(), y = current.pointerY
      const distance = y < bounds.top + 40 ? -Math.min(12, (bounds.top + 40 - y) / 4) : y > bounds.bottom - 40 ? Math.min(12, (y - bounds.bottom + 40) / 4) : 0
      if (distance) { scroller.scrollTop += distance; updatePointer(y) }
      frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(frame)
  }, [sort?.active, sort?.mode, updatePointer])
  const cancelSort = useEffectEvent(() => finishSort(false))
  const isSorting = sort !== null
  useEffect(() => {
    if (!isSorting) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancelSort() }
    }
    const blur = () => cancelSort()
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('blur', blur) }
  }, [isSorting])

  const createGroup = (ids: string[]) => {
    const id = crypto.randomUUID()
    onCreateGroup(id, ids)
    setEditingId(id)
  }
  const openMenu = (target: HTMLElement, x: number, y: number) => {
    const itemId = target.closest<HTMLElement>('[data-list-item]')?.dataset.listItem
    const groupId = target.closest<HTMLElement>('[data-group-header]')?.dataset.groupHeader
    const ids = itemId ? selected.includes(itemId) ? selected : [itemId] : selected
    setMenu({ x, y, ids, groupId })
  }
  const menuActions: PreviewMenuAction[] = []
  if (menu?.groupId) {
    const groupId = menu.groupId
    menuActions.push({ label: 'Rename group', run: () => setEditingId(groupId) }, { label: 'Ungroup', run: () => onUngroup(groupId) })
  } else if (menu?.ids.length) {
    menuActions.push({ label: 'Group selected', run: () => createGroup(menu.ids) })
    for (const group of groups) menuActions.push({ label: `Move to ${group.name}`, run: () => onMove(menu.ids, group.id, null) })
    if (menu.ids.some(id => membership.has(id))) menuActions.push({ label: 'Remove from group', run: () => onMove(menu.ids, null, null) })
  }
  if (!menu?.groupId) menuActions.push({ label: 'New group', run: () => createGroup([]) })
  const dragged = sort?.active ? items.find(item => item.id === sort.id) : undefined
  return <div ref={listRef} className={`grouped-list ${sort?.active ? 'is-sorting' : ''}`} onContextMenu={event => {
    if ((event.target as HTMLElement).closest('input[type=text], input:not([type])')) return
    event.preventDefault(); event.stopPropagation(); openMenu(event.target as HTMLElement, event.clientX, event.clientY)
  }} onKeyDown={event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault(); event.stopPropagation()
      const target = event.target as HTMLElement, bounds = target.getBoundingClientRect()
      openMenu(target, bounds.left, bounds.bottom)
    }
  }}>
    <div className="list-group-tools"><button onClick={() => createGroup([])}><FolderPlus size={13}/>New group</button>
      {!!selected.length && <button onClick={() => createGroup(selected)}>Group selected</button>}</div>
    <p id={instructionsId} className="visually-hidden">Drag to reorder or move between groups. Or press Space, use arrow keys to move, and press Space or Enter to finish. Escape cancels.</p>
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {sections.map(({ group, items: sectionItems }) => {
      const groupId = group?.id ?? null
      const open = !group || !collapsed.includes(group.id)
      const targeted = sort?.active && sort.groupId === groupId
      const lastOther = sectionItems.filter(item => !sort?.ids.includes(item.id)).at(-1)?.id
      const selectedCount = sectionItems.filter(item => selectedIds.includes(item.id)).length
      const allSelected = sectionItems.length > 0 && selectedCount === sectionItems.length
      const partiallySelected = selectedCount > 0 && !allSelected
      return <div key={groupId ?? 'ungrouped'} data-list-section={groupId ?? ''} className={`list-group ${group ? 'named-group' : ''} ${targeted ? 'is-drop-target' : ''}`}>
        {group ? <div className="list-group-header" data-group-header={group.id}>
          <label className="panel-selection-toggle list-group-selection" title={`${allSelected ? 'Deselect' : 'Select'} all ${kind} in ${group.name}`}>
            <input type="checkbox" aria-label={`Select all ${kind} in ${group.name}`} checked={allSelected}
              aria-checked={partiallySelected ? 'mixed' : allSelected} disabled={!sectionItems.length}
              ref={input => { if (input) input.indeterminate = partiallySelected }}
              onChange={event => onSelectGroup(sectionItems.map(item => item.id), event.target.checked)}/>
          </label>
          <button className="list-group-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} group ${group.name}`} aria-expanded={open} onClick={() => setCollapsed(ids => open ? [...ids, group.id] : ids.filter(id => id !== group.id))}>{open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
          <Folder size={14}/>
          {editingId === group.id ? <GroupName key={group.id} group={group} onSave={name => onRenameGroup(group.id, name)} onDone={() => {
            const ownedFocus = document.activeElement?.classList.contains('panel-inline-name')
            setEditingId(null)
            if (ownedFocus) requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-group-header="${CSS.escape(group.id)}"] .list-group-name`)?.focus())
          }}/> : <button className="list-group-name" title="Double-click to rename · F2" onClick={() => setCollapsed(ids => open ? [...ids, group.id] : ids.filter(id => id !== group.id))} onDoubleClick={() => { setCollapsed(ids => ids.filter(id => id !== group.id)); setEditingId(group.id) }} onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setEditingId(group.id) } }}>{group.name}</button>}
          <span className="list-group-count">{sectionItems.length}</span>
          <button className="list-group-rename" aria-label={`Rename group ${group.name}`} onClick={() => setEditingId(group.id)}><Pencil size={12}/></button>
        </div> : !!groups.length && <div className="list-ungrouped-label">Ungrouped</div>}
        {open && <div className={`${kind === 'panels' ? 'panel' : 'connector'}-list ${sort?.active ? 'is-sorting' : ''}`} role="list" aria-label={group?.name ?? (kind === 'panels' ? 'Panels' : 'Connectors')}>
          {sectionItems.map((item, index) => {
            const dragging = !!dragged && !!sort?.ids.includes(item.id)
            const begin = (mode: SortSession['mode'], bounds?: DOMRect, pointerY = 0): SortSession => {
              const ids = selected.includes(item.id) ? selected : [item.id]
              return { id: item.id, ids, groupId, beforeId: sectionItems.slice(index + 1).find(item => !ids.includes(item.id))?.id ?? null, mode, active: mode === 'keyboard', startY: pointerY, pointerY, offsetY: bounds ? pointerY - bounds.top : 0, left: bounds?.left ?? 0, width: bounds?.width ?? 0 }
            }
            const handle: ButtonHTMLAttributes<HTMLButtonElement> = {
              title: 'Drag to reorder or move between groups · Space for keyboard', 'aria-label': `Reorder ${label(item)}`, 'aria-describedby': instructionsId, 'aria-pressed': dragging,
              disabled: items.length < 2 && !groups.length,
              onBlur: () => { if (sortRef.current?.mode === 'keyboard') finishSort(false) },
              onPointerDown: event => {
                if (event.button !== 0 || !event.isPrimary || sortRef.current) return
                event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
                updateSort(begin('pointer', event.currentTarget.closest<HTMLElement>('[data-list-item]')!.getBoundingClientRect(), event.clientY))
              },
              onPointerMove: event => updatePointer(event.clientY),
              onPointerUp: event => {
                const current = sortRef.current
                if (current?.mode !== 'pointer') return
                finishSort(true)
                if (!current.active) onSelect(item.id, event.shiftKey || event.metaKey || event.ctrlKey)
              },
              onPointerCancel: () => finishSort(false),
              onLostPointerCapture: () => { if (sortRef.current?.mode === 'pointer') finishSort(false) },
              onKeyDown: event => {
                const current = sortRef.current
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault(); event.stopPropagation()
                  if (current) finishSort(true)
                  else { updateSort(begin('keyboard')); setAnnouncement(`${label(item)} picked up. Use arrow keys to move between positions and groups.`) }
                } else if (current?.mode === 'keyboard' && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault(); event.stopPropagation()
                  const targets: Target[] = sections.flatMap(section => [
                    ...(section.group && collapsed.includes(section.group.id) ? [] : section.items.filter(item => !current.ids.includes(item.id)).map(item => ({ groupId: section.group?.id ?? null, beforeId: item.id }))),
                    { groupId: section.group?.id ?? null, beforeId: null },
                  ])
                  const position = targets.findIndex(target => target.groupId === current.groupId && target.beforeId === current.beforeId)
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : Math.max(0, Math.min(targets.length - 1, position + (event.key === 'ArrowUp' ? -1 : 1)))
                  const target = targets[next]
                  updateSort({ ...current, ...target })
                  setAnnouncement(`${groups.find(group => group.id === target.groupId)?.name ?? 'Ungrouped'}, ${target.beforeId ? `before ${label(items.find(item => item.id === target.beforeId)!)}` : 'at end'}.`)
                  listRef.current?.querySelector<HTMLElement>(target.beforeId ? `[data-list-item="${CSS.escape(target.beforeId)}"]` : `[data-list-section="${CSS.escape(target.groupId ?? '')}"]`)?.scrollIntoView({ block: 'nearest' })
                } else if (current) { if (event.key === 'Tab') finishSort(false); else event.stopPropagation() }
              },
            }
            return <div key={item.id} role="listitem" data-list-item={item.id} className={`group-list-item ${dragging ? 'is-dragging' : ''} ${targeted && sort?.beforeId === item.id ? 'drop-before' : ''} ${targeted && sort?.beforeId === null && item.id === lastOther ? 'drop-after' : ''}`}>{renderItem(item, handle)}</div>
          })}
          {!!groups.length && !sectionItems.length && <div className="list-group-empty">Drag {kind} here</div>}
        </div>}
      </div>
    })}
    {menu && <PreviewContextMenu {...menu} ariaLabel="List actions" title={menu.groupId ? groups.find(group => group.id === menu.groupId)?.name ?? 'Group' : `${menu.ids.length} ${kind}`} actions={menuActions} onClose={() => setMenu(null)}/>}
    {dragged && sort?.mode === 'pointer' && createPortal(<div className="list-drag-preview" aria-hidden="true" style={{ left: sort.left, top: sort.pointerY - sort.offsetY, width: sort.width }}><Folder size={16}/><span>{sort.ids.length > 1 ? `${sort.ids.length} ${kind}` : label(dragged)}</span></div>, document.body)}
  </div>
}
