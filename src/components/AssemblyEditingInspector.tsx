import { useId, useRef, type ReactNode } from 'react'
import { Box, Link2, Pencil } from 'lucide-react'
import { Button } from './ui/button'
import { PanelFields } from './fields'
import { AssemblyParametersSection } from './AssemblyParametersEditor'
import { OutlinePreview } from './PanelOutlineEditor'
import { PanelSecondaryFields } from './PanelInspectorFields'
import type { AssemblyParameter, Panel } from '@/lib/types'
import './inspector-assembly.css'

const EMPTY_PARAMETERS: AssemblyParameter[] = []

export function AssemblyEditingInspector({ panels, definitionPanels = panels, parameters = EMPTY_PARAMETERS, onChange, onParametersChange, accessories }: {
  panels: Panel[]; definitionPanels?: Panel[]; parameters?: AssemblyParameter[]; name: string; count: number;
  onChange: (patch: Partial<Panel>) => boolean; onParametersChange?: (parameters: AssemblyParameter[]) => boolean
  accessories?: ReactNode
}) {
  const first = panels[0]
  const valuesId = useId()
  const valuesTarget = useRef<HTMLDivElement>(null)
  const drivenDimensions = (['width', 'height', 'thickness'] as const).filter(dimension => parameters.some(parameter => parameter.bindings.some(binding => binding.dimension === dimension && panels.some(panel => panel.id === binding.panelId))))
  const jumpToValues = () => {
    valuesTarget.current?.scrollIntoView({ block: 'start' })
    valuesTarget.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  return <>
    <div className="selected-heading"><Pencil size={15}/><span>{panels.length ? 'ASSEMBLY PANELS' : 'SHARED DEFAULTS'}</span></div>
    {first ? <>
      {panels.length === 1 ? <label className="field panel-name-field"><span>Panel name</span><input key={`${first.id}-${first.name}`} defaultValue={first.name} aria-label="Panel name" maxLength={60} onBlur={event => { const value = event.target.value.trim(); if (value && value !== first.name) onChange({ name: value }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label> : <div className="multi-selection-heading"><h2>{panels.length} panels selected</h2><p>Shared values apply to every selected panel. Mixed values are disabled.</p></div>}
      <section className="inspector-section"><div className="section-title"><h2>Dimensions</h2><span>mm</span></div><PanelFields group="dimensions" resizeOnCommit panel={first} panels={panels} disabledFields={drivenDimensions} onChange={onChange}/>
        {drivenDimensions.length > 0 && <div className="assembly-driven-values">{drivenDimensions.map(dimension => {
          const owners = parameters.filter(parameter => parameter.bindings.some(binding => binding.dimension === dimension && panels.some(panel => panel.id === binding.panelId)))
          return <p key={dimension}><span>{dimension[0].toUpperCase() + dimension.slice(1)} controlled by </span>{owners.map((parameter, index) => <span key={parameter.id}>{index > 0 && ', '}{onParametersChange ? <button type="button" aria-controls={valuesId} onClick={jumpToValues}><Link2 size={12}/>{parameter.name}</button> : parameter.name}</span>)}</p>
        })}</div>}
      </section>
      <PanelSecondaryFields resizeOnCommit panel={first} panels={panels} disabledFields={drivenDimensions} onChange={onChange}/>
      {accessories}
    </> : <p className="field-note">Select a panel in this assembly to edit its shared construction.</p>}
    {onParametersChange && <div ref={valuesTarget} id={valuesId} className="assembly-values-target"><AssemblyParametersSection key={definitionPanels.map(panel => panel.id).join(',')} panels={definitionPanels} parameters={parameters} onChange={onParametersChange}/></div>}
  </>
}

export function AssemblyPartInspector({ panel, instanceName, definitionName, count, onSelectInstance, onEdit }: { panel: Panel; instanceName: string; definitionName: string; count: number; onSelectInstance: () => void; onEdit: () => void }) {
  return <>
    <div className="selected-heading"><Box size={15}/><span>ASSEMBLY PANEL</span></div>
    <div className="multi-selection-heading"><h2>{panel.name}</h2></div>
    <button className="assembly-instance-breadcrumb" aria-label="Select whole instance" onClick={onSelectInstance}><Box size={13}/>Part of {instanceName}</button>
    <p className="inspector-summary">{panel.width} × {panel.height} × {panel.thickness} mm</p>
    {panel.customOutline && <OutlinePreview panel={panel}/>}
    <p className="inspector-scope">From {definitionName}. Editing its shared design updates {count} linked {count === 1 ? 'instance' : 'instances'}.</p>
    <Button variant="outline" className="full-button" onClick={onEdit}><Pencil size={15}/>Edit shared design</Button>
  </>
}
