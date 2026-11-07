import { useRef, useState } from 'react'
import type { MovementReview } from '@/lib/structure-edit'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { PanelChangeTable } from './PanelChangeTable'

const mm = (value: number) => Number(value.toFixed(2)).toLocaleString()

export function MovementAlternativesDialog({ review, onConfirm, onCancel }: {
  review: MovementReview
  onConfirm: (index: number) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState(0)
  const opener = useRef<HTMLElement | null>(null)
  const alternative = review.alternatives[selected]
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent onOpenAutoFocus={() => {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement : document.querySelector('canvas')
    }} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}>
      <DialogTitle>Review wider movement</DialogTitle>
      <DialogDescription>The adjacent spans cannot absorb this move. Review a wider change before applying it. Joints, saved rules, stock limits, and insert support remain enforced.</DialogDescription>
      <p className="field-note">Requested movement: {mm(Math.hypot(...review.delta))} mm perpendicular to the selected panel.</p>
      <fieldset>
        <legend>Choose the affected construction</legend>
        {review.alternatives.map((option, index) => <label className="checkbox-label" key={option.label}>
          <input type="radio" name="movement-alternative" checked={selected === index} onChange={() => setSelected(index)}/>
          <span>{option.label}</span>
        </label>)}
      </fieldset>
      <p className="dialog-note">Outside size along the move: {mm(alternative.outsideSize.before)} → {mm(alternative.outsideSize.after)} mm. The opposite outside face stays fixed.</p>
      <PanelChangeTable changes={alternative.changes} label="Movement changes"/>
      <p className="dialog-note">Review these panel changes before applying the complete move in one undo step. New panel overlaps are excluded using rectangular bounds. Cancel keeps the construction unchanged.</p>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(selected)}>Apply movement</Button>
      </div>
    </DialogContent>
  </Dialog>
}
