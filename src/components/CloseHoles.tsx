import { useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from './ui/button'
import type { PanelHole } from '@/lib/close-holes'

export function CloseHoles({ holes, assembly, onClose }: { holes: PanelHole[]; assembly: boolean; onClose: (id: string) => void }) {
  const [chosen, setChosen] = useState('')
  if (!holes.length) return null
  const hole = holes.length === 1 ? holes[0] : holes.find(item => item.id === chosen)
  return <section className="inspector-section" aria-label="Close holes">
    <div className="section-title"><h2>{holes.length === 1 ? 'Close hole' : 'Close holes'}</h2><Square size={16}/></div>
    {holes.length > 1 && <label className="field"><span>{holes.length} openings found</span><select aria-label="Opening to close" value={hole?.id ?? ''} onChange={event => setChosen(event.target.value)}>
      <option value="" disabled>Choose an opening…</option>
      {holes.map(item => <option key={item.id} value={item.id}>{item.label} · {Math.round(item.panel.width)} × {Math.round(item.panel.height)} mm</option>)}
    </select></label>}
    {hole && <p className="field-note">{hole.label} · {Math.round(hole.panel.width)} × {Math.round(hole.panel.height)} × {hole.panel.thickness} mm</p>}
    <Button variant="outline" className="full-button" disabled={!hole} onClick={() => { if (hole) { onClose(hole.id); setChosen('') } }}><Square size={15}/>Close hole</Button>
    <p className="field-note">Fit a solid panel and connectors on all four edges. {assembly ? 'Creates an independent design for this instance; other copies keep their openings. ' : ''}Shared joints are upgraded to T or cross connectors when needed.</p>
  </section>
}
