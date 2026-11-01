import { useId } from 'react'
import { CONNECTOR_MATERIALS } from '@/lib/connector-options'
import type { ConnectorMaterial } from '@/lib/types'
import './connector-material-field.css'

export function ConnectorMaterialField({ material, metalAvailable, onChange }: {
  material: ConnectorMaterial | ''
  metalAvailable: boolean
  onChange: (material: ConnectorMaterial) => void
}) {
  const helpId = useId()
  return <div className="field">
    <span>Connector material{!material && <span className="field-hint">Mixed</span>}</span>
    <div className="connector-material-options" role="group" aria-label="Connector material" aria-describedby={!metalAvailable ? helpId : undefined}>
      {CONNECTOR_MATERIALS.map(option => <button key={option.id} type="button"
        aria-label={`${option.name} connector material`} aria-pressed={material === option.id}
        disabled={option.id === 'metal' && !metalAvailable} onClick={() => onChange(option.id)}>
        <i className={`connector-material-sample ${option.id}`} aria-hidden="true"/>
        <span>{option.name}<small>{option.detail}</small></span>
      </button>)}
    </div>
    {!metalAvailable && <p id={helpId} className="field-note">Metal is available for 90° connectors only.</p>}
  </div>
}
