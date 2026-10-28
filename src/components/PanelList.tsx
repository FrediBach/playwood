import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, GripVertical, Pencil, TriangleAlert, Trash2 } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import type { Panel, ValidationIssue } from '@/lib/types'

interface PanelListProps {
  panels: Panel[]
  selectedIds: string[]
  issues: ValidationIssue[]
  onSelect: (id: string, additive?: boolean) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onToggleVisibility: (id: string) => void
  onReorder: (id: string, beforeId: string | null) => void
}

interface SortSession {
  id: string
  beforeId: string | null
  mode: 'pointer' | 'keyboard'
  active: boolean
  startY: number
  pointerY: number
  offsetY: number
  left: number
  width: number
}

const dimensions = (panel: Panel) => `${Math.round(panel.width).toLocaleString()} × ${Math.round(panel.height).toLocaleString()} mm`

function PanelName({ panel, onRename, onDone }: { panel: Panel; onRename: PanelListProps['onRename']; onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  useEffect(() => { inputRef.current?.select() }, [])
  const finish = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    const name = inputRef.current?.value.trim()
    if (save && name && name !== panel.name) onRename(panel.id, name)
    onDone()
  }
  return <input ref={inputRef} className="panel-inline-name" aria-label="Rename panel" defaultValue={panel.name} maxLength={120} autoFocus
    onBlur={() => finish(true)} onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault()
        finish(event.key === 'Enter')
      }
    }} />
}

