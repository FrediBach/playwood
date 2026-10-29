import { CircleHelp, Copy, Layers, Link2, Move3D, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, PanelFields, SelectField } from '@/components/fields'
import { getSharedPanelFields, panelValuesEqual } from '@/lib/selection'
import type { Connection, Panel, Side, ValidationIssue, Vec3 } from '@/lib/types'

type ConnectionPatch = Partial<Pick<Connection, 'side' | 'offset' | 'inset' | 'flip'>>
interface Props {
  panels: Panel[]
  connections: Connection[]
  issues: ValidationIssue[]
  onChange: (patch: Partial<Panel>) => boolean | void
  onConnectionChange: (patch: ConnectionPatch) => void
  onDuplicate: () => void
  onDelete: () => void
}
const SIDES: Side[] = ['left', 'right', 'top', 'bottom', 'front', 'back']
const AXES = ['X', 'Y', 'Z'] as const

function SharedConnectionFields({connections,onChange}: {connections:(Connection|undefined)[];onChange:Props['onConnectionChange']}) {
  const allAttached = connections.every(c => c !== undefined)
  const joint = connections.find(c => c !== undefined)
  const connectionShared = (key: keyof Connection) => allAttached && connections.every(c => panelValuesEqual(c?.[key], joint?.[key]))
  return <section className="inspector-section"><div className="section-title"><h2>Connections</h2><Link2 size={16}/></div>
      {!allAttached&&<p className="field-note">The selection contains both free and connected panels.</p>}
      <SelectField label="Side" value={joint?.side??'left'} mixed={!connectionShared('side')} onChange={side=>onChange({side:side as Side})}>{SIDES.map(side=><option key={side} value={side}>{side[0].toUpperCase()+side.slice(1)}</option>)}</SelectField>
      <div className="field-row"><NumberField label="Offset" value={joint?.offset??0} mixed={!connectionShared('offset')} onChange={offset=>onChange({offset})}/><NumberField label="Inset" value={joint?.inset??0} mixed={!connectionShared('inset')} onChange={inset=>onChange({inset})}/></div>
      <label className={`checkbox-label ${connectionShared('flip')?'':'is-mixed'}`}><input type="checkbox" checked={connectionShared('flip')?joint?.flip:false} disabled={!connectionShared('flip')} ref={element=>{if(element)element.indeterminate=!connectionShared('flip')}} onChange={e=>onChange({flip:e.target.checked})}/>Flip joint direction{!connectionShared('flip')&&<span className="field-hint">Mixed</span>}</label>
    </section>
}

export function MultiPanelInspector({ panels, connections, issues, onChange, onConnectionChange, onDuplicate, onDelete }: Props) {
  const first = panels[0]
  const shared = getSharedPanelFields(panels)
  const selectedConnections = panels.map(panel => connections.find(c => c.childId === panel.id && c.role !== 'support'))
  const anyAttached = selectedConnections.some(c => c !== undefined)
  const axisShared = (key: 'position' | 'rotation', index: number) => panels.every(panel => panelValuesEqual(panel[key][index], first[key][index]))
  const orientation = Math.abs(first.rotation[0] + Math.PI / 2) < .001 ? 'horizontal' : Math.abs(first.rotation[1] - Math.PI / 2) < .001 ? 'side' : first.rotation.every(n => n === 0) ? 'vertical' : 'custom'
  const changeAxis = (key: 'position' | 'rotation', index: number, value: number) => {
    const vector = [...first[key]] as Vec3
    vector[index] = value
    onChange({ [key]: vector })
  }
  const selectedIds = new Set(panels.map(p => p.id))
  return <>
    <div className="selected-heading"><span className="selection-indicator"/><span>MULTIPLE PANELS</span><Layers size={15} className="selected-index"/></div>
    <div className="multi-selection-heading"><h2>{panels.length} panels selected</h2><p>Shared values apply to every selected panel. Mixed values are disabled.</p></div>
    <label className={`field ${shared.has('name') ? '' : 'is-mixed'}`}><span>Name</span><input key={`${panels.map(p=>p.id).join(',')}-${first.name}`} defaultValue={shared.has('name') ? first.name : ''} placeholder="Mixed" disabled={!shared.has('name')} aria-label="Panel name" maxLength={60} onBlur={e=>{if(shared.has('name'))onChange({name:e.target.value.trim()||'Untitled panel'})}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
    <section className="inspector-section"><div className="section-title"><h2>Make them yours</h2><span>mm</span></div><PanelFields resizeOnCommit panel={first} panels={panels} onChange={onChange}/></section>
    <section className="inspector-section"><div className="section-title"><h2>Placement</h2><Move3D size={16}/></div>
      {anyAttached&&<p className="field-note">Click the preview and use arrow keys to move 1 cm, or Shift for 10 cm. Connected panels resize to keep their joints aligned.</p>}
      <SelectField label="Orientation" value={orientation} mixed={!shared.has('rotation')} disabled={anyAttached} onChange={value=>onChange({rotation:value==='horizontal'?[-Math.PI/2,0,0]:value==='side'?[0,Math.PI/2,0]:[0,0,0]})}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option><option value="custom" disabled>Custom rotation</option></SelectField>
      <div className="field-row">{AXES.map((axis,i)=><NumberField key={axis} label={`Position ${axis}`} value={first.position[i]} mixed={!axisShared('position',i)} disabled={anyAttached} onChange={value=>changeAxis('position',i,value)}/>)}</div>
      <div className="field-row">{AXES.map((axis,i)=><NumberField key={axis} label={`Rotate ${axis}`} value={first.rotation[i]*180/Math.PI} mixed={!axisShared('rotation',i)} disabled={anyAttached} min={-360} max={360} unit="°" onChange={value=>changeAxis('rotation',i,value*Math.PI/180)}/>)}</div>
    </section>
    {anyAttached&&<SharedConnectionFields connections={selectedConnections} onChange={onConnectionChange}/>}
    {issues.filter(issue=>issue.panelIds.some(id=>selectedIds.has(id))).map(issue=><div className={`validation-note ${issue.severity}`} key={issue.id}><CircleHelp size={16}/><span>{issue.message}</span></div>)}
    <div className="panel-actions"><Button variant="outline" size="sm" onClick={onDuplicate}><Copy size={15}/>Duplicate {panels.length}</Button><Button variant="ghost" size="icon" aria-label="Delete selected panels" className="delete-button" onClick={onDelete}><Trash2 size={16}/></Button></div>
  </>
}
