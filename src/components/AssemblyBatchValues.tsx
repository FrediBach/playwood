import './assembly-batch-values.css'
import { useEffect, useRef, useState } from 'react'
import { updateAssemblyParameterValuesBatch, type AssemblyParameterChanges } from '@/lib/assemblies'
import { getAssemblyParameterRange } from '@/lib/assembly-parameters'
import { resolvePanels } from '@/lib/model'
import type { AssemblyInstance, Project } from '@/lib/types'
import { NumberField, SelectField } from './fields'
import { PanelChangeTable } from './PanelChangeTable'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog'

export function AssemblyBatchValues({ project, selectedIds, onApply }: {
  project: Project
  selectedIds: string[]
  onApply: (source: Project, candidate: Project) => boolean
}) {
  const [source, setSource] = useState<{ project: Project; instances: AssemblyInstance[] } | null>(null)
  const selected = new Set(selectedIds)
  const instances = (project.assemblies?.instances ?? []).filter(instance => Object.values(instance.panelIds).every(id => selected.has(id))
    && project.assemblies!.definitions.find(definition => definition.id === instance.definitionId)?.parameters?.length)
  if (instances.length < 2 && !source) return null
  return <Dialog open={!!source} onOpenChange={open => setSource(open ? { project, instances } : null)}>
    <DialogTrigger asChild><Button variant="outline">Edit coordinated values</Button></DialogTrigger>
    {source && <AssemblyBatchForm source={source.project} stale={project !== source.project} instances={source.instances} onApply={candidate => {
      if (onApply(source.project, candidate)) setSource(null)
    }} onCancel={() => setSource(null)}/>}
  </Dialog>
}

function AssemblyBatchForm({ source, stale, instances, onApply, onCancel }: {
  source: Project
  stale: boolean
  instances: AssemblyInstance[]
  onApply: (candidate: Project) => void
  onCancel: () => void
}) {
  const content = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const [changes, setChanges] = useState<AssemblyParameterChanges>({})
  const [anchor, setAnchor] = useState(instances[0].id)
  const [candidate, setCandidate] = useState<Project | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0
    title.current?.focus({ preventScroll: true })
  }, [candidate])
  const update = (instanceId: string, parameterId: string, value: number | undefined) => {
    setChanges(current => ({ ...current, [instanceId]: { ...current[instanceId], [parameterId]: value } }))
    setError('')
  }
  const review = () => {
    try {
      // Include untouched selected instances so any selected reference is valid.
      const edits = Object.fromEntries(instances.map(instance => [instance.id, changes[instance.id] ?? {}]))
      const next = updateAssemblyParameterValuesBatch(source, edits, anchor)
      if (next === source) { setError('Change a value or restore an override before reviewing.'); return }
      setCandidate(next); setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'These values cannot be applied together.') }
  }
  const before = resolvePanels(source)
  const panelChanges = candidate ? resolvePanels(candidate).flatMap(after => {
    const previous = before.find(panel => panel.id === after.id)
    if (!previous) return []
    return (['width', 'height', 'thickness'] as const).some(key => Math.abs(previous[key] - after[key]) > 1e-6)
      || previous.position.some((value, index) => Math.abs(value - after.position[index]) > 1e-6)
      || previous.rotation.some((value, index) => Math.abs(value - after.rotation[index]) > 1e-6)
      ? [{ before: previous, after }] : []
  }) : []
  const labels = new Map((source.assemblies?.instances ?? []).flatMap((instance, index) =>
    Object.values(instance.panelIds).map(id => [id, `${instance.name} · ${index + 1} / ${before.find(panel => panel.id === id)?.name ?? id}`] as const)))
  return <DialogContent ref={content} className="assembly-batch-values">
    <DialogTitle ref={title} tabIndex={-1}>{candidate ? 'Review coordinated values' : 'Edit coordinated values'}</DialogTitle>
    <DialogDescription>Change values for {instances.length} selected assemblies together. Source defaults and unedited overrides stay unchanged. Linked neighbors may move; review the complete result before applying.</DialogDescription>
    {!candidate ? <>
      <SelectField label="Fixed reference instance" value={anchor} onChange={setAnchor}>
        {instances.map((instance, index) => <option key={instance.id} value={instance.id}>{instance.name} · {index + 1}</option>)}
      </SelectField>
      <p className="field-note">The reference instance keeps its placement origin and rotation. Its panels can move as its dimensions change.</p>
      {instances.map((instance, index) => {
        const parameters = (source.assemblies?.definitions.find(definition => definition.id === instance.definitionId)?.parameters ?? [])
        return <fieldset key={instance.id}><legend>{instance.name} · {index + 1}</legend>
          {parameters.map(parameter => {
            const edited = Object.hasOwn(changes[instance.id] ?? {}, parameter.id)
            const override = edited ? changes[instance.id][parameter.id] : instance.parameterValues?.[parameter.id]
            return <div key={parameter.id}>
              <NumberField label={`${instance.name} ${index + 1} · ${parameter.name}`} value={override ?? parameter.defaultValue} precision={3} {...getAssemblyParameterRange(parameter)} nice={!parameter.bindings.some(binding => binding.dimension === 'thickness')} commitOnBlur onChange={value => update(instance.id, parameter.id, value)}/>
              <Button variant="ghost" size="sm" aria-label={`Use default for ${instance.name} ${index + 1} · ${parameter.name}`} disabled={override === undefined} onClick={() => update(instance.id, parameter.id, undefined)}>Use source default</Button>
            </div>
          })}
        </fieldset>
      })}
    </> : <>
      <p className="dialog-note">Fixed reference: {instances.find(instance => instance.id === anchor)?.name} · {instances.findIndex(instance => instance.id === anchor) + 1}. All changes below will be saved as one edit.</p>
      <ul>{instances.flatMap((instance, index) => Object.entries(changes[instance.id] ?? {}).map(([id, value]) => {
        const parameter = (source.assemblies?.definitions.find(definition => definition.id === instance.definitionId)?.parameters ?? []).find(item => item.id === id)
        if (!parameter) return null
        return <li key={`${instance.id}/${id}`}>{instance.name} {index + 1} · {parameter.name}: {instance.parameterValues?.[id] ?? parameter.defaultValue} → {value ?? parameter.defaultValue} mm{value === undefined ? ' (source default)' : ''}</li>
      }))}</ul>
      <PanelChangeTable changes={panelChanges} label="Coordinated assembly changes" panelLabels={labels}/>
      {!panelChanges.length && <p>Only parameter overrides change; panel geometry stays the same.</p>}
    </>}
    {(stale || error) && <p role="alert" className="error-message">{stale ? 'The project changed. Close this dialog and review again.' : error}</p>}
    <div className="dialog-footer">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      {candidate && <Button variant="outline" onClick={() => setCandidate(null)}>Back to values</Button>}
      <Button disabled={stale} onClick={() => candidate ? onApply(candidate) : review()}>{candidate ? 'Apply coordinated values' : 'Review coordinated changes'}</Button>
    </div>
  </DialogContent>
}
