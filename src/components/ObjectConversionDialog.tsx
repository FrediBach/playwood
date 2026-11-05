import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Button } from './ui/button'
import { NumberField, SelectField } from './fields'
import Scene from './Scene'
import { MATERIALS } from '@/lib/materials'
import { getDefaultConnectorColor } from '@/lib/connector-selection'
import { resolvePanels } from '@/lib/model'
import type { ConversionFailurePreview } from '@/lib/object-conversion-diagnostics'
import type { ObjectConversion, ObjectConversionOptions } from '@/lib/object-conversion'
import type { Project } from '@/lib/types'

export function ObjectConversionDialog({ source, project, ids, onAccept, onCancel }: {
  source: Project; project: Project; ids: string[];
  onAccept: (result: ObjectConversion) => void; onCancel: () => void;
}) {
  const opener = useRef<HTMLElement | null>(null)
  const [options, setOptions] = useState<ObjectConversionOptions>(() => ({ rectangularOnly: false, thickness: 18, material: 'birch', color: '#d9c7a3', finishCoverage: 0, connectorColor: getDefaultConnectorColor(source), connectorMaterial: 'plastic' }))
  const [response, setResponse] = useState<{ options: ObjectConversionOptions; result?: ObjectConversion; error?: string; failure?: ConversionFailurePreview }>()
  const stale = source !== project
  useEffect(() => {
    if (stale) return
    let active = true
    const worker = new Worker(new URL('../lib/object-conversion.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<{ result?: ObjectConversion; error?: string; failure?: ConversionFailurePreview }>) => { if (active) setResponse({ options, ...event.data }) }
    worker.onerror = () => { if (active) setResponse({ options, error: 'The conversion worker could not finish. Change an input to try again.' }) }
    worker.postMessage({ source, ids, options })
    return () => { active = false; worker.terminate() }
  }, [source, ids, options, stale])
  const current = !stale && response?.options === options ? response : undefined
  const result = current?.result, failure = current?.failure
  const panels = useMemo(() => result ? resolvePanels(result.project) : failure ? resolvePanels(source) : [], [result, failure, source])
  const patch = (value: Partial<ObjectConversionOptions>) => setOptions(current => ({ ...current, ...value }))
  return <Dialog open onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent className="object-conversion-dialog" onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}>
      <DialogTitle>Convert objects to panels</DialogTitle>
      <DialogDescription>Review the closed panel construction. Acceptance retains and hides the selected source objects. Separate roots retain their compartment boundaries. Generated furniture is independent; remove panels afterward to make openings.</DialogDescription>
      <div className="field-row">
        <NumberField label="Conversion thickness" value={options.thickness} min={16} max={19} nice={false} onChange={thickness => patch({ thickness })}/>
        <SelectField label="Conversion material" value={options.material} onChange={material => patch({ material: material as ObjectConversionOptions['material'] })}>
          {MATERIALS.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}
        </SelectField>
        <NumberField label="Conversion finish coverage" value={options.finishCoverage * 100} min={0} max={100} unit="%" nice={false} onChange={finishCoverage => patch({ finishCoverage: finishCoverage / 100 })}/>
      </div>
      <div className="field-row">
        <label className="field"><span>Panel color</span><input aria-label="Conversion panel color" type="color" value={options.color} onChange={event => patch({ color: event.target.value })}/></label>
        <label className="field"><span>Connector color</span><input aria-label="Conversion connector color" type="color" value={options.connectorColor} onChange={event => patch({ connectorColor: event.target.value })}/></label>
        <SelectField label="Conversion connector material" value={options.connectorMaterial} onChange={connectorMaterial => patch({ connectorMaterial: connectorMaterial as ObjectConversionOptions['connectorMaterial'] })}><option value="plastic">Plastic</option><option value="metal">Metal (90° only)</option></SelectField>
      </div>
      <label className="checkbox-label"><input type="checkbox" checked={options.rectangularOnly ?? false} aria-describedby="rectangular-panels-note" onChange={event => patch({ rectangularOnly: event.target.checked })}/>Rectangular panels only</label>
      <p id="rectangular-panels-note" className="field-note">Split closing faces into rectangles attached to the surrounding walls. Seams between pieces have no connectors; conversion requires valid wall attachments for every piece.</p>
      {result && <><div className="object-conversion-preview"><Scene panels={panels} connections={result.project.connections} connectorOverrides={result.project.connectorOverrides} selectedIds={result.panelIds} onSelect={() => {}} view="perspective" showGrid={false} showDimensions={false} exploded={false} fitSignal={0} zoomSignal={{ direction: 0, key: 0 }}/></div>
        <p role="status">{result.panelIds.length} panels · {result.hardwareCount} connectors · Outside dimensions {result.dimensions.map(value => Number(value.toFixed(2))).join(' × ')} mm</p>
        {result.compartments.length > 1 && <><p>{result.compartments.length} compartments · {result.sharedWalls} shared walls</p><ul>{result.compartments.map(compartment => <li key={compartment.id}>{compartment.name}{compartment.clearDimensions ? ` · Clear interior ${compartment.clearDimensions.map(value => Number(value.toFixed(2))).join(' × ')} mm` : ' · Profile shape'}{compartment.sharedWall ? ' · Shared divider' : ''}</li>)}</ul></>}</>}
      {failure && <>
        <div className="object-conversion-preview" role="region" aria-label="Conversion failure preview"><Scene panels={panels} connections={source.connections} connectorOverrides={source.connectorOverrides} selectedIds={[]} onSelect={() => {}} view="perspective" showGrid={false} showDimensions={false} exploded={false} fitSignal={0} zoomSignal={{ direction: 0, key: 0 }}
          constructionLayer={{ objects: failure.objects, surfaces: failure.surfaces, highlightedRegions: failure.regions, previewBounds: failure.bounds, selectedIds: [], active: false, movementEnabled: false, step: 10, onSelect: () => {}, onMove: () => {} }}/></div>
        <p>Red outlines mark affected source regions:</p>
        <ul aria-label="Affected source regions">{failure.regions.map(region => <li key={region.id}>{region.name}</li>)}</ul>
      </>}
      {stale ? <p role="alert">The project changed. Close this preview and convert again.</p> : current?.error ? <p role="alert">{current.error}</p> : !result ? <p role="status">Solving panels and connectors…</p> : null}
      <p className="field-note">Dimensions exclude projecting hardware. Clearance uses conservative stock and CAD bounds; inspect before fabrication. Conversion supports cuboids with up to four separate rectangular corner cutouts, single rectangular through-openings or blind recesses, and common-depth profiles with 6–12 boundary edges, including L, U, and stepped shapes. Three-axis crosses with three to six full-face rectangular arms convert to rectangular shell panels. Disconnected results convert as separate pieces when each piece is supported and has clearance. Enclosed cavities, multiple or non-rectangular tunnels, and other changing-depth shapes are not supported yet. Straight rows and complete rectangular grids of touching cuboids share dividers with 18–19 mm stock. Grids use cross connectors at interior intersections. Missing cells, three-dimensional grids, and partial shared faces are not supported yet.</p>
      <div className="dialog-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={!result} onClick={() => { if (result) onAccept(result) }}>Create panels</Button></div>
    </DialogContent>
  </Dialog>
}
