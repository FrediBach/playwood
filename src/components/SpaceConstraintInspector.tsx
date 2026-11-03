import { useState } from 'react'
import type { Panel, SpaceConstraint } from '@/lib/types'
import { getDesignConstraintBounds } from '@/lib/design-constraints'
import { NumberField } from './fields'
import { Button } from './ui/button'
import './design-constraints.css'

export function SpaceConstraintInspector({ value, panels, onSave, onToggle }: { value?: SpaceConstraint; panels: Panel[]; onSave: (value: SpaceConstraint) => void; onToggle: (value: SpaceConstraint) => void }) {
  const [draft, setDraft] = useState<SpaceConstraint>(() => {
    const bounds = panels.map(getDesignConstraintBounds)
    const minX = Math.min(0, ...bounds.map(b => b.min[0])), maxX = Math.max(0, ...bounds.map(b => b.max[0]))
    const minZ = Math.min(0, ...bounds.map(b => b.min[2])), maxZ = Math.max(0, ...bounds.map(b => b.max[2]))
    return value ?? { enabled: false, width: Math.ceil(Math.max(1000, maxX - minX)), height: Math.ceil(Math.max(1000, ...bounds.map(b => b.max[1]))), depth: Math.ceil(Math.max(1000, maxZ - minZ)), centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 }
  })
  const [error, setError] = useState('')
  return <section className="design-constraints" aria-label="Build space">
    <h3>Build space</h3>
    <p className="field-note">Limit the build to a box resting on the floor. Dimensions and center positions are in millimeters. Includes hidden panels; hardware and accessories are not measured.</p>
    <label className="space-constraint-toggle"><input type="checkbox" checked={value?.enabled ?? false} onChange={e => {
      try { onToggle({ ...(value ?? draft), enabled: e.target.checked }); setError('') }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change build space.') }
    }}/>Enable build space</label>
    {(['width', 'height', 'depth', 'centerX', 'centerZ'] as const).map(key => <NumberField key={key} label={{ width: 'Space width', height: 'Space height', depth: 'Space depth', centerX: 'Space center X', centerZ: 'Space center Z' }[key]} value={draft[key]} min={key.startsWith('center') ? -100000 : 1} max={100000} nice={false} commitOnBlur onChange={n => setDraft(current => ({ ...current, [key]: n }))}/>)}
    {error && <p className="error-message" role="alert">{error}</p>}
    <Button variant="outline" className="full-button" onClick={() => { try { onSave({ ...draft, enabled: value?.enabled ?? false }); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save build space.') } }}>Save build space</Button>
  </section>
}
