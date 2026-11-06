import { Html, Line } from '@react-three/drei'
import { describeDesignConstraintRequirement } from '@/lib/design-constraints'
import { designConstraintMeasurements } from '@/lib/design-constraint-measurements'
import type { DesignConstraint, Panel, Vec3 } from '@/lib/types'

interface Props {
  constraint: DesignConstraint | null
  panels: Panel[]
}
const meters = (point: Vec3): Vec3 => point.map(value => value * 0.001) as Vec3

/** Selected rule only; measurements use resolved geometry before display/exploded transforms. */
export function DesignConstraintOverlay({ constraint, panels }: Props) {
  if (!constraint) return null
  const measurement = designConstraintMeasurements(constraint, panels)
  if (!measurement) return null
  const requirement = constraint.kind === 'floor' || constraint.kind === 'dimension' || constraint.kind === 'gap' ? describeDesignConstraintRequirement(constraint) : undefined
  const color = !constraint.enabled ? '#92988a' : measurement.violation ? '#af753e' : '#6a8750'
  return <group>{measurement.lines.map(line => {
    const from = meters(line.from), to = meters(line.to)
    const midpoint: Vec3 = from.map((coordinate, axis) => (coordinate + to[axis]) / 2) as Vec3
    return <group key={line.id}>
      <Line points={[from, to]} color={color} lineWidth={1.5} depthTest={false}/>
      {line.leaders?.map((points, leader) => <Line key={leader} points={points.map(meters)} color={color} lineWidth={0.7} transparent opacity={0.6} depthTest={false}/>)}
      {[from, to].map((point, endpoint) => <mesh key={endpoint} position={point}><sphereGeometry args={[0.003, 8, 8]}/><meshBasicMaterial color={color} depthTest={false}/></mesh>)}
      <Html position={midpoint} center style={{ pointerEvents: 'none' }}><span className="constraint-overlay-label">{line.label}{requirement && <small>{requirement}</small>}</span></Html>
    </group>
  })}</group>
}
