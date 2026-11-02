import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowRight, CircleHelp, Copy, Link2, Move3D, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, PanelFields, SelectField } from './fields'
import { IconButton, ConnectorGlyph } from './editor-controls'
import { InspectorDisclosure } from './InspectorPrimitives'
import { JointPositionDiagram, PanelDimensionsDiagram } from './InspectorDiagrams'
import { PanelSecondaryFields } from './PanelInspectorFields'
import { CONNECTORS, SIDES } from '@/lib/connector-options'
import type { AttachmentOptions, Connection, Panel, Side, ValidationIssue, Vec3 } from '@/lib/types'

interface Props {
  selected: Panel
  panels: Panel[]
  connection?: Connection
  supportConnected?: boolean
  connected?: boolean
  issues: ValidationIssue[]
  updatePanel: (patch: Partial<Panel>) => boolean | void
  updateConnection: (patch: Partial<AttachmentOptions>) => void
  onDetach: () => void
  duplicateSelected: () => void
  deleteSelected: () => void
  onExtendToGround: () => void
  groundFitReason: string
  buildTools?: ReactNode
  accessories?: ReactNode
  constraints?: ReactNode
  editError?: string
  onManageConstraints?: () => void
}
const matchesRotation = (rotation:Vec3, reference:Vec3)=>rotation.every((angle,i)=>Math.abs(angle-reference[i])<.001)

export function SinglePanelInspector({selected,panels,connection,supportConnected=false,connected=false,issues,updatePanel,updateConnection,onDetach,duplicateSelected,deleteSelected,onExtendToGround,groundFitReason,buildTools,accessories,constraints,editError,onManageConstraints}: Props) {
  const placement = <>
    <SelectField label="Orientation" disabled={supportConnected} value={matchesRotation(selected.rotation,[-Math.PI/2,0,0])?'horizontal':matchesRotation(selected.rotation,[0,Math.PI/2,0])?'side':matchesRotation(selected.rotation,[0,0,0])?'vertical':'custom'} onChange={v=>updatePanel({rotation:v==='horizontal'?[-Math.PI/2,0,0]:v==='side'?[0,Math.PI/2,0]:[0,0,0]})}>
      <option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option><option value="custom" disabled>Custom rotation</option>
    </SelectField>
    <div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Position ${axis}`} disabled={supportConnected} value={selected.position[i]} onChange={v=>{const pos=[...selected.position] as Vec3;pos[i]=v;updatePanel({position:pos})}}/>)}</div>
    <InspectorDisclosure title="Rotation" summary={selected.rotation.map(angle=>`${Math.round(angle*180/Math.PI)}°`).join(' · ')} preferenceKey="panel-rotation">
      <div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Rotate ${axis}`} disabled={supportConnected} value={selected.rotation[i]*180/Math.PI} min={-360} max={360} unit="°" onChange={v=>{const rot=[...selected.rotation] as Vec3;rot[i]=v*Math.PI/180;updatePanel({rotation:rot})}}/>)}</div>
    </InspectorDisclosure>
  </>
  return <>
    <div className="selected-heading"><span className="selection-indicator"/><span>SELECTED PANEL</span><span className="selected-index">{connection||supportConnected||connected?'Connected':'Free'}</span></div>
    <label className="field panel-name-field"><span>Name</span><input key={`${selected.id}-${selected.name}`} defaultValue={selected.name} aria-label="Panel name" maxLength={60} onBlur={e=>updatePanel({name:e.target.value.trim()||'Untitled panel'})} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
    {issues.filter(i=>i.panelIds.includes(selected.id)).map(i=><div className={`validation-note ${i.severity}`} role="status" key={i.id}><CircleHelp size={16}/><span>{i.message}</span></div>)}
    <section className="inspector-section" aria-label="Panel dimensions">
      <div className="section-title"><h2>Dimensions</h2><span>mm</span></div>
      <PanelFields group="dimensions" compact resizeOnCommit panel={selected} onChange={updatePanel}/>
      {editError&&<div className="validation-note error" role="status"><span>{editError}{onManageConstraints&&<button className="text-button" onClick={onManageConstraints}>Review constraints</button>}</span></div>}
      <Button variant="outline" size="sm" onClick={onExtendToGround} disabled={!!groundFitReason} aria-describedby="extend-ground-help"><ArrowDownToLine size={15}/>Extend to ground</Button>
      <p id="extend-ground-help" className="field-note ground-fit-note">{groundFitReason || 'Extend the lower edge to ground level (Y = 0), keeping the upper edge and existing joints in place.'}</p>
      <InspectorDisclosure title="About panel dimensions" className="inspector-help"><PanelDimensionsDiagram/><p className="field-note">Dimensions follow the panel's face, before assembly. Connected panels resize together.</p></InspectorDisclosure>
    </section>
    <section className="inspector-section"><div className="section-title"><h2>{connection?'Connection':'Placement'}</h2><Move3D size={16}/></div>
      {connection?<>
        <div className="connection-type"><ConnectorGlyph type={connection.type}/><span><strong>{CONNECTORS.find(c=>c.id===connection.type)?.name} connector</strong><small>Attached to {panels.find(p=>p.id===connection.parentId)?.name}</small></span></div>
        <SelectField label="Side" value={connection.side} onChange={side=>updateConnection({side:side as Side})}>{SIDES.map(side=><option key={side} value={side}>{side[0].toUpperCase()+side.slice(1)}</option>)}</SelectField>
        <div className="field-row"><NumberField label="Offset" value={connection.offset} onChange={offset=>updateConnection({offset})}/><NumberField label="Inset" value={connection.inset} onChange={inset=>updateConnection({inset})}/></div>
        <InspectorDisclosure title="Joint position guide" className="inspector-help"><JointPositionDiagram side={connection.side}/><p className="field-note">Offset slides along the joint. Inset moves across the panel. Flip reverses the attached panel's joint direction.</p></InspectorDisclosure>
        <label className="checkbox-label"><input type="checkbox" checked={connection.flip} onChange={e=>updateConnection({flip:e.target.checked})}/>Flip joint direction</label>
        <Button variant="ghost" size="sm" className="detach-button" onClick={onDetach}><Link2 size={14}/>Detach for free placement<ArrowRight size={14}/></Button>
      </>:supportConnected?<>
        <p className="field-note">Connected to other parts. Detach to edit placement freely.</p>
        <Button variant="ghost" size="sm" className="detach-button" onClick={onDetach}>Detach for free placement<ArrowRight size={14}/></Button>
        <InspectorDisclosure title="Placement details">{placement}</InspectorDisclosure>
      </>:placement}
    </section>
    {constraints}
    <PanelSecondaryFields resizeOnCommit panel={selected} onChange={updatePanel}/>
    {accessories}
    {buildTools}
    <div className="panel-actions"><Button variant="outline" size="sm" onClick={duplicateSelected}><Copy size={15}/>Duplicate</Button><IconButton label="Delete selected panel" className="delete-button" onClick={deleteSelected}><Trash2 size={16}/></IconButton></div>
    <InspectorDisclosure title="Selection & movement help" className="inspector-help"><p className="field-note">Shift-click to select more panels. Focus the workspace and use the arrow keys to move the selection; hold Shift for a larger step. Snapping follows the workspace settings.</p></InspectorDisclosure>
  </>
}
