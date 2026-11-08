import { equalOpeningSelection } from '@/lib/equal-opening-selection'
import { DESIGN_CONSTRAINT_TOLERANCE,DesignConstraintEvaluation,describeDesignConstraint,designConstraintCoordinate,designConstraintPanelIds,evaluateDesignConstraints,measureDesignConstraint,openingMeasurements } from '@/lib/design-constraints'
import type { ConstraintReference,DesignConstraint,Panel } from '@/lib/types'
import { ArrowLeftRight,Check,CircleAlert,LocateFixed,MousePointer2,Pencil,Plus,Ruler,Trash2 } from 'lucide-react'
import { useEffect,useEffectEvent,useId,useRef,useState } from 'react'
import { createPortal } from 'react-dom'
import './design-constraints.css'
import { DesignConstraintFields } from './DesignConstraintFields'
import { SelectField } from './fields'
import { InspectorDisclosure } from './InspectorPrimitives'
import { Button } from './ui/button'

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
const isPair = (kind: DesignConstraint['kind']) => kind === 'setback' || kind === 'opening-ratio' || kind === 'equal-dimension' || kind === 'level' || kind === 'gap'
const referenceLabel = (reference: ConstraintReference) => reference === 'min' ? 'Bottom surface / edge' : reference === 'max' ? 'Top surface / edge' : 'Center'
const ruleTypes: { value: DesignConstraint['kind']; label: string }[] = [
  { value: 'position', label: 'Fixed reference position' },
  { value: 'setback', label: 'Setback between references' },
  { value: 'floor', label: 'Height above floor' },
  { value: 'dimension', label: 'Panel dimension' },
  { value: 'equal-dimension', label: 'Equal panel dimensions' },
  { value: 'level', label: 'Same level above floor' },
  { value: 'gap', label: 'Gap between panels' },
  { value: 'opening-ratio', label: 'Equal / proportional openings' },
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
  if (kind === 'opening-ratio') {
    const selectedOpenings = equalOpeningSelection(panels, ids, id)
    if (selectedOpenings) return selectedOpenings
    const candidates = [...panels].sort((a, b) => a.position[1] - b.position[1])
    return { ...base, kind, panelIds: [candidates[0]?.id ?? '', candidates[1]?.id ?? '', candidates[1]?.id ?? '', candidates[2]?.id ?? ''], axis: 'y', ratio: 1 }
  }
  if (kind === 'position') return { ...base, kind, panelId, axis: 'x', reference: 'min', value: first ? designConstraintCoordinate(first, 'min', 'x') : 0 }
  if (kind === 'setback') return { ...base, kind, panelIds, axis: 'z', references: ['max', 'max'], value: first && second ? designConstraintCoordinate(second, 'max', 'z') - designConstraintCoordinate(first, 'max', 'z') : 0 }
  if (kind === 'floor') return { ...base, kind, panelId, reference: 'max', value: Math.max(0, first ? designConstraintCoordinate(first, 'max') : 0) }
  if (kind === 'dimension') return { ...base, kind, panelId, dimension: 'height', value: first?.height ?? 600 }
  if (kind === 'equal-dimension') return { ...base, kind, panelIds, dimension: 'height' }
  if (kind === 'level') return { ...base, kind, panelIds, references: ['max', 'max'] }
  if (first && second && second.position[1] < first.position[1]) panelIds.reverse()
  const rule: DesignConstraint = { ...base, kind, panelIds, axis: 'y', relation: 'minimum', value: 0 }
  const measurement = measureDesignConstraint(rule, panels).actual
  return { ...rule, value: Number.isFinite(measurement) ? Math.max(0, measurement) : 0 }
}

