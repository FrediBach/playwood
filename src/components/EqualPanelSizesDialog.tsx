import { useMemo, useState } from 'react'
import { differingPanelDimension, equalizePanelSizes } from '@/lib/equal-panel-sizes'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'
import { NumberField } from './fields'
import { PanelChangeTable } from './PanelChangeTable'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

export function EqualPanelSizesDialog({ source, ids, onApply, onCancel }: {
  source: Project; ids: string[]; onApply: (candidate: Project) => void; onCancel: () => void
}) {
  const selectedIds = new Set(ids)
  const panels = source.panels.filter(panel => selectedIds.has(panel.id))
  const dimension = differingPanelDimension(panels)!
  const [value, setValue] = useState(panels[0][dimension])
  const result = useMemo(() => {
    try {
      const candidate = equalizePanelSizes(source, ids, value)
      const before = new Map(resolvePanels(source).map(panel => [panel.id, panel]))
      const changes = resolvePanels(candidate).flatMap(after => {
        const original = before.get(after.id)!
        return JSON.stringify(original) === JSON.stringify(after) ? [] : [{ before: original, after }]
      })
      return { candidate, changes, error: null }
    } catch (error) { return { candidate: null, changes: [], error: error instanceof Error ? error.message : 'These sizes cannot be made equal.' } }
  }, [source, ids, value])
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLCanvasElement>('canvas')?.focus() }}>
      <DialogTitle>Make sizes equal</DialogTitle>
      <DialogDescription>Choose an existing size or enter the shared {dimension}. All selected panel sizes are shown in millimeters. Connected panels may also adjust to preserve joints.</DialogDescription>
      <div className="parts-table-wrap"><table aria-label="Selected panel sizes">
        <thead><tr><th>Panel</th><th>Width</th><th>Height</th><th>Thickness</th></tr></thead>
        <tbody>{panels.map(panel => <tr key={panel.id}><td>{panel.name}</td><td>{panel.width}</td><td>{panel.height}</td><td>{panel.thickness}</td></tr>)}</tbody>
      </table></div>
      <fieldset><legend>Shared {dimension} (mm)</legend>
        {[...new Set(panels.map(panel => panel[dimension]))].sort((a,b) => a-b).map(size => <label className="checkbox-label" key={size}>
          <input type="radio" name="equal-size" checked={value === size} onChange={() => setValue(size)}/>{size} mm
        </label>)}
      </fieldset>
      <NumberField label={`Shared ${dimension}`} value={value} onChange={setValue} min={dimension === 'thickness' ? 3 : 40} max={dimension === 'thickness' ? 100 : 4000} precision={3} nice={dimension !== 'thickness'} commitOnBlur/>
      {result.error ? <p role="alert">{result.error}</p> : <PanelChangeTable changes={result.changes} label="Affected panel sizes and positions"/>}
      <div className="dialog-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={!result.candidate} onClick={() => { if (result.candidate) onApply(result.candidate) }}>Apply equal sizes</Button></div>
    </DialogContent>
  </Dialog>
}
