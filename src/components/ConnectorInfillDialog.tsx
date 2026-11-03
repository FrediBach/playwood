import { useState } from 'react'
import { addConnectorsBetween } from '@/lib/connector-infill'
import type { Project } from '@/lib/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export function ConnectorInfillDialog({ project, ids, onApply, onCancel }: {
  project: Project; ids: string[]; onApply: (count: number) => void; onCancel: () => void
}) {
  const [quantity, setQuantity] = useState('1')
  const count = Number(quantity)
  let error = ''
  try { addConnectorsBetween(project, ids, count) } catch (reason) { error = (reason as Error).message }
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>('[data-connector-infill]')?.focus() }}>
      <DialogTitle>Add connectors between</DialogTitle>
      <DialogDescription>Add matching connectors evenly between the two selected pieces. Existing hardware and panels stay in place.</DialogDescription>
      <label className="field"><span>Number of connectors</span><input type="number" min="1" max="18" step="1" value={quantity} onChange={event => setQuantity(event.target.value)}/></label>
      {error && <p className="validation-note warning" role="alert">{error}</p>}
      <div className="dialog-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={!!error} onClick={() => onApply(count)}>Add connectors</Button></div>
    </DialogContent>
  </Dialog>
}
