import { useEffect, useId, useMemo, useState, type PointerEvent } from 'react'
import { Box, Plus, RotateCw, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { NumberField, SelectField } from './fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { TROFAST_ITEMS, getTrofastColor, getTrofastItem, getTrofastProductUrl } from '@/lib/trofast-catalog'
import { findTrofastPlacement, getTrofastFace, getTrofastPanelReason, getTrofastPlacementIssue, getTrofastPositionBounds, MAX_TROFAST_INSERTS } from '@/lib/trofast'
import type { Panel, Project, TrofastInsert } from '@/lib/types'
import './trofast.css'

interface Props {
  project: Project
  panel: Panel
  onApply: (inserts: TrofastInsert[]) => boolean
  onPreview: (panelId: string, inserts: TrofastInsert[] | null) => void
}

export function TrofastInspector({ project, panel, onApply, onPreview }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const inserts = panel.trofastInserts ?? []
  const reason = getTrofastPanelReason(panel)
  const hasFootprint = TROFAST_ITEMS.some(item => getTrofastPositionBounds(panel, item) || getTrofastPositionBounds(panel, item, true))
  const availableItem = useMemo(() => reason || !hasFootprint ? undefined : TROFAST_ITEMS.find(item => findTrofastPlacement(project, panel.id, item.id)), [project, panel.id, reason, hasFootprint])
  const addReason = reason || (!hasFootprint ? 'This panel is too small. Allow the item footprint plus a 20 mm border on each side.'
    : inserts.length >= MAX_TROFAST_INSERTS ? `A panel supports up to ${MAX_TROFAST_INSERTS} inserts.` : '')
  const existing = inserts.find(insert => insert.id === editing)
  const close = () => { setEditing(null); onPreview(panel.id, null) }
  return <InspectorDisclosure title="TROFAST inserts" badge={inserts.length ? { label: String(inserts.length), description: `${inserts.length} fitted TROFAST items` } : undefined} preferenceKey="panel-trofast" summary={inserts.length ? `${inserts.length} fitted ${inserts.length === 1 ? 'item' : 'items'}` : 'Drop-in boxes & trays'}>
    <p className="field-note">Fit IKEA storage into a horizontal panel, with the rim resting on top and the box below.</p>
    {!!inserts.length && <div className="trofast-installed" aria-label="Installed TROFAST items">
      {inserts.map(insert => <div className="trofast-installed-row" key={insert.id}>
        <button type="button" className={editing === insert.id ? 'selected' : ''} aria-label={`Edit ${getTrofastItem(insert.itemId)?.name}`} onClick={() => setEditing(insert.id)}>
          <span className="trofast-color-dot" style={{ background: getTrofastColor(insert.colorId)?.hex }}/>
          <span>{getTrofastItem(insert.itemId)?.name}<small>{getTrofastColor(insert.colorId)?.name}</small></span>
        </button>
        <Button variant="ghost" size="icon" aria-label={`Remove ${getTrofastItem(insert.itemId)?.name}`} onClick={() => { if (onApply(inserts.filter(item => item.id !== insert.id))) close() }}><Trash2 size={15}/></Button>
      </div>)}
    </div>}
    {addReason && <p className="field-note" role="status">{addReason}</p>}
    {!addReason && !availableItem && <p className="field-note">No automatic placement found. Choose a position to check clearance.</p>}
    {editing && (editing === 'new' || existing) ? <TrofastForm key={`${panel.id}:${editing}:${JSON.stringify(existing)}`} project={project} panel={panel} existing={existing} onApply={onApply} onPreview={onPreview} onClose={close}/>
      : <Button variant="outline" size="sm" className="full-button" disabled={!!addReason} onClick={() => setEditing('new')}><Plus size={15}/>Add TROFAST item</Button>}
  </InspectorDisclosure>
}

function initialInsert(project: Project, panel: Panel, itemId: string, previous?: TrofastInsert): TrofastInsert {
  const item = getTrofastItem(itemId)!
  const fit = findTrofastPlacement(project, panel.id, itemId, previous?.id)
  return { ...(fit ?? { id: previous?.id ?? crypto.randomUUID(), x: panel.width / 2, y: panel.height / 2, face: getTrofastFace(panel) }),
    id: previous?.id ?? fit?.id ?? crypto.randomUUID(), itemId, colorId: previous && item.colors.includes(previous.colorId) ? previous.colorId : item.colors[0] }
}

function TrofastForm({ project, panel, existing, onApply, onPreview, onClose }: Props & { existing?: TrofastInsert; onClose: () => void }) {
  const [draft, setDraft] = useState<TrofastInsert>(() => existing ? { ...existing } : initialInsert(project, panel,
    findTrofastPlacement(project, panel.id, 'plastic-shallow') ? 'plastic-shallow' : TROFAST_ITEMS.find(item => findTrofastPlacement(project, panel.id, item.id))?.id ?? 'plastic-shallow'))
  const item = getTrofastItem(draft.itemId)!
  const color = getTrofastColor(draft.colorId)!
  const bounds = getTrofastPositionBounds(panel, item, draft.quarterTurn)
  const issue = getTrofastPlacementIssue(project, panel.id, draft)
  const hintId = useId()
  useEffect(() => {
    onPreview(panel.id, issue ? null : [...(panel.trofastInserts ?? []).filter(insert => insert.id !== draft.id), draft])
    return () => onPreview(panel.id, null)
  }, [draft, issue, panel.id, panel.trofastInserts, onPreview])
  const position = (x: number, y: number) => setDraft(value => ({ ...value,
    x: bounds ? Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(x))) : Math.round(x),
    y: bounds ? Math.max(bounds.minY, Math.min(bounds.maxY, Math.round(y))) : Math.round(y),
  }))
  const turn = () => {
    const quarterTurn = !draft.quarterTurn
    const limits = getTrofastPositionBounds(panel, item, quarterTurn)
    setDraft({ ...draft, quarterTurn,
      x: limits ? Math.max(limits.minX, Math.min(limits.maxX, draft.x)) : draft.x,
      y: limits ? Math.max(limits.minY, Math.min(limits.maxY, draft.y)) : draft.y })
  }
  const w = draft.quarterTurn ? item.depth : item.width, h = draft.quarterTurn ? item.width : item.depth
  const pointerPosition = (event: PointerEvent<HTMLButtonElement>) => {
    const svg = event.currentTarget.querySelector('svg')!
    const point = svg.createSVGPoint()
    point.x = event.clientX; point.y = event.clientY
    const matrix = svg.getScreenCTM()
    if (matrix) { const local = point.matrixTransform(matrix.inverse()); position(local.x, local.y) }
  }
  return <div className="trofast-form" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <SelectField label="TROFAST item" value={item.id} onChange={id => setDraft(initialInsert(project, panel, id, draft))}>
      {TROFAST_ITEMS.map(option => <option key={option.id} value={option.id}>{option.name} · {option.width} × {option.depth} × {option.height} mm</option>)}
    </SelectField>
    <div className="field"><span>Color · {color.name}</span><div className="trofast-swatches" role="group" aria-label="TROFAST colors">
      {item.colors.map(id => { const option = getTrofastColor(id)!; return <button type="button" key={id} aria-label={`${option.name} TROFAST color`} aria-pressed={id === draft.colorId} title={option.name} style={{ background: option.hex }} onClick={() => setDraft({ ...draft, colorId: id })}/> })}
    </div></div>
    <div className="trofast-position-heading"><span>Position on panel</span><Button variant="ghost" size="sm" onClick={turn} aria-label="Rotate TROFAST item" aria-pressed={!!draft.quarterTurn}><RotateCw size={14}/>{draft.quarterTurn ? '90°' : '0°'}</Button></div>
    <button type="button" className={`trofast-position-map ${issue ? 'is-blocked' : ''}`} aria-label="Position TROFAST on panel" aria-describedby={hintId}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointerPosition(event) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointerPosition(event) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        const step = event.shiftKey ? 1 : 10
        position(draft.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), draft.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
      }}>
      <svg viewBox={`-5 -5 ${panel.width + 10} ${panel.height + 10}`} aria-hidden="true">
        <rect className="trofast-map-panel" x="0" y="0" width={panel.width} height={panel.height} rx={panel.cornerRadius ?? 0}/>
        {(panel.trofastInserts ?? []).filter(insert => insert.id !== draft.id).map(insert => {
          const other = getTrofastItem(insert.itemId)!, width = insert.quarterTurn ? other.depth : other.width, height = insert.quarterTurn ? other.width : other.depth
          return <rect key={insert.id} className="trofast-map-other" x={insert.x - width / 2} y={insert.y - height / 2} width={width} height={height} rx="12"/>
        })}
        <path className="trofast-map-crosshair" d={`M ${draft.x} 0 V ${panel.height} M 0 ${draft.y} H ${panel.width}`}/>
        <rect className="trofast-map-item" x={draft.x - w / 2} y={draft.y - h / 2} width={w} height={h} rx="14" fill={color.hex}/>
        <rect className="trofast-map-opening" x={draft.x - w / 2 + 13} y={draft.y - h / 2 + 13} width={w - 26} height={h - 26} rx="10"/>
        {item.kind === 'tray' && <path className="trofast-map-divider" d={`M ${draft.x} ${draft.y - h / 2 + 13} V ${draft.y + h / 2 - 13} M ${draft.x - w / 2 + 13} ${draft.y} H ${draft.x + w / 2 - 13}`}/>}
      </svg>
    </button>
    <p id={hintId} className="field-note trofast-map-help">Panel face, from its top-left corner. Click or drag to place; arrow keys move 10 mm, Shift moves 1 mm.</p>
    <div className="field-row">
      <NumberField label="TROFAST center X" value={draft.x} min={bounds?.minX ?? 0} max={bounds?.maxX ?? panel.width} commitOnBlur onChange={x => position(x, draft.y)}/>
      <NumberField label="TROFAST center Y" value={draft.y} min={bounds?.minY ?? 0} max={bounds?.maxY ?? panel.height} commitOnBlur onChange={y => position(draft.x, y)}/>
    </div>
    <div className={`trofast-fit-status ${issue ? 'is-blocked' : ''}`} role="status"><Box size={15}/><span>{issue || 'Fits here · clearance below is available'}</span></div>
    <div className="trofast-form-actions"><Button size="sm" disabled={!!issue} onClick={() => {
      const next = [...(panel.trofastInserts ?? []).filter(insert => insert.id !== draft.id), draft]
      if (onApply(next)) onClose()
    }}>{existing ? 'Save TROFAST changes' : 'Add TROFAST box'}</Button><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button></div>
    <p className="field-note trofast-disclaimer">The opening and rim profile are approximate. Measure your box before cutting. Colors are visual approximations.</p>
    <a className="trofast-product-link" href={getTrofastProductUrl(item, draft.colorId)} target="_blank" rel="noreferrer">View this item at IKEA Switzerland ↗</a>
  </div>
}
