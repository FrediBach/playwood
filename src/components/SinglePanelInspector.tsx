import { ArrowRight, CircleHelp, Copy, Link2, Move3D, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberField, PanelFields, SelectField } from './fields'
import { IconButton, ConnectorGlyph } from './editor-controls'
import { CONNECTORS, SIDES } from '@/lib/connector-options'
import type { AttachmentOptions, Connection, Panel, Side, ValidationIssue, Vec3 } from '@/lib/types'

interface Props {
  selected: Panel
  panels: Panel[]
  connection?: Connection
  supportConnected?: boolean
  issues: ValidationIssue[]
  updatePanel: (patch: Partial<Panel>) => boolean | void
  updateConnection: (patch: Partial<AttachmentOptions>) => void
  onDetach: () => void
  duplicateSelected: () => void
  deleteSelected: () => void
}

const matchesRotation = (rotation:Vec3, reference:Vec3)=>rotation.every((angle,i)=>Math.abs(angle-reference[i])<.001)

export function SinglePanelInspector({selected,panels,connection,supportConnected=false,issues,updatePanel,updateConnection,onDetach,duplicateSelected,deleteSelected}: Props) {
  return <>
          <div className="selected-heading"><span className="selection-indicator"/><span>SELECTED PANEL</span><span className="selected-index">{String(panels.findIndex(p=>p.id===selected.id)+1).padStart(2,'0')}</span></div>
          <label className="field panel-name-field"><span>Name</span><input key={`${selected.id}-${selected.name}`} defaultValue={selected.name} aria-label="Panel name" maxLength={60} onBlur={e=>updatePanel({name:e.target.value.trim()||'Untitled panel'})} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
          <section className="inspector-section"><div className="section-title"><h2>Make it yours</h2><span>mm</span></div><PanelFields resizeOnCommit panel={selected} onChange={updatePanel}/><p className="field-note">Connected panels resize together. Click the preview, then use arrow keys to move 1 cm; hold Shift for 10 cm.</p></section>
          <section className="inspector-section"><div className="section-title"><h2>{connection?'Connection':'Placement'}</h2><Move3D size={16}/></div>
          {!connection&&supportConnected&&<><p className="field-note">This panel is connected to other parts. Detach it to place it freely.</p><Button variant="ghost" size="sm" className="detach-button" onClick={onDetach}>Detach for free placement<ArrowRight size={14}/></Button></>}
          {connection?<><div className="connection-type" aria-label="Connector type"><ConnectorGlyph type={connection.type}/><span><strong>{CONNECTORS.find(c=>c.id===connection.type)?.name} connector</strong><small>{CONNECTORS.find(c=>c.id===connection.type)?.description}</small></span></div><div className="attached-to"><Link2 size={15}/><span>Attached to <strong>{panels.find(p=>p.id===connection.parentId)?.name}</strong></span></div><SelectField label="Side" value={connection.side} onChange={side=>updateConnection({side:side as Side})}>{SIDES.map(side=><option key={side} value={side}>{side[0].toUpperCase()+side.slice(1)}</option>)}</SelectField><div className="field-row"><NumberField label="Offset" value={connection.offset} onChange={offset=>updateConnection({offset})}/><NumberField label="Inset" value={connection.inset} onChange={inset=>updateConnection({inset})}/></div><label className="checkbox-label"><input type="checkbox" checked={connection.flip} onChange={e=>updateConnection({flip:e.target.checked})}/>Flip joint direction</label><Button variant="ghost" size="sm" className="detach-button" onClick={onDetach}>Detach for free placement<ArrowRight size={14}/></Button></>:<><SelectField label="Orientation" disabled={supportConnected} value={matchesRotation(selected.rotation,[-Math.PI/2,0,0])?'horizontal':matchesRotation(selected.rotation,[0,Math.PI/2,0])?'side':matchesRotation(selected.rotation,[0,0,0])?'vertical':'custom'} onChange={v=>updatePanel({rotation:v==='horizontal'?[-Math.PI/2,0,0]:v==='side'?[0,Math.PI/2,0]:[0,0,0]})}><option value="vertical">Vertical · front facing</option><option value="horizontal">Horizontal · flat</option><option value="side">Vertical · side facing</option><option value="custom" disabled>Custom rotation</option></SelectField><div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Position ${axis}`} disabled={supportConnected} value={selected.position[i]} onChange={v=>{const pos=[...selected.position] as Vec3;pos[i]=v;updatePanel({position:pos})}}/>)}</div><div className="field-row">{(['X','Y','Z'] as const).map((axis,i)=><NumberField key={axis} label={`Rotate ${axis}`} disabled={supportConnected} value={selected.rotation[i]*180/Math.PI} min={-360} max={360} unit="°" onChange={v=>{const rot=[...selected.rotation] as Vec3;rot[i]=v*Math.PI/180;updatePanel({rotation:rot})}}/>)}</div></>}
          </section>
          {issues.filter(i=>i.panelIds.includes(selected.id)).map(i=><div className={`validation-note ${i.severity}`} key={i.id}><CircleHelp size={16}/><span>{i.message}</span></div>)}
          <div className="panel-actions"><Button variant="outline" size="sm" onClick={duplicateSelected}><Copy size={15}/>Duplicate</Button><IconButton label="Delete selected panel" className="delete-button" onClick={deleteSelected}><Trash2 size={16}/></IconButton></div>
  </>
}
