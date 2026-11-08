import { useMemo, useRef, useState } from 'react'
import type { PreviewConnectGestureProps } from '@/components/PreviewConnectGesture'
import { getConnectStrokeCandidate, type ConnectStrokeResult } from '@/lib/connect-stroke'
import { connectorId, parseConnectorId } from '@/lib/connector-selection'
import type { Project, Vec3 } from '@/lib/types'

interface StrokePreview {
  source: Project
  panelIds: string[]
  result: ConnectStrokeResult | null
}

/** Pointer candidates remain outside history; release accepts only the current source. */
export function useConnectStroke({ project, enabled, commit, notify, cancel }: {
  project: Project
  enabled: boolean
  commit: (change: (current: Project) => Project) => void
  notify: (message: string) => void
  cancel: () => void
}) {
  const session = useRef<{ source: Project; panelId: string; point: Vec3 } | null>(null)
  const latest = useRef<ConnectStrokeResult | null>(null)
  const [preview, setPreview] = useState<StrokePreview | null>(null)
  const current = enabled && preview?.source === project ? preview : null
  const result = current?.result
  const ghost = useMemo(() => {
    if (!result?.candidate || !result.connectorId) return undefined
    const [connectionId] = parseConnectorId(result.connectorId)
    const joint = connectionId.replace(/:\d+$/, '')
    const connections = result.candidate.connections.filter(connection => connection.id.replace(/:\d+$/, '') === joint)
    const connectorOverrides = { ...result.candidate.connectorOverrides }
    for (const connection of connections) for (let index = 0; index < connection.count; index++) {
      const id = connectorId(connection.id, index)
      if (id !== result.connectorId) connectorOverrides[id] = { ...connectorOverrides[id], removed: true }
    }
    return { connections, connectorOverrides }
  }, [result])
  const clear = () => { session.current = null; latest.current = null; setPreview(null) }
  const gesture: PreviewConnectGestureProps = {
    active: enabled,
    resetToken: project,
    onStart: (panelId, point) => {
      if (!enabled) return false
      session.current = { source: project, panelId, point }
      latest.current = null
      setPreview({ source: project, panelIds: [panelId], result: null })
      return true
    },
    onMove: hit => {
      const source = session.current
      if (!enabled || !source || source.source !== project) { clear(); return }
      if (!hit || hit.panelId === source.panelId) {
        latest.current = null
        setPreview({ source: project, panelIds: [source.panelId], result: null })
        return
      }
      try {
        latest.current = getConnectStrokeCandidate(project, { startPanelId: source.panelId, endPanelId: hit.panelId, start: source.point, end: hit.point })
      } catch (error) {
        latest.current = { candidate: null, reason: error instanceof Error ? error.message : 'A connector cannot fit here.' }
      }
      setPreview({ source: project, panelIds: [source.panelId, hit.panelId], result: latest.current })
    },
    onEnd: canceled => {
      const source = session.current, candidate = latest.current
      if (!canceled && enabled && source?.source === project && candidate?.candidate) {
        try {
          commit(currentProject => {
            if (currentProject !== source.source) throw new Error('The project changed. Draw the connection again.')
            return candidate.candidate!
          })
          notify('Connector added. Undo is available.')
        } catch (error) { notify(error instanceof Error ? error.message : 'This connector could not be added.') }
      } else if (!canceled && candidate?.reason) notify(candidate.reason)
      clear()
    },
    onCancel: () => { clear(); cancel() },
    status: result ? {
      valid: !!result?.candidate,
      message: result?.candidate ? `${result.type === 't' ? 'T' : result.type === 'cross' ? 'Cross' : `${result.type}°`} connector · release or click to add`
        : result?.reason || 'Choose another panel near the joint',
    } : undefined,
  }
  return { gesture, panelIds: current?.panelIds ?? [], preview: ghost }
}
