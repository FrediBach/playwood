import { ConnectorColorField } from './ConnectorColorField'
import { Link2, Trash2 } from 'lucide-react'
import type { ConnectorOverride, ConnectorType } from '@/lib/types'
import { getPhysicalConnectors } from '@/lib/connector-selection'
import { CONNECTORS } from '@/lib/connector-options'
import { SelectField } from './fields'
import { Button } from './ui/button'

export function ConnectorInspector({ connectors, onChange, onRemove }: {
  connectors: ReturnType<typeof getPhysicalConnectors>
  onChange: (patch: ConnectorOverride) => void
  onRemove: () => void
}) {
  const first = connectors[0]
  const sameType = connectors.every(connector => connector.type === first.type)
  const sameColor = connectors.every(connector => connector.color.toLowerCase() === first.color.toLowerCase())
  return <>
    <div className="selected-heading"><Link2 size={15}/><span>{connectors.length === 1 ? 'SELECTED CONNECTOR' : `${connectors.length} SELECTED CONNECTORS`}</span></div>
    <section className="inspector-section">
      <SelectField label="Connector type" value={sameType ? first.type : ''} onChange={type => onChange({ type: type as ConnectorType })}>
        {!sameType && <option value="" disabled>Mixed types</option>}
        {CONNECTORS.map(type => <option key={type.id} value={type.id}>{type.name} · {type.description}</option>)}
      </SelectField>
      <ConnectorColorField color={first.color} mixed={!sameColor} onChange={color => onChange({ color })}/>
      <p className="field-note">Shift, ⌘ or Ctrl-click connectors to select several. Changes apply to the selected pieces of hardware.</p>
      <p className="field-note">Panels keep their placement when hardware is changed or removed.</p>
      {connectors.some(connector => connector.type !== connector.connection.type) && <p className="validation-note warning">The replacement type differs from the joint layout. Check that its angle and openings fit the panels.</p>}
    </section>
    <div className="panel-actions"><Button variant="outline" onClick={onRemove}><Trash2 size={15}/>Remove {connectors.length === 1 ? 'connector' : 'connectors'}</Button></div>
  </>
}
