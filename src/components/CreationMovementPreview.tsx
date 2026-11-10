import { useId } from 'react'
import type { getProjectBounds } from '@/lib/model'
import type { Vec3 } from '@/lib/types'

type Bounds = ReturnType<typeof getProjectBounds>

function PositionView({ bounds, delta, backWall, top }: { bounds: Bounds; delta: Vec3; backWall: number; top: boolean }) {
  const marker = useId()
  const vertical = top ? 2 : 1
  const reference = top ? backWall : 0
  const minX = Math.min(bounds.min[0], bounds.min[0] + delta[0], 0)
  const maxX = Math.max(bounds.max[0], bounds.max[0] + delta[0], 0)
  const minV = Math.min(bounds.min[vertical], bounds.min[vertical] + delta[vertical], reference)
  const maxV = Math.max(bounds.max[vertical], bounds.max[vertical] + delta[vertical], reference)
  const scale = Math.min(190 / Math.max(maxX - minX, 1), 95 / Math.max(maxV - minV, 1))
  const x = (value: number) => 120 + (value - (minX + maxX) / 2) * scale
  const y = (value: number) => 80 + (top ? 1 : -1) * (value - (minV + maxV) / 2) * scale
  const width = bounds.width * scale
  const height = (bounds.max[vertical] - bounds.min[vertical]) * scale
  const centerX = (bounds.min[0] + bounds.max[0]) / 2
  const centerV = (bounds.min[vertical] + bounds.max[vertical]) / 2
  const changed = delta[0] !== 0 || delta[vertical] !== 0
  return <svg viewBox="0 0 240 160" role="img" aria-label={top ? 'Top view movement preview' : 'Front view movement preview'}>
    <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#c44929"/></marker></defs>
    <text x="12" y="15" className="movement-view-title">{top ? 'TOP · X / Z' : 'FRONT · X / Y'}</text>
    <line x1="12" x2="228" y1={y(reference)} y2={y(reference)} stroke="#8c967f"/>
    <text x="228" y={y(reference) - 5} textAnchor="end">{top ? 'Back wall (−Z)' : 'Floor · Y = 0'}</text>
    <line x1={x(0)} x2={x(0)} y1="28" y2="132" stroke="#bcc2b3" strokeDasharray="2 4"/>
    <rect x={x(bounds.min[0] + delta[0])} y={y((top ? bounds.min[vertical] : bounds.max[vertical]) + delta[vertical])} width={width} height={height} fill="#c44929" fillOpacity=".13" stroke="#c44929" strokeWidth="1.5"/>
    <rect x={x(bounds.min[0])} y={y(top ? bounds.min[vertical] : bounds.max[vertical])} width={width} height={height} fill="none" stroke="#65705b" strokeWidth="1.5" strokeDasharray="4 3"/>
    {changed && <line x1={x(centerX)} y1={y(centerV)} x2={x(centerX + delta[0])} y2={y(centerV + delta[vertical])} stroke="#c44929" strokeWidth="1.5" markerEnd={`url(#${marker})`}/>}
    <text x="12" y="151">← Left (−X)</text><text x="228" y="151" textAnchor="end">{top ? 'Forward (+Z) ↓' : 'Up (+Y) ↑'}</text>
  </svg>
}

export function CreationMovementPreview({ bounds, delta, backWall }: { bounds: Bounds; delta: Vec3; backWall: number }) {
  const floor = bounds.min[1] + delta[1]
  const wall = bounds.min[2] + delta[2] - backWall
  const mm = (value: number) => Math.round(Math.abs(value)).toLocaleString()
  return <figure className="movement-preview">
    <div className="movement-views">
      <PositionView bounds={bounds} delta={delta} backWall={backWall} top/>
      <PositionView bounds={bounds} delta={delta} backWall={backWall} top={false}/>
    </div>
    <figcaption>
      <div className="movement-legend"><span>┄ Current</span><span>━ Proposed</span><span>Overall bounds</span></div>
      <p role="status">{floor < 0 ? `${mm(floor)} mm below floor` : `${mm(floor)} mm above floor`} · {wall < 0 ? `${mm(wall)} mm behind wall` : `${mm(wall)} mm from wall`}</p>
    </figcaption>
  </figure>
}
