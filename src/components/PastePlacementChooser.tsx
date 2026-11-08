import { memo, useMemo, useRef, useEffect } from 'react'
import { ArrowLeft, CornerDownRight, Layers, X } from 'lucide-react'
import type { useCopyPaste } from '@/hooks/use-copy-paste'
import type { AssemblyAttachmentTarget } from '@/lib/assemblies'
import { createLibraryDrawing } from '@/lib/library-preview'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'
import { Button } from './ui/button'
import './paste-placement.css'

type Clipboard = ReturnType<typeof useCopyPaste>

const ArrangementDrawing = memo(function ArrangementDrawing({ source, target }: { source: Project; target: AssemblyAttachmentTarget }) {
  const drawing = useMemo(() => {
    const original = new Set(source.panels.map(panel => panel.id))
    const destination = target.location?.id.split('/')[0]
    const panels = resolvePanels(target.project!).filter(panel => !original.has(panel.id) || !destination || panel.id === destination)
      .map(panel => ({ ...panel, color: original.has(panel.id) ? '#a5af99' : '#e78b59' }))
    return createLibraryDrawing({ version: 1, name: '', panels, connections: [] })
  }, [source, target])
  return <svg viewBox="0 0 240 152" aria-hidden="true">{drawing.map((face, index) => <g key={index}><polygon points={face.points} fill={face.color}/><path d={face.outline} fill="none" stroke="#39452d" strokeWidth="0.7"/></g>)}</svg>
})

export function PastePlacementChooser({ clipboard, project }: { clipboard: Clipboard; project: Project }) {
  const { location, locations, hovered, pageLocations, locationPage } = clipboard
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef(location?.id)
  useEffect(() => {
    if (previous.current !== location?.id) heading.current?.focus()
    previous.current = location?.id
  }, [location?.id])
  return <section className="paste-chooser" aria-label="Attachment placement" onKeyDown={event => {
    if (event.key !== 'Escape' && !event.ctrlKey && !event.metaKey) event.stopPropagation()
  }}>
    <header>
      {location && <button className="paste-back" aria-label="Back to attachment locations" onClick={clipboard.back}><ArrowLeft size={17}/></button>}
      <div><small>{location ? 'STEP 2 OF 2' : 'STEP 1 OF 2'}</small><h2 ref={heading} tabIndex={-1}>{location ? 'How should it attach?' : 'Where should it attach?'}</h2></div>
      <button className="paste-close" aria-label="Cancel placement" onClick={clipboard.cancel}><X size={18}/></button>
    </header>
    <p>{location ? location.label : 'Choose a numbered edge or surface in the scene or below.'}</p>
    {location ? <>
      <div className="paste-legend"><span>● Existing panel</span><span>● Added panels</span></div>
      <div className="paste-arrangements" aria-label="Attachment arrangements">
        {location.targets.map((target, index) => {
          const shared = target.id.includes('/shared-panel') || target.label.includes('shared panel')
          const title = shared ? 'Share this panel' : target.label.includes('reverse') ? 'Reverse bend' : 'Corner attachment'
          const Icon = shared ? Layers : CornerDownRight
          const existingConnections = new Set(project.connections.map(connection => connection.id))
          const hardware = [...new Set(target.project!.connections.filter(connection => connection.count > 0 && !existingConnections.has(connection.id))
            .map(connection => connection.type === 't' ? 'T' : connection.type === 'cross' ? 'Cross' : `${connection.type}°`))]
          return <button key={target.id} className={`paste-arrangement ${hovered?.id === target.id ? 'is-selected' : ''}`}
            aria-label={`Preview arrangement ${index + 1}: ${title} · ${target.label}`} aria-pressed={hovered?.id === target.id}
            onFocus={() => clipboard.hover(target.id)} onPointerEnter={() => clipboard.hover(target.id)} onClick={() => clipboard.hover(target.id)}>
            <ArrangementDrawing source={project} target={target}/>
            <strong><Icon size={15}/>{title}</strong><span>{target.label.split(' → ')[0]}</span><span className="paste-hardware">{hardware.join(' + ')} connectors</span>
          </button>
        })}
      </div>
      {hovered?.warning && <p className="paste-warning" role="status">{hovered.warning}</p>}
      <footer><span>{hovered ? 'Preview only · Attach to keep' : 'Choose an arrangement to preview'}</span><Button disabled={!hovered} onClick={() => hovered && clipboard.attach(hovered.id)}>Attach {clipboard.inserting || 'copy'}</Button></footer>
    </> : <><div className="paste-locations">{pageLocations.map((item, index) => <button key={item.id}
      onPointerEnter={() => clipboard.hoverLocation(item.id)} onPointerLeave={() => clipboard.hoverLocation(null)}
      onFocus={() => clipboard.hoverLocation(item.id)} onBlur={() => clipboard.hoverLocation(null)}
      onClick={() => clipboard.chooseLocation(item.id)}><b>{locationPage * 8 + index + 1}</b><span>{item.label}</span><small>{item.targets.length} {item.targets.length === 1 ? 'option' : 'options'}</small></button>)}</div>{locations.length > 8 && <footer>
      <button disabled={!locationPage} onClick={() => clipboard.changeLocationPage(locationPage - 1)}>Previous locations</button>
      <span>{locationPage * 8 + 1}–{Math.min((locationPage + 1) * 8, locations.length)} of {locations.length}</span>
      <button disabled={(locationPage + 1) * 8 >= locations.length} onClick={() => clipboard.changeLocationPage(locationPage + 1)}>Next locations</button>
    </footer>}</>}
  </section>
}
