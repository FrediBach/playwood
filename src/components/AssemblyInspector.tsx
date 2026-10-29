import { useState } from 'react'
import { Box, Copy, Link2, Pencil, Plus, RotateCcw, Trash2, Ungroup, Unlink } from 'lucide-react'
import { Button } from './ui/button'
import { NumberField } from './fields'
import { AssemblyParametersEditor, assemblyParametersError } from './AssemblyParametersEditor'
import { getAssemblyParameterRange } from '@/lib/assembly-parameters'
import type { AssemblyParameter, Panel } from '@/lib/types'
import './assemblies.css'

export interface AssemblyInspectorProps {
  name: string
  definitionName: string
  instanceCount: number
  panelCount: number
  color: string
  hasColorOverride: boolean
  parameters?: AssemblyParameter[]
  parameterValues?: Record<string, number>
  onParameterChange?: (id: string, value: number) => boolean
  onResetParameters?: () => void
  connected?: boolean
  attachmentTargets?: { id: string; name: string }[]
  attachmentActive?: boolean
  canAttachCopy?: boolean
  attachmentMessage?: string
  onRename: (name: string) => void
  onColorChange: (color: string) => void
  onResetColor: () => void
  onDuplicate: () => void
  onAttachCopy: () => void
  onAttachExisting: (id: string) => void
  onEdit: () => void
  onDisconnect: () => void
  onMakeIndependent: () => void
  onDisassemble: () => void
  onDelete: () => void
  onCancelAttach?: () => void
}

