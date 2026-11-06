import { Button } from './ui/button'
import { NumberField, SelectField } from './fields'
import { constructionBounds, moveConstructionSelection, resizeConstructionSelection } from '@/lib/object-geometry'
import type { useConstructionEditor } from '@/hooks/use-construction-editor'
import type { ConstructionObject, ConstructionObjects, ObjectBooleanOperation, Vec3 } from '@/lib/types'

type ObjectEditor = ReturnType<typeof useConstructionEditor>
interface InspectorProps { editor: ObjectEditor; disabled?: boolean; conversionReason?: string; onConvert: () => void }

export function ConstructionObjectInspector({ editor, disabled, conversionReason, onConvert }: InspectorProps) {
  const { objects, selectedIds, editing } = editor
  const selectedSet = new Set(selectedIds), rootSet = new Set(objects.roots)
  const selected = objects.nodes.filter(node => selectedSet.has(node.id)), node = selected.length === 1 ? selected[0] : undefined
  const roots = selected.length > 0 && selectedIds.every(id => rootSet.has(id))
  const bounds = constructionBounds(objects, selectedIds)
  return <section aria-label="Object inspector" onKeyDown={event => {
    if (event.key === 'Escape' && editing) { event.preventDefault(); event.stopPropagation(); editor.cancel() }
  }}>
    <h2 className="object-heading">{node ? node.name : selected.length ? `${selected.length} objects` : 'Shape your idea'}</h2>
    {!selected.length ? <p className="field-note">Add a box in Objects, then enter its outside dimensions and position. Select multiple top-level objects to combine them.</p> : <>
      <fieldset disabled={disabled} className="object-fields">
        {node && <label className="field"><span>Object name</span><input aria-label="Object name" value={node.name} maxLength={120} onChange={event => editor.update({ ...node, name: event.target.value })}/></label>}
        {node?.kind === 'box' && <BoxFields node={node} onChange={editor.update}/>}
        {node?.kind === 'boolean' && <BooleanFields node={node} objects={objects} onChange={editor.update}/>}
        {bounds && <><p className="field-note">Center position (mm){node?.kind !== 'box' ? ' · all selected source boxes' : ''}</p><div className="field-row">{(['X', 'Y', 'Z'] as const).map((axis, index) => <NumberField key={axis} label={`Object center ${axis}`} value={(bounds.min[index] + bounds.max[index]) / 2} min={-100000} max={100000} nice={false} commitOnBlur onChange={value => editor.change(source => moveConstructionSelection(source, selectedIds, [0, 0, 0].map((_, i) => i === index ? value - (bounds.min[index] + bounds.max[index]) / 2 : 0) as Vec3))}/>)}</div>
          {node?.kind !== 'box' && <div className="field-row">{(['width', 'height', 'depth'] as const).map((dimension, index) => <NumberField key={dimension} label={`Source ${dimension}`} value={bounds.max[index] - bounds.min[index]} min={1} max={10000} nice={false} commitOnBlur onChange={value => editor.change(source => resizeConstructionSelection(source, selectedIds, index as 0 | 1 | 2, value))}/>)}</div>}</>}
      </fieldset>
      <ObjectActions editor={editor} disabled={disabled} roots={roots} selectionCount={selected.length} conversionReason={conversionReason} onConvert={onConvert}/>
      <p className="field-note">Control-drag to move; drag an arrow to resize. Escape cancels. Focus the canvas for arrow-key movement, B box selection, or X/Y/Z rotation by 90°. Shift moves ten steps. Use Convert to panels when the object is ready.</p>
    </>}
  </section>
}

function BoxFields({ node, onChange }: { node: Extract<ConstructionObject, { kind: 'box' }>; onChange: (node: ConstructionObject) => void }) {
  return <><div className="field-row">{(['width', 'height', 'depth'] as const).map(dimension => <NumberField key={dimension} label={`Box ${dimension}`} value={node[dimension]} min={1} max={10000} nice={false} commitOnBlur onChange={value => onChange({ ...node, [dimension]: value })}/>)}</div>
          <div className="field-row">{(['X', 'Y', 'Z'] as const).map((axis, index) => <SelectField key={axis} label={`Box rotation ${axis}`} value={String(Math.round(node.rotation[index] / (Math.PI / 2) + 400) % 4)} onChange={value => onChange({ ...node, rotation: node.rotation.map((angle, i) => i === index ? Number(value) * Math.PI / 2 : angle) as Vec3 })}>{[0, 1, 2, 3].map(turn => <option key={turn} value={turn}>{turn * 90}°</option>)}</SelectField>)}</div></>
}

function BooleanFields({ node, objects, onChange }: { node: Extract<ConstructionObject, { kind: 'boolean' }>; objects: ConstructionObjects; onChange: (node: ConstructionObject) => void }) {
  return <><SelectField label="Boolean operation" value={node.operation} onChange={operation => onChange({ ...node, operation: operation as ObjectBooleanOperation })}><option value="union">Union</option><option value="subtract">Subtract</option><option value="intersect">Intersect</option></SelectField>
          <p className="field-note">Operands stay editable in the Objects list. Subtract keeps the first operand and removes the later ones.</p>
          <ol className="object-operands">{node.children.map((id, index) => <li key={id}><span>{objects.nodes.find(item => item.id === id)?.name}</span><button disabled={index === 0} aria-label={`Move operand ${index + 1} earlier`} onClick={() => { const children = [...node.children]; [children[index - 1], children[index]] = [children[index], children[index - 1]]; onChange({ ...node, children }) }}>↑</button></li>)}</ol></>
}

function ObjectActions({ editor, disabled, roots, selectionCount, conversionReason, onConvert }: InspectorProps & { roots: boolean; selectionCount: number }) {
  return <>
    {editor.editing ? <div className="object-actions"><Button onClick={editor.apply} disabled={disabled}>Apply object changes</Button><Button variant="outline" onClick={editor.cancel}>Cancel</Button></div> : <>
        <div className="object-actions">{(['X', 'Y', 'Z'] as const).map((axis, index) => <Button key={axis} variant="outline" disabled={disabled} onClick={() => editor.rotate(index as 0 | 1 | 2)}>Rotate {axis} 90°</Button>)}</div>
        {roots && selectionCount > 1 && <><p className="field-note">Subtraction order follows selection order. Review and reorder operands after combining.</p><div className="object-actions">{(['union', 'subtract', 'intersect'] as const).map(operation => <Button key={operation} variant="outline" disabled={disabled} onClick={() => editor.combine(operation)}>{operation === 'union' ? 'Union' : operation === 'subtract' ? 'Subtract' : 'Intersect'}</Button>)}</div></>}
        <div className="object-actions"><Button variant="outline" disabled={disabled || !roots} onClick={editor.duplicate}>Duplicate objects</Button><Button variant="ghost" disabled={disabled || !roots} onClick={editor.remove}>Remove objects</Button></div>
        <Button disabled={disabled || !!conversionReason} onClick={onConvert}>Convert to panels</Button>
        {conversionReason && <p className="field-note">{conversionReason}</p>}
        {!roots && <p className="field-note">To duplicate or remove this shape, select its top-level object.</p>}
      </>}
  </>
}
