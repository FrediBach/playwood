import { MATERIALS } from '@/lib/materials'
import { roundNiceValue } from '@/lib/nice-values'
import { panelCornerRadius } from '@/lib/panel-shape'
import { getSharedPanelFields } from '@/lib/selection'
import type { Panel,Pattern } from '@/lib/types'
import { ChevronDown } from 'lucide-react'
import { useId,useState,type ReactNode } from 'react'
import { FinishCoverageField } from './FinishCoverageField'
import { PanelColorField } from './PanelColorField'
import { PanelOutlineControl } from './PanelOutlineEditor'
import { useNiceValueStep } from './nice-values-context'

export function NumberField({label,value,onChange,min=-10000,max=10000,step=1,unit='mm',disabled=false,mixed=false,commitOnBlur=false,precision=1,nice=true}: {
  label:string;value:number;onChange:(v:number)=>boolean|void;min?:number;max?:number;step?:number;unit?:string;disabled?:boolean;mixed?:boolean;commitOnBlur?:boolean;precision?:number;nice?:boolean
}) {
  const niceStep=useNiceValueStep()
  const rounding=nice&&unit==='mm'?niceStep:undefined
  const deferred=commitOnBlur||rounding!==undefined
  // Native number spinners use min as their step origin. Align that origin to
  // zero-based nice multiples too (for example width min 80 with 25 mm steps).
  const { displayScale,firstNice,lastNice }=numberInputScale(rounding,min,max,precision)
  const [text,setText] = useState(mixed?'':String(Math.round(value*displayScale)/displayScale))
  const [error,setError] = useState('')
  const [edited,setEdited]=useState(false)
  const [source,setSource]=useState({value,mixed,displayScale,rounding})
  const id=useId()
  const unavailable=disabled||mixed
  // Reset before children render, retaining the input node and its focus.
  if(!Object.is(source.value,value)||source.mixed!==mixed||source.displayScale!==displayScale||source.rounding!==rounding) {
    setSource({value,mixed,displayScale,rounding})
    setText(mixed?'':String(Math.round(value*displayScale)/displayScale))
    setEdited(false)
    setError('')
  }
  const commit=createNumberCommit(unavailable,edited,setEdited,text,rounding,min,max,onChange,setText,value,displayScale,setError)
  return <label className={`field ${unavailable?'field-disabled':''}`} htmlFor={id}>
    <span>{label}</span>
    <NumberInput id={id} label={label} mixed={mixed} text={text} rounding={rounding} firstNice={firstNice} lastNice={lastNice} min={min} max={max} step={step} unavailable={unavailable} error={error} setEdited={setEdited} setText={setText} setError={setError} deferred={deferred} onChange={onChange} value={value} displayScale={displayScale} commit={commit} unit={unit}/>
    {error&&<span id={`${id}-error`} className="error-message" role="alert">{error}</span>}
  </label>
}

function NumberInput({ id, label, mixed, text, rounding, firstNice, lastNice, min, max, step, unavailable, error, setEdited, setText, setError, deferred, onChange, value, displayScale, commit, unit }: { id: string; label: string; mixed: boolean; text: string; rounding: number|undefined; firstNice: number; lastNice: number; min: number; max: number; step: number; unavailable: boolean; error: string; setEdited: React.Dispatch<React.SetStateAction<boolean>>; setText: React.Dispatch<React.SetStateAction<string>>; setError: React.Dispatch<React.SetStateAction<string>>; deferred: boolean; onChange: (v: number) => boolean|void; value: number; displayScale: number; commit: () => void; unit: string })  {
  return <div className="number-wrap">
    <input
    id={id}
    aria-label={label}
    type="number"
    value={mixed? '':text}
    placeholder={mixed? 'Mixed':undefined}
    title={mixed? 'Different values in the selection':rounding? `Rounds to ${rounding} mm on Enter or leaving the field`:undefined}
    min={firstNice<=lastNice? firstNice:min}
    max={firstNice<=lastNice? lastNice:max}
    step={rounding??step}
    disabled={unavailable}
    aria-invalid={!!error}
    aria-describedby={error? `${id}-error`:undefined}
    onChange={createNumberChange(unavailable,setEdited,setText,setError,deferred,min,max,onChange,value,displayScale)}
    onBlur={commit}
    onKeyDown={e => { if(e.key==='Enter') { e.preventDefault(); e.currentTarget.blur()}  } } />
    {!mixed&&<span className="input-unit">{unit}</span>}
  </div>
}

