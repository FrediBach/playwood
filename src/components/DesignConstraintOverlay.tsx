import { ArrowDownToLine, ArrowLeftRight, Equal, LockKeyhole, MoveHorizontal, Ratio, Ruler, AlignVerticalJustifyCenter } from 'lucide-react'
import { ConstraintLabel } from './ConstraintLabels'
import { Line } from '@react-three/drei'
import { describeDesignConstraintRequirement } from '@/lib/design-constraints'
import { designConstraintMeasurements } from '@/lib/design-constraint-measurements'
import type { DesignConstraint, Panel, Vec3 } from '@/lib/types'

interface Props {
  constraint: DesignConstraint | null
  panels: Panel[]
  compact?: boolean
}
const meters = (point: Vec3): Vec3 => point.map(value => value * 0.001) as Vec3

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

/** Rule measurements; measurements use resolved geometry before display/exploded transforms. */
export function DesignConstraintOverlay({ constraint, panels, compact = false }: Props) {
  if (!constraint) return null
  const measurement = designConstraintMeasurements(constraint, panels)
  if (!measurement) return null
  const requirement = constraint.kind === 'floor' || constraint.kind === 'dimension' || constraint.kind === 'gap' || constraint.kind === 'position' || constraint.kind === 'setback' ? describeDesignConstraintRequirement(constraint) : undefined
  const { icon: Icon, color: typeColor, label } = styles[constraint.kind]
  const color = !constraint.enabled ? '#92988a' : measurement.violation ? '#af753e' : typeColor
  return <group>{measurement.lines.map(line => {
    const from = meters(line.from), to = meters(line.to)
    const midpoint: Vec3 = from.map((coordinate, axis) => (coordinate + to[axis]) / 2) as Vec3
    return <group key={line.id}>
      <Line points={[from, to]} color={color} lineWidth={compact ? 2.5 : 3} dashed={!constraint.enabled || constraint.kind === 'level'} dashSize={0.012} gapSize={0.008} depthTest={false}/>
      {line.leaders?.map((points, leader) => <Line key={leader} points={points.map(meters)} color={color} lineWidth={1.5} transparent opacity={0.85} depthTest={false}/>)}
      {[from, to].map((point, endpoint) => <mesh key={endpoint} position={point}><sphereGeometry args={[0.003, 8, 8]}/><meshBasicMaterial color={color} depthTest={false}/></mesh>)}
      <ConstraintLabel id={`rule-${constraint.id}-${line.id}`} position={midpoint} color={color}><span className={`constraint-overlay-label constraint-rule-label ${compact ? 'is-compact' : ''}`} style={{ borderColor: color, color }} data-constraint-id={constraint.id} data-constraint-kind={constraint.kind} aria-label={`${label}: ${line.label}${!constraint.enabled ? ' · Paused' : ''}`}><span className="constraint-rule-measurement"><Icon size={12}/>{line.label}{!constraint.enabled && ' · Paused'}{measurement.violation > 0 && ' · !'}</span>{!compact && requirement && <small>{requirement}</small>}{constraint.kind === 'opening-ratio' && <small>Ratio 1 : {constraint.ratio}</small>}</span></ConstraintLabel>
    </group>
  })}</group>
}
