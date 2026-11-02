import { snapDistance, snapTargets, type SnapSettings } from '@/lib/preview-snap'
import { useMemo, useRef, useState } from 'react'
import { finishPreviewResize, movePreviewResize, preparePreviewResize } from '@/lib/preview-resize'
import { resolvePanels } from '@/lib/model'
import type { Project } from '@/lib/types'

/** Keep transient geometry out of autosave and commit each gesture once. */
export function usePreviewResize({ project, selectedIds, selectedConnectorIds, enabled, commit, notify, snapSettings }: {
  snapSettings: SnapSettings
  project: Project
  selectedIds: readonly string[]
  selectedConnectorIds: readonly string[]
  enabled: boolean
  commit: (project: Project) => void
  notify: (message: string) => void
}) {
  const panelId = selectedIds.length === 1 && !selectedConnectorIds.length ? selectedIds[0] : undefined
  const connectorId = selectedConnectorIds.length === 1 && !selectedIds.length ? selectedConnectorIds[0] : undefined
  const prepared = useMemo(() => {
    if (!enabled || (!panelId && !connectorId)) return null
    return preparePreviewResize(project, { panelId, connectorId })
  }, [project, panelId, connectorId, enabled])
  type Session = NonNullable<typeof prepared>
  type Result = ReturnType<typeof movePreviewResize>
  const session = useRef<{ source: Session; handleId: string; local: boolean } | null>(null)
  const latest = useRef<Result | null>(null)
  const [preview, setPreview] = useState<Result | null>(null)
  const current = session.current?.source === prepared ? preview : null
  const panels = useMemo(() => current ? resolvePanels(current.project) : null, [current])
  const handles = useMemo(() => (prepared?.handles ?? []).map(handle => {
    if (!current || !panels || handle.id !== session.current?.handleId) return handle
    const operation = prepared!.drivers.get(handle.id)!.operation
    const sizes = operation.kind === 'edge'
      ? panels.filter(panel => panel.id === operation.panelId).map(panel => ({
        label: operation.dimension === 'width' ? 'Width' : 'Height', value: panel[operation.dimension],
      }))
      : panels.flatMap(panel => {
        const before = prepared!.original.panels.find(item => item.id === panel.id)
        return (['width', 'height'] as const).filter(dimension => before && Math.abs(panel[dimension] - before[dimension]) > 1e-6)
          .map(dimension => ({ label: `${panel.name} · ${dimension === 'width' ? 'Width' : 'Height'}`, value: panel[dimension] }))
      })
    return { ...handle, sizes, position: handle.position.map((value, axis) => value + handle.direction[axis] * current.distance) as typeof handle.position }
  }), [prepared, current, panels])

  return {
    handles,
    snapProbe: current && session.current ? handles.find(handle => handle.id === session.current!.handleId) : undefined,
    active: !!current,
    project: current?.project,
    panels,
    distance: current?.distance,
    limited: current?.limited,
    start: (handleId: string, local = false) => {
      if (!prepared?.handles.some(handle => handle.id === handleId)) return false
      session.current = { source: prepared, handleId, local }
      latest.current = null
      setPreview({ project, distance: 0, limited: false })
      return true
    },
    move: (distance: number, keyboard = false) => {
      if (!session.current || session.current.source !== prepared) return
      try {
        const source = session.current.source
        const handle = source.handles.find(item => item.id === session.current!.handleId)!
        const targets = snapTargets(project, selectedIds, selectedConnectorIds, !!connectorId)
        const snapped = snapDistance(handle.position, handle.direction, Math.round(distance), targets, keyboard ? { ...snapSettings, tolerance: Math.min(snapSettings.tolerance, Math.abs(distance) * 0.45) } : snapSettings)
        const result = movePreviewResize(source, session.current.handleId, snapped, session.current.local)
        latest.current = result
        setPreview(result)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'This direction cannot preserve the connected panels.')
      }
    },
    end: (cancel: boolean) => {
      if (!cancel && latest.current && session.current?.source === prepared && Math.abs(latest.current.distance) > 1e-6) {
        try { commit(finishPreviewResize(session.current.source, session.current.handleId, latest.current, session.current.local).project) }
        catch (error) { notify(error instanceof Error ? error.message : 'This resize conflicts with a constraint.') }
      }
      session.current = null
      latest.current = null
      setPreview(null)
    },
  }
}
