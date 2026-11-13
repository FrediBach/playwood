import { useEffect, useRef } from 'react'
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber'
import { LoaderCircle } from 'lucide-react'
import './room-preparation.css'

export function RoomPreparing() {
  return <div className="room-preparing" role="status" aria-live="polite" aria-atomic="true">
    <div className="room-preparing-card">
      <LoaderCircle className="room-preparing-spinner" size={30} aria-hidden="true" />
      <strong>Preparing realistic preview…</strong>
      <span>Setting up your room, lighting and furnishings.</span>
    </div>
  </div>
}

/** useFrame runs before drawing. Wait for this Canvas to finish its own frame,
 * including initial shader compilation, before revealing the generated room. */
function RoomFirstFrame({ onRendered }: { onRendered: () => void }) {
  const invalidate = useThree(state => state.invalidate)
  const rendered = useRef(false)
  useFrame(() => { rendered.current = true })
  useEffect(() => {
    rendered.current = false
    let delivered = false
    const unsubscribe = addAfterEffect(() => {
      if (!rendered.current || delivered) return
      delivered = true
      onRendered()
    })
    invalidate()
    return unsubscribe
  }, [invalidate, onRendered])
  return null
}

export function SceneUnavailable({ onSettled }: { onSettled?: () => void }) {
  useEffect(() => { onSettled?.() }, [onSettled])
  return <div style={{ padding: 32 }}>Your browser needs WebGL to display this 3D workspace.</div>
}

export function RoomRenderCompletion({ onRendered }: { onRendered?: () => void }) {
  return onRendered ? <RoomFirstFrame onRendered={onRendered} /> : null
}
