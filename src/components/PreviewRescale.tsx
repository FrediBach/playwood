import { ChevronRight } from 'lucide-react'
import type { usePreviewRescale } from '@/hooks/use-preview-rescale'
import './preview-rescale.css'

export function PreviewRescale({ control, step = 1 }: { control: ReturnType<typeof usePreviewRescale>; step?: number }) {
  if (!control.values.length && !control.pending && !control.error) return null
  return <details className="preview-rescale" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); control.cancel() }
  }}>
    <summary aria-description={`${control.values.length} sliders`}><ChevronRight size={14} aria-hidden="true"/>Rescale<span className="preview-rescale-count" aria-hidden="true">{control.values.length}</span></summary>
    <div role="group" aria-label="Common dimensions" aria-busy={control.pending}>
    {control.pending && <p role="status">Preparing dimensions…</p>}
    {control.values.map(value => {
      const amount = control.amount[value.id] ?? value.value
      const min = Math.ceil(value.min / step) * step
      const max = Math.floor(value.max / step) * step
      return <label className="preview-rescale-row" key={value.id}>
        <span title={`${value.count} matching panel dimensions`}>{Number(amount.toFixed(2))} <small>mm · {value.count} uses</small></span>
        <input type="range" aria-label={`Rescale ${value.value} mm dimension`} aria-valuetext={`${amount} millimeters, ${value.count} uses`}
          min={min} max={max} step={step} value={amount} disabled={control.disabled || min >= max}
          onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
          onChange={event => control.change(value.id, event.currentTarget.valueAsNumber)}
          onPointerUp={control.finish} onPointerCancel={control.cancel} onLostPointerCapture={control.finish}
          onKeyUp={event => { event.stopPropagation(); if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) control.finish() }}
          onBlur={control.finish}/>
      </label>
    })}
    {control.error && <p role="status">{control.error}</p>}
    </div>
  </details>
}
