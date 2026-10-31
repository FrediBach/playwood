import { useEffect, useRef, type ReactNode } from 'react'
import { Box, ChevronDown, Expand, Hand, House, Keyboard, Maximize, Minus, Plus } from 'lucide-react'
import { IconButton } from './editor-controls'
import { Tooltip } from './ui/tooltip'
import type { CameraView } from '@/lib/types'
import './viewport-controls.css'

interface Props {
  panMode: boolean
  onTogglePan: () => void
  realisticPreview: boolean
  view: CameraView
  onViewChange: (view: CameraView) => void
  onZoom: (direction: number) => void
  onFit: () => void
  exploded: boolean
  onToggleExploded: () => void
  status?: ReactNode
  notice?: ReactNode
  showTransformShortcuts?: boolean
  roomDetails?: ReactNode
}

export function ViewportControls({ panMode, onTogglePan, realisticPreview, view, onViewChange, onZoom, onFit, exploded, onToggleExploded, status, notice, showTransformShortcuts, roomDetails }: Props) {
  return <div className="viewport-dock">
    {roomDetails}
    {(notice || status || showTransformShortcuts) && <div className="viewport-guidance">
      {notice || (status && <div className="viewport-status" role="status">{status}</div>)}
      {showTransformShortcuts && <div className="viewport-selection-hints" aria-label="Selection shortcuts">
        <span><kbd>Ctrl + drag</kbd>Move &amp; snap</span>
        <span><kbd>X Y Z</kbd>Rotate 90°</span>
      </div>}
    </div>}
    <div className="viewport-controls-anchor">
    <div className="viewport-bar" role="group" aria-label="View controls">
      {realisticPreview
        ? <span className="viewport-room-label"><House size={16}/>Room view</span>
        : <div className="viewport-camera"><Box size={16}/>
          <select aria-label="Camera view" value={view} onChange={event => onViewChange(event.target.value as CameraView)}>
            <option value="perspective">Perspective</option><option value="front">Front</option><option value="top">Top</option><option value="right">Right</option>
          </select><ChevronDown size={12}/>
        </div>}
      <IconButton label="Pan view" aria-pressed={panMode} onClick={onTogglePan}><Hand size={17}/></IconButton>
      <span className="viewport-divider"/>
      <IconButton label="Zoom out" onClick={() => onZoom(-1)}><Minus size={17}/></IconButton>
      <IconButton label="Zoom in" onClick={() => onZoom(1)}><Plus size={17}/></IconButton>
      <span className="viewport-divider"/>
      <IconButton label={realisticPreview ? 'Reset room view (F)' : 'Fit assembly (F)'} onClick={onFit}><Maximize size={17}/></IconButton>
      {!realisticPreview && <IconButton label="Exploded view" aria-pressed={exploded} onClick={onToggleExploded}><Expand size={17}/></IconButton>}
      <span className="viewport-divider"/>
      <ViewportShortcuts panMode={panMode || (!realisticPreview && view !== 'perspective')} realisticPreview={realisticPreview}/>
    </div>
    </div>
  </div>
}

function ViewportShortcuts({ panMode, realisticPreview }: { panMode: boolean; realisticPreview: boolean }) {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.current?.contains(event.target) && details.current) details.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.current?.open) return
      event.preventDefault()
      event.stopPropagation()
      details.current.open = false
      details.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', escape, true)
    }
  }, [])
  return <details className="viewport-shortcuts" ref={details} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }}>
    <Tooltip label="Viewport shortcuts"><summary aria-label="Viewport shortcuts"><Keyboard size={18}/></summary></Tooltip>
    <div className="viewport-shortcuts-panel" role="region" aria-label="Viewport shortcuts">
      <h3>Navigation</h3>
      <dl>
        <div><dt>{panMode ? 'Pan' : 'Orbit'}</dt><dd><kbd>Drag</kbd></dd></div>
        <div><dt>Pan</dt><dd><kbd>Right-drag</kbd></dd></div>
        <div><dt>Zoom</dt><dd><kbd>Scroll</kbd></dd></div>
        <div><dt>{realisticPreview ? 'Reset room view' : 'Fit view'}</dt><dd><kbd>F</kbd></dd></div>
      </dl>
      <h3>Snapping</h3><dl><div><dt>Global grid</dt><dd><kbd>G</kbd></dd></div><div><dt>Geometry alignment</dt><dd><kbd>S</kbd></dd></div></dl>
      <h3>Selection</h3>
      <dl>
        {!realisticPreview && <div><dt>Multi-select</dt><dd><kbd>Shift + click</kbd></dd></div>}
        <div><dt>Move &amp; snap</dt><dd><kbd>Ctrl + drag</kbd></dd></div>
        <div><dt>Move 1 cm</dt><dd><kbd>↑ ↓ ← →</kbd></dd></div>
        <div><dt>Move 10 cm</dt><dd><kbd>Shift + arrows</kbd></dd></div>
        <div><dt>Rotate 90°</dt><dd><kbd>X</kbd><kbd>Y</kbd><kbd>Z</kbd></dd></div>
      </dl>
    </div>
  </details>
}
