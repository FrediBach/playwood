import { useMemo } from 'react'
import { EyeOff, Link2 } from 'lucide-react'
import { CONNECTORS, CONNECTOR_COLORS } from '@/lib/connector-options'
import type { getPhysicalConnectors } from '@/lib/connector-selection'
import type { Panel } from '@/lib/types'
import { ConnectorGlyph } from './editor-controls'
import './connector-list.css'

interface Props {
  connectors: ReturnType<typeof getPhysicalConnectors>
  panels: Panel[]
  selectedIds: string[]
  onSelect: (id: string, additive?: boolean) => void
  onSelectAll: (selected: boolean) => void
}

export function ConnectorList({ connectors, panels, selectedIds, onSelect, onSelectAll }: Props) {
  const panelsById = useMemo(() => new Map(panels.map(panel => [panel.id, panel])), [panels])
  const selected = new Set(selectedIds)
  const selectedCount = connectors.filter(connector => selected.has(connector.id)).length
  const allSelected = connectors.length > 0 && selectedCount === connectors.length

  return <div onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      if (connectors.length) onSelectAll(true)
    }
  }}>
    <div className="section-label"><span>YOUR CONNECTORS</span><span className="count-badge">{connectors.length.toString().padStart(2, '0')}</span></div>
    <div className="selection-tools">
      <span aria-live="polite" aria-atomic="true">{selectedCount ? `${selectedCount} selected` : 'Select to edit colors'}</span>
      <button onClick={() => onSelectAll(!allSelected)} disabled={!connectors.length}>{allSelected ? 'Clear' : 'Select all'}</button>
    </div>
    <ul className="connector-list" aria-label="Connectors">
      {connectors.map(connector => {
        const parent = panelsById.get(connector.connection.parentId)
        const child = panelsById.get(connector.connection.childId)
        const type = CONNECTORS.find(type => type.id === connector.type)!
        const color = CONNECTOR_COLORS.find(color => color.color.toLowerCase() === connector.color.toLowerCase())?.name ?? connector.color
        const joint = `${parent?.name ?? 'Panel'} ↔ ${child?.name ?? 'Panel'}`
        const label = `${type.name} connector ${connector.index + 1}: ${joint}`
        const hidden = !parent?.visible || !child?.visible
        const isSelected = selected.has(connector.id)
        return <li key={connector.id} data-connector-id={connector.id} className={`connector-list-row ${isSelected ? 'selected' : ''}`}>
          <label className="panel-selection-toggle"><input type="checkbox" aria-label={`Select ${label}`} checked={isSelected} onChange={() => onSelect(connector.id, true)}/></label>
          <button className="connector-list-select" aria-label={label} aria-pressed={isSelected} title={`${label} · ${color}${hidden ? ' · Panels hidden' : ''}`}
            onClick={event => onSelect(connector.id, event.shiftKey || event.metaKey || event.ctrlKey)}>
            <span className="connector-list-glyph" style={{ color: connector.color }}><ConnectorGlyph type={connector.type}/></span>
            <span className="connector-list-copy"><span className="connector-list-name">{type.name} connector <small>#{connector.index + 1}</small></span><span className="connector-list-joint">{joint}</span></span>
            {hidden && <EyeOff className="connector-list-hidden" size={13} aria-label="Panels hidden"/>}
          </button>
        </li>
      })}
    </ul>
    {!connectors.length && <div className="empty-panels"><Link2 size={30}/><p>No connectors yet.<br/>Attach panels or auto-add connectors<br/>to connect your build.</p></div>}
  </div>
}
