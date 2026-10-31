import { useEffect, useId, useRef, useState } from 'react'
import './finish-coverage-field.css'

interface Props {
  value: number
  mixed?: boolean
  disabled?: boolean
  onChange: (value: number) => boolean | void
}

/** One committed edit per drag or key press keeps finish changes easy to undo. */
export function FinishCoverageField({ value, mixed = false, disabled = false, onChange }: Props) {
  const id = useId()
  const [percent, setPercent] = useState(Math.round(value * 100))
  const edited = useRef(false)
  const unavailable = mixed || disabled
  useEffect(() => {
    setPercent(Math.round(value * 100))
    edited.current = false
  }, [value, mixed, disabled])

  const commit = (nextPercent: number) => {
    if (unavailable || !edited.current) return
    edited.current = false
    const next = nextPercent / 100
    if (next !== value && onChange(next) === false) setPercent(Math.round(value * 100))
  }
  const valueText = mixed ? 'Mixed' : `${percent}%${percent === 0 ? ' · Natural grain' : percent === 100 ? ' · Solid color' : ' coverage'}`
  return <label className={`field finish-coverage${unavailable ? ' field-disabled' : ''}`} htmlFor={id}>
    <span>Finish coverage <span className="field-hint">{mixed ? 'Mixed' : `${percent}%`}</span></span>
    <input id={id} aria-label="Finish coverage" aria-valuetext={valueText}
      type="range" min={0} max={100} step={1} value={mixed ? 50 : percent} disabled={unavailable}
      title={mixed ? 'Different finishes in the selection' : undefined}
      onChange={event => { edited.current = true; setPercent(Number(event.currentTarget.value)) }}
      onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
      onPointerUp={event => commit(Number(event.currentTarget.value))}
      onPointerCancel={() => { edited.current = false; setPercent(Math.round(value * 100)) }}
      onKeyUp={event => commit(Number(event.currentTarget.value))}
      onBlur={event => commit(Number(event.currentTarget.value))}/>
    <span className="finish-coverage-ends" aria-hidden="true"><span>Natural grain</span><span>Solid color</span></span>
  </label>
}
