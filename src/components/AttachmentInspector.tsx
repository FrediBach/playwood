import { ConnectorColorField } from './ConnectorColorField'
import type { Dispatch, SetStateAction } from 'react'
import { Check, CircleHelp, Layers, Link2 } from 'lucide-react'
import { NumberField, PanelFields, SelectField } from './fields'
import { ConnectorGlyph } from './editor-controls'
import { Tooltip } from './ui/tooltip'
import { CONNECTORS, SIDES } from '@/lib/connector-options'
import { createPanel } from '@/lib/model'
import type { AttachmentOptions, Panel, ValidationIssue } from '@/lib/types'

interface Props {
  selected: Panel
  panels: Panel[]
  draft: Panel
  setDraft: Dispatch<SetStateAction<Panel>>
  attachment: AttachmentOptions
  setAttachment: Dispatch<SetStateAction<AttachmentOptions>>
  attachTarget: string
  setAttachTarget: (target: string) => void
  previewError: string
  previewIssues: ValidationIssue[]
  hasPreview: boolean
}

export function AttachmentInspector({selected,panels,draft,setDraft,attachment,setAttachment,attachTarget,setAttachTarget,previewError,previewIssues,hasPreview}: Props) {
  return <>
          <div className="attach-intro"><span className="connector-mini"><Link2 size={20}/></span><div><h2>Keep building.</h2><p>Attach to {selected.name}</p></div></div>
          <SelectField label="Panel to attach" value={attachTarget} onChange={value=>{setAttachTarget(value);setDraft(value==='new'?createPanel({name:`Panel ${panels.length+1}`,width:selected.width,height:360,thickness:selected.thickness,material:selected.material,color:selected.color}):{...panels.find(p=>p.id===value)!})}}><option value="new">Create a new panel</option>{panels.filter(p=>p.id!==selected.id).map(p=><option key={p.id} value={p.id}>{p.name} · existing</option>)}</SelectField>
          <div className="field"><span>Choose a side</span><div className="side-options">{SIDES.map(side=><button key={side} className={attachment.side===side?'selected':''} aria-pressed={attachment.side===side} onClick={()=>setAttachment(a=>({...a,side}))}>{side[0].toUpperCase()+side.slice(1)}</button>)}</div></div>
          <div className="field"><span>Connector</span><div className="connector-options">{CONNECTORS.map(c=><Tooltip key={c.id} label={c.description}><button className={attachment.type===c.id?'selected':''} aria-label={`${c.name} connector`} aria-pressed={attachment.type===c.id} onClick={()=>setAttachment(a=>({...a,type:c.id}))}><ConnectorGlyph type={c.id}/><span>{c.name}</span></button></Tooltip>)}</div></div>
          <div className="field-row"><NumberField label="Offset" value={attachment.offset} onChange={offset=>setAttachment(a=>({...a,offset}))}/><NumberField label="Inset" value={attachment.inset} onChange={inset=>setAttachment(a=>({...a,inset}))}/></div><p className="field-note">Offset slides along the joint. Inset moves it across the panel.</p>
          <label className="checkbox-label"><input type="checkbox" checked={attachment.flip} onChange={e=>setAttachment(a=>({...a,flip:e.target.checked}))}/>Flip joint direction</label>
          <NumberField label="Connectors" value={attachment.count} min={1} max={8} unit="pcs" onChange={count=>setAttachment(a=>({...a,count:Math.round(count)}))}/>
          <ConnectorColorField color={attachment.color} onChange={color=>setAttachment(a=>({...a,color}))}/>
          <section className="inspector-section"><div className="section-title"><h2>{attachment.type==='t'?'2 new panels':attachment.type==='cross'?'3 new panels':attachTarget==='new'?'New panel':'Your panel'}</h2><Layers size={16}/></div><PanelFields panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))} compact/></section>
          {previewError&&<div className="validation-note error" role="alert"><CircleHelp size={16}/><span>{previewError}</span></div>}
          {previewIssues.length?previewIssues.map(i=><div className={`validation-note ${i.severity}`} key={i.id}><CircleHelp size={16}/><span>{i.message}</span></div>):hasPreview?<div className="compatibility-note"><Check size={16}/><span>Panel thickness is compatible</span></div>:null}
  </>
}
