import { useRef, useState } from 'react'
import { ChevronDown, Link2, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import type { AssemblyParameter, Panel } from '@/lib/types'
import { assemblyParametersError } from '@/lib/assembly-parameters-validation'
import { Button } from './ui/button'
import { NumberField } from './fields'

const DIMENSIONS = ['width', 'height', 'thickness'] as const
const title = (value: string) => value[0].toUpperCase() + value.slice(1)
const rounded = (value: number) => Math.round(value * 1000) / 1000

/** A controlled draft: changes become model edits only when its enclosing form saves. */
export function AssemblyParametersEditor({ panels, parameters, onChange }: {
  panels: Panel[]; parameters: AssemblyParameter[]; onChange: (parameters: AssemblyParameter[]) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const editedDefaults = useRef(new Set(parameters.map(parameter => parameter.id)))
  const update = (id: string, patch: Partial<AssemblyParameter>) => onChange(parameters.map(parameter => parameter.id === id ? { ...parameter, ...patch } : parameter))
  const add = () => {
    let name = 'Side length', number = 1
    while (parameters.some(parameter => parameter.name.toLowerCase() === name.toLowerCase())) name = `Value ${++number}`
    const parameter: AssemblyParameter = { id: crypto.randomUUID(), name, defaultValue: 350, bindings: [] }
    onChange([...parameters, parameter]); setExpandedId(parameter.id)
  }
  const toggle = (parameter: AssemblyParameter, panel: Panel, dimension: typeof DIMENSIONS[number]) => {
    const exists = parameter.bindings.some(binding => binding.panelId === panel.id && binding.dimension === dimension)
    const defaultValue = parameter.bindings.length || editedDefaults.current.has(parameter.id) ? parameter.defaultValue : panel[dimension]
    const first = parameter.bindings[0], firstPanel = first && panels.find(item => item.id === first.panelId)
    // Keep the original size difference even if the user has already changed
    // the default. Equally sized panels should still share the same value.
    const originalValue = first && firstPanel ? (firstPanel[first.dimension] - first.offset) / first.scale : panel[dimension]
    update(parameter.id, exists
      ? { bindings: parameter.bindings.filter(binding => binding.panelId !== panel.id || binding.dimension !== dimension) }
      : { defaultValue, bindings: [...parameter.bindings, { panelId: panel.id, dimension, scale: 1, offset: rounded(panel[dimension] - originalValue) }] })
  }
  return <div className="assembly-parameters-editor" onKeyDown={event => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') { event.preventDefault(); event.target.blur() }
  }}>
    {!parameters.length && <p className="assembly-help">Add a value such as “Side length” and choose the panel dimensions it controls. Each instance can then have its own size.</p>}
    {parameters.map((parameter, index) => {
      const expanded = expandedId === parameter.id
      return <div className="assembly-parameter-card" key={parameter.id}>
        <div className="assembly-parameter-heading">
          <button type="button" className="assembly-parameter-toggle" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : parameter.id)}>
            <ChevronDown size={14}/><span><strong>{parameter.name || `Value ${index + 1}`}</strong><small>{rounded(parameter.defaultValue)} mm · {parameter.bindings.length} {parameter.bindings.length === 1 ? 'dimension' : 'dimensions'}</small></span>
          </button>
          <button type="button" className="assembly-parameter-remove" aria-label={`Remove ${parameter.name || `value ${index + 1}`}`} onClick={() => onChange(parameters.filter(item => item.id !== parameter.id))}><Trash2 size={14}/></button>
        </div>
        {expanded && <div className="assembly-parameter-body">
          <label className="field"><span>Value name</span><input aria-label="Value name" value={parameter.name} maxLength={60} placeholder="e.g. Width" onChange={event => update(parameter.id, { name: event.target.value })}/></label>
          <NumberField label="Default value" value={parameter.defaultValue} precision={3} min={0.01} max={10000} onChange={defaultValue => { editedDefaults.current.add(parameter.id); update(parameter.id, { defaultValue }) }}/>
          <div className="assembly-binding-label"><Link2 size={13}/><span>Dimensions controlled by this value</span></div>
          <p className="assembly-binding-note">Choose several to change them together. Panel dimensions are measured before assembly.</p>
          <div className="assembly-binding-list">
            {panels.map((panel, panelIndex) => <fieldset className="assembly-binding-panel" key={panel.id}>
              <legend>{panel.name}<span>#{panelIndex + 1}</span></legend>
              {DIMENSIONS.map(dimension => {
                const binding = parameter.bindings.find(item => item.panelId === panel.id && item.dimension === dimension)
                const owner = parameters.find(item => item.id !== parameter.id && item.bindings.some(target => target.panelId === panel.id && target.dimension === dimension))
                return <label key={dimension} className={`assembly-binding-option ${owner ? 'is-unavailable' : ''}`} title={owner ? `Controlled by ${owner.name}` : undefined}>
                  <input type="checkbox" aria-label={`${panel.name} ${dimension}`} checked={!!binding} disabled={!!owner} onChange={() => toggle(parameter, panel, dimension)}/>
                  <span>{title(dimension)}</span><small>{owner ? owner.name : `${rounded(binding ? parameter.defaultValue * binding.scale + binding.offset : panel[dimension])} mm`}</small>
                </label>
              })}
            </fieldset>)}
          </div>
          {parameter.bindings.some(binding => binding.offset !== 0 || binding.scale !== 1) && <p className="assembly-binding-note">Different starting sizes keep their difference. Adjust this under Relationships.</p>}
          {!!parameter.bindings.length && <details className="assembly-relationships"><summary>Relationships <span>optional</span></summary>
            <p className="assembly-binding-note">Panel dimension = value × multiplier + offset. Use 1 and 0 for matching lengths.</p>
            {parameter.bindings.map((binding, bindingIndex) => {
              const panel = panels.find(item => item.id === binding.panelId)
              return <div className="assembly-relationship" role="group" aria-label={`${panel?.name} ${binding.dimension} relationship`} key={`${binding.panelId}/${binding.dimension}`}>
                <strong>{panel?.name ?? 'Missing panel'} · {binding.dimension}</strong>
                <div className="field-row">
                  <NumberField label="Multiplier" value={binding.scale} precision={3} min={0.01} max={1000} step={0.01} unit="×" onChange={scale => update(parameter.id, { bindings: parameter.bindings.map((item, i) => i === bindingIndex ? { ...item, scale } : item) })}/>
                  <NumberField label="Offset" value={binding.offset} precision={3} min={-100000} max={100000} onChange={offset => update(parameter.id, { bindings: parameter.bindings.map((item, i) => i === bindingIndex ? { ...item, offset } : item) })}/>
                </div>
                <p>{parameter.name || 'Value'}{binding.scale !== 1 && ` × ${rounded(binding.scale)}`}{binding.offset !== 0 && ` ${binding.offset > 0 ? '+' : '−'} ${rounded(Math.abs(binding.offset))}`} = {rounded(parameter.defaultValue * binding.scale + binding.offset)} mm</p>
              </div>
            })}
          </details>}
        </div>}
      </div>
    })}
    <Button type="button" variant="outline" size="sm" className="full-button" onClick={add}><Plus size={14}/>Add editable value</Button>
  </div>
}