function createNumberChange(unavailable: boolean,setEdited: React.Dispatch<React.SetStateAction<boolean>>,setText: React.Dispatch<React.SetStateAction<string>>,setError: React.Dispatch<React.SetStateAction<string>>,deferred: boolean,min: number,max: number,onChange: (v: number) => boolean|void,value: number,displayScale: number) {
  return (e: React.ChangeEvent<HTMLInputElement>) => { if(unavailable) return; const text=e.target.value; setEdited(true); setText(text); setError(''); const n=Number(text); if(!deferred&&text.trim()&&Number.isFinite(n)&&n>=min&&n<=max) { setEdited(false); if(onChange(n)===false) setText(String(Math.round(value*displayScale)/displayScale))}  }
}

function numberInputScale(rounding: number|undefined,min: number,max: number,precision: number) {
  const firstNice=rounding===undefined? min:Number((Math.ceil(min/rounding-1e-9)*rounding).toFixed(9))
  const lastNice=rounding===undefined? max:Number((Math.floor(max/rounding+1e-9)*rounding).toFixed(9))
  const displayScale=10**Math.max(precision,rounding===undefined? 0:(String(rounding).split('.')[1]?.length??0))
  return { displayScale,firstNice,lastNice }
}

function createNumberCommit(unavailable: boolean,edited: boolean,setEdited: React.Dispatch<React.SetStateAction<boolean>>,text: string,rounding: number|undefined,min: number,max: number,onChange: (v: number) => boolean|void,setText: React.Dispatch<React.SetStateAction<string>>,value: number,displayScale: number,setError: React.Dispatch<React.SetStateAction<string>>) {
  return () => {
    // Display precision must not become a model edit just because a user tabs
    // through the field. In particular, rotated coordinates retain their value.
    if(unavailable||!edited) return
    setEdited(false)
    const n=Number(text)
    if(text.trim()&&Number.isFinite(n)) {
      try {
        const v=rounding===undefined? Math.max(min,Math.min(max,n)):roundNiceValue(n,rounding,min,max)
        const accepted=onChange(v)!==false
        setText(String(Math.round((accepted? v:value)*displayScale)/displayScale))
      } catch(cause) {
        setText(String(Math.round(value*displayScale)/displayScale))
        setError(cause instanceof Error? cause.message:'This value is unavailable.')
      }
    } else setText(String(value))
  }
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

export function PanelFields({panel,panels,onChange:applyChange,compact=false,disabledFields=[],resizeOnCommit=false,group}: {
  panel:Panel;panels?:Panel[];onChange:(v:Partial<Panel>)=>boolean|void;compact?:boolean;resizeOnCommit?:boolean;disabledFields?:readonly (keyof Panel)[];group?:'dimensions'|'shape'|'appearance'
}) {
  const selection=panels?.length?panels:[panel]
  const shared=getSharedPanelFields(selection)
  const mixed=(key:keyof Panel)=>!shared.has(key)
  const disabled=(key:keyof Panel)=>disabledFields.includes(key)||mixed(key)
  const patternMixed=mixed('pattern')
  const colorMixed=mixed('color')
  const finishCoverage=panel.material==='painted'?1:panel.finishCoverage??0
  const finishCoverageMixed=selection.some(p=>(p.material==='painted'?1:p.finishCoverage??0)!==finishCoverage)
  const allPainted=selection.every(p=>p.material==='painted')
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
    return applyChange(patch)
  }
  const numberProps=(key:keyof Panel)=>({mixed:mixed(key),disabled:disabledFields.includes(key)})
  const showPerforations=selection.some(p=>p.pattern!=='solid')
  const holeControlsDisabled=patternMixed||selection.some(p=>p.pattern==='solid')
  const maxHoleSize=Math.min(40,...selection.map(p=>p.holeSpacing-6))
  const minSpacing=Math.max(...selection.map(p=>Math.max(15,p.holeSize+6,Math.ceil(Math.sqrt(p.width*p.height/4500)))))
  return <>
    {(!group || group==='dimensions') && <><div className="field-row">
      <NumberField label="Width" commitOnBlur={resizeOnCommit} value={panel.width} min={80} max={3000} {...numberProps('width')} onChange={width=>onChange({width})}/>
      <NumberField label="Height" commitOnBlur={resizeOnCommit} value={panel.height} min={80} max={3000} {...numberProps('height')} onChange={height=>onChange({height})}/>
      <NumberField label="Thickness" nice={false} value={panel.thickness} min={3} max={60} {...numberProps('thickness')} onChange={thickness=>onChange({thickness})}/>
    </div>
    {!compact&&<p className="field-note">Panel cut dimensions, before assembly.</p>}
    </>}
    <PanelShapeFields group={group} panel={panel} selection={selection} numberProps={numberProps} onChange={onChange} disabledFields={disabledFields} applyChange={applyChange} disabled={disabled} patternMixed={patternMixed} showPerforations={showPerforations} maxHoleSize={maxHoleSize} mixed={mixed} holeControlsDisabled={holeControlsDisabled} minSpacing={minSpacing}/>
    <PanelAppearanceFields group={group} panel={panel} mixed={mixed} disabledFields={disabledFields} onChange={onChange} disabled={disabled} colorMixed={colorMixed} selection={selection} finishCoverage={finishCoverage} finishCoverageMixed={finishCoverageMixed} allPainted={allPainted}/>
  </>
}

