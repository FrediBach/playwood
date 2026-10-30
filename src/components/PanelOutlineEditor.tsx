import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, FlipHorizontal2, FlipVertical2, Hand, Minus, MousePointer2, Pentagon, Plus, Redo2, RotateCcw, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'
import { getOutlineError, panelCornerRadius, panelOutlineSvgPath } from '@/lib/panel-shape'
import type { OutlinePoint, Panel } from '@/lib/types'
import './panel-outline.css'

interface EditorPoint extends OutlinePoint { key: string }
const editorPoints = (points: OutlinePoint[]): EditorPoint[] => points.map(({ x, y }) => ({ x, y, key: crypto.randomUUID() }))
const rectangle = () => editorPoints([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)
const mm = (n: number) => Math.round(n * 100) / 100
interface Draft { points: EditorPoint[]; radius: number }
interface Props { panel: Panel; onChange: (patch: Partial<Panel>) => boolean | void }

export function OutlinePreview({ panel }: { panel: Panel }) {
  const pad = Math.max(panel.width, panel.height) * .06
  return <svg className="outline-preview" role="img" aria-label="Custom outline preview" viewBox={`${-pad} ${-pad} ${panel.width + pad * 2} ${panel.height + pad * 2}`}>
    <path d={panelOutlineSvgPath(panel)} fill={panel.color} stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
  </svg>
}

export function PanelOutlineControl({ panel, onChange }: Props) {
  const [open, setOpen] = useState(false)
  return <div className="panel-outline-control">
    <div className="outline-field-heading"><span>Outline</span><span>{panel.customOutline ? `${panel.customOutline.length} points` : 'Rectangle'}</span></div>
    <Dialog open={open} onOpenChange={setOpen}>
      <div className={panel.customOutline ? 'outline-custom-card' : ''}>
        <DialogTrigger asChild>
          {panel.customOutline ? <button className="outline-preview-button" aria-label="Edit custom outline"><OutlinePreview panel={panel}/><span><Pentagon size={14}/>Edit custom outline</span></button>
            : <Button variant="outline" size="sm" className="full-button"><Pentagon size={15}/>Create custom outline<Plus size={14}/></Button>}
        </DialogTrigger>
        {panel.customOutline && <button className="outline-remove" aria-label="Remove custom outline" onClick={() => onChange({ customOutline: undefined })}><RotateCcw size={13}/>Reset to rectangle</button>}
      </div>
      {open && <OutlineEditor key={panel.id} panel={panel} onChange={onChange} onClose={() => setOpen(false)}/>}
    </Dialog>
  </div>
}

/** Local input text allows decimals and intermediate empty values without moving the point. */
function CoordinateInput({ id, label, value, max, onCommit, onFocus }: { id?: string; label: string; value: number; max: number; onCommit: (value: number) => void; onFocus?: () => void }) {
  const [text, setText] = useState(String(mm(value)))
  const [lastValue, setLastValue] = useState(value)
  const edited = useRef(false)
  if (value !== lastValue) { setLastValue(value); setText(String(mm(value))) }
  const commit = () => {
    if (!edited.current) return
    edited.current = false
    const n = Number(text)
    const next = text.trim() && Number.isFinite(n) ? clamp(n, 0, max) : value
    setText(String(mm(next)))
    if (next !== value) onCommit(next)
  }
  return <input id={id} aria-label={label} type="number" min={0} max={max} step={.1} value={text}
    onFocus={onFocus} onChange={event => { edited.current = true; setText(event.target.value) }}
    onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/>
}

function OutlineEditor({ panel, onChange, onClose }: Props & { onClose: () => void }) {
  const [history, setHistory] = useState<{ past: Draft[]; draft: Draft; future: Draft[] }>(() => ({ past: [], draft: { points: panel.customOutline ? editorPoints(panel.customOutline) : rectangle(), radius: panelCornerRadius(panel) }, future: [] }))
  const latest = useRef(history)
  const updateHistory = (update: (current: typeof history) => typeof history) => {
    const next = update(latest.current)
    latest.current = next
    setHistory(next)
  }
  const { draft } = history
  const { points, radius } = draft
  const [selected, setSelected] = useState(0)
  const [mode, setMode] = useState<'select' | 'add' | 'pan'>('select')
  const [snap, setSnap] = useState(true)
  const [snapStep, setSnapStep] = useState(5)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [saveError, setSaveError] = useState('')
  const svg = useRef<SVGSVGElement>(null)
  const drawing = useRef<SVGGElement>(null)
  const drag = useRef<{ index: number; start: OutlinePoint; original: Draft; point: OutlinePoint; initialPan?: { x: number; y: number } } | null>(null)
  const gridId = useId().replace(/:/g, '')
  const scale = Math.min(600 / panel.width, 400 / panel.height)
  const left = (720 - panel.width * scale) / 2, top = (520 - panel.height * scale) / 2
  const error = getOutlineError(points)
  const preview = { ...panel, customOutline: points, cornerRadius: radius }
  const path = error ? '' : panelOutlineSvgPath(preview)
  const active = Math.min(selected, points.length - 1)
  const change = (update: Draft | ((current: Draft) => Draft)) => {
    setSaveError('')
    updateHistory(h => {
      const next = typeof update === 'function' ? update(h.draft) : update
      return same(h.draft, next) ? h : { past: [...h.past.slice(-59), h.draft], draft: next, future: [] }
    })
  }
  const undo = () => updateHistory(h => h.past.length ? { past: h.past.slice(0, -1), draft: h.past[h.past.length - 1], future: [h.draft, ...h.future] } : h)
  const redo = () => updateHistory(h => h.future.length ? { past: [...h.past, h.draft], draft: h.future[0], future: h.future.slice(1) } : h)
  const movePoint = (index: number, point: Partial<OutlinePoint>) => change(current => ({ ...current, points: current.points.map((p, i) => i === index ? { ...p, ...point } : p) }))
  const flipOutline = (axis: 'x' | 'y') => change(current => ({
    ...current,
    points: current.points.map(point => ({ ...point, [axis]: 1 - point[axis] })),
  }))
  const removePoint = () => {
    if (points.length <= 3) return
    change(current => ({ ...current, points: current.points.filter((_, i) => i !== active) }))
    setSelected(Math.max(0, active - 1))
  }
  const insert = (index: number, point: OutlinePoint) => {
    const current = latest.current.draft
    if (current.points.length >= 128) return
    const next = { ...current, points: [...current.points.slice(0, index + 1), { ...point, key: crypto.randomUUID() }, ...current.points.slice(index + 1)] }
    change(next); setSelected(index + 1)
    return next
  }
  const addMidpoint = () => {
    const a = points[active], b = points[(active + 1) % points.length]
    insert(active, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }
  const location = (event: { clientX: number; clientY: number }, untransformed = false) => {
    const matrix = (untransformed ? svg.current : drawing.current)?.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  }
  const beginDrag = (event: PointerEvent<SVGElement>, index: number, insertOnEdge = false) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    // Focusing commits any pending coordinate input before the gesture snapshots it.
    svg.current?.focus()
    const original = latest.current.draft
    let point = original.points[index]
    if (insertOnEdge) {
      if (original.points.length >= 128) return
      point = { ...edgePoint(index, event, original.points), key: crypto.randomUUID() }
      index += 1
      const next = { ...original, points: [...original.points.slice(0, index), point, ...original.points.slice(index)] }
      updateHistory(h => ({ ...h, draft: next }))
    }
    setSelected(index)
    svg.current?.setPointerCapture(event.pointerId)
    drag.current = { index, start: location(event), point, original }
  }
  const edgePoint = (index: number, event: { clientX: number; clientY: number }, vertices = points) => {
    const p = location(event), a = vertices[index], b = vertices[(index + 1) % vertices.length]
    const ax = left + a.x * panel.width * scale, ay = top + a.y * panel.height * scale
    const dx = (b.x - a.x) * panel.width * scale, dy = (b.y - a.y) * panel.height * scale
    const t = clamp(((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1), .01, .99)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current
    if (!current) return
    if (current.initialPan) {
      const at = location(event, true)
      setPan({ x: current.initialPan.x + at.x - current.start.x, y: current.initialPan.y + at.y - current.start.y })
      return
    }
    const at = location(event)
    let dx = (at.x - current.start.x) / scale, dy = (at.y - current.start.y) / scale
    if (event.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0 }
    const quantize = (n: number) => snap && !event.altKey ? Math.round(n / snapStep) * snapStep : mm(n)
    const x = clamp(dx === 0 ? current.point.x * panel.width : quantize(current.point.x * panel.width + dx), 0, panel.width) / panel.width
    const y = clamp(dy === 0 ? current.point.y * panel.height : quantize(current.point.y * panel.height + dy), 0, panel.height) / panel.height
    updateHistory(h => ({ ...h, draft: { ...h.draft, points: h.draft.points.map((p, i) => i === current.index ? { ...p, x, y } : p) } }))
  }
  const finishDrag = (cancel = false) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    if (current.initialPan) return
    updateHistory(h => cancel ? { ...h, draft: current.original } : same(current.original, h.draft) ? h : { past: [...h.past.slice(-59), current.original], draft: h.draft, future: [] })
  }
  const onKey = (event: KeyboardEvent) => {
    // The project shortcuts must never act on panels while this editor is open.
    event.stopPropagation()
    const input = (event.target as HTMLElement).matches('input,select,textarea')
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); finishDrag(true); return }
    if (drag.current) { event.preventDefault(); return }
    if (input) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removePoint(); return }
    if (event.key.startsWith('Arrow') && !(event.metaKey || event.ctrlKey || event.altKey)) {
      event.preventDefault()
      const step = event.shiftKey ? 10 : 1, point = points[active]
      movePoint(active, { x: clamp(point.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) / panel.width, 0, 1), y: clamp(point.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) / panel.height, 0, 1) })
    }
  }
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }) }
  const gridStep = Math.max(snapStep, 10 ** Math.ceil(Math.log10(14 / (scale * zoom)))) * scale
  const pointString = points.map(p => `${left + p.x * panel.width * scale},${top + p.y * panel.height * scale}`).join(' ')

  return <DialogContent className="outline-dialog" onKeyDown={onKey} onEscapeKeyDown={event => { if (drag.current) { event.preventDefault(); finishDrag(true) } }} onInteractOutside={event => event.preventDefault()}>
    <header className="outline-dialog-header"><span className="dialog-eyebrow">SHAPE YOUR PANEL</span><DialogTitle>Edit panel outline</DialogTitle><DialogDescription>Drag points or enter exact coordinates. Your outline scales with the panel.</DialogDescription><div className="outline-panel-meta"><span>{panel.name}</span><span>{panel.width} × {panel.height} mm</span></div></header>
    <div className="outline-toolbar">
      <div className="outline-tool-group" aria-label="Outline tools">
        <button aria-label="Select and move points" aria-pressed={mode === 'select'} title="Select and move points" onClick={() => setMode('select')}><MousePointer2 size={16}/><span>Select</span></button>
        <button aria-label="Add points on edges" aria-pressed={mode === 'add'} title="Click an edge to add a point, then drag it" onClick={() => setMode('add')}><Plus size={17}/><span>Add point</span></button>
        <button aria-label="Pan outline canvas" aria-pressed={mode === 'pan'} title="Drag to pan" onClick={() => setMode('pan')}><Hand size={16}/></button>
      </div>
      <div className="outline-tool-group"><button aria-label="Undo outline edit" title="Undo (⌘/Ctrl Z)" disabled={!history.past.length} onClick={undo}><Undo2 size={16}/></button><button aria-label="Redo outline edit" title="Redo (⌘/Ctrl Shift Z)" disabled={!history.future.length} onClick={redo}><Redo2 size={16}/></button></div>
      <div className="outline-tool-group" role="group" aria-label="Flip outline">
        <button aria-label="Flip outline horizontally" title="Mirror left to right across the panel center" onClick={() => flipOutline('x')}><FlipHorizontal2 size={16}/><span>Flip horizontal</span></button>
        <button aria-label="Flip outline vertically" title="Mirror top to bottom across the panel center" onClick={() => flipOutline('y')}><FlipVertical2 size={16}/><span>Flip vertical</span></button>
      </div>
      <div className="outline-snap"><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>Snap</label><select aria-label="Snap spacing" value={snapStep} onChange={e => setSnapStep(Number(e.target.value))}>{[1, 5, 10, 25, 50].map(n => <option key={n} value={n}>{n} mm</option>)}</select></div>
    </div>
    <div className="outline-editor-body">
      <div className="outline-canvas-column">
        <div className={`outline-canvas-wrap outline-mode-${mode}`}>
          <svg ref={svg} className="outline-canvas" viewBox="0 0 720 520" aria-label="Panel outline editor" role="group" tabIndex={0}
            onPointerMove={pointerMove} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag()}
            onPointerDown={event => { if (event.button === 0 && mode === 'pan') { event.preventDefault(); svg.current?.setPointerCapture(event.pointerId); drag.current = { index: -1, original: draft, point: { x: 0, y: 0 }, start: location(event, true), initialPan: pan } } }}>
            <g ref={drawing} transform={`translate(${pan.x} ${pan.y}) translate(360 260) scale(${zoom}) translate(-360 -260)`}>
              <defs><pattern id={gridId} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse" x={left} y={top}><circle cx="0" cy="0" r={.9 / zoom} fill="#b7bcad"/></pattern></defs>
              <rect x={left} y={top} width={panel.width * scale} height={panel.height * scale} fill={`url(#${gridId})`} stroke="#c4c8bb" strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`}/>
              <text x={360} y={top - 22 / zoom} textAnchor="middle" className="outline-dimension" fontSize={12 / zoom}>{panel.width} mm</text>
              <text transform={`translate(${left - 24 / zoom} 260) rotate(-90)`} textAnchor="middle" className="outline-dimension" fontSize={12 / zoom}>{panel.height} mm</text>
              <text x={left} y={top + panel.height * scale + 24 / zoom} className="outline-origin" fontSize={11 / zoom}>0, 0 at top left · X → · Y ↓</text>
              {path && <path d={path} transform={`translate(${left} ${top}) scale(${scale})`} fill={panel.color} fillOpacity=".58" stroke="#647154" strokeWidth={2 / (scale * zoom)}/>}
              <polygon points={pointString} fill={error ? '#c9472710' : 'none'} stroke={error ? '#ba482b' : '#7d806f'} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${4 / zoom}`} pointerEvents="none"/>
              {points.map((point, i) => {
                const next = points[(i + 1) % points.length]
                return <line key={`edge-${point.key}`} className="outline-edge-hit" x1={left + point.x * panel.width * scale} y1={top + point.y * panel.height * scale} x2={left + next.x * panel.width * scale} y2={top + next.y * panel.height * scale}
                  stroke="transparent" strokeWidth={20 / zoom} pointerEvents={mode === 'pan' ? 'none' : 'stroke'}
                  onPointerDown={event => { if (mode === 'add') beginDrag(event, i, true) }}
                  onDoubleClick={event => { if (mode === 'select') { event.preventDefault(); svg.current?.focus(); insert(i, edgePoint(i, event, latest.current.draft.points)) } }}/>
              })}
              {points.map((point, i) => <g key={point.key} className={`outline-node ${i === active ? 'is-selected' : ''}`} role="button" tabIndex={mode === 'pan' ? -1 : 0} aria-label={`Point ${i + 1}`} aria-pressed={i === active}
                transform={`translate(${left + point.x * panel.width * scale} ${top + point.y * panel.height * scale})`} style={{ pointerEvents: mode === 'pan' ? 'none' : 'auto' }}
                onFocus={() => setSelected(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(i) } }} onPointerDown={event => beginDrag(event, i)}>
                <circle r={16 / zoom} fill="transparent"/><circle className="outline-node-ring" r={9 / zoom} strokeWidth={1 / zoom}/><circle className="outline-node-dot" r={4 / zoom}/>
                <text x={13 / zoom} y={-13 / zoom} fontSize={11 / zoom} pointerEvents="none">{i + 1}</text>
              </g>)}
            </g>
          </svg>
          <div className="outline-zoom"><button aria-label="Zoom out outline" disabled={zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z / 1.5))}><ZoomOut size={16}/></button><button aria-label="Fit outline to view" onClick={resetView}>{Math.round(zoom * 100)}%</button><button aria-label="Zoom in outline" disabled={zoom >= 6} onClick={() => setZoom(z => Math.min(6, z * 1.5))}><ZoomIn size={16}/></button></div>
          <div className="outline-canvas-hint">{mode === 'add' ? 'Click an edge to add a point. Drag to shape it.' : mode === 'pan' ? 'Drag the canvas to pan. Click the percentage to fit.' : 'Drag a point · Double-click an edge to add'}</div>
        </div>
        <div className="outline-shortcuts"><span><kbd>Shift</kbd> lock drag axis</span><span><kbd>Alt</kbd> bypass snap</span><span><kbd>↑ ↓ ← →</kbd> 1 mm · Shift 10 mm</span></div>
      </div>
      <aside className="outline-point-panel" aria-label="Outline point coordinates">
        <div className="outline-points-heading"><h3>Points <span>{points.length}</span></h3><span>millimetres</span></div>
        <p className="outline-points-help">Coordinates from the panel’s top left.</p>
        <div className="outline-point-columns"><span>Point</span><span>X</span><span>Y</span></div>
        <div className="outline-point-list">
          {points.map((point, i) => <div key={point.key} className={`outline-point-row ${i === active ? 'is-selected' : ''}`}>
            <button aria-label={`Select point ${i + 1}`} aria-pressed={i === active} onClick={() => setSelected(i)}>{String(i + 1).padStart(2, '0')}</button>
            <CoordinateInput label={`Point ${i + 1} X`} value={point.x * panel.width} max={panel.width} onFocus={() => setSelected(i)} onCommit={x => movePoint(i, { x: x / panel.width })}/>
            <CoordinateInput label={`Point ${i + 1} Y`} value={point.y * panel.height} max={panel.height} onFocus={() => setSelected(i)} onCommit={y => movePoint(i, { y: y / panel.height })}/>
          </div>)}
        </div>
        <div className="outline-point-actions"><Button variant="outline" size="sm" aria-label="Add point after selected" disabled={points.length >= 128} onClick={addMidpoint}><Plus size={14}/>Add after {active + 1}</Button><Button variant="ghost" size="icon" aria-label="Delete selected point" title={points.length <= 3 ? 'An outline needs at least 3 points' : `Delete point ${active + 1}`} disabled={points.length <= 3} onClick={removePoint}><Trash2 size={15}/></Button></div>
        <div className="outline-rounding"><label htmlFor={`${gridId}-radius`}>Corner radius</label><div><CoordinateInput id={`${gridId}-radius`} label="Outline corner radius" value={radius} max={Math.min(panel.width, panel.height) / 2} onCommit={radius => change(current => ({ ...current, radius }))}/><span>mm</span></div><p>Applied to every corner. Tight corners use a smaller radius to fit.</p></div>
        <div className="outline-presets"><span>Quick starts</span><div><button onClick={() => { change({ ...draft, points: rectangle() }); setSelected(0) }}>Rectangle</button><button onClick={() => { change({ ...draft, points: editorPoints([{ x: .2, y: 0 }, { x: .8, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) }); setSelected(0) }}>Trapezoid</button><button onClick={() => { change({ ...draft, points: editorPoints([{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: .5 }, { x: 1, y: .5 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) }); setSelected(0) }}>L shape</button></div></div>
      </aside>
    </div>
    <footer className="outline-dialog-footer"><div className={error || saveError ? 'outline-status is-error' : 'outline-status'} role="status">{error || saveError ? <><Minus size={16}/><span>{error || saveError}</span></> : <><Check size={16}/><span>{points.length} points · Closed outline · Scales with panel</span></>}</div><div><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!!error} onClick={() => { if (onChange({ customOutline: points.map(({ x, y }) => ({ x, y })), cornerRadius: radius }) !== false) onClose(); else setSaveError('This outline could not be applied. Check the panel’s assembly constraints.') }}>Apply outline<Check size={15}/></Button></div></footer>
  </DialogContent>
}
