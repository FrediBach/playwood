import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { Mesh, Object3D, Raycaster, Vector2 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { Vec3 } from '@/lib/types'
import './preview-connect-gesture.css'

export interface ConnectPanelHit { panelId: string; point: Vec3 }

export interface PreviewConnectGestureProps {
  active: boolean
  resetToken?: unknown
  onStart: (panelId: string, point: Vec3) => boolean
  onMove: (hit: ConnectPanelHit | null) => void
  onEnd: (cancel: boolean) => void
  onCancel: () => void
  status?: { valid: boolean; message: string }
}

interface ScreenPoint { x: number; y: number }
interface ConnectGesture {
  start: ScreenPoint
  pointerId: number | null
  moved: boolean
  secondPress: boolean
  controls?: OrbitControls
  controlsEnabled: boolean
}

function visiblePanel(object: Object3D) {
  if (!(object instanceof Mesh) || typeof object.userData.panelId !== 'string' || object.userData.trofastInsertId) return false
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  if (!materials.some(material => material.visible)) return false
  for (let parent: Object3D | null = object; parent; parent = parent.parent) if (!parent.visible) return false
  return true
}

function editableTarget(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
}

/** Own endpoint picking without changing selection or saved geometry. */
export function PreviewConnectGesture({ active, resetToken, onStart, onMove, onEnd, onCancel, status }: PreviewConnectGestureProps) {
  const { camera, scene, gl, controls, invalidate } = useThree()
  const portal = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl])
  const [raycaster] = useState(() => new Raycaster())
  const gesture = useRef<ConnectGesture | null>(null)
  const pointer = useRef<ScreenPoint | null>(null)
  const pendingFrame = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const [line, setLine] = useState<{ start: ScreenPoint; end: ScreenPoint } | null>(null)
  const [keyboardPoint, setKeyboardPoint] = useState<ScreenPoint | null>(null)

  const localPoint = (point: ScreenPoint) => {
    const rect = gl.domElement.getBoundingClientRect()
    return { x: point.x - rect.left, y: point.y - rect.top }
  }
  const hitAt = (point: ScreenPoint): ConnectPanelHit | null => {
    const rect = gl.domElement.getBoundingClientRect()
    if (point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom) return null
    camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    raycaster.setFromCamera(new Vector2((point.x - rect.left) / rect.width * 2 - 1, 1 - (point.y - rect.top) / rect.height * 2), camera)
    const hit = raycaster.intersectObjects(scene.children, true).find(item => visiblePanel(item.object))
    return hit ? { panelId: hit.object.userData.panelId, point: hit.point.multiplyScalar(1000).toArray() as Vec3 } : null
  }
  const clearFrame = () => {
    if (pendingFrame.current !== null) window.cancelAnimationFrame(pendingFrame.current)
    pendingFrame.current = null
  }
  const releasePointer = (current: ConnectGesture) => {
    const pointerId = current.pointerId
    current.pointerId = null
    if (pointerId !== null && gl.domElement.hasPointerCapture(pointerId)) gl.domElement.releasePointerCapture(pointerId)
  }
  const finish = useEffectEvent((cancel: boolean) => {
    clearFrame()
    const current = gesture.current
    gesture.current = null
    if (!current) return
    setLine(null)
    releasePointer(current)
    if (current.controls) current.controls.enabled = current.controlsEnabled
    onEnd(cancel)
    invalidate()
  })
  const preview = useEffectEvent((point: ScreenPoint) => {
    const current = gesture.current
    if (!current) return
    setLine({ start: localPoint(current.start), end: localPoint(point) })
    onMove(hitAt(point))
    invalidate()
  })
  const start = useEffectEvent((point: ScreenPoint) => {
    const orbit = controls as OrbitControls | undefined
    if (orbit) {
      // Finish camera damping before resolving the surface under the pointer.
      const damping = orbit.enableDamping
      orbit.enableDamping = false
      orbit.update()
      orbit.enableDamping = damping
    }
    const hit = hitAt(point)
    if (!hit || !onStart(hit.panelId, hit.point)) return false
    gesture.current = { start: point, pointerId: null, moved: false, secondPress: false, controls: orbit, controlsEnabled: orbit?.enabled ?? true }
    if (orbit) orbit.enabled = false
    setLine({ start: localPoint(point), end: localPoint(point) })
    invalidate()
    return true
  })
  const down = useEffectEvent((event: PointerEvent) => {
    suppressClick.current = false
    if (!active) return
    if (event.button !== 0) {
      if (gesture.current) { event.preventDefault(); event.stopImmediatePropagation() }
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    suppressClick.current = true
    gl.domElement.focus({ preventScroll: true })
    setKeyboardPoint(null)
    pointer.current = { x: event.clientX, y: event.clientY }
    const current = gesture.current
    if (current && current.pointerId !== null) return
    if (current) current.secondPress = true
    else if (!start(pointer.current)) return
    gesture.current!.pointerId = event.pointerId
    gl.domElement.setPointerCapture(event.pointerId)
    if (current) preview(pointer.current)
  })
  const move = useEffectEvent((event: PointerEvent) => {
    if (!active) return
    const current = gesture.current
    // Right/middle camera gestures remain available while Connect is armed.
    if (!current && event.buttons !== 0) return
    if (event.target === gl.domElement) event.stopImmediatePropagation()
    if (!current && event.target !== gl.domElement) return
    if (current?.pointerId !== null && current?.pointerId !== undefined && current.pointerId !== event.pointerId) return
    pointer.current = { x: event.clientX, y: event.clientY }
    setKeyboardPoint(null)
    if (!current) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) >= 4) current.moved = true
    if (pendingFrame.current !== null) return
    pendingFrame.current = window.requestAnimationFrame(() => {
      pendingFrame.current = null
      if (pointer.current) preview(pointer.current)
    })
  })
  const up = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type !== 'pointerup') { finish(true); return }
    clearFrame()
    pointer.current = { x: event.clientX, y: event.clientY }
    if (Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) >= 4) current.moved = true
    if (current.moved || current.secondPress) {
      // The last move can still be queued, so resolve the actual release point.
      preview(pointer.current)
      finish(false)
    } else releasePointer(current)
  })
  const cancel = useEffectEvent(() => {
    finish(true)
    setKeyboardPoint(null)
    onCancel()
  })
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (!active || event.defaultPrevented || event.isComposing || editableTarget(event.target)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      cancel()
      document.querySelector<HTMLButtonElement>('button[aria-label="Connect mode"]')?.focus({ preventScroll: true })
      return
    }
    if (event.key === 'Tab') { cancel(); return }
    if (document.activeElement !== gl.domElement) return
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    const choose = event.key === 'Enter' || event.key === ' '
    if ((direction || choose) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopImmediatePropagation()
      const rect = gl.domElement.getBoundingClientRect()
      const current = pointer.current ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const step = event.shiftKey ? 40 : 10
      const point = { x: Math.max(rect.left + 1, Math.min(rect.right - 1, current.x + (direction?.[0] ?? 0) * step)), y: Math.max(rect.top + 1, Math.min(rect.bottom - 1, current.y + (direction?.[1] ?? 0) * step)) }
      pointer.current = point
      setKeyboardPoint(localPoint(point))
      clearFrame()
      if (choose && !event.repeat) {
        if (gesture.current) { preview(point); finish(false) } else start(point)
      } else if (gesture.current) preview(point)
      invalidate()
    } else if (gesture.current) { event.preventDefault(); event.stopImmediatePropagation() }
  })
  const outside = useEffectEvent((event: PointerEvent) => {
    if (active && gesture.current && event.target !== gl.domElement) finish(true)
  })
  const blur = useEffectEvent(() => { if (active) cancel() })
  const wheel = useEffectEvent((event: Event) => {
    if (gesture.current) { event.preventDefault(); event.stopImmediatePropagation() }
  })
  const click = useEffectEvent((event: MouseEvent) => {
    if (active || suppressClick.current) { event.preventDefault(); event.stopImmediatePropagation() }
  })

  useEffect(() => {
    if (!active) return
    const canvas = gl.domElement, previousCursor = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    document.body.style.cursor = ''
    canvas.focus({ preventScroll: true })
    return () => { canvas.style.cursor = previousCursor; finish(true); setKeyboardPoint(null) }
  }, [active, gl])
  useEffect(() => { finish(true) }, [resetToken])
  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('click', click, true)
    canvas.addEventListener('dblclick', click, true)
    canvas.addEventListener('contextmenu', click, true)
    canvas.addEventListener('lostpointercapture', up)
    canvas.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', blur)
    return () => {
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('click', click, true)
      canvas.removeEventListener('dblclick', click, true)
      canvas.removeEventListener('contextmenu', click, true)
      canvas.removeEventListener('lostpointercapture', up)
      canvas.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', blur)
      finish(true)
    }
  }, [gl, camera])

  if (!active || (!line && !keyboardPoint)) return null
  return <Html fullscreen portal={portal} zIndexRange={[3, 3]}
    calculatePosition={(_object, _camera, viewport) => [viewport.width / 2, viewport.height / 2]}
    style={{ pointerEvents: 'none' }}>
    <div className={`preview-connect-layer${status?.valid ? ' is-valid' : status ? ' is-invalid' : ''}`} aria-label="Connection gesture">
      <svg className="preview-connect-line" aria-hidden="true">
        {line && <><line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} /><circle cx={line.start.x} cy={line.start.y} r="5" /><circle cx={line.end.x} cy={line.end.y} r="5" /></>}
        {keyboardPoint && <path className="preview-connect-crosshair" d={`M${keyboardPoint.x - 9},${keyboardPoint.y}h18M${keyboardPoint.x},${keyboardPoint.y - 9}v18`} />}
      </svg>
      <div className="preview-connect-status" role="status">
        <span>{line ? status?.message ?? 'Choose the second panel' : 'Move the crosshair to a panel'}</span>
        <small>{keyboardPoint ? 'Arrows to aim · Enter to choose · Esc to exit' : 'Drag or click another panel · Esc to exit'}</small>
      </div>
    </div>
  </Html>
}
