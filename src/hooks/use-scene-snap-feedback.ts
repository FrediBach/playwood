import { useEffect, useRef, useState } from 'react'
import { getSceneSnapGuides } from '@/lib/scene-snap-guides'
import type { Vec3 } from '@/lib/types'
import type { PreviewResizeMode } from '@/lib/preview-resize'
import type { SceneProps } from '@/components/Scene'

/** Keyboard feedback stays mounted across Studio/room and handle visibility changes. */
export function useSceneSnapFeedback(props: SceneProps) {
  const connectorSelection = (props.selectionKind ?? (props.selectedConnectorIds?.length ? 'connectors' : 'panels')) === 'connectors'
  const activePanelIds = connectorSelection ? [] : props.selectedIds
  const activeConnectorIds = connectorSelection ? props.selectedConnectorIds ?? [] : []
  const [keyboardSnap, setKeyboardSnap] = useState<{ direction: Vec3; selection: string; handleId?: string } | null>(null)
  const resizeHandleId = useRef<string | undefined>(undefined)
  const resizeMode = useRef<PreviewResizeMode>('connected')
  const selection = JSON.stringify([connectorSelection, activePanelIds, activeConnectorIds])
  useEffect(() => {
    if (!keyboardSnap) return
    const timer = window.setTimeout(() => setKeyboardSnap(null), 900)
    return () => window.clearTimeout(timer)
  }, [keyboardSnap])
  const recordMovement = (direction: Vec3) => setKeyboardSnap({ direction, selection })
  const onResizeStart: NonNullable<SceneProps['onResizeStart']> = (id, mode) => {
    const started = props.onResizeStart?.(id, mode) ?? false
    if (started) { resizeHandleId.current = id; resizeMode.current = mode ?? 'connected'; setKeyboardSnap(null) }
    return started
  }
  const onResizeMove: NonNullable<SceneProps['onResizeMove']> = (distance, keyboard) => {
    props.onResizeMove?.(distance, keyboard)
    const handle = props.resizeHandles?.find(item => item.id === resizeHandleId.current)
    if (keyboard && handle && resizeMode.current !== 'repeat') setKeyboardSnap({ direction: handle.direction, selection, handleId: handle.id })
  }
  return { connectorSelection, activePanelIds, activeConnectorIds, recordMovement, onResizeStart, onResizeMove,
    guides: getSceneSnapGuides(props, {connectorSelection, activePanelIds, activeConnectorIds}, keyboardSnap?.selection === selection ? keyboardSnap : null) }
}