export function AssemblyParametersSection({ panels, parameters = [], onChange }: {
  panels: Panel[]; parameters?: AssemblyParameter[]; onChange: (parameters: AssemblyParameter[]) => boolean
}) {
  const [draft, setDraft] = useState<AssemblyParameter[] | null>(null)
  const error = draft ? assemblyParametersError(draft, panels) : undefined
  const save = () => {
    if (!draft || error) return
    if (onChange(draft.map(parameter => ({ ...parameter, name: parameter.name.trim() })))) setDraft(null)
  }
  return <section className="inspector-section assembly-parameters-section">
    <div className="section-title"><h2>Editable values</h2><SlidersHorizontal size={16}/></div>
    <p className="assembly-help">Choose which dimensions can be configured on each instance. Defaults apply to instances that have no custom value.</p>
    {draft ? <>
      <AssemblyParametersEditor panels={panels} parameters={draft} onChange={setDraft}/>
      {error && <p className="assembly-parameter-error" role="status">{error}</p>}
      <div className="assembly-parameter-actions"><Button type="button" size="sm" onClick={save} disabled={!!error}>Save values</Button><Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button></div>
    </> : <>
      {parameters.length > 0 && <ul className="assembly-parameter-summary">{parameters.map(parameter => <li key={parameter.id}><span><strong>{parameter.name}</strong><small>{parameter.bindings.length} linked {parameter.bindings.length === 1 ? 'dimension' : 'dimensions'}</small></span><span>{rounded(parameter.defaultValue)} mm</span></li>)}</ul>}
      <Button type="button" variant="outline" size="sm" className="full-button" onClick={() => setDraft(structuredClone(parameters))}>{parameters.length ? <Pencil size={14}/> : <Plus size={14}/>} {parameters.length ? 'Edit values' : 'Define editable values'}</Button>
    </>}
  </section>
}
