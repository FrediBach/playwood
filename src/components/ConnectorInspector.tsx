import { ConnectorColorField } from './ConnectorColorField'
import { ConnectorMaterialField } from './ConnectorMaterialField'
import { Link2, Plus, Trash2 } from 'lucide-react'
import type { ConnectorOverride, ConnectorType, Panel } from '@/lib/types'
import { getPhysicalConnectors } from '@/lib/connector-selection'
import { CONNECTORS } from '@/lib/connector-options'
import { ConnectorTypeField } from './ConnectorTypeField'
import { InspectorDisclosure } from './InspectorPrimitives'
import { Button } from './ui/button'
import './connector-inspector.css'

export function ConnectorInspector({ connectors, panels = [], onChange, onTypeChange, typeError, onRemove, onConnectPanel, panelFitReason, fitSummary }: {
  connectors: ReturnType<typeof getPhysicalConnectors>
  panels?: Panel[]
  onChange: (patch: ConnectorOverride) => void
  onTypeChange: (type: ConnectorType) => void
  typeError?: string
  onRemove: () => void
  onConnectPanel: () => void
  panelFitReason: string
  fitSummary?: string
}) {
  const first = connectors[0]
  if (!first) return null
  const sameType = connectors.every(connector => connector.type === first.type)
  const sameColor = connectors.every(connector => connector.color.toLowerCase() === first.color.toLowerCase())
  const sameMaterial = connectors.every(connector => connector.material === first.material)
  const single = connectors.length === 1
  const typeName = CONNECTORS.find(type => type.id === first.type)?.name ?? first.type
  const panelNames = [first.connection.parentId, first.connection.childId].map(id => panels.find(panel => panel.id === id)?.name).filter(Boolean)
  const jointCount = new Set(connectors.map(connector => connector.connection.id)).size
  const changedLayout = connectors.some(connector => connector.type !== connector.connection.type)
  return <>
    <div className="connector-selection-heading">
      <div><Link2 size={18}/><h2>{single ? `${typeName} connector` : `${connectors.length} connectors`}</h2></div>
      <p className="inspector-summary">{single
        ? panelNames.length ? panelNames.join(' ↔ ') : 'Selected hardware'
        : `${jointCount} ${jointCount === 1 ? 'joint' : 'joints'} · ${sameType ? `${typeName} hardware` : 'Mixed types'}`}</p>
    </div>
    <section className="inspector-section" aria-label="Hardware">
      <ConnectorTypeField value={sameType ? first.type : ''} onChange={onTypeChange}/>
      <p className="field-note">90°, 105° and 150° change the whole joint, including its other connectors. Attached panels and their connected branches follow the angle. T and Cross change selected hardware only.</p>
      {typeError && <p className="validation-note warning connector-type-warning" role="alert">{typeError}</p>}
      {changedLayout && <p className="validation-note warning connector-type-warning" role="status">Hardware changed; panel angles stay unchanged. Check that the openings fit the joint.</p>}
      <ConnectorMaterialField material={sameMaterial ? first.material : ''} metalAvailable={connectors.every(connector => connector.type === '90')} onChange={material => onChange({ material })}/>
      {sameMaterial && first.material === 'plastic' && <ConnectorColorField color={first.color} mixed={!sameColor} onChange={color => onChange({ color })}/>}
    </section>
    <section className="inspector-section connector-build-section" aria-label="Connect a panel">
      {single ? <p className="field-note">To add a panel, select at least two connectors with free T or Cross openings.</p> : <>
        <Button variant={panelFitReason ? 'outline' : 'default'} className="full-button" onClick={onConnectPanel} disabled={!!panelFitReason} aria-describedby="connector-fit-status"><Plus size={15}/>Connect with a panel</Button>
        <p className="field-note" id="connector-fit-status" role="status">{panelFitReason || (fitSummary ? `Fits one ${fitSummary} panel to the selected openings.` : 'Fits one panel to the selected free openings.')}</p>
      </>}
    </section>
    <InspectorDisclosure title="Selection & movement" preferenceKey="connector-help">
      <p className="field-note">Shift, ⌘ or Ctrl-click to select several connectors. Angle changes apply to their whole joints. Material and color changes apply to each selected piece.</p>
      <p className="field-note">Use arrow keys in the workspace to slide hardware along its joint; hold Shift for larger steps. Snapping follows the workspace settings. Movement stops at panel ends and other connectors.</p>
    </InspectorDisclosure>
    <div className="connector-remove-action">
      <Button variant="ghost" size="sm" onClick={onRemove}><Trash2 size={15}/>Remove {single ? 'connector' : 'connectors'}</Button>
      <p className="field-note">Panels stay in place.</p>
    </div>
  </>
}
