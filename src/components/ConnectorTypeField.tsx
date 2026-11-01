import { CONNECTORS } from '@/lib/connector-options'
import type { ConnectorType } from '@/lib/types'
import { ConnectorGlyph } from './editor-controls'
import { Tooltip } from './ui/tooltip'

/** The same visual hardware choices are used for inspection and attachment. */
export function ConnectorTypeField({ value, onChange }: {
  value: ConnectorType | ''
  onChange: (type: ConnectorType) => void
}) {
  return <div className="field connector-type-field">
    <span>Connector type{!value && <span className="field-hint">Mixed types</span>}</span>
    <div className="connector-options" role="group" aria-label="Connector type">
      {CONNECTORS.map(connector => <Tooltip key={connector.id} label={connector.description}>
        <button type="button" className={value === connector.id ? 'selected' : ''}
          aria-label={`${connector.name} connector`} aria-pressed={value === connector.id}
          onClick={() => onChange(connector.id)}>
          <ConnectorGlyph type={connector.id}/><span>{connector.name}</span>
        </button>
      </Tooltip>)}
    </div>
  </div>
}
