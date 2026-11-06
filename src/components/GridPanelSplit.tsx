import { useEffect, useState } from 'react'
import { ArrowRight, Grid2X2, Minus, Plus } from 'lucide-react'
import { Button } from './ui/button'
import type { gridPanelCut, splitPanelGrid } from '@/lib/grid-split'
import type { Project } from '@/lib/types'
import './parallel-panel-split.css'

type Result = ReturnType<typeof splitPanelGrid>
type Frame = NonNullable<ReturnType<typeof gridPanelCut>>
type Preview = { result?: Result; error?: string }

function dividerCount(text: string, maximum: number): number | null {
  const value = text === '' ? NaN : Number(text)
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : null
}

export function GridPanelSplit({ project, ids, frame, onSplit }: {
  project: Project; ids: string[]; frame: Frame; onSplit: (result: Result, x: number, y: number) => void
}) {
  const [x, setX] = useState(String(Math.min(1, frame.maxX))), [y, setY] = useState(String(Math.min(1, frame.maxY)))
  const nx = dividerCount(x, frame.maxX), ny = dividerCount(y, frame.maxY)
  const valid = nx !== null && ny !== null && nx + ny > 0
  const [preview, setPreview] = useState<{ project: Project; ids: string[]; x: string; y: string; value: Preview }>()
  const current = preview?.project === project && preview.ids === ids && preview.x === x && preview.y === y ? preview.value : undefined
  useEffect(() => {
    if (!valid) return
    let worker: Worker | undefined
    const timer = window.setTimeout(() => {
      worker = new Worker(new URL('../lib/grid-split.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<Preview>) => setPreview({ project, ids, x, y, value: event.data })
      worker.onerror = () => setPreview({ project, ids, x, y, value: { error: 'Could not check this grid. Change the divisions to try again.' } })
      worker.postMessage({ project, ids, x: nx, y: ny })
    }, 120)
    return () => { window.clearTimeout(timer); worker?.terminate() }
  }, [project, ids, x, y, nx, ny, valid])
  const shownX = nx ?? 0
  const shownY = ny ?? 0
  const error = !valid ? `Use whole numbers from 0–${frame.maxX} on X and 0–${frame.maxY} on Y, with at least one divider.` : current?.error
  return <section className="inspector-section panel-split" aria-label="Split opening into a grid">
    <div className="panel-split-heading"><Grid2X2 size={16}/><h2>Divide into a grid</h2></div>
    <div className="panel-split-preview">
      <svg viewBox="0 0 248 140" role="img" aria-label={`Grid preview: ${shownX + 1} columns and ${shownY + 1} rows`}>
        <rect className="split-board" x="16" y="12" width="216" height="7" rx="1.5"/>
        <rect className="split-board" x="16" y="113" width="216" height="7" rx="1.5"/>
        <rect className="split-board" x="12" y="19" width="7" height="94" rx="1.5"/>
        <rect className="split-board" x="229" y="19" width="7" height="94" rx="1.5"/>
        {Array.from({ length: shownX }, (_, i) => <rect key={`x:${i}`} className="split-divider" x={19 + (i + 1) * 210 / (shownX + 1) - 2} y="19" width="4" height="94" rx="1"/>)}
        {Array.from({ length: shownY }, (_, i) => <rect key={`y:${i}`} className="split-divider" x="19" y={19 + (i + 1) * 94 / (shownY + 1) - 2} width="210" height="4" rx="1"/>)}
        <text x="124" y="133" textAnchor="middle">X →</text><text x="4" y="69" textAnchor="middle">Y</text>
      </svg>
      <div className="panel-split-caption"><strong>{shownX + 1} × {shownY + 1} compartments</strong><span>equal spacing</span></div>
    </div>
    <GridDividerField axis="X" value={x} maximum={frame.maxX} onChange={setX}/>
    <GridDividerField axis="Y" value={y} maximum={frame.maxY} onChange={setY}/>
    <Button className="full-button panel-split-apply" disabled={!valid || !current?.result} onClick={() => { if (valid && current?.result) onSplit(current.result, nx, ny) }}>
      Create {shownX + 1} × {shownY + 1} grid<ArrowRight size={15}/>
    </Button>
    <p id="grid-split-status" className={`panel-split-note${error ? ' grid-split-error' : ''}`} role="status">{error ?? (!current ? 'Checking connector clearance…' : 'T and cross connectors included. Outer size unchanged.')}</p>
  </section>
}

function GridDividerField({ axis, value, maximum, onChange }: { axis: 'X' | 'Y'; value: string; maximum: number; onChange: (value: string) => void }) {
  const numeric = value === '' ? NaN : Number(value)
  const integer = Number.isInteger(numeric)
  return <div className="panel-split-controls">
    <label htmlFor={`grid-split-${axis}`}>{axis} dividers <span className="grid-split-axis">{axis === 'X' ? 'Columns' : 'Rows'}</span></label>
    <div className="panel-split-stepper">
      <button type="button" aria-label={`Fewer ${axis} dividers`} disabled={!integer || numeric <= 0} onClick={() => onChange(String(numeric - 1))}><Minus size={14}/></button>
      <input id={`grid-split-${axis}`} aria-label={`${axis} dividers`} type="number" min="0" max={maximum} step="1" value={value} onChange={event => onChange(event.target.value)} aria-invalid={!integer || numeric < 0 || numeric > maximum} aria-describedby="grid-split-status"/>
      <button type="button" aria-label={`More ${axis} dividers`} disabled={!integer || numeric >= maximum} onClick={() => onChange(String(numeric + 1))}><Plus size={14}/></button>
    </div>
  </div>
}
