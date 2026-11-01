import { useMemo, useState } from 'react'
import { EyeOff, GripVertical, Link2 } from 'lucide-react'
import { CONNECTORS, CONNECTOR_COLORS, CONNECTOR_MATERIALS, METAL_CONNECTOR_COLOR, connectorDisplayColor } from '@/lib/connector-options'
import type { getPhysicalConnectors } from '@/lib/connector-selection'
import type { Panel } from '@/lib/types'
import { ConnectorGlyph } from './editor-controls'
import './connector-list.css'
import { GroupedList, type ListGroupingProps } from './GroupedList'

import { ListFilters, FilterChoices, FilterResults, emptyFilters, filterCount, matchesCommon, matchesChoice } from './ListFilters'

interface Props extends ListGroupingProps {
  connectors: ReturnType<typeof getPhysicalConnectors>
  panels: Panel[]
  selectedIds: string[]
  onSelect: (id: string, additive?: boolean) => void
  onSelectAll: (selected: boolean) => void
}

export function ConnectorList({ connectors, panels, selectedIds, onSelect, onSelectAll, ...grouping }: Props) {
  const panelsById = useMemo(() => new Map(panels.map(panel => [panel.id, panel])), [panels])
  const selected = new Set(selectedIds)
  const [filters, setFilters] = useState(emptyFilters)
  const filtering = filterCount(filters) > 0
  const matching = connectors.filter(connector => matchesCommon(filters, `${CONNECTORS.find(type => type.id === connector.type)?.name} ${connector.material} ${panelsById.get(connector.connection.parentId)?.name ?? ''} ${panelsById.get(connector.connection.childId)?.name ?? ''}`, connectorDisplayColor(connector), !!panelsById.get(connector.connection.parentId)?.visible && !!panelsById.get(connector.connection.childId)?.visible, selected.has(connector.id)) && matchesChoice(filters.types, connector.type) && matchesChoice(filters.materials, connector.material))
  const selectMatching = (value: boolean) => filtering ? grouping.onSelectGroup(matching.map(connector => connector.id), value) : onSelectAll(value)
  const selectedCount = connectors.filter(connector => selected.has(connector.id)).length
  const allSelected = matching.length > 0 && matching.every(connector => selected.has(connector.id))

  return <div onKeyDown={event => {
    if ((event.target as HTMLElement).tagName === 'INPUT' && (event.target as HTMLInputElement).type !== 'checkbox') return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      if (matching.length) selectMatching(true)
    }
  }}>
    <div className="section-label"><span>YOUR CONNECTORS</span><ListFilters kind="connectors" filters={filters} onChange={setFilters} count={matching.length} total={connectors.length}>
      <FilterChoices label="Color" colors values={[...new Set(connectors.map(connector => connectorDisplayColor(connector).toLowerCase()))].sort().map(color => ({ value: color, label: color === METAL_CONNECTOR_COLOR ? 'Silver' : CONNECTOR_COLORS.find(option => option.color === color)?.name ?? color }))} selected={filters.colors} onChange={colors => setFilters({ ...filters, colors })}/>
      <FilterChoices label="Material" values={CONNECTOR_MATERIALS.map(material => ({ value: material.id, label: material.name }))} selected={filters.materials} onChange={materials => setFilters({ ...filters, materials })}/>
      <FilterChoices label="Connector type" values={CONNECTORS.map(type => ({ value: type.id, label: type.name }))} selected={filters.types} onChange={types => setFilters({ ...filters, types })}/>
    </ListFilters><span className="count-badge">{connectors.length.toString().padStart(2, '0')}</span></div>
    <div className="selection-tools">
      <span aria-live="polite" aria-atomic="true">{selectedCount ? `${selectedCount} selected` : 'Select to edit finishes'}</span>
      <button onClick={() => selectMatching(!allSelected)} disabled={!matching.length}>{allSelected ? 'Clear' : 'Select all'}</button>
    </div>
    {filtering && <FilterResults count={matching.length} total={connectors.length} onReset={() => setFilters(emptyFilters())}/>}
    <GroupedList {...grouping} onSelect={onSelect} items={matching} selectedIds={selectedIds} kind="connectors"
      label={connector => `${CONNECTORS.find(type => type.id === connector.type)!.name} connector ${connector.index + 1}: ${panelsById.get(connector.connection.parentId)?.name ?? 'Panel'} ↔ ${panelsById.get(connector.connection.childId)?.name ?? 'Panel'}`}
      renderItem={(connector, handle) => {
        const parent = panelsById.get(connector.connection.parentId)
        const child = panelsById.get(connector.connection.childId)
        const type = CONNECTORS.find(type => type.id === connector.type)!
        const color = connector.material === 'metal' ? 'Cast metal · Silver' : CONNECTOR_COLORS.find(color => color.color.toLowerCase() === connector.color.toLowerCase())?.name ?? connector.color
        const joint = `${parent?.name ?? 'Panel'} ↔ ${child?.name ?? 'Panel'}`
        const label = `${type.name} connector ${connector.index + 1}: ${joint}`
        const hidden = !parent?.visible || !child?.visible
        const isSelected = selected.has(connector.id)
        return <div key={connector.id} data-connector-id={connector.id} className={`connector-list-row ${isSelected ? 'selected' : ''}`}>
          <label className="panel-selection-toggle"><input type="checkbox" aria-label={`Select ${label}`} checked={isSelected} onChange={() => onSelect(connector.id, true)}/></label>
          <button className="connector-drag-handle" data-list-handle {...handle}><GripVertical size={14}/></button>
          <button className="connector-list-select" aria-label={label} aria-pressed={isSelected} title={`${label} · ${color}${hidden ? ' · Panels hidden' : ''}`}
            onClick={event => onSelect(connector.id, event.shiftKey || event.metaKey || event.ctrlKey)}>
            <span className="connector-list-glyph" style={{ color: connectorDisplayColor(connector) }}><ConnectorGlyph type={connector.type}/></span>
            <span className="connector-list-copy"><span className="connector-list-name">{type.name} connector <small>#{connector.index + 1}{connector.material === 'metal' ? ' · Metal' : ''}</small></span><span className="connector-list-joint">{joint}</span></span>
            {hidden && <EyeOff className="connector-list-hidden" size={13} aria-label="Panels hidden"/>}
          </button>
        </div>
      }}/>
    {!connectors.length && <div className="empty-panels"><Link2 size={30}/><p>No connectors yet.<br/>Attach panels or auto-add connectors<br/>to connect your build.</p></div>}
  </div>
}
