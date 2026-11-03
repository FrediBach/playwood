import { Html, Line } from '@react-three/drei'
import { spaceBounds, spaceClearances } from '@/lib/space-constraint'
import type { Panel, SpaceConstraint, Vec3 } from '@/lib/types'

export function SpaceConstraintOverlay({ space, panels }: { space: SpaceConstraint; panels: Panel[] }) {
  if (!space.enabled) return null
  const { min, max } = spaceBounds(space)
  const rows = spaceClearances(space, panels)
  const corners: Vec3[] = Array.from({ length: 8 }, (_, i) => min.map((v, axis) => ((i & (1 << axis)) ? max[axis] : v) / 1000) as Vec3)
  const near = rows.filter(row => row.clearance <= 10)
  const outside = near.some(row => row.clearance < -0.1)
  return <group>
    {corners.flatMap((point, index) => [0, 1, 2].filter(axis => !(index & (1 << axis))).map(axis => {
      const faces = [0, 1, 2].filter(a => a !== axis).map(a => a * 2 + ((index & (1 << a)) ? 1 : 0))
      const close = rows.some(row => faces.some(face => row.clearances[face] <= 10))
      return <Line key={`${index}-${axis}`} points={[point, corners[index | (1 << axis)]]} color={close ? '#d18431' : '#6a8750'} lineWidth={close ? 2.5 : 1} transparent opacity={0.8} depthTest={false}/>
    }))}
    <Html position={[max[0] / 1000, max[1] / 1000, max[2] / 1000]} style={{ pointerEvents: 'none' }}><span className="constraint-overlay-label" role="status">Build space · {space.width} × {space.height} × {space.depth} mm{near.length > 0 && <small>{outside ? 'Outside build space' : 'Space boundary reached'} · {near.map(row => row.panel.name).join(', ')}</small>}</span></Html>
  </group>
}
