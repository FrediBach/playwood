import { measureDesignConstraint } from '@/lib/design-constraints'
import type { ConstraintReference, DesignConstraint, Panel } from '@/lib/types'
import { NumberField, SelectField } from './fields'

type ReferenceConstraint = Extract<DesignConstraint, { kind: 'position' | 'setback' }>

export function ReferenceConstraintFields({ draft, panels, update }: {
  draft: ReferenceConstraint
  panels: Panel[]
  update: (rule: DesignConstraint) => void
}) {
  const options = { x: ['Left edge (minimum)', 'Right edge (maximum)'], y: ['Bottom surface / edge (minimum)', 'Top surface / edge (maximum)'], z: ['Back edge (minimum)', 'Front edge (maximum)'] }[draft.axis]
  const references = <><option value="min">{options[0]}</option><option value="max">{options[1]}</option><option value="center">Center</option></>
  const chooseReference = (next: ReferenceConstraint) => {
    const actual = measureDesignConstraint(next, panels).actual
    update(Number.isFinite(actual) ? { ...next, value: actual } : next)
  }
  return <>
    <SelectField label="Reference direction" value={draft.axis} onChange={value => chooseReference({ ...draft, axis: value as 'x' | 'y' | 'z' })}>
      <option value="x">Horizontal · left to right (X)</option><option value="y">Vertical · bottom to top (Y)</option><option value="z">Depth · back to front (Z)</option>
    </SelectField>
    {draft.kind === 'position'
      ? <SelectField label="Fixed reference" value={draft.reference} onChange={value => chooseReference({ ...draft, reference: value as ConstraintReference })}>{references}</SelectField>
      : <>
        <SelectField label="First panel reference" value={draft.references[0]} onChange={value => chooseReference({ ...draft, references: [value as ConstraintReference, draft.references[1]] })}>{references}</SelectField>
        <SelectField label="Second panel reference" value={draft.references[1]} onChange={value => chooseReference({ ...draft, references: [draft.references[0], value as ConstraintReference] })}>{references}</SelectField>
      </>}
    <NumberField label={draft.kind === 'position' ? 'Fixed coordinate' : 'Signed setback'} value={draft.value} min={draft.kind === 'position' ? -100000 : -200000} max={draft.kind === 'position' ? 100000 : 200000} commitOnBlur onChange={value => update({ ...draft, value })}/>
    <p className="field-note">{draft.kind === 'position'
      ? 'Keeps this reference at an absolute world coordinate as cuts and neighboring bays change. Negative coordinates are allowed. Copies omit this position rule.'
      : 'Second reference minus first reference along the chosen direction. Use 0 for alignment; a negative value puts the second reference behind the first. This measures stock references, not clearance from hardware or obstacles.'}</p>
  </>
}
