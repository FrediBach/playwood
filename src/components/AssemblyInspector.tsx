import { getAssemblyParameterRange } from '@/lib/assembly-parameters'
import { assemblyParametersError } from '@/lib/assembly-parameters-validation'
import type { AssemblyParameter,Panel } from '@/lib/types'
import { Box,Copy,Download,Link2,Pencil,Plus,RotateCcw,Trash2,Ungroup,Unlink } from 'lucide-react'
import { useState,type ReactNode } from 'react'
import './assemblies.css'
import { AssemblyParametersEditor } from './AssemblyParametersEditor'
import { NumberField } from './fields'
import { FinishCoverageField } from './FinishCoverageField'
import './inspector-assembly.css'
import { InspectorDisclosure } from './InspectorPrimitives'
import { PanelColorField } from './PanelColorField'
import { Button } from './ui/button'

export interface AssemblyInspectorProps {
  name: string
  definitionName: string
  instanceCount: number
  panelCount: number
  color: string
  hasColorOverride: boolean
  finishCoverage?: number
  finishCoverageMixed?: boolean
  finishCoverageDisabled?: boolean
  hasFinishCoverageOverride?: boolean
  onFinishCoverageChange?: (coverage: number) => void
  onResetFinishCoverage?: () => void
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
  onExport: () => void
  onAttachCopy: () => void
  onAttachExisting: (id: string) => void
  onEdit: () => void
  onDisconnect: () => void
  onMakeIndependent: () => void
  onDisassemble: () => void
  onDelete: () => void
  onCancelAttach?: () => void
  buildTools?: ReactNode
}

