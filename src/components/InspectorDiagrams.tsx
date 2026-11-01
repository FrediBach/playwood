import type { Side } from '@/lib/types'

export function PanelDimensionsDiagram() {
  return <svg className="inspector-diagram" viewBox="0 0 264 100" role="img" aria-label="Panel dimensions: width across the face, height along the face, thickness through the edge.">
    <path className="diagram-board" d="M56 22h130v49H56zM186 22l15-10v49l-15 10M56 22l15-10h130"/>
    <path className="diagram-measure" d="M56 81h130m-130-4v8m130-8v8M44 22v49m-4-49h8m-8 49h8M199 72l15-10"/>
    <text x="121" y="97" textAnchor="middle">Width</text><text x="29" y="49" textAnchor="middle" transform="rotate(-90 29 49)">Height</text><text x="206" y="86" textAnchor="middle">Thickness</text>
  </svg>
}

/** A local panel-plane schematic, not a simulation of connector clearance. */
export function JointPositionDiagram({ side }: { side: Side }) {
  const horizontal = side === 'top' || side === 'bottom' || side === 'front' || side === 'back'
  const face = side === 'front' || side === 'back'
  const joint = horizontal ? `M58 ${face ? 46 : side === 'top' ? 22 : 70}h132` : `M${side === 'left' ? 58 : 190} 22v48`
  return <figure className="joint-position-diagram">
    <svg className="inspector-diagram" viewBox="0 0 264 108" role="img" aria-label={`${side} side: offset moves along the joint; inset moves across the panel.`}>
      <rect className="diagram-board" x="58" y="22" width="132" height="48" rx="2"/>
      <path className="diagram-joint" d={joint}/>
      <path className="diagram-measure" d="M70 86h108m-103-4-5 4 5 4m98-8 5 4-5 4M211 26v40m-4-35 4-5 4 5m-8 30 4 5 4-5"/>
      <text x="124" y="103" textAnchor="middle">{horizontal ? 'Offset' : 'Inset'}</text>
      <text x="232" y="48" textAnchor="middle" transform="rotate(-90 232 48)">{horizontal ? 'Inset' : 'Offset'}</text>
      <text x="124" y="14" textAnchor="middle">{side[0].toUpperCase() + side.slice(1)} {face ? 'face' : 'edge'}</text>
    </svg>
  </figure>
}
