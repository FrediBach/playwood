import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { getColorUsage, getProjectPalette, MAX_CUSTOM_COLORS } from '@/lib/custom-colors'
import type { PaletteColor, Project } from '@/lib/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import './palette-manager.css'

type ColorInput = Pick<PaletteColor, 'name' | 'color'>
export interface PaletteActions {
  onAddColor: (color: ColorInput) => void
  onUpdateColor: (id: string, color: ColorInput) => void
  onRemoveColor: (id: string, replacementColor?: string) => void
}

interface Props extends PaletteActions {
  project: Project
  open: boolean
  initialMode: 'add' | 'manage'
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

type PaletteView = { mode: 'manage' | 'add' } | { mode: 'edit' | 'remove'; id: string }

export function PaletteManager({ open, initialMode, onClose, onCloseAutoFocus, ...props }: Props) {
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose() }}>
    <DialogContent className="palette-manager-dialog" onCloseAutoFocus={onCloseAutoFocus}>
      <DialogTitle>Project palette</DialogTitle>
      <DialogDescription>Name and save colors for this project. Choose a swatch in the inspector to apply it to panels.</DialogDescription>
      {open && <PaletteManagerBody {...props} key={initialMode} initialMode={initialMode}/>}
    </DialogContent>
  </Dialog>
}

function PaletteManagerBody({ project, initialMode, onAddColor, onUpdateColor, onRemoveColor }: PaletteActions & { project: Project; initialMode: 'add' | 'manage' }) {
  const [view, setView] = useState<PaletteView>({ mode: initialMode })
  const colors = project.customColors ?? []
  const selected = 'id' in view ? colors.find(color => color.id === view.id) : undefined
  const back = () => setView({ mode: 'manage' })

  if (view.mode === 'add' || view.mode === 'edit' && selected) {
    return <ColorEditor key={selected ? `${selected.id}:${selected.name}:${selected.color}` : 'new'} project={project} existing={selected}
      onSave={input => { if (selected) onUpdateColor(selected.id, input); else onAddColor(input); back() }} onCancel={back}/>
  }
  if (view.mode === 'remove' && selected) {
    return <RemoveColor key={`${selected.id}:${selected.color}`} project={project} color={selected}
      onRemove={replacement => { onRemoveColor(selected.id, replacement); back() }} onCancel={back}/>
  }

  return <>
    <div className="palette-manager-heading"><h3>Custom colors <span>{colors.length}</span></h3>
      <Button variant="outline" size="sm" disabled={colors.length >= MAX_CUSTOM_COLORS} onClick={() => setView({ mode: 'add' })}><Plus size={14}/>Add color</Button>
    </div>
    {colors.length ? <ul className="palette-manager-list" aria-label="Custom colors">
      {colors.map(color => <li key={color.id}>
        <span className="palette-color-chip" style={{ background: color.color }} aria-hidden="true"/>
        <div className="palette-color-copy"><strong>{color.name}</strong><span>{color.color}</span></div>
        <button type="button" className="palette-row-action" aria-label={`Edit ${color.name}`} title={`Edit ${color.name}`} onClick={() => setView({ mode: 'edit', id: color.id })}><Pencil size={16}/></button>
        <button type="button" className="palette-row-action" aria-label={`Remove ${color.name}`} title={`Remove ${color.name}`} onClick={() => setView({ mode: 'remove', id: color.id })}><Trash2 size={16}/></button>
      </li>)}
    </ul> : <p className="palette-empty">Add your first custom color to make it available throughout this project.</p>}
    <p className="palette-manager-note">Standard colors are always available. Custom colors are for panels only.</p>
    {colors.length >= MAX_CUSTOM_COLORS && <p className="palette-manager-note">Remove a custom color before adding another.</p>}
  </>
}

function ColorEditor({ project, existing, onSave, onCancel }: { project: Project; existing?: PaletteColor; onSave: (input: ColorInput) => void; onCancel: () => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [hex, setHex] = useState(existing?.color ?? '#6f88a5')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')
  const normalized = hex.trim().toLowerCase()
  const validHex = /^#[0-9a-f]{6}$/.test(normalized)
  const duplicate = getProjectPalette(project).find(color => color.id !== existing?.id && color.color.toLowerCase() === normalized)
  const atLimit = !existing && (project.customColors?.length ?? 0) >= MAX_CUSTOM_COLORS
  const validation = !name.trim() ? 'Enter a color name.' : !validHex ? 'Enter a six-digit hex color, such as #123456.' : duplicate ? `This color is already in the palette as “${duplicate.name}”.` : atLimit ? 'Remove a custom color before adding another.' : ''

  return <form className="palette-color-editor" noValidate onSubmit={event => {
    event.preventDefault()
    setTouched(true)
    if (validation) return
    try { onSave({ name: name.trim(), color: normalized }) } catch (cause) { setError(cause instanceof Error ? cause.message : 'This color could not be saved.') }
  }}>
    <h3>{existing ? `Edit ${existing.name}` : 'Add a custom color'}</h3>
    <label className="field"><span>Color name</span><input aria-label="Color name" value={name} maxLength={60} required autoFocus onChange={event => { setName(event.target.value); setTouched(true); setError('') }}/></label>
    <div className="palette-color-values">
      <label className="palette-picker"><span>Color</span><input type="color" aria-label="Color value" value={validHex ? normalized : existing?.color ?? '#6f88a5'} onChange={event => { setHex(event.target.value); setTouched(true); setError('') }}/></label>
      <label className="field"><span>Hex color</span><input aria-label="Hex color" value={hex} maxLength={7} spellCheck={false} autoComplete="off" placeholder="#123456" onChange={event => { setHex(event.target.value); setTouched(true); setError('') }}/></label>
    </div>
    <p className="palette-manager-note">{existing ? `Saving updates all panels and assemblies using “${existing.name}”.` : 'Save this color to the palette, then select its swatch to apply it.'}</p>
    {(error || touched && validation) && <p className="palette-manager-error" role="alert">{error || validation}</p>}
    <div className="dialog-footer"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button type="submit" disabled={!!validation}>Save color</Button></div>
  </form>
}

function RemoveColor({ project, color, onRemove, onCancel }: { project: Project; color: PaletteColor; onRemove: (replacement?: string) => void; onCancel: () => void }) {
  const [replacement, setReplacement] = useState('')
  const [error, setError] = useState('')
  const usage = getColorUsage(project, color.color)
  const options = getProjectPalette(project).filter(option => option.id !== color.id)

  return <div className="palette-remove-color">
    <h3>Remove {color.name}?</h3>
    <p className="palette-manager-note">{usage.inUse ? 'This color is in use. Choose a replacement for all panels and assemblies using it.' : 'This color is not in use. Removing it only changes the project palette.'} You can undo this change.</p>
    {usage.inUse && <label className="field"><span>Replacement color</span><select aria-label="Replacement color" value={replacement} onChange={event => { setReplacement(event.target.value); setError('') }}>
      <option value="" disabled>Choose a replacement…</option>{options.map(option => <option key={option.id} value={option.color}>{option.name}</option>)}
    </select></label>}
    {error && <p className="palette-manager-error" role="alert">{error}</p>}
    <div className="dialog-footer"><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="destructive" disabled={usage.inUse && !replacement} onClick={() => {
      try { onRemove(usage.inUse ? replacement : undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : 'This color could not be removed.') }
    }}>Remove color</Button></div>
  </div>
}
