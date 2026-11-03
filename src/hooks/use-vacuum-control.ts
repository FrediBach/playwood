import { useEffect, useEffectEvent, useRef } from 'react'

export interface VacuumPlayback {
  phase: 'docked' | 'cleaning' | 'manual'
  elapsed: number
}

const IDLE_DELAY = 10_000
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const INPUT_OWNER = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="menu"],[role="menubar"],[role="list"],[role="listbox"],[role="grid"],[role="tree"],[role="tablist"],[role="radiogroup"],dialog,[role="dialog"],.preview-resize-handle'

function acceptsVacuumKeys(target: EventTarget | null) {
  return target instanceof Element && (target === document.body || !!target.closest('.workspace'))
    && !target.closest(INPUT_OWNER)
}

/** Owns preview-only keyboard input and sleeping timers; never edits the project. */
export function useVacuumControl(data: VacuumPlayback, enabled: boolean, invalidate: () => void, onResume: () => void, onTakeover: () => void) {
  const controls = useRef({ active: false, lastTime: 0, forward: 0, turn: 0 })
  const release = useRef<(() => void) | null>(null)
  const resumeRoute = useEffectEvent(onResume)
  const takeOver = useEffectEvent(onTakeover)
  const canDrive = useEffectEvent((event: KeyboardEvent) => enabled && !event.defaultPrevented && !event.isComposing
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !document.hidden
    && acceptsVacuumKeys(event.target) && !document.querySelector('dialog[open],[role="dialog"],[role="alertdialog"]'))

  useEffect(() => {
    const state = controls.current
    const pressed = new Set<string>()
    let remaining = IDLE_DELAY
    let waiting = true
    let waitStarted: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const updateAxes = () => {
      state.forward = Number(pressed.has('ArrowUp')) - Number(pressed.has('ArrowDown'))
      state.turn = Number(pressed.has('ArrowLeft')) - Number(pressed.has('ArrowRight'))
    }
    const pauseWait = () => {
      clearTimeout(timer)
      if (waitStarted !== null) {
        const elapsed = Math.min(remaining, performance.now() - waitStarted)
        data.elapsed += elapsed / 1000
        remaining = Math.max(0, remaining - elapsed)
        waitStarted = null
      }
    }
    const startWait = () => {
      if (!waiting || document.hidden) return
      waitStarted = performance.now()
      timer = setTimeout(() => {
        data.elapsed += remaining / 1000
        waitStarted = null
        remaining = 0
        waiting = false
        data.phase = 'cleaning'
        state.lastTime = 0
        resumeRoute()
        invalidate()
      }, remaining)
    }
    const releaseKeys = () => {
      if (!pressed.size) return
      pressed.clear()
      updateAxes()
      state.lastTime = 0
      pauseWait()
      waiting = true
      remaining = IDLE_DELAY
      startWait()
      invalidate()
    }
    const down = (event: KeyboardEvent) => {
      if (!ARROWS.has(event.key) || !canDrive(event) || (event.repeat && !pressed.has(event.key))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      pauseWait()
      waiting = false
      if (data.phase !== 'manual') { state.lastTime = 0; takeOver() }
      data.phase = 'manual'
      pressed.add(event.key)
      updateAxes()
      invalidate()
    }
    const up = (event: KeyboardEvent) => {
      if (!pressed.delete(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      updateAxes()
      if (!pressed.size) {
        state.lastTime = 0
        waiting = true
        remaining = IDLE_DELAY
        startWait()
      }
      invalidate()
    }
    const visibility = () => {
      releaseKeys()
      pauseWait()
      state.active = !document.hidden
      state.lastTime = 0
      if (state.active) { startWait(); invalidate() }
    }
    const focus = (event: FocusEvent) => {
      if (!acceptsVacuumKeys(event.target) || document.querySelector('dialog[open],[role="dialog"],[role="alertdialog"]')) releaseKeys()
    }
    state.active = !document.hidden
    state.lastTime = 0
    state.forward = state.turn = 0
    release.current = releaseKeys
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('focusin', focus)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', releaseKeys)
    startWait()
    return () => {
      clearTimeout(timer)
      pressed.clear()
      state.active = false
      state.forward = state.turn = state.lastTime = 0
      release.current = null
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('focusin', focus)
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', releaseKeys)
    }
  }, [data, invalidate])

  useEffect(() => { if (!enabled) release.current?.() }, [enabled])
  return controls
}
