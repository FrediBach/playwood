import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { OrbitControls } from 'three-stdlib'
import type { Vec3 } from '@/lib/types'

export interface PreviewDragProps {
  onDragStart?: () => boolean
  onDragMove?: (delta: Vec3, snapDistance: number) => void
  onDragEnd?: (cancel: boolean) => void
}

interface Gesture {
  pointerId: number
  panelId: string
  x: number
  y: number
  point: Vector3
  plane: Plane
  snapDistance: number
  started: boolean
  canDrag: boolean
  moved: boolean
  controls?: OrbitControls
  controlsEnabled: boolean
}

/** Capture Control-drag before OrbitControls, keeping ordinary clicks and camera gestures intact. */
export function PreviewDragMovement({ selectedIds, movementEnabled, onSelect, onDragStart, onDragMove, onDragEnd }: PreviewDragProps & {
  selectedIds: readonly string[]
  movementEnabled?: boolean
  onSelect: (id: string, additive: boolean) => void
}) {
  const { camera, scene, gl, controls, invalidate } = useThree()
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const [raycaster] = useState(() => new Raycaster())
  const pointAt = (x: number, y: number) => {
    const rect = gl.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new Vector2((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2), camera)
    return raycaster.ray
  }
  const finish = useEffectEvent((cancel: boolean) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    if (current.controls) current.controls.enabled = current.controlsEnabled
    if (gl.domElement.hasPointerCapture(current.pointerId)) gl.domElement.releasePointerCapture(current.pointerId)
    gl.domElement.style.cursor = ''
    document.body.style.cursor = ''
    if (current.started) onDragEnd?.(cancel)
    else if (!cancel && !current.moved) onSelect(current.panelId, true)
    invalidate()
  })
  const down = useEffectEvent((event: PointerEvent) => {
    suppressClick.current = false
    if (gesture.current || !movementEnabled || !onDragStart || event.button !== 0 || !event.ctrlKey || event.altKey || event.metaKey) return
    camera.updateMatrixWorld()
    scene.updateMatrixWorld(true)
    pointAt(event.clientX, event.clientY)
    const hit = raycaster.intersectObjects(scene.children, true).find(hit => typeof hit.object.userData.panelId === 'string')
    if (!hit) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), hit.point)
    const offset = pointAt(event.clientX + 14, event.clientY).intersectPlane(plane, new Vector3())
    const orbit = controls as OrbitControls | undefined
    gesture.current = {
      pointerId: event.pointerId, panelId: hit.object.userData.panelId,
      x: event.clientX, y: event.clientY, point: hit.point.clone(), plane,
      snapDistance: Math.min(60, Math.max(5, (offset?.distanceTo(hit.point) ?? 0.03) * 1000)),
      started: false, moved: false, canDrag: selectedIds.includes(hit.object.userData.panelId), controls: orbit, controlsEnabled: orbit?.enabled ?? true,
    }
    if (orbit) orbit.enabled = false
    suppressClick.current = true
    gl.domElement.focus({ preventScroll: true })
    gl.domElement.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopImmediatePropagation()
  })
  const move = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!current.started) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return
      current.moved = true
      if (!current.canDrag) return
      if (!onDragStart?.()) { finish(true); return }
      current.started = true
      gl.domElement.style.cursor = 'grabbing'
      document.body.style.cursor = 'grabbing'
    }
    const point = pointAt(event.clientX, event.clientY).intersectPlane(current.plane, new Vector3())
    if (point) onDragMove?.(point.sub(current.point).multiplyScalar(1000).toArray() as Vec3, current.snapDistance)
  })
  const up = useEffectEvent((event: PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    finish(event.type !== 'pointerup')
  })
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (!gesture.current) return
    // Keep shortcuts from changing the project underneath a pending drop.
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') finish(true)
  })
  const cancel = useEffectEvent(() => finish(true))
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (gesture.current) { event.preventDefault(); event.stopImmediatePropagation() }
  })
  useEffect(() => {
    const canvas = gl.domElement
    const click = (event: MouseEvent) => {
      if (suppressClick.current) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    canvas.addEventListener('pointerdown', down, true)
    canvas.addEventListener('click', click, true)
    canvas.addEventListener('dblclick', click, true)
    canvas.addEventListener('contextmenu', click, true)
    canvas.addEventListener('lostpointercapture', up)
    canvas.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    return () => {
      cancel()
      canvas.removeEventListener('pointerdown', down, true)
      canvas.removeEventListener('click', click, true)
      canvas.removeEventListener('dblclick', click, true)
      canvas.removeEventListener('contextmenu', click, true)
      canvas.removeEventListener('lostpointercapture', up)
      canvas.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
    }
  }, [gl, camera, movementEnabled])
  return null
}
