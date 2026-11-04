import { useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from './ui/button'
import type { PanelHole } from '@/lib/close-holes'

export function CloseHoles({ holes, assembly, initialHoleId = '', onClose }: { holes: PanelHole[]; assembly: boolean; initialHoleId?: string; onClose: (id: string) => void }) {
  const [chosen, setChosen] = useState(initialHoleId)
  if (!holes.length) return null
  const hole = holes.length === 1 ? holes[0] : holes.find(item => item.id === chosen)
  return <section className="inspector-section" aria-label="Close holes">
    <div className="section-title"><h2>{holes.length === 1 ? 'Close hole' : 'Close holes'}</h2><Square size={16}/></div>
    {holes.length > 1 && <label className="field"><span>{holes.length} openings found</span><select aria-label="Opening to close" value={hole?.id ?? ''} onChange={event => setChosen(event.target.value)}>
      <option value="" disabled>Choose an opening…</option>
      {holes.map(item => <option key={item.id} value={item.id}>{item.label} · {Math.round(item.panel.width)} × {Math.round(item.panel.height)} mm{item.panel.customOutline ? ' · Custom outline' : ''}{item.alignment ? ' · Align edges' : ''}</option>)}
    </select></label>}
    {hole && <p className="field-note">{hole.label} · {Math.round(hole.panel.width)} × {Math.round(hole.panel.height)} × {hole.panel.thickness} mm</p>}
    {hole?.panel.customOutline && <p className="field-note">Custom outline with {hole.panel.customOutline.length} edges. Reshapes with the surrounding panels.</p>}
    {hole?.alignment && <section aria-label="Align frame edges">
      <p className="field-note">The rim edges have different depths. Extend these edges to one plane before fitting the panel. Opposite edges stay fixed; existing closing panels on this face follow the adjustment.</p>
      <ul className="field-note">{hole.alignment.adjustments.map(change => <li key={change.panelId}>
        {change.panelName} · {change.dimension}: {Number(change.before.toFixed(2))} → {Number(change.after.toFixed(2))} mm (+{Number(change.distance.toFixed(2))} mm)
      </li>)}</ul>
      <p className="field-note">Alignment and filling apply together as one undoable edit.</p>
    </section>}
    <Button variant="outline" className="full-button" disabled={!hole} onClick={() => { if (hole) { onClose(hole.id); setChosen('') } }}><Square size={15}/>{hole?.alignment ? 'Align edges & close hole' : 'Close hole'}</Button>
    <p className="field-note">Fit a solid panel and connectors around the opening. {assembly ? 'Creates an independent design for this instance; other copies keep their openings. ' : ''}{!hole?.panel.customOutline && 'Shared rectangular joints are upgraded to T or cross connectors when needed.'}</p>
  </section>
}