export function AssemblyInspector({ name, definitionName, instanceCount, panelCount, color, hasColorOverride, parameters = [], parameterValues = {}, onParameterChange, onResetParameters, connected, attachmentTargets = [], attachmentActive, canAttachCopy = true, attachmentMessage, onRename, onColorChange, onResetColor, onDuplicate, onAttachCopy, onAttachExisting, onEdit, onDisconnect, onMakeIndependent, onDisassemble, onDelete, onCancelAttach }: AssemblyInspectorProps) {
  const isCustom = (id: string) => Object.hasOwn(parameterValues, id)
  const hasParameterOverrides = parameters.some(parameter => isCustom(parameter.id))
  return <>
    <div className="selected-heading"><Box size={15}/><span>ASSEMBLY INSTANCE</span></div>
    <label className="field panel-name-field"><span>Instance name</span><input key={name} aria-label="Instance name" defaultValue={name} maxLength={120}
      onBlur={event => { const value = event.target.value.trim(); if (value && value !== name) onRename(value) }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label>
    <div className="assembly-definition-note"><Box size={17}/><div><strong>{definitionName}</strong><span>{panelCount} panels · {instanceCount} linked {instanceCount === 1 ? 'instance' : 'instances'}</span></div></div>
    <Button variant="outline" className="full-button" onClick={onEdit}><Pencil size={15}/>Edit assembly</Button>
    <p className="assembly-help">Edit shared construction and choose the values each instance can configure.</p>

    {parameters.length > 0 && <section className="inspector-section assembly-instance-values" aria-label="Instance values">
      <div className="section-title"><h2>Instance values</h2><span>mm</span></div>
      {parameters.map(parameter => <div className="assembly-instance-value" key={parameter.id}>
        <NumberField label={parameter.name} value={isCustom(parameter.id) ? parameterValues[parameter.id] : parameter.defaultValue} precision={3} {...getAssemblyParameterRange(parameter)} commitOnBlur disabled={!onParameterChange} onChange={value => onParameterChange?.(parameter.id, value)}/>
        <p>{parameter.bindings.length} linked {parameter.bindings.length === 1 ? 'dimension' : 'dimensions'}{isCustom(parameter.id) && <span>Custom</span>}</p>
      </div>)}
      <p className="assembly-help">Sizes change only for this instance. Connected neighbors may move to keep shared connectors aligned.</p>
      <p className="assembly-help">Values describe panel cut lengths; overall size includes connector clearances.</p>
      {hasParameterOverrides && onResetParameters && <button type="button" className="assembly-reset-values" onClick={onResetParameters}><RotateCcw size={13}/>Reset to assembly defaults</button>}
    </section>}

    <section className="inspector-section assembly-finish-section"><div className="section-title"><h2>This instance</h2><span>LOCAL</span></div>
      <label className="assembly-color-field"><span>Panel color</span><input type="color" aria-label="Instance panel color" value={color} onChange={event => onColorChange(event.target.value)}/></label>
      <div className="assembly-override-status"><span>{hasColorOverride ? 'Custom color' : 'Using assembly color'}</span>{hasColorOverride && <button onClick={onResetColor}><RotateCcw size={12}/>Reset</button>}</div>
      <p className="assembly-help">Color affects only this instance.</p>
    </section>

    <section className="inspector-section"><div className="section-title"><h2>Keep building</h2><Link2 size={16}/></div>
      {attachmentActive ? <div className="assembly-placement-note" role="status"><strong>Choose a connection</strong><p>{attachmentMessage || 'Hover a + in the workspace to preview. Click to attach.'}</p>{onCancelAttach && <Button variant="ghost" size="sm" onClick={onCancelAttach}>Cancel attachment</Button>}</div> : <>
        <Button className="full-button" onClick={onAttachCopy} disabled={!canAttachCopy}><Plus size={16}/>Attach a copy</Button>
        <p className="assembly-help">{canAttachCopy ? 'Choose a + in the workspace. Connectors are fitted automatically.' : attachmentMessage || 'No compatible connection is available. Duplicate this instance for free placement.'}</p>
        {attachmentTargets.length > 0 && <label className="field"><span>Attach an existing instance</span><select aria-label="Attach an existing instance" value="" onChange={event => { if (event.target.value) onAttachExisting(event.target.value) }}><option value="" disabled>Choose an instance…</option>{attachmentTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
      </>}
    </section>

    <div className="panel-actions assembly-primary-actions"><Button variant="outline" size="sm" onClick={onDuplicate}><Copy size={15}/>Duplicate</Button><Button variant="ghost" size="icon" aria-label="Delete assembly instance" className="delete-button" onClick={onDelete}><Trash2 size={16}/></Button></div>
    <div className="assembly-secondary-actions">{connected && <button onClick={onDisconnect}><Unlink size={13}/>Disconnect from neighbors</button>}<button onClick={onMakeIndependent}><Box size={13}/>Make independent</button></div>
    <p className="assembly-help">Make independent gives this instance its own assembly design. Its panels and physical connections stay in place.</p>
    <div className="assembly-secondary-actions"><button onClick={onDisassemble}><Ungroup size={13}/>Disassemble</button></div>
    <p className="assembly-help">Turn this instance into separate, editable panels. Panels and connectors stay in place.</p>
  </>
}

export function CreateAssemblyForm({ panelCount, panels = [], onCreate, disabled = false, reason }: { panelCount: number; panels?: Panel[]; onCreate: (name: string, parameters: AssemblyParameter[]) => void; disabled?: boolean; reason?: string }) {
  const [name, setName] = useState('My assembly')
  const [parameters, setParameters] = useState<AssemblyParameter[]>([])
  const error = assemblyParametersError(parameters, panels)
  return <section className="create-assembly-section"><div className="section-title"><h2>Build once. Use again.</h2><Box size={17}/></div>
    <p className="assembly-help">Turn these {panelCount} panels into a reusable assembly with linked copies.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); if (!disabled && !error && name.trim()) onCreate(name.trim(), parameters.map(parameter => ({ ...parameter, name: parameter.name.trim() }))) }}>
      <label className="field"><span>Assembly name</span><input aria-label="Assembly name" value={name} maxLength={120} onChange={event => setName(event.target.value)}/></label>
      {!!panels.length && <details className="assembly-create-values"><summary>Editable values <span>{parameters.length || 'optional'}</span></summary>
        <AssemblyParametersEditor panels={panels} parameters={parameters} onChange={setParameters}/>
      </details>}
      {error && <p className="assembly-parameter-error" role="status">{error}</p>}
      <Button type="submit" variant="outline" className="full-button" disabled={disabled || !!error || !name.trim()}><Box size={16}/>Create assembly</Button>
    </form>{reason && <p className="assembly-help">{reason}</p>}
  </section>
}
