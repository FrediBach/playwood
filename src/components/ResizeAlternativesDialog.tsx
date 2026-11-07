import { useRef, useState } from 'react'
import type { ResizeReview } from '@/lib/structure-edit'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const mm = (value: number) => Number(value.toFixed(2)).toLocaleString()

export function ResizeAlternativesDialog({ review, onConfirm, onCancel }: {
  review: ResizeReview
  onConfirm: (index: number) => void
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
      <DialogDescription>The requested resize cannot preserve every inferred alignment or fit. Choose one relationship to relax for this edit. Saved rules and physical joints remain enforced.</DialogDescription>
      <fieldset>
        <legend>Allow this relationship to change</legend>
        {review.alternatives.map((option, index) => <label className="checkbox-label" key={option.relaxed.id}>
          <input type="radio" name="resize-alternative" checked={selected === index} onChange={() => setSelected(index)}/>
          <span>{option.relaxed.description}</span>
        </label>)}
      </fieldset>
      <p className="dialog-note">Edge names refer to each panel’s local cut, before rotation. Only the selected relationship is released; other inferred relationships remain protected.</p>
      <div className="parts-table-wrap">
        <table aria-label="Resize changes">
          <thead><tr><th>Panel</th><th>Changes (mm)</th></tr></thead>
          <tbody>{alternative.changes.map(({ before, after }) => <tr key={after.id}>
            <td>{after.name}</td>
            <td>
              {(['width', 'height'] as const).filter(field => Math.abs(before[field] - after[field]) > 1e-6).map(field => <div key={field}>{field === 'width' ? 'Width' : 'Height'}: {mm(before[field])} → {mm(after[field])}</div>)}
              {(['X', 'Y', 'Z'] as const).map((axis, index) => Math.abs(before.position[index] - after.position[index]) > 1e-6
                ? <div key={axis}>Center {axis}: {mm(before.position[index])} → {mm(after.position[index])}</div> : null)}
              {JSON.stringify(before.customOutline) !== JSON.stringify(after.customOutline) && <div>Outline refitted</div>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="dialog-note">Reviewing changes nothing. Apply saves the complete resize as one undoable edit. New panel overlaps are excluded using the editor’s rectangular bounds.</p>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onConfirm(selected)}>Apply resize</Button>
      </div>
    </DialogContent>
  </Dialog>
}
