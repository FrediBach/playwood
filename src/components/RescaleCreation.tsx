import { useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Scaling } from 'lucide-react'
import { getRescaleValues } from '@/lib/project-rescale'
import type { Project } from '@/lib/types'
import { Button } from './ui/button'
import { DialogDescription, DialogTitle } from './ui/dialog'
import './rescale-creation.css'

const format = (value: number) => Number(value.toFixed(4)).toLocaleString('en', { maximumFractionDigits: 4 })

export function RescaleCreation({ project, onRescale, onCancel }: {
  project: Project
  onRescale: (changes: Record<string, number>) => void
  onCancel: () => void
}) {
  const values = useMemo(() => getRescaleValues(project), [project])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const changes: Record<string, number> = {}
  const invalid = new Set<string>()
  for (const value of values) {
    const text = draft[value.id]
    if (text === undefined) continue
    const next = Number(text)
    if (!text.trim() || !Number.isFinite(next) || next < value.min || next > value.max) invalid.add(value.id)
    else if (Math.abs(next - value.value) > 1e-6) changes[value.id] = next
  }
  const changedCount = Object.keys(changes).length
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!changedCount || invalid.size) return
    try { onRescale(changes) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'These values cannot keep the structure connected. Try a smaller change.') }
  }
  return <form onSubmit={submit} noValidate className="rescale-form">
    <DialogTitle>Rescale creation</DialogTitle>
    <DialogDescription>Change a repeated measurement to update every matching use across the project.</DialogDescription>
    {values.length ? <>
      <div className="rescale-column-labels" aria-hidden="true"><span>Current measurement</span><span>New value · mm</span></div>
      <div className="rescale-values" aria-label="Repeated measurements">
        {values.map(value => {
          const id = `rescale-${value.id}`
          const changed = changes[value.id] !== undefined
          return <div className={`rescale-row${changed ? ' is-changed' : ''}`} key={value.id}>
            <label htmlFor={id}><strong>{format(value.value)} <span>mm</span></strong><span>{value.label} · {value.count} uses</span></label>
            <ArrowRight size={14} aria-hidden="true"/>
            <div className="rescale-input">
              <input id={id} type="number" inputMode="decimal" aria-label={`${value.label} · ${value.value} mm`}
                aria-describedby={`${id}-range`} aria-invalid={invalid.has(value.id)}
                min={value.min} max={value.max} step={value.step} value={draft[value.id] ?? String(value.value)}
                onChange={event => { setDraft(current => ({ ...current, [value.id]: event.target.value })); setError('') }}/>
              <span id={`${id}-range`}>{format(value.min)}–{format(value.max)} mm</span>
            </div>
          </div>
        })}
      </div>
      <p className="rescale-note">Connected panels and fitted inserts adapt together. Connector sizes stay fixed. Apply all changes in one undoable step.</p>
      {invalid.size > 0 && <p role="alert" className="error-message">Enter a value within the range shown for each measurement.</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
    </> : <p className="rescale-empty">No repeated measurements yet. Measurements used at least twice will appear here.</p>}
    <div className="dialog-footer rescale-footer">
      {values.length > 0 && <Button type="button" variant="ghost" className="rescale-reset" disabled={!Object.keys(draft).length} onClick={() => { setDraft({}); setError('') }}>Reset values</Button>}
      <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={!changedCount || invalid.size > 0}><Scaling size={16}/>Apply rescale</Button>
    </div>
  </form>
}