export function AssemblyInspector({
  name, definitionName, instanceCount, panelCount,
  color, hasColorOverride, finishCoverage = 0, finishCoverageMixed = false,
  finishCoverageDisabled = false, hasFinishCoverageOverride = false, onFinishCoverageChange, onResetFinishCoverage,
  parameters = [], parameterValues = {}, onParameterChange, onResetParameters,
  connected, attachmentTargets = [], attachmentActive, canAttachCopy = true,
  attachmentMessage, onRename, onColorChange, onResetColor,
  onDuplicate, onExport, onAttachCopy, onAttachExisting,
  onEdit, onDisconnect, onMakeIndependent, onDisassemble,
  onDelete, buildTools
}: AssemblyInspectorProps) {
  const isCustom = (id: string) => Object.hasOwn(parameterValues, id)
  const hasParameterOverrides = parameters.some(parameter => isCustom(parameter.id))
  const appearanceSummary = [hasColorOverride ? 'Custom color' : 'Assembly color', finishCoverageMixed ? 'Mixed finish' : `${Math.round(finishCoverage * 100)}% finish${hasFinishCoverageOverride ? ' · Custom' : ''}`].join(' · ')

  if (attachmentActive) return <div className="assembly-attachment-task">
    <div className="selected-heading"><Link2 size={15}/><span>ATTACH ASSEMBLY</span></div>
    <div className="multi-selection-heading"><h2>Attach to {name}</h2><p>{definitionName} · {panelCount} panels</p></div>
    <div className="assembly-placement-note" role="status"><strong>Choose a connection</strong><p>{attachmentMessage || 'Hover a + in the workspace to preview. Click to attach.'}</p></div>
  </div>

  return <>
    <div className="selected-heading"><Box size={15}/><span>ASSEMBLY INSTANCE</span></div>
    <label className="field panel-name-field"><span>Instance name</span><input key={name} aria-label="Instance name" defaultValue={name} maxLength={120}
      onBlur={event => { const value = event.target.value.trim(); if (value && value !== name) onRename(value) }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}/></label>
    <div className="assembly-design-reference">
      <div className="assembly-definition-note"><Box size={17}/><div><strong>{definitionName}</strong><span>{panelCount} panels · {instanceCount} linked {instanceCount === 1 ? 'instance' : 'instances'}</span></div></div>
      <button type="button" className="assembly-edit-design" aria-describedby="assembly-edit-scope" onClick={onEdit}><Pencil size={13}/>Edit shared design</button>
      <span id="assembly-edit-scope" className="visually-hidden">Changes the shared construction of {instanceCount} linked {instanceCount === 1 ? 'instance' : 'instances'}.</span>
    </div>
    <p className="inspector-scope">{parameters.length ? 'Values and appearance affect' : 'Appearance affects'} only this instance.</p>

    <AssemblyInstanceValues parameters={parameters} isCustom={isCustom} parameterValues={parameterValues} onParameterChange={onParameterChange} connected={connected} hasParameterOverrides={hasParameterOverrides} onResetParameters={onResetParameters}/>

    <AssemblyAppearance hasColorOverride={hasColorOverride} hasFinishCoverageOverride={hasFinishCoverageOverride} appearanceSummary={appearanceSummary} color={color} onColorChange={onColorChange} onResetColor={onResetColor} onFinishCoverageChange={onFinishCoverageChange} name={name} finishCoverage={finishCoverage} finishCoverageMixed={finishCoverageMixed} finishCoverageDisabled={finishCoverageDisabled} onResetFinishCoverage={onResetFinishCoverage}/>

    <AssemblyConnections onAttachCopy={onAttachCopy} canAttachCopy={canAttachCopy} attachmentMessage={attachmentMessage} attachmentTargets={attachmentTargets} onAttachExisting={onAttachExisting} connected={connected} onDisconnect={onDisconnect}/>

    {buildTools}

    <InspectorDisclosure title="Manage assembly" summary="Export, make independent, disassemble" preferenceKey="assembly-management" className="inspector-management">
      <div className="inspector-action-list">
        <div><Button variant="outline" size="sm" className="full-button" onClick={onExport}><Download size={15}/>Export assembly</Button><p className="field-note">Save a reusable file with these values and colors as its defaults.</p></div>
        <div><Button variant="ghost" size="sm" onClick={onMakeIndependent}><Box size={14}/>Make independent</Button><p className="field-note">Give this instance its own design. Panels and physical connections stay in place.</p></div>
        <div><Button variant="ghost" size="sm" onClick={onDisassemble}><Ungroup size={14}/>Disassemble</Button><p className="field-note">Turn this instance into separate editable panels. Panels and connectors stay in place.</p></div>
      </div>
    </InspectorDisclosure>
    <div className="panel-actions assembly-primary-actions"><Button variant="outline" size="sm" onClick={onDuplicate}><Copy size={15}/>Duplicate</Button><Button variant="ghost" size="icon" aria-label="Delete assembly instance" className="delete-button" onClick={onDelete}><Trash2 size={16}/></Button></div>
  </>
}

const EMPTY_PANELS: Panel[] = []

