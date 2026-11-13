import { useCallback, useEffect, useState } from 'react'

/** Give the DOM overlay a paint before starting synchronous room generation. */
export function useRoomPreparation(requested: boolean) {
  const [state, setState] = useState({ requested, generation: 0, phase: 'waiting' as 'waiting' | 'rendering' | 'ready' })
  if (state.requested !== requested) {
    setState({ requested, generation: state.generation + 1, phase: 'waiting' })
  }
  const { generation } = state
  useEffect(() => {
    if (!requested) return
    let cancelled = false
    let frame = requestAnimationFrame(() => {
      // The first callback runs before paint; start work on the following frame.
      frame = requestAnimationFrame(() => {
        if (!cancelled) setState(current => current.generation === generation ? { ...current, phase: 'rendering' } : current)
      })
    })
    return () => { cancelled = true; cancelAnimationFrame(frame) }
  }, [requested, generation])

  const onRendered = useCallback(() => {
    setState(current => current.generation === generation && current.phase === 'rendering'
      ? { ...current, phase: 'ready' } : current)
  }, [generation])
  return {
    renderRoom: requested && state.requested === requested && state.phase !== 'waiting',
    preparing: requested && (state.requested !== requested || state.phase !== 'ready'),
    ready: requested && state.requested === requested && state.phase === 'ready',
    onRendered: requested && state.requested === requested && state.phase === 'rendering' ? onRendered : undefined,
  }
}
