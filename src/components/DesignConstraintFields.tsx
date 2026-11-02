import { NumberField, SelectField } from './fields'
import { designConstraintCoordinate, designConstraintPanelIds, measureDesignConstraint } from '@/lib/design-constraints'
import type { ConstraintReference, DesignConstraint, Panel } from '@/lib/types'

type NumericConstraint = Extract<DesignConstraint, { kind: 'floor' | 'dimension' | 'gap' }>
type RequirementMode = 'exact' | 'minimum' | 'maximum' | 'range'
interface Props {
  draft: DesignConstraint
  panels: Panel[]
  update: (rule: DesignConstraint) => void
  resetMeasurement: (rule: NumericConstraint, value: number) => void
  changeRequirement: (relation: RequirementMode) => void
}

export function DesignConstraintFields({draft, panels, update, resetMeasurement, changeRequirement}: Props) {
  const draftIds=designConstraintPanelIds(draft)
  const referenceOptions=<><option value="max">Top surface / edge</option><option value="min">Bottom surface / edge</option><option value="center">Center</option></>
  return <>
    {draft.kind === 'floor' && <SelectField label="Measure from" value={draft.reference} onChange={value => {
      const reference = value as ConstraintReference
      const panel = panels.find(panel => panel.id === draft.panelId)
      if (panel) resetMeasurement({ ...draft, reference }, Math.max(0, designConstraintCoordinate(panel, reference)))
      else update({ ...draft, reference })
    }}>{referenceOptions}</SelectField>}
    {(draft.kind === 'dimension' || draft.kind === 'equal-dimension') && <>
      <SelectField label="Panel cut dimension" value={draft.dimension} onChange={value => {
        const dimension = value as 'width' | 'height'
        const panel = panels.find(panel => panel.id === draftIds[0])
        if (draft.kind === 'dimension' && panel) resetMeasurement({ ...draft, dimension }, panel[dimension])
        else update({ ...draft, dimension })
      }}><option value="height">Height</option><option value="width">Width</option></SelectField>
      <p className="field-note">Cut dimensions follow each panel’s face. Use Same level above floor to align their placement.</p>
    </>}
    {draft.kind === 'level' && <>
      <SelectField label="First panel reference" value={draft.references[0]} onChange={value => update({ ...draft, references: [value as ConstraintReference, draft.references[1]] })}>{referenceOptions}</SelectField>
      <SelectField label="Second panel reference" value={draft.references[1]} onChange={value => update({ ...draft, references: [draft.references[0], value as ConstraintReference] })}>{referenceOptions}</SelectField>
    </>}
    {draft.kind === 'gap' && <>
      <SelectField label="Gap direction" value={draft.axis} onChange={value => {
        const axis = value as 'x' | 'y' | 'z'
        const next = { ...draft, axis }
        const [a, b] = draft.panelIds.map(id => panels.find(panel => panel.id === id))
        if (a && b && designConstraintCoordinate(a, 'center', axis) > designConstraintCoordinate(b, 'center', axis)) next.panelIds = [draft.panelIds[1], draft.panelIds[0]]
        const current = measureDesignConstraint(next, panels).actual
        if (Number.isFinite(current)) resetMeasurement(next, Math.max(0, current))
        else update(next)
      }}><option value="y">Vertical · lower to upper (Y)</option><option value="x">Horizontal · left to right (X)</option><option value="z">Depth · back to front (Z)</option></SelectField>
      <p className="field-note">Clear distance between panel boundaries along the chosen world direction. Includes panel thickness; openings and hardware are not measured.</p>
    </>}
    {(draft.kind==='floor'||draft.kind==='dimension'||draft.kind==='gap') && <NumericRequirementFields draft={draft} update={update} changeRequirement={changeRequirement}/>}
  </>
}

const numericFields = {
  floor: { noun: 'height', label: 'Height above floor', min: 0, max: 100000, requirement: 'Measurement requirement' },
  dimension: { noun: 'dimension', label: 'Fixed dimension', min: 40, max: 4000, requirement: 'Measurement requirement' },
  gap: { noun: 'gap', label: 'Required gap', min: 0, max: 200000, requirement: 'Gap requirement' },
}

function NumericRequirementFields({draft, update, changeRequirement}: {
  draft: NumericConstraint
  update: (rule: DesignConstraint) => void
  changeRequirement: (relation: RequirementMode) => void
}) {
  const field=numericFields[draft.kind]
  let label=field.label
  if(draft.kind==='dimension') {
    if(draft.relation==='minimum')label='Minimum dimension'
    if(draft.relation==='maximum')label='Maximum dimension'
  }
  return <>
    <SelectField label={field.requirement} value={draft.relation ?? 'exact'} onChange={value=>changeRequirement(value as RequirementMode)}>
      <option value="exact">Exactly</option><option value="minimum">At least</option><option value="maximum">At most</option><option value="range">Between</option>
    </SelectField>
    {draft.relation==='range' ? <div className="field-row constraint-range-fields">
      <NumberField label={`Minimum ${field.noun}`} value={draft.min} min={field.min} max={field.max} commitOnBlur onChange={min=>update({...draft,min})}/>
      <NumberField label={`Maximum ${field.noun}`} value={draft.max} min={field.min} max={field.max} commitOnBlur onChange={max=>update({...draft,max})}/>
    </div> : <NumberField label={label} value={draft.value} min={field.min} max={field.max} commitOnBlur onChange={value=>update({...draft,value})}/>}
    {draft.relation && draft.relation!=='exact' && <p className="field-note">Measurements may change freely within these limits. Panels adjust only when a limit would be crossed.</p>}
  </>
}
