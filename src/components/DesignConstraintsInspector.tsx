import { DesignConstraintFields } from './DesignConstraintFields'
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Check, CircleAlert, LocateFixed, MousePointer2, Pencil, Plus, Ruler, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { SelectField } from './fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { DESIGN_CONSTRAINT_TOLERANCE, describeDesignConstraint, designConstraintCoordinate, designConstraintPanelIds, evaluateDesignConstraints, measureDesignConstraint } from '@/lib/design-constraints'
import type { ConstraintReference, DesignConstraint, Panel } from '@/lib/types'
import './design-constraints.css'

interface Props {
  panels: Panel[]
  constraints: DesignConstraint[]
  selectedIds: string[]
  unavailablePanelIds?: string[]
  previewError?: string
  previewSummary?: string
  openRequest?: number
  manageRequest?: number
  cancelRequest?: number
  onPreview: (rule: DesignConstraint | null, anchorPanelId?: string) => void
  onApply: (rule: DesignConstraint, anchorPanelId?: string) => boolean
  onRemove: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onHighlight?: (rule: DesignConstraint | null) => void
  onFindPanels?: (ids: string[]) => void
  onEditingChange?: (editing: boolean) => void
  footerContainer?: HTMLElement | null
  onPickPanel?: (onPicked: (panelId: string) => boolean) => void
}

const EMPTY_IDS: string[] = []
type NumericConstraint = Extract<DesignConstraint, { kind: 'floor' | 'dimension' | 'gap' }>
type RequirementMode = 'exact' | 'minimum' | 'maximum' | 'range'
const isNumeric = (rule: DesignConstraint): rule is NumericConstraint => rule.kind === 'floor' || rule.kind === 'dimension' || rule.kind === 'gap'
const format = (value: number) => `${Number(value.toFixed(1))} mm`
const isPair = (kind: DesignConstraint['kind']) => kind === 'equal-dimension' || kind === 'level' || kind === 'gap'
const referenceLabel = (reference: ConstraintReference) => reference === 'min' ? 'Bottom surface / edge' : reference === 'max' ? 'Top surface / edge' : 'Center'
const ruleTypes: { value: DesignConstraint['kind']; label: string }[] = [
  { value: 'floor', label: 'Height above floor' },
  { value: 'dimension', label: 'Panel dimension' },
  { value: 'equal-dimension', label: 'Equal panel dimensions' },
  { value: 'level', label: 'Same level above floor' },
  { value: 'gap', label: 'Gap between panels' },
]

function withRequirement(rule: NumericConstraint, relation: RequirementMode, value: number, maximum = value): NumericConstraint {
  const requirement = relation === 'range' ? { relation, min: value, max: maximum } : { relation, value }
  if (rule.relation === 'range') {
    const { relation: _relation, min: _min, max: _max, ...identity } = rule
    return { ...identity, ...requirement } as NumericConstraint
  }
  const { relation: _relation, value: _value, ...identity } = rule
  return { ...identity, ...requirement } as NumericConstraint
}

function defaultRule(kind: DesignConstraint['kind'], panels: Panel[], ids: string[], id: string = crypto.randomUUID()): DesignConstraint {
  const first = panels.find(panel => panel.id === ids[0]) ?? panels[0]
  const second = panels.find(panel => panel.id === ids[1] && panel.id !== first?.id) ?? panels.find(panel => panel.id !== first?.id)
  const base = { id, enabled: true }
  const panelId = first?.id ?? ''
  const panelIds: [string, string] = [panelId, second?.id ?? '']
  if (kind === 'floor') return { ...base, kind, panelId, reference: 'max', value: Math.max(0, first ? designConstraintCoordinate(first, 'max') : 0) }
  if (kind === 'dimension') return { ...base, kind, panelId, dimension: 'height', value: first?.height ?? 600 }
  if (kind === 'equal-dimension') return { ...base, kind, panelIds, dimension: 'height' }
  if (kind === 'level') return { ...base, kind, panelIds, references: ['max', 'max'] }
  if (first && second && second.position[1] < first.position[1]) panelIds.reverse()
  const rule: DesignConstraint = { ...base, kind, panelIds, axis: 'y', relation: 'minimum', value: 0 }
  const measurement = measureDesignConstraint(rule, panels).actual
  return { ...rule, value: Number.isFinite(measurement) ? Math.max(0, measurement) : 0 }
}

