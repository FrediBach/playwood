import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import { DialogDescription, DialogTitle } from './ui/dialog'
import { SelectField } from './fields'
import { rotateProject } from '@/lib/model'
import { createLibraryDrawing, type LibraryDrawing } from '@/lib/library-preview'
import type { Project, RotationAxis } from '@/lib/types'
import './rotate-creation.css'

const axisHints: Record<RotationAxis, string> = {
  z: 'Tilt in the front view, like turning a picture on a wall.',
  x: 'Tip in the side view, like laying a shelf on its back.',
  y: 'Turn in the top view, like spinning furniture on the floor.',
}

function RotationDrawing({ drawing, label }: { drawing: LibraryDrawing; label: string }) {
  return <svg viewBox="0 0 240 155" role="img" aria-label={label}>
    {drawing.map((face, index) => <g key={index}>
      <polygon points={face.points} fill={face.color}/>
      <path d={face.outline} fill="none" stroke="#5f503c" strokeOpacity=".45" strokeWidth=".65" strokeLinejoin="round"/>
    </g>)}
  </svg>
}

export function RotateCreation({ project, onRotate, onCancel }: {
  project: Project
  onRotate: (axis: RotationAxis, degrees: number) => void
  onCancel: () => void
}) {
  const [axis, setAxis] = useState<RotationAxis>('z')
  const [angle, setAngle] = useState(90)
  const current = useMemo(() => createLibraryDrawing(project), [project])
  const results = useMemo(() => [-1, 1].map(direction => {
    const degrees = direction * angle
    try {
      return { degrees, drawing: createLibraryDrawing(rotateProject(project, axis, degrees)), error: '' }
    } catch (error) {
      return { degrees, drawing: null, error: error instanceof Error ? error.message : 'This rotation is unavailable.' }
    }
  }), [project, axis, angle])
  return <>
    <DialogTitle>Rotate creation</DialogTitle>
    <DialogDescription>Choose how to turn the whole build, then apply the result you want. All panels and connectors stay together.</DialogDescription>
    <div className="rotation-fields">
      <SelectField label="Rotation axis" value={axis} onChange={value => setAxis(value as RotationAxis)}>
        <option value="z">Tilt sideways · Z</option>
        <option value="x">Tip forward / backward · X</option>
        <option value="y">Turn left / right · Y</option>
      </SelectField>
      <SelectField label="Rotation angle" value={String(angle)} onChange={value => setAngle(Number(value))}>
        <option value="90">90° · quarter turn</option>
        <option value="45">45° · diagonal</option>
        <option value="180">180° · half turn</option>
      </SelectField>
    </div>
    <p className="rotation-hint">{axisHints[axis]}</p>
    <figure className="rotation-current">
      <RotationDrawing drawing={current} label="Current orientation"/>
      <figcaption><strong>Current orientation</strong><span>Compare the results below.</span></figcaption>
    </figure>
    <div className="rotation-results">
      {results.map(({ degrees, drawing, error }) => {
        const label = `${degrees < 0 ? '−' : '+'}${angle}°`
        return <div className="rotation-result" key={degrees < 0 ? 'negative' : 'positive'}>
          <strong>After {label}</strong>
          {drawing ? <RotationDrawing drawing={drawing} label={`Preview after ${label} around ${axis.toUpperCase()}`}/> : <p className="rotation-error" role="status">{error}</p>}
          <Button variant="outline" disabled={!drawing} aria-label={`Rotate creation by ${label}`} onClick={() => onRotate(axis, degrees)}>Apply {label}</Button>
        </div>
      })}
    </div>
    <p className="dialog-note rotation-note">{angle === 180 && 'Both directions give the same half turn. '}Includes hidden panels and separate pieces. The lowest panel stays at the same height. You can undo the rotation.</p>
    <p className="rotation-caption">Simplified previews · same viewing direction · fitted to each frame</p>
    <div className="dialog-footer rotation-footer"><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </>
}
