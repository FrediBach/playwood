import { useRef, useState } from 'react'
import type { ResizeReview } from '@/lib/structure-edit'
import { PanelChangeTable } from './PanelChangeTable'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export function ResizeAlternativesDialog({ review, onConfirm, onCancel, onPreview }: {
  review: ResizeReview
  onConfirm: (index: number) => void
  onPreview?: (index: number) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState(0)
  const opener = useRef<HTMLElement | null>(null)
  const alternative = review.alternatives[selected]
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent
      onOpenAutoFocus={() => {
        // Numeric fields commit by blurring, so activeElement can already be body.
        const label = review.requestedDimensions.width !== undefined ? 'Width' : 'Height'
        opener.current = document.querySelector<HTMLInputElement>(`.inspector-scroll input[aria-label="${label}"]`)
          ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } } }>
      <DialogTitle>Review resize alternatives</DialogTitle>
      <DialogDescription>{review.intent ? 'This resize has several valid outcomes. Choose the sizes or alignments to preserve. Saved rules and physical joints remain enforced.' : 'The requested resize cannot preserve every inferred alignment or fit. Choose one relationship to relax for this edit. Saved rules and physical joints remain enforced.'}</DialogDescription>
      <fieldset>
        <legend>{review.intent ? 'Preserve for this resize' : 'Allow this relationship to change'}</legend>
        {review.alternatives.map((option, index) => <label className="checkbox-label" key={option.relaxed.id}>
          <input type="radio" name="resize-alternative" checked={selected === index} onChange={() => { setSelected(index); onPreview?.(index) }}/>
          <span>{option.relaxed.description}</span>
        </label>)}
      </fieldset>
      <p className="dialog-note">{review.intent ? alternative.explanation : 'Edge names refer to each panel’s local cut, before rotation. Only the selected relationship is released; other inferred relationships remain protected.'}</p>
      {review.intent&&<p className="dialog-note">End names refer to panel-local cuts before rotation. Highlighted panels are the parts affected by this option.</p>}
      {alternative.outsideSize&&<p className="dialog-note">Outside size (X × Y × Z): {alternative.outsideSize.before.map(n=>Number(n.toFixed(2))).join(' × ')} → {alternative.outsideSize.after.map(n=>Number(n.toFixed(2))).join(' × ')} mm.</p>}
      {review.incomplete&&<p className="dialog-note">The search reached its limit. These options are valid, but other outcomes may be possible.</p>}
      <PanelChangeTable changes={alternative.changes} label="Resize changes"/>
      <p className="dialog-note">Reviewing changes nothing. Apply saves the complete resize as one undoable edit. New panel overlaps are excluded using the editor’s rectangular bounds.</p>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(selected)}>Apply resize</Button>
      </div>
    </DialogContent>
  </Dialog>
}