export function DesignConstraintsInspector({ panels, constraints, selectedIds, unavailablePanelIds = EMPTY_IDS, previewError, previewSummary, openRequest = 0, manageRequest = 0, cancelRequest = 0,
  onPreview, onApply, onRemove, onToggle, onHighlight, onFindPanels, onEditingChange, footerContainer, onPickPanel }: Props) {
  const [draft, setDraft] = useState<DesignConstraint | null>(null)
  const [anchor, setAnchor] = useState<string>()
  const [showAll, setShowAll] = useState(false)
  const [reveal, setReveal] = useState(0)
  const returnFocus = useRef<HTMLElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const openedRequest = useRef(0)
  const cancelledRequest = useRef(0)
  const managedRequest = useRef(0)
  const formWasOpen = useRef(false)
  const previousRange = useRef<{ min: number; max: number } | null>(null)
  const statusId = useId()
  const selected = new Set(selectedIds)
  const unavailable = new Set(unavailablePanelIds)
  const applicable = constraints.filter(rule => designConstraintPanelIds(rule).some(id => selected.has(id)))
  const visibleConstraints = showAll || !selectedIds.length ? constraints : applicable
  const rows = evaluateDesignConstraints(visibleConstraints, panels)
  const existing = draft ? constraints.some(rule => rule.id === draft.id) : false
  const draftIds = draft ? designConstraintPanelIds(draft) : []
  const measurement = draft ? measureDesignConstraint(draft, panels) : undefined
  const numericDraft = draft && isNumeric(draft) ? draft : null
  const rangeError = numericDraft?.relation === 'range' && numericDraft.min > numericDraft.max ? 'Minimum must be less than or equal to maximum.' : undefined
  const localError = draftIds.some(id => !id) ? draft && isPair(draft.kind) ? 'Choose two different panels for this constraint.' : 'Choose a panel for this constraint.'
    : draftIds.some(id => unavailable.has(id)) ? 'These panels belong to or connect to a linked assembly. Use its editable values, or disassemble and disconnect the panels before adding a panel constraint.'
      : rangeError || measurement?.issue
  const error = localError || previewError

  const notifyPreview = useEffectEvent((rule: DesignConstraint | null, anchorId?: string) => onPreview(rule, anchorId))
  const notifyEditing = useEffectEvent((editing: boolean) => onEditingChange?.(editing))
  const notifyHighlight = useEffectEvent((rule: DesignConstraint | null) => onHighlight?.(rule))
  useEffect(() => { notifyPreview(localError ? null : draft, anchor) }, [draft, anchor, localError])
  useEffect(() => {
    notifyEditing(!!draft)
    const focus = draft && !formWasOpen.current ? window.setTimeout(() => form.current?.querySelector<HTMLElement>('select, input, button')?.focus(), 0) : undefined
    formWasOpen.current = !!draft
    return () => { if (focus !== undefined) window.clearTimeout(focus) }
  }, [draft])
  useEffect(() => () => { notifyPreview(null); notifyEditing(false); notifyHighlight(null) }, [])

  const close = () => {
    setDraft(null)
    setAnchor(undefined)
    onHighlight?.(null)
    window.setTimeout(() => { (returnFocus.current?.isConnected ? returnFocus.current : addButton.current)?.focus() }, 0)
  }
  const start = (rule?: DesignConstraint) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initialIds = selectedIds.filter(id => !unavailable.has(id))
    const next = rule ?? defaultRule(initialIds.length === 2 ? 'equal-dimension' : 'floor', panels.filter(panel => !unavailable.has(panel.id)), initialIds)
    previousRange.current = isNumeric(next) && next.relation === 'range' ? { min: next.min, max: next.max } : null
    setDraft(next)
    setAnchor('panelIds' in next ? next.panelIds[0] : undefined)
    setReveal(value => value + 1)
    onHighlight?.(next)
  }
  const openFromRequest = useEffectEvent(() => start())
  const cancelFromRequest = useEffectEvent(() => close())
  useEffect(() => {
    if (openRequest && openedRequest.current !== openRequest) { openedRequest.current = openRequest; openFromRequest() }
  }, [openRequest])
  useEffect(() => {
    if (cancelRequest && cancelledRequest.current !== cancelRequest) { cancelledRequest.current = cancelRequest; cancelFromRequest() }
  }, [cancelRequest])
  useEffect(() => {
    if (manageRequest && managedRequest.current !== manageRequest) {
      managedRequest.current = manageRequest
      setShowAll(true)
      setReveal(value => value + 1)
    }
  }, [manageRequest])
  const update = (next: DesignConstraint) => {
    if (isNumeric(next) && next.relation === 'range') previousRange.current = { min: next.min, max: next.max }
    setDraft(next); onHighlight?.(next)
  }
  const changeRequirement = (relation: RequirementMode) => {
    if (!numericDraft) return
    if (numericDraft.relation === 'range') {
      const current = measurement && Number.isFinite(measurement.actual) ? measurement.actual : numericDraft.min
      const value = relation === 'minimum' ? numericDraft.min : relation === 'maximum' ? numericDraft.max : Math.max(numericDraft.min, Math.min(numericDraft.max, current))
      update(withRequirement(numericDraft, relation, value))
    } else if (relation === 'range') {
      const remembered = previousRange.current
      const min = numericDraft.relation !== 'minimum' && remembered ? remembered.min : numericDraft.value
      const max = numericDraft.relation !== 'maximum' && remembered ? remembered.max : numericDraft.value
      update(withRequirement(numericDraft, relation, min, max))
    } else update(withRequirement(numericDraft, relation, numericDraft.value))
  }
  const resetMeasurement = (rule: NumericConstraint, value: number) => {
    previousRange.current = null
    update(withRequirement(rule, rule.relation ?? 'exact', value))
  }
  const choosePanel = (index: number, id: string) => {
    if (!draft) return
    if ('panelId' in draft) update({ ...draft, panelId: id })
    else {
      const ids: [string, string] = [...draft.panelIds]
      ids[index] = id
      update({ ...draft, panelIds: ids })
      if (anchor === draft.panelIds[index]) setAnchor(id)
    }
  }
  const changeType = (kind: DesignConstraint['kind']) => {
    if (!draft) return
    const next = defaultRule(kind, panels, designConstraintPanelIds(draft), draft.id)
    previousRange.current = null
    update({ ...next, enabled: draft.enabled })
    setAnchor('panelIds' in next ? next.panelIds[0] : undefined)
  }
  const eligiblePanels = panels.filter(panel => !unavailable.has(panel.id))
  const panelChoice = (index: number, label: string) => <div className="constraint-panel-choice">
    <SelectField label={label} value={draftIds[index] ?? ''} onChange={id => choosePanel(index, id)}>
      {!draftIds[index] && <option value="">Choose panel</option>}
      {panels.map((panel, panelIndex) => <option key={panel.id} value={panel.id} disabled={unavailable.has(panel.id) || draftIds.some((id, other) => other !== index && id === panel.id)}>{panel.name} · {panelIndex + 1}{unavailable.has(panel.id) ? ' (linked assembly)' : ''}</option>)}
    </SelectField>
    {onPickPanel && <Button type="button" size="sm" variant="ghost" aria-label={`Pick ${label.toLowerCase()} in preview`} onClick={() => onPickPanel(id => {
      if (!panels.some(panel => panel.id === id) || unavailable.has(id) || draftIds.some((other, otherIndex) => otherIndex !== index && other === id)) return false
      choosePanel(index, id)
      return true
    })}><MousePointer2 size={14}/>Pick in preview</Button>}
  </div>
  const measuredText = measurement && Number.isFinite(measurement.actual)
    ? draft?.kind === 'equal-dimension' || draft?.kind === 'level'
      ? `Difference before adjustment: ${format(Math.abs(measurement.actual))}`
      : `Before adjustment: ${format(measurement.actual)}`
    : ''
  const footer = draft && <div className="constraint-form-footer">
    <p id={statusId} className={`constraint-status${error ? ' is-blocked' : ''}`} role="status">{error ? <CircleAlert size={15}/> : <Check size={15}/>}<span>{error || previewSummary || 'Ready to keep this measurement.'}</span></p>
    <div className="constraint-form-actions"><Button size="sm" disabled={!!error} aria-describedby={statusId} onClick={() => { if (onApply(draft, anchor)) close() }}>{existing ? 'Save constraint' : 'Add constraint'}</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
  </div>

  return <InspectorDisclosure title="Constraints" badge={visibleConstraints.length ? { label: String(visibleConstraints.length), description: `${visibleConstraints.length} saved constraints, ${visibleConstraints.filter(rule => !rule.enabled).length} disabled` } : undefined} summary={`${visibleConstraints.filter(rule => rule.enabled).length} active`} preferenceKey="design-constraints" openRequest={reveal || openRequest} className="design-constraints">
    <p className="field-note">Keep dimensions and distances as you edit. Connected panels adapt while their joints stay intact.</p>
    {selectedIds.length > 0 && constraints.length > 0 && <div className="constraint-scope" role="group" aria-label="Constraints shown">
      <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Selection ({applicable.length})</button>
      <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>All ({constraints.length})</button>
    </div>}
    {!draft && rows.length > 0 && <ul className="constraint-list" aria-label="Design constraints">
      {rows.map(({ constraint: rule, violation, issue }) => {
        const description = describeDesignConstraint(rule, panels)
        const problem = rule.enabled && (!!issue || violation > DESIGN_CONSTRAINT_TOLERANCE)
        return <li key={rule.id} className={`${rule.enabled ? '' : 'is-disabled'}${problem ? ' has-issue' : ''}`}>
          <button type="button" className="constraint-description" aria-label={`Edit constraint: ${description}`} onClick={() => start(rule)} onMouseEnter={() => onHighlight?.(rule)} onMouseLeave={() => onHighlight?.(null)} onFocus={() => onHighlight?.(rule)} onBlur={() => onHighlight?.(null)}>
            {problem ? <CircleAlert size={15}/> : <Ruler size={15}/>}<span>{description}<small>{!rule.enabled ? 'Disabled' : problem ? issue || 'Needs attention' : 'Active'}</small></span><Pencil size={13}/>
          </button>
          <div className="constraint-row-actions">
            <label><input type="checkbox" checked={rule.enabled} aria-label={`Enable constraint: ${description}`} onChange={event => { if (event.target.checked) start({ ...rule, enabled: true }); else onToggle(rule.id, false) }}/>Enabled</label>
            {onFindPanels && <Button size="icon" variant="ghost" aria-label={`Find panels: ${description}`} onClick={() => { onFindPanels(designConstraintPanelIds(rule)); onHighlight?.(rule) }}><LocateFixed size={14}/></Button>}
            <Button size="icon" variant="ghost" aria-label={`Remove constraint: ${description}`} onClick={() => onRemove(rule.id)}><Trash2 size={14}/></Button>
          </div>
        </li>
      })}
    </ul>}
    {!draft && <>
      {!rows.length && <p className="field-note">{constraints.length && selectedIds.length && !showAll ? 'No constraints on these panels. Choose All to manage the project’s rules.' : 'Add a rule to keep a measurement or relate two panels.'}</p>}
      {previewError && <p className="constraint-status is-blocked" role="status"><CircleAlert size={15}/><span>{previewError}</span></p>}
      <Button ref={addButton} variant="outline" size="sm" className="full-button" disabled={!eligiblePanels.length} onClick={() => start()}><Plus size={15}/>Add constraint</Button>
      {!eligiblePanels.length && <p className="field-note">{panels.length ? 'Linked assembly dimensions are managed through their editable values. Disassemble and disconnect panels to add panel constraints.' : 'Add a panel to create a constraint.'}</p>}
    </>}
    {draft && <div className="constraint-form" ref={form} role="group" aria-label={existing ? 'Edit constraint' : 'New constraint'} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
      <SelectField label="Constraint type" value={draft.kind} onChange={value => changeType(value as DesignConstraint['kind'])}>
        {ruleTypes.map(type => <option key={type.value} value={type.value} disabled={isPair(type.value) && eligiblePanels.length < 2}>{type.label}</option>)}
      </SelectField>
      {panelChoice(0, draft.kind === 'gap' ? draft.axis === 'y' ? 'Lower panel' : draft.axis === 'x' ? 'Left panel' : 'Back panel' : isPair(draft.kind) ? 'First panel' : 'Constrained panel')}
      {isPair(draft.kind) && panelChoice(1, draft.kind === 'gap' ? draft.axis === 'y' ? 'Upper panel' : draft.axis === 'x' ? 'Right panel' : 'Front panel' : 'Second panel')}
      <DesignConstraintFields draft={draft} panels={panels} update={update} resetMeasurement={resetMeasurement} changeRequirement={changeRequirement}/>
      {'panelIds' in draft && <div className="constraint-reference">
        <SelectField label="Keep in place for this adjustment" value={anchor ?? draft.panelIds[0]} onChange={setAnchor}>
          {draft.panelIds.filter(Boolean).map(id => <option key={id} value={id}>{panels.find(panel => panel.id === id)?.name ?? 'Missing panel'}</option>)}
        </SelectField>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(anchor === draft.panelIds[0] ? draft.panelIds[1] : draft.panelIds[0])}><ArrowLeftRight size={14}/>Switch reference</Button>
        <p className="field-note">This chooses the starting adjustment. Future edits maintain the relationship in either direction.</p>
      </div>}
      <p className="constraint-sentence">{describeDesignConstraint(draft, panels)}</p>
      {measuredText && <p className="field-note">{measuredText}{draft.kind === 'floor' ? ` · ${referenceLabel(draft.reference)} to floor (Y = 0)` : ''}</p>}
      {footerContainer ? createPortal(footer, footerContainer) : footer}
    </div>}
  </InspectorDisclosure>
}
