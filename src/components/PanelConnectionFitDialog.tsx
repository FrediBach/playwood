import { useRef } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export interface PanelConnectionAdjustment {
  panelName: string
  targetPanelName: string
  dimension: 'width' | 'height'
  before: number
  after: number
}

const millimeters = (value: number) => Number(value.toFixed(2)).toLocaleString()

export function PanelConnectionFitDialog({ adjustment, operations, onConfirm, onCancel }: {
  adjustment?: PanelConnectionAdjustment
  operations?: { connectors: number; joints: number; upgrades: number; splits: number; disassembledNames: string[] }
  onConfirm: () => void
  onCancel: () => void
}) {
  const opener = useRef<HTMLElement | null>(null)
  return <Dialog open={!!adjustment} onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}>
      <DialogTitle>Resize panel to connect?</DialogTitle>
      <DialogDescription>{adjustment && <>“{adjustment.panelName}” is close to fitting “{adjustment.targetPanelName}”. Adjust its {adjustment.dimension} to make room for the connector.</>}</DialogDescription>
      {adjustment && <div className="panel-fit-measurement">
        <span>{adjustment.dimension === 'height' ? 'Height' : 'Width'}</span>
        <strong>{millimeters(adjustment.before)} → {millimeters(adjustment.after)} mm</strong>
        <small>{adjustment.after > adjustment.before ? 'Extend' : 'Shorten'} by {millimeters(Math.abs(adjustment.after - adjustment.before))} mm</small>
      </div>}
      <p className="dialog-note">The size adjustment keeps the opposite edge fixed. {operations && <>Auto-connect will fit {operations.connectors} connectors at {operations.joints} {operations.joints === 1 ? 'joint' : 'joints'}. </>}
        {operations?.upgrades ? <>This includes {operations.upgrades} existing {operations.upgrades === 1 ? 'joint upgrade' : 'joint upgrades'}. </> : null}
        {operations?.splits ? <>This includes {operations.splits} panel {operations.splits === 1 ? 'split' : 'splits'} for T joints, keeping outer dimensions. </> : null}
        {!operations?.splits && !operations?.upgrades && <>Other panels and existing connectors stay in place. </>}
        Resizing and connecting apply together and can be undone in one step.</p>
      {!!operations?.disassembledNames.length && <p className="dialog-note">These assembly instances will become independent: {operations.disassembledNames.join(', ')}.</p>}
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm}>Resize and connect</Button>
      </div>
    </DialogContent>
  </Dialog>
}
