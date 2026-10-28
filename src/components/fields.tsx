import { useEffect, useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { Material, Panel, Pattern } from '@/lib/types'

export const MATERIALS: {id:Material;name:string;color:string;detail:string}[] = [
  {id:'birch',name:'Birch plywood',color:'#d9bb87',detail:'Light, layered & versatile'},
  {id:'oak',name:'Oak plywood',color:'#bc945e',detail:'A warm, natural grain'},
  {id:'walnut',name:'Walnut plywood',color:'#79563d',detail:'Rich & characterful'},
  {id:'mdf',name:'Natural MDF',color:'#bca17c',detail:'Smooth & uniform'},
  {id:'painted',name:'Painted board',color:'#e8e5db',detail:'Your color, your way'},
]
export const COLORS = [{name:'Natural',color:'#d9bb87'},{name:'Chalk',color:'#e8e5db'},{name:'Charcoal',color:'#414641'},{name:'Sage',color:'#94a18c'},{name:'Terracotta',color:'#bc6c50'},{name:'Blue gray',color:'#778b99'}]
export function NumberField({label,value,onChange,min=-10000,max=10000,step=1,unit='mm',disabled=false}: {label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;unit?:string;disabled?:boolean}) {
  const [text,setText] = useState(String(Math.round(value*10)/10));const id=useId()
  useEffect(()=>setText(String(Math.round(value*10)/10)),[value])
  const commit = ()=>{const n=Number(text);if(text.trim() && Number.isFinite(n)){const v=Math.max(min,Math.min(max,n));onChange(v);setText(String(Math.round(v*10)/10))}else setText(String(value))}
  return <label className="field" htmlFor={id}><span>{label}</span><div className="number-wrap"><input id={id} aria-label={label} type="number" value={text} min={min} max={max} step={step} disabled={disabled} onChange={e=>{const text=e.target.value;setText(text);const n=Number(text);if(text.trim()&&Number.isFinite(n)&&n>=min&&n<=max)onChange(n)}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/><span className="input-unit">{unit}</span></div></label>
}
export function SelectField({label,value,onChange,children}: {label:string;value:string;onChange:(v:string)=>void;children:ReactNode}) {
  const id=useId();return <label className="field" htmlFor={id}><span>{label}</span><div className="select-wrap"><select id={id} value={value} onChange={e=>onChange(e.target.value)}>{children}</select><ChevronDown size={14}/></div></label>
}
export function PanelFields({panel,onChange:applyChange,compact=false}: {panel:Panel;onChange:(v:Partial<Panel>)=>void;compact?:boolean}) {
  const onChange=(patch:Partial<Panel>)=>{const next={...panel,...patch}; const minPitch=Math.max(15,next.holeSize+6,Math.ceil(Math.sqrt(next.width*next.height/4500))); if(next.pattern!=='solid'&&next.holeSpacing<minPitch)patch.holeSpacing=minPitch;applyChange(patch)}
  return <>
    <div className="field-row"><NumberField label="Width" value={panel.width} min={80} max={3000} onChange={width=>onChange({width})}/><NumberField label="Height" value={panel.height} min={80} max={3000} onChange={height=>onChange({height})}/><NumberField label="Thickness" value={panel.thickness} min={3} max={60} onChange={thickness=>onChange({thickness})}/></div>
    <SelectField label="Material" value={panel.material} onChange={v=>{const m=MATERIALS.find(m=>m.id===v)!;onChange({material:m.id,color:m.color})}}>{MATERIALS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</SelectField>
    <div className="field"><span>Finish <span className="field-hint">{COLORS.find(c=>c.color===panel.color)?.name || (MATERIALS.some(m=>m.color===panel.color)||['#d9bd8c','#b88b54','#76523b','#ae9677'].includes(panel.color)?'Natural':'Custom')}</span></span><div className="swatches">{COLORS.map(c=><button key={c.color} className={`swatch ${panel.color===c.color?'selected':''}`} style={{background:c.color}} aria-label={`${c.name} finish`} aria-pressed={panel.color===c.color} onClick={()=>onChange({color:c.color})}>{panel.color===c.color&&<Check size={15} color={c.color==='#414641'?'white':'#272823'}/>}</button>)}<label className="custom-color" title="Custom finish color"><input type="color" aria-label="Custom finish color" value={panel.color} onChange={e=>onChange({color:e.target.value})}/><span>+</span></label></div></div>
    <div className="field"><span>Surface</span><div className="pattern-options">{(['solid','pegboard','slots'] as Pattern[]).map(p=><button key={p} aria-pressed={panel.pattern===p} onClick={()=>onChange({pattern:p})} className={`pattern-choice ${panel.pattern===p?'selected':''}`}><span className={`pattern-sample ${p}`} aria-hidden="true"/><span>{p==='solid'?'Solid':p==='pegboard'?'Pegboard':'Slots'}</span></button>)}</div></div>
    {panel.pattern!=='solid'&&<div className="field-row"><NumberField label={panel.pattern==='slots'?'Slot width':'Hole diameter'} value={panel.holeSize} min={4} max={Math.min(40,panel.holeSpacing-6)} onChange={holeSize=>onChange({holeSize})}/><NumberField label="Spacing" value={panel.holeSpacing} min={Math.max(15,panel.holeSize+6,Math.ceil(Math.sqrt(panel.width*panel.height/4500)))} max={200} onChange={holeSpacing=>onChange({holeSpacing})}/></div>}
    {!compact&&<p className="field-note">Dimensions describe the panel before assembly.</p>}
  </>
}
