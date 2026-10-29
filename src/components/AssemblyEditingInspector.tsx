import { Box, Pencil } from 'lucide-react'
import { Button } from './ui/button'
import { PanelFields } from './fields'
import type { Panel } from '@/lib/types'

export function AssemblyEditingInspector({ panels, name, count, onChange }: { panels: Panel[]; name: string; count: number; onChange: (patch: Partial<Panel>) => boolean }) {
  if (!panels.length) return <p className="assembly-help">Select panels inside this assembly to edit their shared construction.</p>
  const first = panels[0]
  return <>
    <div className="selected-heading"><Pencil size={15}/><span>EDITING ASSEMBLY</span></div>
    <div className="multi-selection-heading"><h2>{name}</h2><p>Changes update {count} linked {count === 1 ? 'instance' : 'instances'}. Instance color overrides are kept.</p></div>
    {panels.length === 1 && <label className="field"><span>Panel name</span><input key={`${first.id}-${first.name}`} defaultValue={first.name} aria-label="Panel name" maxLength={60} onBlur={event => { const value = event.target.value.trim(); if (value && value !== first.name) onChange({ name: value }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label>}
    <section className="inspector-section"><div className="section-title"><h2>{panels.length === 1 ? first.name : `${panels.length} panels selected`}</h2><span>mm</span></div><PanelFields resizeOnCommit panel={first} panels={panels} onChange={onChange}/></section>
    <p className="assembly-help">Select an individual panel in the tree or workspace to edit it. Connected panels adjust together to keep the joints aligned.</p>
  </>
}

export function AssemblyPartInspector({ panel, instanceName, definitionName, count, onSelectInstance, onEdit }: { panel: Panel; instanceName: string; definitionName: string; count: number; onSelectInstance: () => void; onEdit: () => void }) {
  return <>
    <div className="selected-heading"><Box size={15}/><span>ASSEMBLY PANEL</span></div>
    <div className="multi-selection-heading"><h2>{panel.name}</h2><p>Part of {instanceName}</p></div>
    <p className="field-note">{panel.width} × {panel.height} × {panel.thickness} mm</p>
    <p className="assembly-help">Its construction comes from {definitionName}. Editing the assembly updates {count} linked {count === 1 ? 'instance' : 'instances'}.</p>
    <Button variant="outline" className="full-button" onClick={onEdit}><Pencil size={15}/>Edit assembly</Button>
    <button className="text-button" onClick={onSelectInstance}>Select whole instance</button>
  </>
}
