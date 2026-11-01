import { ConnectorColorField } from './ConnectorColorField'
import { ConnectorTypeField } from './ConnectorTypeField'
import type { Dispatch, SetStateAction } from 'react'
import { CircleHelp, Link2 } from 'lucide-react'
import { NumberField, PanelFields, SelectField } from './fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { JointPositionDiagram } from './InspectorDiagrams'
import { PanelSecondaryFields } from './PanelInspectorFields'
import type { AttachmentSideGuideState } from './AttachmentSideGuide'
import { SIDES } from '@/lib/connector-options'
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
  previewIssues: ValidationIssue[]
  sideGuide: AttachmentSideGuideState
}

export function AttachmentInspector({selected,panels,draft,setDraft,attachment,setAttachment,attachTarget,setAttachTarget,previewIssues,sideGuide}: Props) {
  const count=attachment.type==='t'?2:attachment.type==='cross'?3:1
  return <>
    <div className="attach-intro"><Link2 size={19}/><div><h2>Attach to {selected.name}</h2><p>{count>1?`Creates ${count} panels around one joint.`:attachTarget==='new'?'Preview a new connected panel.':'Preview an existing panel in its new position.'}</p></div></div>
    <SelectField label="Panel to attach" value={attachTarget} onChange={value=>{setAttachTarget(value);setDraft(value==='new'?createPanel({name:`Panel ${panels.length+1}`,width:selected.width,height:360,thickness:selected.thickness,material:selected.material,color:selected.color,...(selected.finishCoverage!==undefined?{finishCoverage:selected.finishCoverage}:{})}):{...panels.find(p=>p.id===value)!})}}><option value="new">Create a new panel</option>{panels.filter(p=>p.id!==selected.id).map(p=><option key={p.id} value={p.id}>{p.name} · existing</option>)}</SelectField>
    <div className="field attachment-side-field">
      <span id="attachment-side-label">Choose a side</span>
      <div className="side-options attachment-side-options" role="group" aria-labelledby="attachment-side-label" aria-describedby="attachment-side-help">
        {SIDES.map((side,index)=><button key={side} type="button" data-inspector-side={side}
          className={`${attachment.side===side?'selected ':''}${sideGuide.highlightedSide===side?'is-highlighted':''}`}
          aria-pressed={attachment.side===side}
          onPointerEnter={()=>sideGuide.onHighlight(side)}
          onPointerLeave={()=>sideGuide.onHighlight(null)}
          onFocus={()=>sideGuide.onHighlight(side)} onBlur={()=>sideGuide.onHighlight(null)}
          onClick={()=>sideGuide.onSelect(side)}>
          <span className="attachment-side-key" aria-hidden="true">{String.fromCharCode(65+index)}</span>
          {side[0].toUpperCase()+side.slice(1)}
        </button>)}
      </div>
      <p className="field-note" id="attachment-side-help">Match the letters in the preview, or click a label there. Side names stay with the panel as you orbit.</p>
    </div>
    <ConnectorTypeField value={attachment.type} onChange={type=>setAttachment(a=>({...a,type}))}/>
    <section className="inspector-section"><div className="section-title"><h2>{count>1?`${count} new panels`:attachTarget==='new'?'New panel dimensions':'Panel dimensions'}</h2><span>mm</span></div><PanelFields group="dimensions" panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))} compact/></section>
    <InspectorDisclosure title="Joint position" summary={`${attachment.count} connectors · ${attachment.side}`} defaultOpen>
      <div className="field-row"><NumberField label="Offset" value={attachment.offset} onChange={offset=>setAttachment(a=>({...a,offset}))}/><NumberField label="Inset" value={attachment.inset} onChange={inset=>setAttachment(a=>({...a,inset}))}/></div>
      <InspectorDisclosure title="Joint position guide" className="inspector-help"><JointPositionDiagram side={attachment.side}/><p className="field-note">Offset slides along the joint. Inset moves across the panel. Flip reverses the joint direction.</p></InspectorDisclosure>
      <label className="checkbox-label"><input type="checkbox" checked={attachment.flip} onChange={e=>setAttachment(a=>({...a,flip:e.target.checked}))}/>Flip joint direction</label>
      <NumberField label="Connectors" value={attachment.count} min={1} max={8} unit="pcs" onChange={count=>setAttachment(a=>({...a,count:Math.round(count)}))}/>
    </InspectorDisclosure>
    <PanelSecondaryFields panel={draft} onChange={patch=>setDraft(p=>({...p,...patch}))}/>
    <InspectorDisclosure title="Connector finish" preferenceKey="attachment-connector-finish"><ConnectorColorField color={attachment.color} onChange={color=>setAttachment(a=>({...a,color}))}/></InspectorDisclosure>
    {previewIssues.length>0&&<section className="inspector-section" aria-label="Preview issues"><div className="section-title"><h2>Preview issues</h2><span>{previewIssues.length}</span></div>{previewIssues.map(issue=><div className={`validation-note ${issue.severity}`} key={issue.id}><CircleHelp size={16}/><span>{issue.message}</span></div>)}</section>}
  </>
}