export function DesignConstraintsInspector({
  panels, constraints, selectedIds, unavailablePanelIds = EMPTY_IDS,
  previewError, previewSummary, openRequest = 0, manageRequest = 0,
  cancelRequest = 0, onPreview, onApply, onRemove,
  onToggle, onHighlight, onFindPanels, onEditingChange,
  footerContainer, onPickPanel
}: Props) {
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
  const { localError,numericDraft,measurement,draftIds }=validateConstraintDraft(draft,panels,unavailable)
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
  const start = createConstraintStart(returnFocus,selectedIds,unavailable,panels,previousRange,setDraft,setAnchor,setReveal,onHighlight)
  useConstraintRequests(start,close,openRequest,openedRequest,cancelRequest,cancelledRequest,manageRequest,managedRequest,setShowAll,setReveal)
  const update = (next: DesignConstraint) => {
    if (isNumeric(next) && next.relation === 'range') previousRange.current = { min: next.min, max: next.max }
    setDraft(next); onHighlight?.(next)
  }
  const changeRequirement = createRequirementChange(numericDraft,measurement,update,previousRange)
  const resetMeasurement = (rule: NumericConstraint, value: number) => {
    previousRange.current = null
    update(withRequirement(rule, rule.relation ?? 'exact', value))
  }
  const choosePanel = (index: number, id: string) => {
    if (!draft) return
    if ('panelId' in draft) update({ ...draft, panelId: id })
    else {
      const ids = [...draft.panelIds] as typeof draft.panelIds
      ids[index] = id
      update({ ...draft, panelIds: ids } as DesignConstraint)
      if (anchor === draft.panelIds[index] && !ids.includes(anchor)) setAnchor(id)
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
  const panelChoice = (index: number, label: string) => <ConstraintPanelChoice label={label} draftIds={draftIds} index={index} choosePanel={choosePanel} panels={panels} unavailable={unavailable} onPickPanel={onPickPanel}/>
  const measuredText = describeConstraintMeasurement(measurement,draft,panels)
  const footer = draft && <ConstraintFooter statusId={statusId} error={error} previewSummary={previewSummary} onApply={onApply} draft={draft} anchor={anchor} close={close} existing={existing}/>

  return <InspectorDisclosure title="Constraints" badge={visibleConstraints.length ? { label: String(visibleConstraints.length), description: `${visibleConstraints.length} saved constraints, ${visibleConstraints.filter(rule => !rule.enabled).length} disabled` } : undefined} summary={`${visibleConstraints.filter(rule => rule.enabled).length} active`} preferenceKey="design-constraints" openRequest={reveal || openRequest} className="design-constraints">
    <p className="field-note">Keep dimensions and distances as you edit. Select three parallel boundary panels, then Add constraint to keep the two openings equal. Connected panels adapt while their joints stay intact.</p>
    {selectedIds.length > 0 && constraints.length > 0 && <div className="constraint-scope" role="group" aria-label="Constraints shown">
      <button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>Selection ({applicable.length})</button>
      <button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>All ({constraints.length})</button>
    </div>}
    {!draft && rows.length > 0 && <ConstraintList rows={rows} panels={panels} start={start} onHighlight={onHighlight} onToggle={onToggle} onFindPanels={onFindPanels} onRemove={onRemove}/>}
    {!draft && <ConstraintEmptyState rows={rows} constraints={constraints} selectedIds={selectedIds} showAll={showAll} previewError={previewError} addButton={addButton} eligiblePanels={eligiblePanels} start={start} panels={panels}/>}
    {draft && <ConstraintForm form={form} existing={existing} close={close} draft={draft} changeType={changeType} eligiblePanels={eligiblePanels} panelChoice={panelChoice} panels={panels} update={update} resetMeasurement={resetMeasurement} changeRequirement={changeRequirement} anchor={anchor} setAnchor={setAnchor} measuredText={measuredText} footerContainer={footerContainer} footer={footer}/>}
  </InspectorDisclosure>
}

function ConstraintFooter({ statusId, error, previewSummary, onApply, draft, anchor, close, existing }: { statusId: string; error: string|undefined; previewSummary: string|undefined; onApply: (rule: DesignConstraint,anchorPanelId?: string) => boolean; draft: DesignConstraint; anchor: string|undefined; close: () => void; existing: boolean })  {
  return <div className="constraint-form-footer">
    <p id={statusId} className={`constraint-status${error? ' is-blocked':''}`} role="status">{error? <CircleAlert size={15} />:<Check size={15} />}<span>{error||previewSummary||'Ready to keep this measurement.'}</span></p>
    <div className="constraint-form-actions"><Button size="sm" disabled={!!error} aria-describedby={statusId} onClick={() => { if(onApply(draft,anchor)) close() } }>{existing? 'Save constraint':'Add constraint'}</Button><Button size="sm" variant="ghost" onClick={close}>Cancel</Button></div>
  </div>
}

function createConstraintStart(returnFocus: React.RefObject<HTMLElement | null>,selectedIds: string[],unavailable: Set<string>,panels: Panel[],previousRange: React.RefObject<{ min: number; max: number; } | null>,setDraft: React.Dispatch<React.SetStateAction<import("@/lib/types").DesignConstraint | null>>,setAnchor: React.Dispatch<React.SetStateAction<string | undefined>>,setReveal: React.Dispatch<React.SetStateAction<number>>,onHighlight: ((rule: DesignConstraint|null) => void)|undefined) {
  return (rule?: DesignConstraint) => {
    returnFocus.current=document.activeElement instanceof HTMLElement? document.activeElement:null
    const initialIds=selectedIds.filter(id => !unavailable.has(id))
    const eligible=panels.filter(panel => !unavailable.has(panel.id))
    const next=rule??equalOpeningSelection(eligible,initialIds)??defaultRule(initialIds.length===2? 'equal-dimension':'floor',eligible,initialIds)
    previousRange.current=isNumeric(next)&&next.relation==='range'? { min: next.min,max: next.max }:null
    setDraft(next)
    setAnchor('panelIds' in next? next.panelIds[0]:undefined)
    setReveal(value => value+1)
    onHighlight?.(next)
  }
}

function ConstraintEmptyState({ rows, constraints, selectedIds, showAll, previewError, addButton, eligiblePanels, start, panels }: { rows: DesignConstraintEvaluation[]; constraints: DesignConstraint[]; selectedIds: string[]; showAll: boolean; previewError: string|undefined; addButton: React.RefObject<HTMLButtonElement | null>; eligiblePanels: Panel[]; start: (rule?: DesignConstraint) => void; panels: Panel[] })  {
  return <>
    {!rows.length&&<p className="field-note">{constraints.length&&selectedIds.length&&!showAll? 'No constraints on these panels. Choose All to manage the project’s rules.':'Add a rule to keep a measurement or relate two panels.'}</p>}
    {previewError&&<p className="constraint-status is-blocked" role="status"><CircleAlert size={15} /><span>{previewError}</span></p>}
    <Button ref={addButton} variant="outline" size="sm" className="full-button" disabled={!eligiblePanels.length} onClick={() => start()}><Plus size={15} />Add constraint</Button>
    {!eligiblePanels.length&&<p className="field-note">{panels.length? 'Linked assembly dimensions are managed through their editable values. Disassemble and disconnect panels to add panel constraints.':'Add a panel to create a constraint.'}</p>}
  </>
}

function describeConstraintMeasurement(measurement: DesignConstraintEvaluation|undefined,draft: DesignConstraint|null,panels: Panel[]) {
  if (draft?.kind==='opening-ratio'&&measurement&&!measurement.issue) {
    const [first, second]=openingMeasurements(draft,panels)
    return `Before adjustment: opening 1 ${format(first)} · opening 2 ${format(second)}`
  }
  return measurement&&Number.isFinite(measurement.actual)
    ? draft?.kind==='equal-dimension'||draft?.kind==='level'||draft?.kind==='opening-ratio'
      ? `Difference before adjustment: ${format(Math.abs(measurement.actual))}`
      :`Before adjustment: ${format(measurement.actual)}`
    :''
}

function useConstraintRequests(start: (rule?: DesignConstraint) => void,close: () => void,openRequest: number,openedRequest: React.RefObject<number>,cancelRequest: number,cancelledRequest: React.RefObject<number>,manageRequest: number,managedRequest: React.RefObject<number>,setShowAll: React.Dispatch<React.SetStateAction<boolean>>,setReveal: React.Dispatch<React.SetStateAction<number>>) {
  const openFromRequest=useEffectEvent(() => start())
  const cancelFromRequest=useEffectEvent(() => close())
  useEffect(() => {
    if(openRequest&&openedRequest.current!==openRequest) { openedRequest.current=openRequest; openFromRequest()}
  },[openRequest,openedRequest])
  useEffect(() => {
    if(cancelRequest&&cancelledRequest.current!==cancelRequest) { cancelledRequest.current=cancelRequest; cancelFromRequest()}
  },[cancelRequest,cancelledRequest])
  useEffect(() => {
    if(manageRequest&&managedRequest.current!==manageRequest) {
      managedRequest.current=manageRequest
      setShowAll(true)
      setReveal(value => value+1)
    }
  },[manageRequest,managedRequest,setShowAll,setReveal])
}

function ConstraintPanelChoice({ label, draftIds, index, choosePanel, panels, unavailable, onPickPanel }: { label: string; draftIds: string[]; index: number; choosePanel: (index: number,id: string) => void; panels: Panel[]; unavailable: Set<string>; onPickPanel: ((onPicked: (panelId: string) => boolean) => void)|undefined })  {
  return <div className="constraint-panel-choice">
    <SelectField label={label} value={draftIds[index]??''} onChange={id => choosePanel(index,id)}>
      {!draftIds[index]&&<option value="">Choose panel</option>}
      {panels.map((panel,panelIndex) => <option key={panel.id} value={panel.id} disabled={unavailable.has(panel.id)||draftIds.some((id,other) => other!==index&&(draftIds.length!==4||Math.floor(other/2)===Math.floor(index/2))&&id===panel.id)}>{panel.name} · {panelIndex+1}{unavailable.has(panel.id)? ' (linked assembly)':''}</option>)}
    </SelectField>
    {onPickPanel&&<Button type="button" size="sm" variant="ghost" aria-label={`Pick ${label.toLowerCase()} in preview`} onClick={() => onPickPanel(id => {
      if(!panels.some(panel => panel.id===id)||unavailable.has(id)||draftIds.some((other,otherIndex) => otherIndex!==index&&(draftIds.length!==4||Math.floor(otherIndex/2)===Math.floor(index/2))&&other===id)) return false
      choosePanel(index,id)
      return true
    })}><MousePointer2 size={14} />Pick in preview</Button>}
  </div>
}

function validateConstraintDraft(draft: DesignConstraint|null,panels: Panel[],unavailable: Set<string>) {
  const draftIds=draft? designConstraintPanelIds(draft):[]
  const measurement=draft? measureDesignConstraint(draft,panels):undefined
  const numericDraft=draft&&isNumeric(draft)? draft:null
  const rangeError=numericDraft?.relation==='range'&&numericDraft.min>numericDraft.max? 'Minimum must be less than or equal to maximum.':undefined
  const localError=draftIds.some(id => !id)? draft?.kind==='opening-ratio'? 'Choose the start and end panel for both openings.':draft&&isPair(draft.kind)? 'Choose two different panels for this constraint.':'Choose a panel for this constraint.'
    :draftIds.some(id => unavailable.has(id))? 'These panels belong to or connect to a linked assembly. Use its editable values, or disassemble and disconnect the panels before adding a panel constraint.'
      :rangeError||measurement?.issue
  return { localError,numericDraft,measurement,draftIds }
}

function createRequirementChange(numericDraft: NumericConstraint|null,measurement: DesignConstraintEvaluation|undefined,update: (next: DesignConstraint) => void,previousRange: React.RefObject<{ min: number; max: number; } | null>) {
  return (relation: RequirementMode) => {
    if(!numericDraft) return
    if(numericDraft.relation==='range') {
      const current=measurement&&Number.isFinite(measurement.actual)? measurement.actual:numericDraft.min
      const value=relation==='minimum'? numericDraft.min:relation==='maximum'? numericDraft.max:Math.max(numericDraft.min,Math.min(numericDraft.max,current))
      update(withRequirement(numericDraft,relation,value))
    } else if(relation==='range') {
      const remembered=previousRange.current
      const min=numericDraft.relation!=='minimum'&&remembered? remembered.min:numericDraft.value
      const max=numericDraft.relation!=='maximum'&&remembered? remembered.max:numericDraft.value
      update(withRequirement(numericDraft,relation,min,max))
    } else update(withRequirement(numericDraft,relation,numericDraft.value))
  }
}

function ConstraintForm({
  form, existing, close, draft,
  changeType, eligiblePanels, panelChoice, panels,
  update, resetMeasurement, changeRequirement, anchor,
  setAnchor, measuredText, footerContainer, footer
}: { form: React.RefObject<HTMLDivElement | null>; existing: boolean; close: () => void; draft: DesignConstraint; changeType: (kind: DesignConstraint["kind"]) => void; eligiblePanels: Panel[]; panelChoice: (index: number, label: string) => React.JSX.Element; panels: Panel[]; update: (next: DesignConstraint) => void; resetMeasurement: (rule: NumericConstraint,value: number) => void; changeRequirement: (relation: RequirementMode) => void; anchor: string|undefined; setAnchor: React.Dispatch<React.SetStateAction<string | undefined>>; measuredText: string; footerContainer: HTMLElement|null|undefined; footer: React.JSX.Element | null })  {
  return <div className="constraint-form" ref={form} role="group" aria-label={existing? 'Edit constraint':'New constraint'} onKeyDown={event => {
    if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); close()}
  } }>
    <SelectField label="Constraint type" value={draft.kind} onChange={value => changeType(value as DesignConstraint['kind'])}>
      {ruleTypes.map(type => <option key={type.value} value={type.value} disabled={type.value==='opening-ratio'? eligiblePanels.length<3:isPair(type.value)&&eligiblePanels.length<2}>{type.label}</option>)}
    </SelectField>
    {panelChoice(0,constraintPanelLabel(draft, 0))}
    {isPair(draft.kind)&&panelChoice(1,constraintPanelLabel(draft, 1))}
    {draft.kind==='opening-ratio'&&<>{panelChoice(2,constraintPanelLabel(draft, 2))}{panelChoice(3,constraintPanelLabel(draft, 3))}</>}
    <DesignConstraintFields draft={draft} panels={panels} update={update} resetMeasurement={resetMeasurement} changeRequirement={changeRequirement} />
    <ConstraintAnchor draft={draft} anchor={anchor} setAnchor={setAnchor} panels={panels}/>
    <p className="constraint-sentence">{describeDesignConstraint(draft,panels)}</p>
    {measuredText&&<p className="field-note">{measuredText}{draft.kind==='floor'? ` · ${referenceLabel(draft.reference)} to floor (Y = 0)`:''}</p>}
    {footerContainer? createPortal(footer,footerContainer):footer}
  </div>
}

