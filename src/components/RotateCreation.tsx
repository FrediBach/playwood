import { useState } from 'react'
import { RotateCcw, RotateCw } from 'lucide-react'
import { Button } from './ui/button'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { SelectField } from './fields'
import type { RotationAxis } from '@/lib/types'

export function RotateCreation({ onRotate, onCancel }: {
  onRotate: (axis: RotationAxis, degrees: number) => void
  onCancel: () => void
}) {
  const [axis, setAxis] = useState<RotationAxis>('z')
  const [angle, setAngle] = useState(90)
  return <>
    <DialogTitle>Rotate creation</DialogTitle>
    <DialogDescription>Turn or tilt the entire creation. All panels and connectors stay together.</DialogDescription>
    <SelectField label="Rotation axis" value={axis} onChange={value => setAxis(value as RotationAxis)}>
      <option value="z">Tilt sideways · Z</option>
      <option value="x">Tip forward / backward · X</option>
      <option value="y">Turn left / right · Y</option>
    </SelectField>
    <SelectField label="Rotation angle" value={String(angle)} onChange={value => setAngle(Number(value))}>
      <option value="90">90° · quarter turn</option>
      <option value="45">45° · diagonal</option>
    </SelectField>
    <p className="dialog-note">Rotates around the center and keeps the base at the same height. Undo is available.</p>
    <div className="dialog-footer rotation-actions">
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      <Button variant="outline" aria-label={`Rotate creation by −${angle}°`} onClick={() => onRotate(axis, -angle)}><RotateCcw size={16}/>−{angle}°</Button>
      <Button aria-label={`Rotate creation by +${angle}°`} onClick={() => onRotate(axis, angle)}><RotateCw size={16}/>+{angle}°</Button>
    </div>
  </>
}
