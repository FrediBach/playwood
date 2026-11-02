import { useId, useRef, useState, type ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { emptyFilters, filterCount, type ListFiltersState } from '@/lib/list-filters'
import './list-filters.css'

export function FilterChoices({ label, values, selected, onChange, colors = false }: { label: string; values: { value: string; label: string }[]; selected: string[]; onChange: (values: string[]) => void; colors?: boolean }) {
  const selectedValues = new Set(selected)
  return <fieldset className="filter-field"><legend>{label}</legend><div className="filter-choices">{values.map(option => <label key={option.value} className={`filter-choice ${selectedValues.has(option.value) ? 'active' : ''}`}>
    <input type="checkbox" checked={selectedValues.has(option.value)} onChange={event => onChange(event.target.checked ? [...selected, option.value] : selected.filter(value => value !== option.value))}/>
    {colors && <i style={{ background: option.value }}/>}<span>{option.label}</span>
  </label>)}</div></fieldset>
}

export function ListFilters({ kind, filters, onChange, count, total, children }: { kind: string; filters: ListFiltersState; onChange: (filters: ListFiltersState) => void; count: number; total: number; children?: ReactNode }) {
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const active = filterCount(filters)
  return <>
    <button ref={trigger} className={`list-filter-trigger ${active ? 'active' : ''}`} aria-label={`Filter ${kind}${active ? ` (${active} active)` : ''}`} aria-expanded={open} aria-controls={id} popoverTarget={id} onClick={() => {
      const bounds = trigger.current!.getBoundingClientRect()
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 328)), top: Math.min(bounds.bottom + 8, window.innerHeight - 180) })
    }}><SlidersHorizontal size={15}/>{!!active && <span>{active}</span>}</button>
    <dialog ref={ref} id={id} popover="auto" aria-label={`Filter ${kind}`} className="list-filter-popover" style={{ left: position.left, top: position.top, maxHeight: `calc(100dvh - ${position.top + 12}px)` }} onToggle={event => { const shown = event.newState === 'open'; setOpen(shown); if (shown) event.currentTarget.querySelector<HTMLInputElement>('input[type=search]')?.focus({ preventScroll: true }) }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); ref.current?.hidePopover(); trigger.current?.focus() } }}>
      <div className="filter-heading"><strong>Filter {kind}</strong><button aria-label="Close filters" onClick={() => { ref.current?.hidePopover(); trigger.current?.focus() }}><X size={16}/></button></div>
      <label className="filter-field">Search<input type="search" placeholder={kind === 'panels' ? 'Panel name…' : 'Panel name or connector type…'} value={filters.search} onChange={event => onChange({ ...filters, search: event.target.value })}/></label>
      {children}
      <div className="filter-columns"><label className="filter-field">Visibility<select value={filters.visibility} onChange={event => onChange({ ...filters, visibility: event.target.value })}><option value="">All</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label>
      <label className="filter-field">Selection<select value={filters.selection} onChange={event => onChange({ ...filters, selection: event.target.value })}><option value="">All</option><option value="selected">Selected</option><option value="unselected">Unselected</option></select></label></div>
      <div className="filter-footer"><span role="status">{count} of {total} {kind}</span><button disabled={!active} onClick={() => onChange(emptyFilters())}>Reset filters</button></div>
    </dialog>
  </>
}

export function FilterResults({ count, total, onReset }: { count: number; total: number; onReset: () => void }) {
  return <div className="filter-results"><span role="status">{count ? `${count} of ${total} shown` : 'No matches. Try fewer filters.'}</span><button onClick={onReset}>Reset</button></div>
}
