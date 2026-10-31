import { useEffect, useEffectEvent, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { OrbitControls } from 'three-stdlib'
import { getBoxSelection } from '@/lib/box-selection'

export interface BoxSelection {
  panelIds: string[]
  connectorIds: string[]
}

export interface BoxSelectionPreview extends BoxSelection {
  rectangle: { left: number; top: number; width: number; height: number }
  additive: boolean
}

export interface BoxSelectionProps {
  boxSelectActive?: boolean
  resolveBoxPanelIds?: (ids: string[]) => string[]
  resolveBoxConnectorIds?: (ids: string[]) => string[]
  onBoxSelect?: (selection: BoxSelection, additive: boolean) => void
  onBoxSelectCancel?: () => void
}

/** Own the pointer before orbit, selection clicks, or movement can consume it. */
export function PreviewBoxSelection({ boxSelectActive = false, resolveBoxPanelIds, resolveBoxConnectorIds,
  onBoxSelect, onBoxSelectCancel, onPreview }: BoxSelectionProps & { onPreview: (preview: BoxSelectionPreview | null) => void }) {
  const { camera, scene, gl, controls, invalidate } = useThree()
  const gesture = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const preview = useEffectEvent((x: number, y: number, additive: boolean): BoxSelectionPreview | null => {
    const current = gesture.current
    if (!current) return null
    const rect = gl.domElement.getBoundingClientRect()
    current.x = Math.max(rect.left, Math.min(rect.right, x))
    current.y = Math.max(rect.top, Math.min(rect.bottom, y))
    if (Math.hypot(current.x - current.startX, current.y - current.startY) >= 4) current.moved = true
    if (!current.moved) return null
    const left = Math.min(current.startX, current.x) - rect.left
    const top = Math.min(current.startY, current.y) - rect.top
    const width = Math.abs(current.x - current.startX), height = Math.abs(current.y - current.startY)
    const bounds = {
      left: left / rect.width * 2 - 1, right: (left + width) / rect.width * 2 - 1,
      top: 1 - top / rect.height * 2, bottom: 1 - (top + height) / rect.height * 2,
    }
    const panelIds = getBoxSelection(scene, camera, bounds, 'panels')
    const connectorIds = getBoxSelection(scene, camera, bounds, 'connectors')
    const result = { rectangle: { left, top, width, height }, additive,
      panelIds: resolveBoxPanelIds?.(panelIds) ?? panelIds,
      connectorIds: resolveBoxConnectorIds?.(connectorIds) ?? connectorIds }
    onPreview(result)
    return result
  })
  const cancel = useEffectEvent(() => {
    const current = gesture.current
    gesture.current = null
    if (current && gl.domElement.hasPointerCapture(current.pointerId)) gl.domElement.releasePointerCapture(current.pointerId)
    onPreview(null)
    onBoxSelectCancel?.()
    invalidate()
  })
  const down = useEffectEvent((event: PointerEvent) => {
    suppressClick.current = false
    if (!boxSelectActive || event.button !== 0 || gesture.current) return
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false }
    suppressClick.current = true
    gl.domElement.focus({ preventScroll: true })
    gl.domElement.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopImmediatePropagation()
  })
  const move = useEffectEvent((event: PointerEvent) => {
    if (!boxSelectActive) return
    // Prevent hover affordances from replacing the crosshair while armed.
    if (event.target === gl.domElement) event.stopImmediatePropagation()
    if (gesture.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    preview(event.clientX, event.clientY, event.shiftKey)
  })
  const up = useEffectEvent((event: PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const result = event.type === 'pointerup' ? preview(event.clientX, event.clientY, event.shiftKey) : null
    cancel()
    if (result) onBoxSelect?.({ panelIds: result.panelIds, connectorIds: result.connectorIds }, result.additive)
  })
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (!boxSelectActive) return
    if (event.key === 'Shift') {
      const current = gesture.current
      if (current) preview(current.x, current.y, event.type === 'keydown')
      return
    }
    if (event.type !== 'keydown') return
    if (event.key === 'Tab') { cancel(); return }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape' || (!gesture.current && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'b')) cancel()
  })
  const outside = useEffectEvent((event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest('[aria-label="Box select (B)"]')) return
    if (boxSelectActive && event.target !== gl.domElement) cancel()
  })
  const blur = useEffectEvent(() => { if (boxSelectActive) cancel() })
  const wheel = useEffectEvent((event: Event) => {
    if (boxSelectActive) { event.preventDefault(); event.stopImmediatePropagation() }
  })
  useEffect(() => {
    if (!boxSelectActive) { if (gesture.current) cancel(); return }
    const orbit = controls as OrbitControls | undefined
    const wasEnabled = orbit?.enabled
    if (orbit) {
      const damping = orbit.enableDamping
      orbit.enableDamping = false
      orbit.update()
      orbit.enableDamping = damping
      orbit.enabled = false
    }
    document.body.style.cursor = ''
    gl.domElement.focus({ preventScroll: true })
    invalidate()
    return () => {
      if (orbit) orbit.enabled = wasEnabled ?? true
      cancel()
    }
  }, [boxSelectActive, controls, gl, invalidate])
  useEffect(() => {
    const canvas = gl.domElement
    const click = (event: MouseEvent) => {
      if (suppressClick.current) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('click', click, true)
    canvas.addEventListener('dblclick', click, true)
    canvas.addEventListener('contextmenu', wheel, true)
    canvas.addEventListener('lostpointercapture', up)
    canvas.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    window.addEventListener('blur', blur)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('click', click, true)
      canvas.removeEventListener('dblclick', click, true)
      canvas.removeEventListener('contextmenu', wheel, true)
      canvas.removeEventListener('lostpointercapture', up)
      canvas.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
      window.removeEventListener('blur', blur)
    }
  }, [gl])
  return null
}
