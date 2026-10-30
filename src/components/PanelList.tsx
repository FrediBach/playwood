import { useEffect, useMemo, useRef, useState } from 'react'
import { GroupedList, type ListGroupingProps } from './GroupedList'
import { Eye, EyeOff, GripVertical, Pencil, TriangleAlert, Trash2 } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import type { Panel, ValidationIssue } from '@/lib/types'

interface PanelListProps extends ListGroupingProps {
  panels: Panel[]
  selectedIds: string[]
  issues: ValidationIssue[]
  onSelect: (id: string, additive?: boolean) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  onToggleVisibility: (id: string) => void
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

export function PanelList({ panels, selectedIds, issues, onSelect, onRename, onRemove, onToggleVisibility, ...grouping }: PanelListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
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

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const restoreNameFocus = (id: string) => {
    const ownedFocus = document.activeElement?.classList.contains('panel-inline-name')
    setEditingId(null)
    // Restore keyboard focus only if editing still owns it (not after clicking elsewhere).
    if (ownedFocus) {
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(id)}"] .panel-list-select`)?.focus())
    }
  }

  return <div ref={listRef}>
    <GroupedList {...grouping} onSelect={onSelect} items={panels} selectedIds={selectedIds} kind="panels" label={panel => panel.name} renderItem={(panel, handle) => {
        const selected = selectedIdSet.has(panel.id)
        const overlapNames = [...(overlaps.get(panel.id) ?? [])]
        const overlapLabel = `Overlaps with ${overlapNames.join(', ')}`
        return <div key={panel.id} data-panel-id={panel.id}
          className={`panel-list-row ${selected ? 'selected' : ''} ${!panel.visible ? 'is-hidden' : ''} ${editingId === panel.id ? 'is-editing' : ''}`}>
          <label className="panel-selection-toggle"><input type="checkbox" aria-label={`Select ${panel.name}`} checked={selected} onChange={() => onSelect(panel.id, true)} /></label>
            <button className="panel-drag-handle" data-list-handle {...handle}>
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
      }}/>
  </div>
}
