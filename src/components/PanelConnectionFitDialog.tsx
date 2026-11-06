import { useRef } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export interface PanelConnectionAdjustment {
  panelId: string
  panelName: string
  targetPanelName: string
  dimension: 'width' | 'height'
  before: number
  after: number
}

interface ConnectionOperations { connectors: number; joints: number; upgrades: number; splits: number; disassembledNames: string[] }

const millimeters = (value: number) => Number(value.toFixed(2)).toLocaleString()

export function PanelConnectionFitDialog({ adjustment, adjustments, operations, onConfirm, onCancel }: {
  adjustments?: PanelConnectionAdjustment[]
  adjustment?: PanelConnectionAdjustment
  operations?: ConnectionOperations
  onConfirm: () => void
  onCancel: () => void
}) {
  const changes = adjustments ?? (adjustment ? [adjustment] : [])
  const coordinated = changes.length > 1
  const opener = useRef<HTMLElement | null>(null)
  return <Dialog open={!!adjustment} onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}>
      <DialogTitle>{coordinated ? 'Resize panels to connect?' : 'Resize panel to connect?'}</DialogTitle>
      <DialogDescription>{coordinated ? 'Close this gap by adjusting both panels together. Review each size change, including the neighboring panel if it was not selected.' : adjustment && <>“{adjustment.panelName}” is close to fitting “{adjustment.targetPanelName}”. Adjust its {adjustment.dimension} to make room for the connector.</>}</DialogDescription>
      {changes.map(change => <div className="panel-fit-measurement" key={`${change.panelId}/${change.dimension}`}>
        <span>{coordinated && `${change.panelName} · `}{change.dimension === 'height' ? 'Height' : 'Width'}</span>
        <strong>{millimeters(change.before)} → {millimeters(change.after)} mm</strong>
        <small>{change.after > change.before ? 'Extend' : 'Shorten'} by {millimeters(Math.abs(change.after - change.before))} mm</small>
      </div>)}
      <ConnectionFitSummary coordinated={coordinated} operations={operations}/>
      <div className="dialog-footer">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onConfirm}>Resize and connect</Button>
      </div>
    </DialogContent>
  </Dialog>
}

function ConnectionFitSummary({ coordinated, operations }: { coordinated: boolean; operations?: ConnectionOperations }) {
  return <>
      <p className="dialog-note">{coordinated ? 'The surrounding panels and existing connectors stay fixed; panel angles and thicknesses are unchanged.' : 'The size adjustment keeps the opposite edge fixed.'} {operations && <>Auto-connect will fit {operations.connectors} connectors at {operations.joints} {operations.joints === 1 ? 'joint' : 'joints'}. </>}
        {operations?.upgrades ? <>This includes {operations.upgrades} existing {operations.upgrades === 1 ? 'joint upgrade' : 'joint upgrades'}. </> : null}
        {operations?.splits ? <>This includes {operations.splits} panel {operations.splits === 1 ? 'split' : 'splits'} for T joints, keeping outer dimensions. </> : null}
        {!coordinated && !operations?.splits && !operations?.upgrades && <>Other panels and existing connectors stay in place. </>}
        Resizing and connecting apply together and can be undone in one step.</p>
      {!!operations?.disassembledNames.length && <p className="dialog-note">These assembly instances will become independent: {operations.disassembledNames.join(', ')}.</p>}
  </>
}
