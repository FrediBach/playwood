import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Plus, SlidersHorizontal } from 'lucide-react'
import { getProjectPalette } from '@/lib/custom-colors'
import type { PaletteColor, Project } from '@/lib/types'
import { PaletteManager, type PaletteActions } from './PaletteManager'
import './panel-colors.css'

interface PanelPalette {
  colors: PaletteColor[]
  openManager: (mode: 'add' | 'manage') => void
}

const PanelPaletteContext = createContext<PanelPalette | null>(null)

export function PanelPaletteProvider({ project, onAddColor, onUpdateColor, onRemoveColor, children }: PaletteActions & {
  project: Project
  children: ReactNode
}) {
  const [mode, setMode] = useState<'add' | 'manage' | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const colors = useMemo(() => getProjectPalette(project), [project])
  const value = useMemo(() => ({ colors, openManager: (next: 'add' | 'manage') => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMode(next)
  } }), [colors])

  return <PanelPaletteContext.Provider value={value}>
    {children}
    <PaletteManager project={project} open={mode !== null} initialMode={mode ?? 'manage'} onClose={() => setMode(null)}
      onAddColor={onAddColor} onUpdateColor={onUpdateColor} onRemoveColor={onRemoveColor}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus() } }}/>
  </PanelPaletteContext.Provider>
}

export function PanelColorField({ color, mixed = false, disabled = false, onChange, label = 'Finish color' }: {
  color: string
  mixed?: boolean
  disabled?: boolean
  onChange: (color: string) => void
  label?: string
}) {
  const palette = useContext(PanelPaletteContext)
  const selectedColor = color.toLowerCase()
  const options = palette?.colors ?? []
  const selected = options.find(option => option.color.toLowerCase() === selectedColor)
  const unavailable = disabled || mixed

  return <div className="field panel-color-field">
    <span>{label} <span className="field-hint">{mixed ? 'Mixed' : selected?.name ?? 'Custom'}</span></span>
    <div className="swatches panel-color-swatches" role="group" aria-label={label}>
      {options.map(option => {
        const active = !mixed && selectedColor === option.color.toLowerCase()
        return <button key={option.id} type="button" className={`swatch ${active ? 'selected' : ''}`} style={{ background: option.color }}
          disabled={unavailable} title={`${option.name} · ${option.color}`} aria-label={`${option.name} finish`} aria-pressed={active} onClick={() => onChange(option.color)}>
          {active && <Check size={15} style={{ color: 'white', filter: 'drop-shadow(0 1px 1px #000)' }}/>}
        </button>
      })}
      {palette && <button type="button" className="custom-color panel-palette-add-swatch" title="Add color" aria-label="Add color" onClick={() => palette.openManager('add')}><Plus size={15}/></button>}
    </div>
    {palette && <div className="panel-palette-actions">
      <button type="button" className="panel-palette-manage" onClick={() => palette.openManager('manage')}><SlidersHorizontal size={13}/>Manage palette</button>
      <span className="panel-palette-note">Colors saved with this project.</span>
    </div>}
  </div>
}