function AssemblyConnections({ onAttachCopy, canAttachCopy, attachmentMessage, attachmentTargets, onAttachExisting, connected, onDisconnect }: { onAttachCopy: () => void; canAttachCopy: boolean; attachmentMessage: string|undefined; attachmentTargets: { id: string; name: string }[]; onAttachExisting: (id: string) => void; connected: boolean|undefined; onDisconnect: () => void })  {
  return <section className="inspector-section assembly-connections"><div className="section-title"><h2>Connections</h2><Link2 size={16} /></div>
    <Button className="full-button" onClick={onAttachCopy} disabled={!canAttachCopy}><Plus size={16} />Attach a copy</Button>
    <p className="field-note">{canAttachCopy? 'Choose a + in the workspace to preview its connection.':attachmentMessage||'No compatible connection is available. Duplicate this instance for free placement.'}</p>
    {attachmentTargets.length>0&&<label className="field"><span>Attach an existing instance</span><select aria-label="Attach an existing instance" value="" onChange={event => { if(event.target.value) onAttachExisting(event.target.value) } }><option value="" disabled>Choose an instance…</option>{attachmentTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>}
    {connected&&<Button variant="ghost" size="sm" onClick={onDisconnect}><Unlink size={13} />Disconnect from neighbors</Button>}
  </section>
}

function AssemblyAppearance({
  hasColorOverride, hasFinishCoverageOverride, appearanceSummary, color,
  onColorChange, onResetColor, onFinishCoverageChange, name,
  finishCoverage, finishCoverageMixed, finishCoverageDisabled, onResetFinishCoverage
}: { hasColorOverride: boolean; hasFinishCoverageOverride: boolean; appearanceSummary: string; color: string; onColorChange: (color: string) => void; onResetColor: () => void; onFinishCoverageChange: ((coverage: number) => void)|undefined; name: string; finishCoverage: number; finishCoverageMixed: boolean; finishCoverageDisabled: boolean; onResetFinishCoverage: (() => void)|undefined })  {
  return <InspectorDisclosure title="Appearance" badge={hasColorOverride||hasFinishCoverageOverride? { label: 'Custom',description: [hasColorOverride&&'Panel color override',hasFinishCoverageOverride&&'Finish coverage override'].filter(Boolean).join(', ') }:undefined} summary={appearanceSummary} preferenceKey="assembly-appearance" className="assembly-finish-disclosure">
    <PanelColorField color={color} label="Panel color" onChange={onColorChange} />
    <div className="assembly-override-status"><span>{hasColorOverride? 'Custom color':'Using assembly color'}</span>{hasColorOverride&&<button onClick={onResetColor}><RotateCcw size={12} />Reset</button>}</div>
    {onFinishCoverageChange&&<>
      <FinishCoverageField key={name} value={finishCoverage} mixed={finishCoverageMixed} disabled={finishCoverageDisabled} onChange={onFinishCoverageChange} />
      <div className="assembly-override-status"><span>{hasFinishCoverageOverride? 'Custom finish':'Using assembly finish'}</span>{hasFinishCoverageOverride&&onResetFinishCoverage&&<button aria-label="Reset instance finish coverage" onClick={onResetFinishCoverage}><RotateCcw size={12} />Reset</button>}</div>
    </>}
  </InspectorDisclosure>
}

function AssemblyInstanceValues({ parameters, isCustom, parameterValues, onParameterChange, connected, hasParameterOverrides, onResetParameters }: { parameters: AssemblyParameter[]; isCustom: (id: string) => boolean; parameterValues: Record<string,number>; onParameterChange: ((id: string,value: number) => boolean)|undefined; connected: boolean|undefined; hasParameterOverrides: boolean; onResetParameters: (() => void)|undefined })  {
  return parameters.length>0&&<section className="inspector-section assembly-instance-values" aria-label="Instance values">
    <div className="section-title"><h2>Dimensions</h2><span>mm</span></div>
    {parameters.map(parameter => <div className="assembly-instance-value" key={parameter.id}>
      <NumberField label={parameter.name} nice={!parameter.bindings.some(binding => binding.dimension==='thickness')} value={isCustom(parameter.id)? parameterValues[parameter.id]:parameter.defaultValue} precision={3} {...getAssemblyParameterRange(parameter)} commitOnBlur disabled={!onParameterChange} onChange={value => onParameterChange?.(parameter.id,value)} />
      <p>{parameter.bindings.length} linked {parameter.bindings.length===1? 'dimension':'dimensions'}<span>{isCustom(parameter.id)? 'Custom':'Default'}</span></p>
    </div>)}
    <p className="field-note">Panel cut lengths; connector clearances add to the overall size.{connected&&' Connected neighbors may move to keep joints aligned.'}</p>
    {hasParameterOverrides&&onResetParameters&&<button type="button" className="assembly-reset-values" onClick={onResetParameters}><RotateCcw size={13} />Reset to assembly defaults</button>}
  </section>
}

export function CreateAssemblyForm({ panelCount, panels = EMPTY_PANELS, onCreate, disabled = false, reason }: { panelCount: number; panels?: Panel[]; onCreate: (name: string, parameters: AssemblyParameter[]) => void; disabled?: boolean; reason?: string }) {
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
