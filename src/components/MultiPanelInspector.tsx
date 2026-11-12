import type { ReactNode } from 'react'
import { CircleHelp, Copy, Layers, Link2, Move3D, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, PanelFields, SelectField, type PanelDimensionLocks } from '@/components/fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { JointPositionDiagram } from './InspectorDiagrams'
import { PanelSecondaryFields } from './PanelInspectorFields'
import { panelDistribution } from '@/lib/panel-distribution'
import { getSharedPanelFields, panelValuesEqual } from '@/lib/selection'
import type { Connection, Panel, Side, ValidationIssue, Vec3 } from '@/lib/types'

type ConnectionPatch = Partial<Pick<Connection, 'side' | 'offset' | 'inset' | 'flip'>>
interface Props extends PanelDimensionLocks {
  panels: Panel[]
  connections: Connection[]
  issues: ValidationIssue[]
  onChange: (patch: Partial<Panel>) => boolean | void
  onConnectionChange: (patch: ConnectionPatch) => boolean | void
  onDuplicate: () => void
  onDelete: () => void
  onDetach?: () => void
  onDistribute: () => void
  buildTools?: ReactNode
  accessories?: ReactNode
  constraints?: ReactNode
  editError?: string
  onManageConstraints?: () => void
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
    {connectionShared('side')&&joint&&<InspectorDisclosure title="Joint position guide" className="inspector-help"><JointPositionDiagram side={joint.side}/></InspectorDisclosure>}
    <label className={`checkbox-label ${connectionShared('flip')?'':'is-mixed'}`}><input type="checkbox" checked={connectionShared('flip')?joint?.flip:false} disabled={!connectionShared('flip')} ref={element=>{if(element)element.indeterminate=!connectionShared('flip')}} onChange={e=>onChange({flip:e.target.checked})}/>Flip joint direction{!connectionShared('flip')&&<span className="field-hint">Mixed</span>}</label>
  </section>
}

export function MultiPanelInspector({ panels, connections, issues, onChange, onConnectionChange, onDuplicate, onDelete, onDetach, onDistribute, buildTools, accessories, constraints, editError, onManageConstraints, dimensionConstraints, onDimensionLockChange }: Props) {
  const first = panels[0]
  const shared = getSharedPanelFields(panels)
  const selectedConnections = panels.map(panel => connections.find(c => c.childId === panel.id && c.role !== 'support'))
  const hasDriving = selectedConnections.some(c => c !== undefined)
  const selectedIds = new Set(panels.map(p => p.id))
  const hasSupports = connections.some(c => c.role === 'support' && (selectedIds.has(c.parentId) || selectedIds.has(c.childId)))
  const anyAttached = hasDriving || hasSupports
  const axisShared = (key: 'position' | 'rotation', index: number) => panels.every(panel => panelValuesEqual(panel[key][index], first[key][index]))
  const orientation = Math.abs(first.rotation[0] + Math.PI / 2) < .001 ? 'horizontal' : Math.abs(first.rotation[1] - Math.PI / 2) < .001 ? 'side' : first.rotation.every(n => n === 0) ? 'vertical' : 'custom'
  const changeAxis = (key: 'position' | 'rotation', index: number, value: number) => {
    const vector = [...first[key]] as Vec3
    vector[index] = value
    return onChange({ [key]: vector })
  }
  const placement = <>
    <SelectField label="Orientation" value={orientation} mixed={!shared.has('rotation')} disabled={anyAttached} onChange={value=>onChange({rotation:value==='horizontal'?[-Math.PI/2,0,0]:value==='side'?[0,Math.PI/2,0]:[0,0,0]})}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option><option value="custom" disabled>Custom rotation</option></SelectField>
    <div className="field-row">{AXES.map((axis,i)=><NumberField key={axis} label={`Position ${axis}`} value={first.position[i]} mixed={!axisShared('position',i)} disabled={anyAttached} onChange={value=>changeAxis('position',i,value)}/>)}</div>
    <InspectorDisclosure title="Rotation" preferenceKey="panel-rotation">
      <div className="field-row">{AXES.map((axis,i)=><NumberField key={axis} label={`Rotate ${axis}`} value={first.rotation[i]*180/Math.PI} mixed={!axisShared('rotation',i)} disabled={anyAttached} min={-360} max={360} unit="°" onChange={value=>changeAxis('rotation',i,value*Math.PI/180)}/>)}</div>
    </InspectorDisclosure>
  </>
  return <>
    <div className="selected-heading"><span className="selection-indicator"/><span>MULTIPLE PANELS</span><Layers size={15} className="selected-index"/></div>
    <div className="multi-selection-heading"><h2>{panels.length} panels selected</h2><p>Edits apply to all selected panels. Mixed values are disabled.</p></div>
    {shared.has('name')&&<label className="field"><span>Name</span><input key={`${panels.map(p=>p.id).join(',')}-${first.name}`} defaultValue={first.name} aria-label="Panel name" maxLength={60} onBlur={e=>onChange({name:e.target.value.trim()||'Untitled panel'})} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>}
    {issues.filter(issue=>issue.panelIds.some(id=>selectedIds.has(id))).map(issue=><div className={`validation-note ${issue.severity}`} role="status" key={issue.id}><CircleHelp size={16}/><span>{issue.message}</span></div>)}
    <section className="inspector-section" aria-label="Panel dimensions"><div className="section-title"><h2>Dimensions</h2><span>mm</span></div><PanelFields group="dimensions" compact resizeOnCommit panel={first} panels={panels} onChange={onChange} dimensionConstraints={dimensionConstraints} onDimensionLockChange={onDimensionLockChange}/></section>
    {editError&&<div className="validation-note error" role="status"><span>{editError}{onManageConstraints&&<button className="text-button" onClick={onManageConstraints}>Review constraints</button>}</span></div>}
    {hasDriving&&<SharedConnectionFields connections={selectedConnections} onChange={onConnectionChange}/>}
    <section className="inspector-section"><div className="section-title"><h2>Placement</h2><Move3D size={16}/></div>
      {panelDistribution(panels)&&<><Button variant="outline" size="sm" onClick={onDistribute}>Distribute evenly</Button><p className="field-note">Equal gaps along the panels’ facing direction. The two outer panels stay fixed.</p></>}
      {anyAttached?<>
        <p className="field-note">Connected panels move together in the workspace. Detach to edit their placement freely.</p>
        {onDetach&&<Button variant="ghost" size="sm" className="detach-button" onClick={onDetach}>Detach selected panels</Button>}
        <InspectorDisclosure title="Placement details">{placement}</InspectorDisclosure>
      </>:placement}
    </section>
    {constraints}
    <PanelSecondaryFields resizeOnCommit panel={first} panels={panels} onChange={onChange}/>
    {accessories}
    {buildTools}
    <div className="panel-actions"><Button variant="outline" size="sm" onClick={onDuplicate}><Copy size={15}/>Duplicate {panels.length}</Button><Button variant="ghost" size="icon" aria-label="Delete selected panels" className="delete-button" onClick={onDelete}><Trash2 size={16}/></Button></div>
  </>
}
