import { ArrowDownToLine } from 'lucide-react'
import { InspectorDisclosure } from './InspectorPrimitives'
import type { SelectionLocation as Location } from '@/lib/selection-location'

const number = (value: number) => String(Math.round(value * 10) / 10)

export function SelectionLocation({ location }: { location: Location | null }) {
  if (!location) return null
  const { min, max, rotation, note } = location
  return <section className="selection-location" aria-label="Scene location">
    <InspectorDisclosure title="Scene location" trailing={<span className="selection-ground-clearance" title="Ground clearance"><ArrowDownToLine size={14} aria-hidden="true"/><span className="visually-hidden">Ground clearance: </span>{number(min[1])} mm</span>}>
    <table><thead><tr><th scope="col">Axis (mm)</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Center</th></tr></thead>
      <tbody>{['X', 'Y', 'Z'].map((axis, i) => <tr key={axis}><th scope="row">{axis}</th><td>{number(min[i])}</td><td>{number(max[i])}</td><td>{number((min[i] + max[i]) / 2)}</td></tr>)}</tbody>
    </table>
    <dl><div><dt>Ground clearance</dt><dd>{number(min[1])} mm</dd></div>
      <div><dt>Rotation X / Y / Z</dt><dd>{rotation ? rotation.map(angle => `${number(angle * 180 / Math.PI)}°`).join(' / ') : '—'}</dd></div></dl>
    <p>{note}{min[1] < -0.05 ? ' · Below ground' : ''}</p>
    </InspectorDisclosure>
  </section>
}
