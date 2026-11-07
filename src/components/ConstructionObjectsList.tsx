import { nextVisibility, visibilityAction } from '@/lib/visibility'
import { Box, Eye, EyeOff, ScanEye, Plus } from 'lucide-react'
import { Button } from './ui/button'
import type { ConstructionObject, ConstructionObjects } from '@/lib/types'
import './construction-objects.css'

interface Props {
  objects: ConstructionObjects;
  selectedIds: readonly string[];
  onSelect: (id: string, additive?: boolean) => void;
  onAdd: () => void;
  onVisibility: (node: ConstructionObject) => void;
  disabled?: boolean;
}
export function ConstructionObjectsList({ objects, selectedIds, onSelect, onAdd, onVisibility, disabled }: Props) {
  const nodes = new Map(objects.nodes.map(node => [node.id, node]))
  const row = (id: string, index?: number, operation?: string) => {
    const node = nodes.get(id)!
    return <li key={id}>
      <div className={`object-row ${selectedIds.includes(id) ? 'is-selected' : ''}`}>
        <button className="object-select" disabled={disabled} aria-label={`Select object ${node.name}`} aria-pressed={selectedIds.includes(id)} onClick={event => onSelect(id, event.shiftKey || event.metaKey || event.ctrlKey)}>
          <Box size={16}/><span><strong>{node.name}</strong><small>{index !== undefined ? operation === 'subtract' ? index === 0 ? 'Keep' : 'Subtract' : `Operand ${index + 1}` : node.kind === 'box' ? 'Box' : node.operation}</small></span>
        </button>
        <button className="visibility-button" disabled={disabled} aria-label={`${visibilityAction(node)} object ${node.name}`} onClick={() => onVisibility({ ...node, ...nextVisibility(node) })}>{node.visible ? <Eye size={14}/> : node.wireframe ? <ScanEye size={14}/> : <EyeOff size={14}/>}</button>
      </div>
      {node.kind === 'boolean' && <ol className="object-children">{node.children.map((child, index) => row(child, index, node.operation))}</ol>}
    </li>
  }
  return <section aria-label="Construction objects">
    <div className="section-label"><span>CONSTRUCTION OBJECTS</span><span className="count-badge">{objects.roots.length}</span></div>
    <p className="field-note">Select boxes to combine them. Shift-click selects more. Blue shapes appear only in Studio.</p>
    <ol className="object-list">{objects.roots.map(id => row(id))}</ol>
    <Button className="add-panel-button" variant="outline" onClick={onAdd} disabled={disabled}><Plus size={16}/>Add a box</Button>
  </section>
}
