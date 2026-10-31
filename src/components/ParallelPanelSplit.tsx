import { useState } from 'react'
import { ArrowRight, Columns3, Minus, Plus } from 'lucide-react'
import { Button } from './ui/button'
import './parallel-panel-split.css'

export function ParallelPanelSplit({ counts, checking, onSplit }: { counts: number[]; checking: boolean; onSplit: (count: number) => void }) {
  const [chosen, setChosen] = useState(2)
  const count = counts.includes(chosen) ? chosen : counts[0]
  const index = count === undefined ? -1 : counts.indexOf(count)
  return <section className="inspector-section panel-split" aria-label="Split parallel panels">
    <div className="panel-split-heading"><Columns3 size={16}/><h2>Divide evenly</h2></div>
    <div className="panel-split-preview">
      {count ? <>
        <svg viewBox="0 0 248 88" role="img" aria-label={`Preview: ${count} dividers creating ${count + 1} equal sections per panel`}>
          <rect className="split-board" x="9" y="13" width="230" height="7" rx="1.5"/>
          <rect className="split-board" x="9" y="68" width="230" height="7" rx="1.5"/>
          {Array.from({ length: count }, (_, i) => <g key={i}>
            <rect className="split-divider" x={9 + (i + 1) * 230 / (count + 1) - 2} y="20" width="4" height="48" rx="1"/>
            <path className="split-joint" d={`M${9 + (i + 1) * 230 / (count + 1) - 4},17 h8 M${9 + (i + 1) * 230 / (count + 1) - 4},71 h8`}/>
          </g>)}
          {count < 6 && Array.from({ length: count + 1 }, (_, i) => <text key={i} x={9 + (i + .5) * 230 / (count + 1)} y="47" textAnchor="middle">{i + 1}</text>)}
        </svg>
        <div className="panel-split-caption"><strong>{count + 1} equal sections</strong><span>per panel</span></div>
      </> : <p className="panel-split-empty" role="status">{checking ? 'Finding space for dividers…' : 'No room for a divider'}</p>}
    </div>
    <div className="panel-split-controls">
      <label htmlFor="panel-split-count">Dividers</label>
      <div className="panel-split-stepper">
        <button type="button" aria-label="Fewer dividers" disabled={index <= 0} onClick={() => setChosen(counts[index - 1])}><Minus size={14}/></button>
        <select id="panel-split-count" aria-label="Number of splits" value={count ?? ''} disabled={!counts.length} onChange={event => setChosen(Number(event.target.value))}>
          {!counts.length && <option value="">—</option>}
          {counts.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <button type="button" aria-label="More dividers" disabled={index < 0 || index >= counts.length - 1} onClick={() => setChosen(counts[index + 1])}><Plus size={14}/></button>
      </div>
    </div>
    <Button className="full-button panel-split-apply" disabled={!count} onClick={() => { if (count) onSplit(count) }}>
      {count ? `Add ${count} ${count === 1 ? 'divider' : 'dividers'}` : 'Add dividers'}<ArrowRight size={15}/>
    </Button>
    <button type="button" className="panel-split-middle" disabled={!counts.includes(1)} onClick={() => onSplit(1)}>Split in the middle</button>
    <p className="panel-split-note" role="status">{checking ? 'Checking connector clearance…' : count ? 'T connectors included. Outer size unchanged.' : 'Check panel thickness, joints, and obstructions.'}</p>
  </section>
}
