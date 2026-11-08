import { ArrowDownToLine, ArrowLeftRight, Equal, LockKeyhole, MoveHorizontal, Ratio, Ruler, AlignVerticalJustifyCenter } from 'lucide-react'
import { useId } from 'react'
import { ConstraintLabel, useConstraintInspection } from './ConstraintLabels'
import { ConstraintMeasurementLine } from './ConstraintMeasurementLine'
import { describeDesignConstraintRequirement } from '@/lib/design-constraints'
import { designConstraintMeasurements } from '@/lib/design-constraint-measurements'
import type { DesignConstraint, Panel, Vec3 } from '@/lib/types'

interface Props {
  constraint: DesignConstraint | null
  panels: Panel[]
  compact?: boolean
}
const meters = (point: Vec3): Vec3 => point.map(value => value * 0.001) as Vec3
const midpoint = (from: Vec3, to: Vec3): Vec3 => from.map((value, axis) => (value + to[axis]) / 2) as Vec3
type ConstraintMeasurement = NonNullable<ReturnType<typeof designConstraintMeasurements>>
const requirementFor = (constraint: DesignConstraint) => constraint.kind === 'floor' || constraint.kind === 'dimension' || constraint.kind === 'gap' || constraint.kind === 'position' || constraint.kind === 'setback'
  ? describeDesignConstraintRequirement(constraint) : undefined

const styles = {
  dimension: { icon: Ruler, color: '#536c8b', label: 'Panel dimension' },
  'equal-dimension': { icon: Equal, color: '#536c8b', label: 'Equal dimensions' },
  floor: { icon: ArrowDownToLine, color: '#6a8750', label: 'Floor height' },
  level: { icon: AlignVerticalJustifyCenter, color: '#6a8750', label: 'Same level' },
  gap: { icon: ArrowLeftRight, color: '#83668c', label: 'Clear gap' },
  'opening-ratio': { icon: Ratio, color: '#83668c', label: 'Proportional openings' },
  position: { icon: LockKeyhole, color: '#887044', label: 'Fixed position' },
  setback: { icon: MoveHorizontal, color: '#887044', label: 'Setback' },
}

/** Rule measurements use resolved geometry before display/exploded transforms. */
export function DesignConstraintOverlay({ constraint, panels, compact = false }: Props) {
  if (!constraint) return null
  const measurement = designConstraintMeasurements(constraint, panels)
  if (!measurement) return null
  return <MeasuredConstraint key={constraint.id} constraint={constraint} panels={panels} measurement={measurement} compact={compact}/>
}

function MeasuredConstraint({ constraint, panels, measurement, compact }: {
  constraint: DesignConstraint; panels: Panel[]
  measurement: ConstraintMeasurement; compact: boolean
}) {
  const { inspected, active, inspect } = useConstraintInspection(constraint.id)
  const tooltipId = useId()
  const inspectedLine = measurement.lines.find(line => line.id === inspected?.lineId) ?? measurement.lines[0]
  const requirement = requirementFor(constraint)
  const { icon: Icon, color: typeColor, label } = styles[constraint.kind]
  const color = !constraint.enabled ? '#92988a' : measurement.violation ? '#af753e' : typeColor
  return <group>{measurement.lines.map((line, index) => {
    const from = meters(line.from), to = meters(line.to)
    const position = midpoint(from, to)
    return <group key={line.id}>
      <ConstraintMeasurementLine id={constraint.id} from={from} to={to} leaders={line.leaders?.map(([a, b]) => [meters(a), meters(b)])}
        kind={constraint.kind} color={color} paused={!constraint.enabled} active={active || !compact}
        onPointerEnter={() => inspect('hovered', line.id, true)} onPointerLeave={() => inspect('hovered', line.id, false)}/>
      <ConstraintLabel id={`rule-${constraint.id}-${line.id}`} position={position} color={color}>
        {compact ? <button type="button" className="constraint-guide-marker" style={{ color }}
          data-constraint-id={constraint.id} data-constraint-kind={constraint.kind} data-active={active} data-paused={!constraint.enabled}
          aria-label={`${label}: ${line.label}${!constraint.enabled ? ' · Paused' : ''}`}
          aria-describedby={active ? tooltipId : undefined}
          onPointerEnter={() => inspect('hovered', line.id, true)} onPointerLeave={() => inspect('hovered', line.id, false)}
          onFocus={() => inspect('focused', line.id, true)} onBlur={() => inspect('focused', line.id, false)}
          onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); event.currentTarget.focus() }}>
          <Icon size={13} aria-hidden="true"/>
          {constraint.kind === 'opening-ratio' && <span aria-hidden="true">{index === 0 ? '1' : constraint.ratio}</span>}
          {measurement.violation > 0 && <span className="constraint-guide-warning" aria-hidden="true">!</span>}
        </button> : <span className="constraint-overlay-label constraint-rule-label" style={{ borderColor: color, color }}>
          <span className="constraint-rule-measurement"><Icon size={12}/>{line.label}{!constraint.enabled && ' · Paused'}{measurement.violation > 0 && ' · !'}</span>
          {requirement && <small>{requirement}</small>}
          {constraint.kind === 'opening-ratio' && <small>Ratio 1 : {constraint.ratio}</small>}
        </span>}
      </ConstraintLabel>
    </group>
  })}
    {compact && active && <ConstraintLabel id={`tooltip-${constraint.id}`} position={meters(midpoint(inspectedLine.from, inspectedLine.to))} color={color}>
      <ConstraintTooltip id={tooltipId} constraint={constraint} measurement={measurement} panels={panels} color={color}/>
    </ConstraintLabel>}
  </group>
}

function ConstraintTooltip({ id, constraint, measurement, panels, color }: {
  id: string; constraint: DesignConstraint; measurement: ConstraintMeasurement; panels: Panel[]; color: string
}) {
  const { icon: Icon, label } = styles[constraint.kind]
  const requirement = requirementFor(constraint)
  const panelNames = [...new Set('panelId' in constraint ? [constraint.panelId] : constraint.panelIds)]
    .map(panelId => panels.find(panel => panel.id === panelId)?.name).filter(Boolean).join(' · ')
  return <span id={id} role="tooltip" className="constraint-overlay-label constraint-guide-tooltip" style={{ borderColor: color, color }} data-constraint-tooltip={constraint.id}>
    <strong className="constraint-rule-measurement"><Icon size={13}/>{label}{!constraint.enabled && ' · Paused'}{measurement.violation > 0 && ' · Needs attention'}</strong>
    {measurement.lines.map(line => <span className="constraint-guide-value" key={line.id}>{line.label}</span>)}
    {requirement && <small>{requirement}</small>}
    {constraint.kind === 'opening-ratio' && <small>Ratio 1 : {constraint.ratio}</small>}
    <small className="constraint-guide-panels">{panelNames}</small>
  </span>
}