export function PanelList({ panels, selectedIds, issues, onSelect, onRename, onRemove, onToggleVisibility, onReorder }: PanelListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortSession | null>(null)
  const sortRef = useRef<SortSession | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const instructionsId = useId()
  const overlaps = useMemo(() => {
    const names = new Map(panels.map(panel => [panel.id, panel.name]))
    const result = new Map<string, Set<string>>()
    for (const issue of issues.filter(issue => issue.id.startsWith('collision-'))) {
      for (const id of issue.panelIds) {
        const others = result.get(id) ?? new Set<string>()
        issue.panelIds.filter(other => other !== id).forEach(other => others.add(names.get(other) ?? 'another panel'))
        result.set(id, others)
      }
    }
    return result
  }, [panels, issues])

  const updateSort = useCallback((next: SortSession | null) => { sortRef.current = next; setSort(next) }, [])
  const finishSort = useCallback((save: boolean) => {
    const current = sortRef.current
    if (!current) return
    if (save && current.active) {
      onReorder(current.id, current.beforeId)
      const others = panels.filter(panel => panel.id !== current.id)
      const position = current.beforeId === null ? panels.length : others.findIndex(panel => panel.id === current.beforeId) + 1
      setAnnouncement(`${panels.find(panel => panel.id === current.id)?.name} moved to position ${position} of ${panels.length}.`)
    } else if (current.active) setAnnouncement('Reorder cancelled.')
    updateSort(null)
  }, [onReorder, panels, updateSort])

  const updatePointer = useCallback((pointerY: number) => {
    const current = sortRef.current
    if (!current || current.mode !== 'pointer') return
    const active = current.active || Math.abs(pointerY - current.startY) >= 4
    let beforeId = current.beforeId
    if (active) {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-panel-id]') ?? [])
      beforeId = rows.find(row => {
        if (row.dataset.panelId === current.id) return false
        const bounds = row.getBoundingClientRect()
        return pointerY < bounds.top + bounds.height / 2
      })?.dataset.panelId ?? null
    }
    updateSort({ ...current, active, pointerY, beforeId })
  }, [updateSort])

  // Scroll the existing sidebar while holding a panel near either edge.
  useEffect(() => {
    if (!sort?.active || sort.mode !== 'pointer') return
    const scroller = listRef.current?.closest<HTMLElement>('.sidebar-scroll')
    if (!scroller) return
    let frame: number
    const scroll = () => {
      const current = sortRef.current
      if (!current) return
      const bounds = scroller.getBoundingClientRect()
      const y = current.pointerY
      const distance = y < bounds.top + 40 ? -Math.min(12, (bounds.top + 40 - y) / 4)
        : y > bounds.bottom - 40 ? Math.min(12, (y - bounds.bottom + 40) / 4) : 0
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
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        cancelSort()
      }
    }
    const cancelOnBlur = () => cancelSort()
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('blur', cancelOnBlur)
    return () => {
      window.removeEventListener('keydown', cancel, true)
      window.removeEventListener('blur', cancelOnBlur)
    }
  }, [isSorting])

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const draggedPanel = sort?.active ? panels.find(panel => panel.id === sort.id) : undefined
  const lastOtherId = panels.filter(panel => panel.id !== sort?.id).at(-1)?.id
  const restoreNameFocus = (id: string) => {
    const ownedFocus = document.activeElement?.classList.contains('panel-inline-name')
    setEditingId(null)
    // Restore keyboard focus only if editing still owns it (not after clicking elsewhere).
    if (ownedFocus) {
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(id)}"] .panel-list-select`)?.focus())
    }
  }

  return <>
    <p id={instructionsId} className="visually-hidden">Drag to reorder. Or press Space, use the arrow keys to move, and press Space or Enter to finish. Escape cancels.</p>
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    <div ref={listRef} className={`panel-list ${draggedPanel ? 'is-sorting' : ''}`}>
      {panels.map((panel, index) => {
        const selected = selectedIdSet.has(panel.id)
        const overlapNames = [...(overlaps.get(panel.id) ?? [])]
        const overlapLabel = `Overlaps with ${overlapNames.join(', ')}`
        const dragging = draggedPanel?.id === panel.id
        return <div key={panel.id} data-panel-id={panel.id}
          className={`panel-list-row ${selected ? 'selected' : ''} ${!panel.visible ? 'is-hidden' : ''} ${dragging ? 'is-dragging' : ''} ${editingId === panel.id ? 'is-editing' : ''} ${draggedPanel && sort?.beforeId === panel.id ? 'drop-before' : ''} ${draggedPanel && sort?.beforeId === null && panel.id === lastOtherId ? 'drop-after' : ''}`}>
          <label className="panel-selection-toggle"><input type="checkbox" aria-label={`Select ${panel.name}`} checked={selected} onChange={() => onSelect(panel.id, true)} /></label>
            <button className="panel-drag-handle" title="Drag to reorder · Space for keyboard" aria-label={`Reorder ${panel.name}`} aria-describedby={instructionsId} aria-pressed={dragging} disabled={panels.length < 2}
              onBlur={() => { if (sortRef.current?.mode === 'keyboard') finishSort(false) }}
              onPointerDown={event => {
                if (event.button !== 0 || !event.isPrimary || sortRef.current) return
                event.currentTarget.focus()
                event.currentTarget.setPointerCapture(event.pointerId)
                const row = event.currentTarget.closest<HTMLElement>('.panel-list-row')!.getBoundingClientRect()
                updateSort({ id: panel.id, beforeId: panels[index + 1]?.id ?? null, mode: 'pointer', active: false, startY: event.clientY, pointerY: event.clientY, offsetY: event.clientY - row.top, left: row.left, width: row.width })
              }}
              onPointerMove={event => updatePointer(event.clientY)}
              onPointerUp={event => {
                if (sortRef.current?.mode !== 'pointer') return
                const wasDragging = sortRef.current.active
                finishSort(true)
                if (!wasDragging) onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey)
              }}
              onPointerCancel={() => finishSort(false)}
              onLostPointerCapture={() => { if (sortRef.current?.mode === 'pointer') finishSort(false) }}
              onKeyDown={event => {
                const current = sortRef.current
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault(); event.stopPropagation()
                  if (current) finishSort(true)
                  else {
                    updateSort({ id: panel.id, beforeId: panels[index + 1]?.id ?? null, mode: 'keyboard', active: true, startY: 0, pointerY: 0, offsetY: 0, left: 0, width: 0 })
                    setAnnouncement(`${panel.name} picked up, position ${index + 1} of ${panels.length}. Use arrow keys to move.`)
                  }
                } else if (current?.mode === 'keyboard' && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault(); event.stopPropagation()
                  const others = panels.filter(item => item.id !== panel.id)
                  const position = current.beforeId === null ? others.length : others.findIndex(item => item.id === current.beforeId)
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? others.length : Math.max(0, Math.min(others.length, position + (event.key === 'ArrowUp' ? -1 : 1)))
                  updateSort({ ...current, beforeId: others[next]?.id ?? null })
                  setAnnouncement(`${panel.name}, position ${next + 1} of ${panels.length}.`)
                  listRef.current?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(others[Math.min(next, others.length - 1)].id)}"]`)?.scrollIntoView({ block: 'nearest' })
                } else if (current) {
                  if (event.key === 'Tab') finishSort(false)
                  else event.stopPropagation()
                }
              }}>
              <span className={`panel-thumbnail ${panel.pattern}`} style={{ '--panel-color': panel.color } as React.CSSProperties} />
              <span className="panel-grip"><GripVertical size={17} /></span>
            </button>
          <div className="panel-list-copy">
            <div className="panel-name-line">
              {editingId === panel.id
                ? <PanelName key={panel.id} panel={panel} onRename={onRename} onDone={() => restoreNameFocus(panel.id)} />
                : <button className="panel-list-select" aria-pressed={selected} title={`${panel.name} · Double-click to rename`}
                  onClick={event => onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey)} onDoubleClick={() => setEditingId(panel.id)}
                  onKeyDown={event => { if (event.key === 'F2') { event.preventDefault(); setEditingId(panel.id) } }}>
                  <span className="panel-list-name">{panel.name}</span>
                </button>}
              {!!overlapNames.length && <Tooltip label={overlapLabel}><button className="panel-overlap-indicator" aria-label={overlapLabel} onClick={() => onSelect(panel.id)}><TriangleAlert size={13} /></button></Tooltip>}
            </div>
            <div className="panel-row-details">
              <button className="panel-dimensions" title={dimensions(panel)} onClick={event => onSelect(panel.id, event.shiftKey || event.metaKey || event.ctrlKey)}>{dimensions(panel)}</button>
              <div className="panel-row-actions">
                <Tooltip label="Rename panel · F2"><button className="panel-row-action reveal-action" aria-label={`Rename ${panel.name}`} onClick={() => setEditingId(panel.id)}><Pencil size={12} /></button></Tooltip>
                <Tooltip label={panel.visible ? 'Hide panel' : 'Show panel'}><button className="panel-row-action visibility-button" aria-label={`${panel.visible ? 'Hide' : 'Show'} ${panel.name}`} onClick={() => onToggleVisibility(panel.id)}>{panel.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button></Tooltip>
                <Tooltip label="Remove panel · Undo to restore"><button className="panel-row-action panel-remove-action reveal-action" aria-label={`Remove ${panel.name}`} onClick={() => onRemove(panel.id)}><Trash2 size={12} /></button></Tooltip>
              </div>
            </div>
          </div>
        </div>
      })}
    </div>
    {draggedPanel && sort?.mode === 'pointer' && createPortal(<div className="panel-drag-preview" aria-hidden="true" style={{ left: sort.left, top: sort.pointerY - sort.offsetY, width: sort.width }}>
      <GripVertical size={15} /><span className={`panel-thumbnail ${draggedPanel.pattern}`} style={{ '--panel-color': draggedPanel.color } as React.CSSProperties} /><div><strong>{draggedPanel.name}</strong><small>{dimensions(draggedPanel)}</small></div>
    </div>, document.body)}
  </>
}