function PanelAppearanceFields({ group, panel, mixed, disabledFields, onChange, disabled, colorMixed, selection, finishCoverage, finishCoverageMixed, allPainted }: { group: string|undefined; panel: Panel; mixed: (key: keyof Panel) => boolean; disabledFields: readonly (keyof Panel)[]; onChange: (change: Partial<Panel>) => boolean|void; disabled: (key: keyof Panel) => boolean; colorMixed: boolean; selection: Panel[]; finishCoverage: number; finishCoverageMixed: boolean; allPainted: boolean })  {
  return (!group||group==='appearance')&&<>
    <SelectField label="Material" value={panel.material} mixed={mixed('material')} disabled={disabledFields.includes('material')}
      onChange={v => { const m=MATERIALS.find(m => m.id===v)!; onChange({ material: m.id,...(!disabled('color')? { color: m.color }:{}) }) } }>
      {MATERIALS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </SelectField>
    <PanelColorField color={panel.color} mixed={colorMixed} disabled={disabled('color')} onChange={color => onChange({ color })} />
    <FinishCoverageField key={`finish:${selection.map(p => p.id).join(':')}`} value={finishCoverage} mixed={finishCoverageMixed}
      disabled={allPainted||disabled('finishCoverage')} onChange={finishCoverage => onChange({ finishCoverage })} />
  </>
}

function PanelShapeFields({ group, panel, selection, numberProps, onChange, disabledFields, applyChange, disabled, patternMixed, showPerforations, maxHoleSize, mixed, holeControlsDisabled, minSpacing }: { group: string|undefined; panel: Panel; selection: Panel[]; numberProps: (key: keyof Panel) => { mixed: boolean; disabled: boolean }; onChange: (change: Partial<Panel>) => boolean|void; disabledFields: readonly (keyof Panel)[]; applyChange: (v: Partial<Panel>) => boolean|void; disabled: (key: keyof Panel) => boolean; patternMixed: boolean; showPerforations: boolean; maxHoleSize: number; mixed: (key: keyof Panel) => boolean; holeControlsDisabled: boolean; minSpacing: number })  {
  return (!group||group==='shape')&&<>
    <NumberField label="Corner radius" value={panelCornerRadius(panel)} min={0} max={Math.min(...selection.map(p => Math.min(p.width,p.height)/2))} {...numberProps('cornerRadius')} onChange={cornerRadius => onChange({ cornerRadius })} />
    {selection.length===1&&!disabledFields.includes('customOutline')&&<PanelOutlineControl key={panel.id} panel={panel} onChange={applyChange} />}
    <div className={`field ${disabled('pattern')? 'field-disabled':''}`}>
      <span>Surface{patternMixed&&<span className="field-hint">Mixed</span>}</span>
      <div className="pattern-options">
        {(['solid','pegboard','slots'] as Pattern[]).map(p => {
          const selected=!patternMixed&&panel.pattern===p
          return <button key={p} disabled={disabled('pattern')} aria-pressed={selected} onClick={() => onChange({ pattern: p })} className={`pattern-choice ${selected? 'selected':''}`}>
            <span className={`pattern-sample ${p}`} aria-hidden="true" /><span>{p==='solid'? 'Solid':p==='pegboard'? 'Pegboard':'Slots'}</span>
          </button>
        })}
      </div>
    </div>
    {showPerforations&&<div className="field-row">
      <NumberField label={!patternMixed&&panel.pattern==='slots'? 'Slot width':'Hole diameter'} value={panel.holeSize} min={4} max={maxHoleSize}
        mixed={mixed('holeSize')} disabled={disabledFields.includes('holeSize')||holeControlsDisabled} onChange={holeSize => onChange({ holeSize })} />
      <NumberField label="Spacing" value={panel.holeSpacing} min={minSpacing} max={Math.max(200,minSpacing)}
        mixed={mixed('holeSpacing')} disabled={disabledFields.includes('holeSpacing')||holeControlsDisabled} onChange={holeSpacing => onChange({ holeSpacing })} />
    </div>}
  </>
}
