import { Check } from 'lucide-react'
import { CONNECTOR_COLORS } from '@/lib/connector-options'

export function ConnectorColorField({ color, mixed = false, onChange }: {
  color: string
  mixed?: boolean
  onChange: (color: string) => void
}) {
  const selectedColor = mixed ? undefined : CONNECTOR_COLORS.find(option => option.color.toLowerCase() === color.toLowerCase())
  return <div className="field">
    <span>Connector color <span className="field-hint">{mixed ? 'Mixed' : selectedColor?.name ?? 'Existing color'}</span></span>
    <div className="swatches" role="group" aria-label="Connector color">
      {CONNECTOR_COLORS.map(option => {
        const selected = selectedColor === option
        return <button key={option.color} type="button" className={`swatch ${selected ? 'selected' : ''}`}
          style={{ background: option.color }} title={option.name} aria-label={`${option.name} connector color`} aria-pressed={selected}
          onClick={() => onChange(option.color)}>
          {selected && <Check size={15} style={{ color: 'white', filter: 'drop-shadow(0 1px 1px #000)' }}/>}
        </button>
      })}
    </div>
  </div>
}
