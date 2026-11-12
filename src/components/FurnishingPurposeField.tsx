import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { InspectorDisclosure } from './InspectorPrimitives'
import { FURNISHING_ROLE_CHOICES, FURNISHING_ROLE_LABELS, type FurnishingRoleChoice } from '@/lib/preview-furnishing-roles'
import { furnishingSurfaceCandidate } from '@/lib/preview-furnishings'
import type { Panel } from '@/lib/types'

const MIXED = '__mixed__'

/**
 * Optional Auto furnish purpose for selected level boards. `panels` are the
 * resolved selection; boards that cannot carry furnishings are left alone.
 */
export function FurnishingPurposeField({ panels, onChange }: { panels: Panel[]; onChange: (ids: string[], choice: FurnishingRoleChoice | 'auto') => void }) {
  const id = useId()
  const surfaces = panels.filter(furnishingSurfaceCandidate)
  if (!surfaces.length) return null
  const values = new Set(surfaces.map(panel => panel.furnishingRole ?? 'auto'))
  const value = values.size === 1 ? [...values][0] : MIXED
  const label = (choice: string) => choice === 'auto' ? 'Automatic' : choice === MIXED ? 'Mixed' : FURNISHING_ROLE_LABELS[choice as FurnishingRoleChoice].label
  const partial = surfaces.length < panels.length
  return <InspectorDisclosure title="Furnishing purpose" summary={label(value)} badge={value !== 'auto' && value !== MIXED ? { label: 'Set', description: 'A furnishing purpose replaces automatic recognition' } : undefined} preferenceKey="panel-furnishing">
    <label className="field" htmlFor={id}>
      <span>Furnish as</span>
      <div className="select-wrap">
        <select id={id} aria-label="Furnish as" value={value} onChange={event => { if (event.target.value !== MIXED) onChange(surfaces.map(panel => panel.id), event.target.value as FurnishingRoleChoice | 'auto') }}>
          {value === MIXED && <option value={MIXED} disabled>Mixed</option>}
          <option value="auto">Automatic</option>
          {FURNISHING_ROLE_CHOICES.map(choice => <option key={choice} value={choice}>{FURNISHING_ROLE_LABELS[choice].label}</option>)}
        </select>
        <ChevronDown size={14}/>
      </div>
    </label>
    <p className="field-note">Tells Auto furnish in Realistic preview what this surface is for. Automatic reads its height, size and surroundings.{partial ? ` Applies to the ${surfaces.length} level ${surfaces.length === 1 ? 'board' : 'boards'} in the selection.` : ''}</p>
  </InspectorDisclosure>
}