function ConstraintAnchor({ draft, anchor, setAnchor, panels }: { draft: DesignConstraint; anchor: string|undefined; setAnchor: React.Dispatch<React.SetStateAction<string | undefined>>; panels: Panel[] })  {
  const ids = [...new Set(designConstraintPanelIds(draft).filter(Boolean))]
  return 'panelIds' in draft&&<div className="constraint-reference">
    <SelectField label="Keep in place for this adjustment" value={anchor??draft.panelIds[0]} onChange={setAnchor}>
      {ids.map(id => <option key={id} value={id}>{panels.find(panel => panel.id===id)?.name??'Missing panel'}</option>)}
    </SelectField>
    <Button variant="ghost" size="sm" onClick={() => setAnchor(ids[(Math.max(0, ids.indexOf(anchor ?? ids[0])) + 1) % ids.length])}><ArrowLeftRight size={14} />Switch reference</Button>
    <p className="field-note">This chooses the starting adjustment. Future edits maintain the relationship in either direction.</p>
  </div>
}

function ConstraintList({ rows, panels, start, onHighlight, onToggle, onFindPanels, onRemove }: { rows: DesignConstraintEvaluation[]; panels: Panel[]; start: (rule?: DesignConstraint) => void; onHighlight: ((rule: DesignConstraint|null) => void)|undefined; onToggle: (id: string,enabled: boolean) => void; onFindPanels: ((ids: string[]) => void)|undefined; onRemove: (id: string) => void })  {
  return <ul className="constraint-list" aria-label="Design constraints">
    {rows.map(({ constraint: rule,violation,issue }) => {
      const description=describeDesignConstraint(rule,panels)
      const problem=rule.enabled&&(!!issue||violation>DESIGN_CONSTRAINT_TOLERANCE)
      return <li key={rule.id} className={`${rule.enabled? '':'is-disabled'}${problem? ' has-issue':''}`}>
        <button type="button" className="constraint-description" aria-label={`Edit constraint: ${description}`} onClick={() => start(rule)} onMouseEnter={() => onHighlight?.(rule)} onMouseLeave={() => onHighlight?.(null)} onFocus={() => onHighlight?.(rule)} onBlur={() => onHighlight?.(null)}>
          {problem? <CircleAlert size={15} />:<Ruler size={15} />}<span>{description}<small>{!rule.enabled? 'Disabled':problem? issue||'Needs attention':'Active'}</small></span><Pencil size={13} />
        </button>
        <div className="constraint-row-actions">
          <label><input type="checkbox" checked={rule.enabled} aria-label={`Enable constraint: ${description}`} onChange={event => { if(event.target.checked) start({ ...rule,enabled: true }); else onToggle(rule.id,false) } } />Enabled</label>
          {onFindPanels&&<Button size="icon" variant="ghost" aria-label={`Find panels: ${description}`} onClick={() => { onFindPanels([...new Set(designConstraintPanelIds(rule))]); onHighlight?.(rule) } }><LocateFixed size={14} /></Button>}
          <Button size="icon" variant="ghost" aria-label={`Remove constraint: ${description}`} onClick={() => onRemove(rule.id)}><Trash2 size={14} /></Button>
        </div>
      </li>
    })}
  </ul>
}

function constraintPanelLabel(draft: DesignConstraint, index: number) {
  if (draft.kind === 'opening-ratio') return `Opening ${index < 2 ? '1' : '2'} ${index % 2 === 0 ? 'start' : 'end'} panel`
  if (draft.kind === 'gap') return { x: ['Left panel', 'Right panel'], y: ['Lower panel', 'Upper panel'], z: ['Back panel', 'Front panel'] }[draft.axis][index]
  if (index === 1) return 'Second panel'
  return isPair(draft.kind) ? 'First panel' : 'Constrained panel'
}
