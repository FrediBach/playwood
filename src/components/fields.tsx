import { useEffect, useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { Material, Panel, Pattern } from '@/lib/types'
import { getSharedPanelFields } from '@/lib/selection'

export const MATERIALS: {id:Material;name:string;color:string;detail:string}[] = [
  {id:'birch',name:'Birch plywood',color:'#d9bb87',detail:'Light, layered & versatile'},
  {id:'oak',name:'Oak plywood',color:'#bc945e',detail:'A warm, natural grain'},
  {id:'walnut',name:'Walnut plywood',color:'#79563d',detail:'Rich & characterful'},
  {id:'mdf',name:'Natural MDF',color:'#bca17c',detail:'Smooth & uniform'},
  {id:'painted',name:'Painted board',color:'#e8e5db',detail:'Your color, your way'},
]
export const COLORS = [{name:'Natural',color:'#d9bb87'},{name:'Chalk',color:'#e8e5db'},{name:'Charcoal',color:'#414641'},{name:'Sage',color:'#94a18c'},{name:'Terracotta',color:'#bc6c50'},{name:'Blue gray',color:'#778b99'}]

export function NumberField({label,value,onChange,min=-10000,max=10000,step=1,unit='mm',disabled=false,mixed=false}: {
  label:string;value:number;onChange:(v:number)=>void;min?:number;max?:number;step?:number;unit?:string;disabled?:boolean;mixed?:boolean
}) {
  const [text,setText] = useState(String(Math.round(value*10)/10))
  const id=useId()
  const unavailable=disabled||mixed
  useEffect(()=>setText(mixed?'':String(Math.round(value*10)/10)),[value,mixed])
  const commit=()=>{
    if(unavailable)return
    const n=Number(text)
    if(text.trim()&&Number.isFinite(n)){
      const v=Math.max(min,Math.min(max,n));onChange(v);setText(String(Math.round(v*10)/10))
    }else setText(String(value))
  }
  return <label className={`field ${unavailable?'field-disabled':''}`} htmlFor={id}>
    <span>{label}</span>
    <div className="number-wrap">
      <input id={id} aria-label={label} type="number" value={mixed?'':text} placeholder={mixed?'Mixed':undefined}
        title={mixed?'Different values in the selection':undefined} min={min} max={max} step={step} disabled={unavailable}
        onChange={e=>{if(unavailable)return;const text=e.target.value;setText(text);const n=Number(text);if(text.trim()&&Number.isFinite(n)&&n>=min&&n<=max)onChange(n)}}
        onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
      {!mixed&&<span className="input-unit">{unit}</span>}
    </div>
  </label>
}

export function SelectField({label,value,onChange,children,disabled=false,mixed=false}: {
  label:string;value:string;onChange:(v:string)=>void;children:ReactNode;disabled?:boolean;mixed?:boolean
}) {
  const id=useId()
  const unavailable=disabled||mixed
  return <label className={`field ${unavailable?'field-disabled':''}`} htmlFor={id}>
    <span>{label}</span>
    <div className="select-wrap">
      <select id={id} aria-label={label} value={mixed?'__mixed__':value} disabled={unavailable} title={mixed?'Different values in the selection':undefined}
        onChange={e=>{if(!unavailable)onChange(e.target.value)}}>
        {mixed&&<option value="__mixed__">Mixed</option>}{children}
      </select>
      <ChevronDown size={14}/>
    </div>
  </label>
}

export function PanelFields({panel,panels,onChange:applyChange,compact=false,disabledFields=[]}: {
  panel:Panel;panels?:Panel[];onChange:(v:Partial<Panel>)=>void;compact?:boolean;disabledFields?:readonly (keyof Panel)[]
}) {
  const selection=panels?.length?panels:[panel]
  const shared=getSharedPanelFields(selection)
  const mixed=(key:keyof Panel)=>!shared.has(key)
  const disabled=(key:keyof Panel)=>disabledFields.includes(key)||mixed(key)
  const patternMixed=mixed('pattern')
  const colorMixed=mixed('color')
  const onChange=(change:Partial<Panel>)=>{
    const patch=Object.fromEntries(Object.entries(change).filter(([key])=>!disabled(key as keyof Panel))) as Partial<Panel>
    if(!Object.keys(patch).length)return
    // Automatic adjustments must never overwrite a disabled, differing value.
    if(!disabled('holeSpacing')&&!patternMixed){
      const minPitch=Math.max(...selection.map(p=>{
        const next={...p,...patch}
        return next.pattern==='solid'?next.holeSpacing:Math.max(next.holeSpacing,15,next.holeSize+6,Math.ceil(Math.sqrt(next.width*next.height/4500)))
      }))
      if(minPitch>selection[0].holeSpacing)patch.holeSpacing=minPitch
    }
    applyChange(patch)
  }
  const numberProps=(key:keyof Panel)=>({mixed:mixed(key),disabled:disabledFields.includes(key)})
  const showPerforations=selection.some(p=>p.pattern!=='solid')
  const holeControlsDisabled=patternMixed||selection.some(p=>p.pattern==='solid')
  const maxHoleSize=Math.min(40,...selection.map(p=>p.holeSpacing-6))
  const minSpacing=Math.max(...selection.map(p=>Math.max(15,p.holeSize+6,Math.ceil(Math.sqrt(p.width*p.height/4500)))))
  const finishName=colorMixed?'Mixed':COLORS.find(c=>c.color.toLowerCase()===panel.color.toLowerCase())?.name || (MATERIALS.some(m=>m.color===panel.color)||['#d9bd8c','#b88b54','#76523b','#ae9677'].includes(panel.color)?'Natural':'Custom')
  return <>
    <div className="field-row">
      <NumberField label="Width" value={panel.width} min={80} max={3000} {...numberProps('width')} onChange={width=>onChange({width})}/>
      <NumberField label="Height" value={panel.height} min={80} max={3000} {...numberProps('height')} onChange={height=>onChange({height})}/>
      <NumberField label="Thickness" value={panel.thickness} min={3} max={60} {...numberProps('thickness')} onChange={thickness=>onChange({thickness})}/>
    </div>
    <SelectField label="Material" value={panel.material} mixed={mixed('material')} disabled={disabledFields.includes('material')}
      onChange={v=>{const m=MATERIALS.find(m=>m.id===v)!;onChange({material:m.id,...(!disabled('color')?{color:m.color}:{})})}}>
      {MATERIALS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
    </SelectField>
    <div className={`field ${disabled('color')?'field-disabled':''}`}>
      <span>Finish <span className="field-hint">{finishName}</span></span>
      <div className="swatches">
        {COLORS.map(c=>{
          const selected=!colorMixed&&panel.color.toLowerCase()===c.color.toLowerCase()
          return <button key={c.color} className={`swatch ${selected?'selected':''}`} style={{background:c.color}}
            disabled={disabled('color')} aria-label={`${c.name} finish`} aria-pressed={selected} onClick={()=>onChange({color:c.color})}>
            {selected&&<Check size={15} color={c.color==='#414641'?'white':'#272823'}/>}
          </button>
        })}
        <label className="custom-color" title={colorMixed?'Different finish colors in the selection':'Custom finish color'}>
          <input type="color" aria-label="Custom finish color" disabled={disabled('color')} value={colorMixed?'#808080':panel.color} onChange={e=>onChange({color:e.target.value})}/><span>+</span>
        </label>
      </div>
    </div>
    <div className={`field ${disabled('pattern')?'field-disabled':''}`}>
      <span>Surface{patternMixed&&<span className="field-hint">Mixed</span>}</span>
      <div className="pattern-options">
        {(['solid','pegboard','slots'] as Pattern[]).map(p=>{
          const selected=!patternMixed&&panel.pattern===p
          return <button key={p} disabled={disabled('pattern')} aria-pressed={selected} onClick={()=>onChange({pattern:p})} className={`pattern-choice ${selected?'selected':''}`}>
            <span className={`pattern-sample ${p}`} aria-hidden="true"/><span>{p==='solid'?'Solid':p==='pegboard'?'Pegboard':'Slots'}</span>
          </button>
        })}
      </div>
    </div>
    {showPerforations&&<div className="field-row">
      <NumberField label={!patternMixed&&panel.pattern==='slots'?'Slot width':'Hole diameter'} value={panel.holeSize} min={4} max={maxHoleSize}
        mixed={mixed('holeSize')} disabled={disabledFields.includes('holeSize')||holeControlsDisabled} onChange={holeSize=>onChange({holeSize})}/>
      <NumberField label="Spacing" value={panel.holeSpacing} min={minSpacing} max={Math.max(200,minSpacing)}
        mixed={mixed('holeSpacing')} disabled={disabledFields.includes('holeSpacing')||holeControlsDisabled} onChange={holeSpacing=>onChange({holeSpacing})}/>
    </div>}
    {!compact&&<p className="field-note">Dimensions describe the panel before assembly.</p>}
  </>
}
