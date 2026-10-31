import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { Vec3 } from '@/lib/types'
import type { PreviewResizeHandle } from '@/lib/preview-resize'
import './preview-resize-handles.css'

export type { PreviewResizeHandle } from '@/lib/preview-resize'

export interface PreviewResizeProps {
  handles: readonly PreviewResizeHandle[]
  enabled?: boolean
  distance?: number
  limited?: boolean
  keyboardStep?: number
  onResizeStart: (handleId: string) => boolean
  onResizeMove: (distanceMm: number, keyboard?: boolean) => void
  onResizeEnd: (cancel: boolean) => void
}

interface Gesture {
  handleId: string
  pointerId: number
  target: HTMLButtonElement
  x: number
  y: number
  point: Vector3
  plane: Plane
  axis: Vector3
  started: boolean
  controls?: OrbitControls
  controlsEnabled: boolean
  previousCursor: string
  arm: number
}

const MM = 0.001
const ARM = 48

/** Screen-sized handles whose drag plane contains the selected structural axis. */
export function PreviewResizeHandles({ handles, enabled = true, keyboardStep = 10, distance, limited, onResizeStart, onResizeMove, onResizeEnd }: PreviewResizeProps) {
  const { camera, gl, controls, size, invalidate } = useThree()
  // Drei's implicit target changes when R3F connects its event manager during
  // startup, which can unmount the HTML root while React is rendering it.
  const portal = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl])
  const projection = useMemo(() => ({ position: new Vector3(), origin: new Vector3(), tip: new Vector3(), axis: new Vector3(), towards: new Vector3() }), [])
  const elements = useRef(new Map<string, HTMLDivElement>())
  const gesture = useRef<Gesture | null>(null)
  const [raycaster] = useState(() => new Raycaster())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [requestedDistance, setRequestedDistance] = useState(0)
  const pointAt = (x: number, y: number, plane: Plane) => {
    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera)
    return raycaster.ray.intersectPlane(plane, new Vector3())
  }
  const finish = useEffectEvent((cancel: boolean) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (current.controls) current.controls.enabled = current.controlsEnabled
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId)
    document.body.style.cursor = current.previousCursor
    setActiveId(null)
    setRequestedDistance(0)
    if (current.started) onResizeEnd(cancel)
    invalidate()
  })
  const down = (event: PointerEvent<HTMLButtonElement>, handle: PreviewResizeHandle) => {
    event.preventDefault()
    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
    if (!enabled || gesture.current || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return
    camera.updateMatrixWorld()
    const axis = new Vector3(...handle.direction).normalize()
    const rootPosition = new Vector3(...handle.position).multiplyScalar(MM)
    const normal = camera instanceof OrthographicCamera ? camera.getWorldDirection(new Vector3()) : rootPosition.clone().sub(camera.position).normalize()
    // A facing plane that contains this axis gives a stable one-dimensional
    // movement, in perspective as well as orthographic views.
    normal.addScaledVector(axis, -normal.dot(axis))
    if (normal.lengthSq() < 0.0025) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), rootPosition)
    const point = pointAt(event.clientX, event.clientY, plane)
    if (!point) return
    const orbit = controls as OrbitControls | undefined
    gesture.current = {
      handleId: handle.id, pointerId: event.pointerId, target: event.currentTarget,
      x: event.clientX, y: event.clientY, point, plane, axis, started: false,
      controls: orbit, controlsEnabled: orbit?.enabled ?? true, previousCursor: document.body.style.cursor,
      arm: Number(event.currentTarget.parentElement?.dataset.resizeArm) || ARM,
    }
    if (orbit) orbit.enabled = false
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.style.cursor = 'grabbing'
    setActiveId(handle.id)
    setRequestedDistance(0)
    invalidate()
  }
  const move = useEffectEvent((event: globalThis.PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!current.started) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3) return
      if (!onResizeStart(current.handleId)) { finish(true); return }
      current.started = true
    }
    const point = pointAt(event.clientX, event.clientY, current.plane)
    if (!point) return
    const next = point.sub(current.point).dot(current.axis) / MM
    setRequestedDistance(next)
    onResizeMove(next)
    invalidate()
  })
  const up = useEffectEvent((event: globalThis.PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish(event.type !== 'pointerup')
  })
  const key = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (!gesture.current) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') finish(true)
  })
  const cancel = useEffectEvent(() => finish(true))
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (gesture.current) { event.preventDefault(); event.stopImmediatePropagation() }
  })
  const step = (event: KeyboardEvent<HTMLButtonElement>, handle: PreviewResizeHandle) => {
    if (event.ctrlKey || event.metaKey || event.altKey || gesture.current) return
    const sign = ['ArrowRight', 'ArrowUp', '+', '='].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowDown', '-'].includes(event.key) ? -1 : 0
    if (!sign) return
    event.preventDefault()
    event.stopPropagation()
    if (enabled && onResizeStart(handle.id)) {
      onResizeMove(sign * keyboardStep * (event.shiftKey ? 10 : 1), true)
      onResizeEnd(false)
    }
  }
  useEffect(() => {
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('lostpointercapture', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    window.addEventListener('wheel', wheel, { capture: true, passive: false })
    return () => {
      cancel()
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('lostpointercapture', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('wheel', wheel, true)
    }
  }, [gl, camera])
  useEffect(() => {
    if (!enabled || (gesture.current && !handles.some(handle => handle.id === gesture.current?.handleId))) cancel()
  }, [enabled, handles])
  useLayoutEffect(() => { invalidate() }, [handles, enabled, activeId, size, invalidate])
  useFrame(() => {
    camera.updateMatrixWorld()
    const placed: { x: number; y: number }[] = []
    for (const handle of handles) {
      const element = elements.current.get(handle.id)
      if (!element) continue
      const { position, origin, tip, axis, towards } = projection
      position.set(...handle.position).multiplyScalar(MM)
      origin.copy(position).project(camera)
      axis.set(...handle.direction)
      // Differentiate the projection at the root, rather than projecting a
      // fixed long arrow that could flip or distort close to the camera.
      tip.copy(position).addScaledVector(axis, 0.001).project(camera)
      const x = (origin.x + 1) * size.width / 2, y = (1 - origin.y) * size.height / 2
      const dx = (tip.x - origin.x) * size.width / 2, dy = (origin.y - tip.y) * size.height / 2
      const length = Math.hypot(dx, dy)
      if (camera instanceof OrthographicCamera) camera.getWorldDirection(towards)
      else towards.copy(position).sub(camera.position).normalize()
      const visible = enabled && (!activeId || activeId === handle.id) && origin.z >= -1 && origin.z <= 1
        && length > 0.0001 && Math.abs(towards.dot(axis)) < 0.995
        && (activeId === handle.id || (x >= 0 && x <= size.width && y >= 0 && y <= size.height))
      element.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) continue
      let arm = gesture.current?.handleId === handle.id ? gesture.current.arm : ARM
      // Some distinct structural axes overlap in a front or top view. Keep
      // each arrow reachable by lengthening its stem along the same axis.
      if (!activeId) for (let attempt = 0; attempt < handles.length; attempt++) {
        const buttonX = x + dx / length * arm, buttonY = y + dy / length * arm
        if (placed.every(other => Math.hypot(other.x - buttonX, other.y - buttonY) >= 34)) break
        arm += 36
      }
      placed.push({ x: x + dx / length * arm, y: y + dy / length * arm })
      element.dataset.resizeArm = String(arm)
      element.style.transform = `translate3d(${x}px,${y}px,0)`
      element.style.setProperty('--resize-angle', `${Math.atan2(dy, dx)}rad`)
      element.style.setProperty('--resize-arm', `${arm}px`)
      element.style.setProperty('--resize-x', `${dx / length * arm}px`)
      element.style.setProperty('--resize-y', `${dy / length * arm}px`)
      const caption = element.lastElementChild as HTMLSpanElement
      caption.style.maxWidth = `${Math.max(0, Math.min(240, size.width - 16))}px`
      const captionWidth = caption.offsetWidth || Math.min(240, size.width - 16)
      const captionHeight = caption.offsetHeight || 44
      const buttonX = x + dx / length * arm, buttonY = y + dy / length * arm
      const captionX = Math.max(captionWidth / 2 + 8, Math.min(size.width - captionWidth / 2 - 8, buttonX))
      const captionBelow = buttonY + 23
      const captionY = Math.max(8, Math.min(size.height - captionHeight - 8,
        captionBelow + captionHeight <= size.height - 8 ? captionBelow : buttonY - 23 - captionHeight))
      element.style.setProperty('--resize-caption-x', `${captionX - x}px`)
      element.style.setProperty('--resize-caption-y', `${captionY - y}px`)
    }
  })
  if (!handles.length || !enabled) return null
  const shownDistance = Math.round(distance ?? requestedDistance)
  return <Html fullscreen portal={portal} zIndexRange={[2, 2]} position={handles[0].position.map(value => value * MM) as Vec3}
    calculatePosition={(_object, _camera, viewport) => [viewport.width / 2, viewport.height / 2]}
    style={{ pointerEvents: 'none' }}>
    <div className="preview-resize-layer" aria-label="Resize selection">
      {handles.map(handle => <div key={handle.id} className={`preview-resize-anchor${activeId === handle.id ? ' is-active' : ''}`}
        ref={element => { if (element) { elements.current.set(handle.id, element); invalidate() } else elements.current.delete(handle.id) }}>
        <span className="preview-resize-root" aria-hidden="true" />
        <span className="preview-resize-stem" aria-hidden="true" />
        <button type="button" className="preview-resize-handle" aria-label={`Resize · ${handle.label}`} data-resize-handle={handle.id}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight" title={`${handle.label} · drag to pull or push. Arrow keys: ${keyboardStep} mm; Shift: ${keyboardStep * 10} mm.`}
          onPointerDown={event => down(event, handle)} onKeyDown={event => step(event, handle)}
          onPointerEnter={() => invalidate()} onFocus={() => invalidate()}
          onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 9h11M10 4l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span className={`preview-resize-caption${limited && activeId === handle.id ? ' is-limited' : ''}`}>
          {activeId === handle.id ? <>{shownDistance > 0 ? '+' : ''}{shownDistance} mm{limited ? ' · limit' : ''}<small>Release to resize · Esc to cancel</small></> : handle.label}
        </span>
      </div>)}
    </div>
  </Html>
}
